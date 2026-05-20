/**
 * Build a "loans issued" + "disbursement" lookup from the Management dashboard's parsedReports.
 *
 * Each management report is a snapshot for a specific month. The metrics we care about per
 * product are:
 *   - Number of loans / Number of Loans   (for "Overall Loans Issued")
 *   - Disbursement this Month variants    (for "Overall Total disbursed")
 *
 * Products are keyed as: 'CS' | 'LBF' | 'SME' | 'Agrifinance' | 'Total'
 * Months are YYYY-MM keys.
 */

const pickMetric = (obj, names) => {
  if (!obj) return 0;
  for (const n of names) {
    if (obj[n] != null) return Number(obj[n]) || 0;
  }
  return 0;
};

const LOAN_COUNT_METRICS = ['Number of loans', 'Number of Loans', 'number of loans'];
const DISBURSEMENT_METRICS = [
  'Disbursement this Month',
  'Disbursement This Month',
  'Disbursements This Month',
  'disbursement this month',
];

const monthKey = (date) => {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/**
 * Returns a map:
 *   { [product]: { [monthKey]: { loans: number, disbursement: number } } }
 *
 * "Total" rolls up all products from the country-wide row, which includes Agrifinance.
 */
export const buildManagementIssuanceLookup = (parsedReports = []) => {
  const out = {
    CS: {},
    LBF: {},
    SME: {},
    Agrifinance: {},
    Total: {},
  };

  // Since each management report is one snapshot, iterate and merge by month key.
  // If multiple reports land in the same month (e.g. re-uploaded), the latest (highest date) wins.
  const byMonth = new Map(); // monthKey -> latest Date

  const assign = (product, mk, loans, disbursement) => {
    if (!out[product]) out[product] = {};
    out[product][mk] = {
      loans: (out[product][mk]?.loans || 0) + (Number(loans) || 0),
      disbursement: (out[product][mk]?.disbursement || 0) + (Number(disbursement) || 0),
    };
  };

  for (const report of parsedReports) {
    const date = report?.date ? (report.date instanceof Date ? report.date : new Date(report.date)) : null;
    const mk = monthKey(date);
    if (!mk) continue;

    // Track the most recent report per month to avoid double-counting.
    const prev = byMonth.get(mk);
    if (prev && prev.getTime() > date.getTime()) continue;
    byMonth.set(mk, date);

    // When we accept a newer report for the same month, reset existing aggregates for that month.
    for (const p of Object.keys(out)) {
      if (out[p][mk]) delete out[p][mk];
    }

    const cs = report.cs || {};
    const lbf = report.lbf || {};
    const sme = report.sme || {};
    const agri = report.agrifinance || {};
    const country = report.countrywise || {};

    assign('CS', mk, pickMetric(cs, LOAN_COUNT_METRICS), pickMetric(cs, DISBURSEMENT_METRICS));
    assign('LBF', mk, pickMetric(lbf, LOAN_COUNT_METRICS), pickMetric(lbf, DISBURSEMENT_METRICS));
    assign('SME', mk, pickMetric(sme, LOAN_COUNT_METRICS), pickMetric(sme, DISBURSEMENT_METRICS));
    assign('Agrifinance', mk, pickMetric(agri, LOAN_COUNT_METRICS), pickMetric(agri, DISBURSEMENT_METRICS));

    // "Total" comes from the Country row when present. Fallback to sum of products.
    let totalLoans = pickMetric(country, LOAN_COUNT_METRICS);
    let totalDisb = pickMetric(country, DISBURSEMENT_METRICS);
    if (!totalLoans) {
      totalLoans =
        (pickMetric(cs, LOAN_COUNT_METRICS) || 0) +
        (pickMetric(lbf, LOAN_COUNT_METRICS) || 0) +
        (pickMetric(sme, LOAN_COUNT_METRICS) || 0) +
        (pickMetric(agri, LOAN_COUNT_METRICS) || 0);
    }
    if (!totalDisb) {
      totalDisb =
        (pickMetric(cs, DISBURSEMENT_METRICS) || 0) +
        (pickMetric(lbf, DISBURSEMENT_METRICS) || 0) +
        (pickMetric(sme, DISBURSEMENT_METRICS) || 0) +
        (pickMetric(agri, DISBURSEMENT_METRICS) || 0);
    }
    assign('Total', mk, totalLoans, totalDisb);
  }

  return out;
};

export const getIssuance = (lookup, product, mk) => {
  if (!lookup || !lookup[product] || !lookup[product][mk]) {
    return { loans: 0, disbursement: 0 };
  }
  return lookup[product][mk];
};
