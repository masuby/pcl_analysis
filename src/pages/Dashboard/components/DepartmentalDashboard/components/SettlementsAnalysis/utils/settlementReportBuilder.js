import { resolveProductForBranch } from './zoneClusterParser';
import { monthLabelFor } from './transactionsParser';
import { getIssuance } from './managementIssuance';

/**
 * Aggregate transactions into monthly, per-product buckets combined with the
 * Management dashboard issuance/disbursement totals.
 *
 * Each product now also exposes a "Source of repayment" breakdown: transactions
 * are grouped by the `institution that buys the loan` column. Rows with an empty
 * institution are labelled "Cash Deposit".
 *
 * Output shape (per product, including the pseudo-product "Total"):
 *   monthly: [{ monthKey, monthLabel, settledLoans, issuedLoans, settledBalance,
 *               totalDisbursed, settledPctByCount, settledPctByAmount }],
 *   totals:  { settledLoans, issuedLoans, settledBalance, totalDisbursed },
 *   sources: [{ name, countPerMonth: [...], balancePerMonth: [...],
 *               totalCount, totalBalance }]
 *
 * Additionally the report exposes `institutions` — the full, ordered list of
 * institutions detected across the whole transactions file. Every product sheet
 * uses the same list for consistency.
 */

const CASH_DEPOSIT = 'Cash Deposit';

const normalizeInstitution = (raw) => {
  const s = String(raw ?? '').trim();
  return s.length ? s : CASH_DEPOSIT;
};

const sortInstitutions = (firstSeenMap) => {
  const names = [...firstSeenMap.keys()];
  return names.sort((a, b) => {
    if (a === CASH_DEPOSIT && b !== CASH_DEPOSIT) return -1;
    if (b === CASH_DEPOSIT && a !== CASH_DEPOSIT) return 1;
    const ta = firstSeenMap.get(a);
    const tb = firstSeenMap.get(b);
    return (ta?.getTime?.() ?? 0) - (tb?.getTime?.() ?? 0);
  });
};

export const buildSettlementReport = ({
  transactions = [],
  branchToProduct,
  issuanceLookup,
}) => {
  const monthsSet = new Set();
  const productsSet = new Set(['CS', 'LBF', 'SME', 'Agrifinance']);
  const unmappedCounts = new Map();

  // Monthly aggregates keyed by product/month.
  const agg = new Map(); // product -> month -> { count, sum }
  const totalAgg = new Map(); // month -> { count, sum }

  // Per-institution monthly aggregates:
  //   instAgg.get(product).get(institution).get(monthKey) -> { count, sum }
  //   totalInstAgg.get(institution).get(monthKey)         -> { count, sum }
  const instAgg = new Map();
  const totalInstAgg = new Map();
  const institutionFirstSeen = new Map(); // institution -> earliest creationDate

  const touch = (map, product, mk) => {
    if (!map.has(product)) map.set(product, new Map());
    const inner = map.get(product);
    if (!inner.has(mk)) inner.set(mk, { count: 0, sum: 0 });
    return inner.get(mk);
  };
  const touchTotal = (mk) => {
    if (!totalAgg.has(mk)) totalAgg.set(mk, { count: 0, sum: 0 });
    return totalAgg.get(mk);
  };
  const touchInstProduct = (product, inst, mk) => {
    if (!instAgg.has(product)) instAgg.set(product, new Map());
    const byInst = instAgg.get(product);
    if (!byInst.has(inst)) byInst.set(inst, new Map());
    const byMonth = byInst.get(inst);
    if (!byMonth.has(mk)) byMonth.set(mk, { count: 0, sum: 0 });
    return byMonth.get(mk);
  };
  const touchInstTotal = (inst, mk) => {
    if (!totalInstAgg.has(inst)) totalInstAgg.set(inst, new Map());
    const byMonth = totalInstAgg.get(inst);
    if (!byMonth.has(mk)) byMonth.set(mk, { count: 0, sum: 0 });
    return byMonth.get(mk);
  };

  for (const tx of transactions) {
    if (!tx.monthKey) continue;

    const product = resolveProductForBranch(branchToProduct, tx.branch) || 'Unmapped';
    if (product === 'Unmapped') {
      unmappedCounts.set(tx.branch || '(blank)', (unmappedCounts.get(tx.branch || '(blank)') || 0) + 1);
      continue;
    }

    monthsSet.add(tx.monthKey);
    productsSet.add(product);

    const amount = Number(tx.amount) || 0;
    const inst = normalizeInstitution(tx.institution);

    const prev = institutionFirstSeen.get(inst);
    if (!prev || (tx.creationDate instanceof Date && tx.creationDate < prev)) {
      institutionFirstSeen.set(inst, tx.creationDate instanceof Date ? tx.creationDate : prev || new Date(0));
    }

    const productBucket = touch(agg, product, tx.monthKey);
    productBucket.count += 1;
    productBucket.sum += amount;

    const totalBucket = touchTotal(tx.monthKey);
    totalBucket.count += 1;
    totalBucket.sum += amount;

    const instProdBucket = touchInstProduct(product, inst, tx.monthKey);
    instProdBucket.count += 1;
    instProdBucket.sum += amount;

    const instTotalBucket = touchInstTotal(inst, tx.monthKey);
    instTotalBucket.count += 1;
    instTotalBucket.sum += amount;
  }

  // Include months from issuance lookup so disbursed-only months still appear.
  if (issuanceLookup) {
    for (const product of Object.keys(issuanceLookup)) {
      for (const mk of Object.keys(issuanceLookup[product] || {})) {
        monthsSet.add(mk);
      }
    }
  }

  const months = [...monthsSet].sort();
  const institutions = sortInstitutions(institutionFirstSeen);

  const canonicalOrder = ['CS', 'LBF', 'SME', 'Agrifinance'];
  const extras = [...productsSet].filter((p) => !canonicalOrder.includes(p));
  const products = ['Total', ...canonicalOrder, ...extras];

  const perProduct = {};
  for (const product of products) {
    const productAgg = product === 'Total' ? totalAgg : agg.get(product) || new Map();
    const instForProduct = product === 'Total' ? totalInstAgg : instAgg.get(product) || new Map();
    const issuanceForProduct = issuanceLookup?.[product] || {};

    const monthly = months.map((mk) => {
      const cell = productAgg.get(mk) || { count: 0, sum: 0 };
      const issuance = getIssuance(issuanceLookup, product, mk);
      const settledLoans = cell.count;
      const settledBalance = cell.sum;
      const issuedLoans = issuance.loans || 0;
      const totalDisbursed = issuance.disbursement || 0;
      return {
        monthKey: mk,
        monthLabel: monthLabelFor(mk),
        settledLoans,
        issuedLoans,
        settledBalance,
        totalDisbursed,
        settledPctByCount: issuedLoans > 0 ? settledLoans / issuedLoans : 0,
        settledPctByAmount: totalDisbursed > 0 ? settledBalance / totalDisbursed : 0,
      };
    });

    const totals = monthly.reduce(
      (a, r) => ({
        settledLoans: a.settledLoans + r.settledLoans,
        issuedLoans: a.issuedLoans + r.issuedLoans,
        settledBalance: a.settledBalance + r.settledBalance,
        totalDisbursed: a.totalDisbursed + r.totalDisbursed,
      }),
      { settledLoans: 0, issuedLoans: 0, settledBalance: 0, totalDisbursed: 0 }
    );

    // Build the per-institution rows for this product. Skip institutions that
    // have zero activity in this product so per-product sheets stay clean,
    // but always keep the full `institutions` ordering available for callers.
    const sources = institutions
      .map((instName) => {
        const byMonth = instForProduct.get(instName) || new Map();
        const countPerMonth = months.map((mk) => byMonth.get(mk)?.count || 0);
        const balancePerMonth = months.map((mk) => byMonth.get(mk)?.sum || 0);
        const totalCount = countPerMonth.reduce((a, b) => a + b, 0);
        const totalBalance = balancePerMonth.reduce((a, b) => a + b, 0);
        return {
          name: instName,
          countPerMonth,
          balancePerMonth,
          totalCount,
          totalBalance,
        };
      })
      .filter((src) => src.totalCount > 0 || src.totalBalance > 0);

    perProduct[product] = {
      monthly,
      totals,
      sources,
      hasIssuance: Object.keys(issuanceForProduct).length > 0,
    };
  }

  const unmappedBranches = [...unmappedCounts.entries()]
    .map(([branch, count]) => ({ branch, count }))
    .sort((a, b) => b.count - a.count);

  return {
    products,
    months,
    institutions,
    perProduct,
    unmappedBranches,
    generatedAt: new Date(),
  };
};
