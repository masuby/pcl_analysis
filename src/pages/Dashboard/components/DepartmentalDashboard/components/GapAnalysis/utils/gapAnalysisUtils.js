/**
 * Gap Analysis utils: map MTD columns, build Branch (Team Leader) and RSM (Supervision) gap data.
 * CS, LBF, and SME are separate reports in the DB; fetch via getReportsByDepartmentAndType(department, 'MTD').
 * CS file columns (from MTD sheet): BRANCH/ TEAM LEADER, NEW LOANS TARGET, REFINANCE TARGET, MONTH TARGET,
 *   NEW LOANS (achieved), REFINANCE (achieved), VALUE (disbursement), COMMENT, Number of Active Reps.
 * LBF/SME file columns: first col = branch/team name, MONTH TARGET, VALUE, COMMENT, Number of Active Reps.
 * SME uses the same column map and gap row structure as LBF (buildLBFGapRows, ROW_ORDER_LBF).
 */

const num = (v) => {
  if (v == null || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Find first header that equals or includes any of the patterns (case-insensitive). */
const findCol = (headers, patterns) => {
  if (!headers || !Array.isArray(headers)) return null;
  const upper = (s) => String(s || '').toUpperCase().trim();
  for (const p of patterns) {
    const pu = upper(p);
    const found = headers.find((h) => {
      if (!h) return false;
      const hu = upper(h);
      return hu === pu || hu.includes(pu);
    });
    if (found) return found;
  }
  return null;
};

/** Find header matching patterns but excluding headers that contain any excludeSubstring (e.g. avoid matching "NEW LOANS TARGET" for "NEW LOANS"). */
const findColExcluding = (headers, patterns, excludeSubstrings) => {
  if (!headers || !Array.isArray(headers)) return null;
  const upper = (s) => String(s || '').toUpperCase().trim();
  const exclude = (excludeSubstrings || []).map(upper);
  for (const p of patterns) {
    const pu = upper(p);
    const found = headers.find((h) => {
      if (!h) return false;
      const hu = upper(h);
      const matches = hu === pu || hu.includes(pu);
      const excluded = exclude.some((ex) => hu.includes(ex));
      return matches && !excluded;
    });
    if (found) return found;
  }
  return null;
};

export const isZanzibar = (supervisionName) => {
  return String(supervisionName || '').toUpperCase().includes('ZANZIBAR');
};

/** Resolve column map for a product from parsed MTD headers. Exact names from CS/LBF MTD files. */
export const getColumnMap = (headers, product) => {
  if (!headers || !headers.length) return {};
  const H = headers;
  if (product === 'CS') {
    return {
      newLoansTarget: findCol(H, ['NEW LOANS TARGET', 'NEW LOAN TARGET']),
      refinanceTarget: findCol(H, ['REFINANCE TARGET']),
      monthTarget: findCol(H, ['MONTH TARGET']),
      newLoans: findColExcluding(H, ['NEW LOANS', 'NEW LOAN'], ['TARGET']),
      refinance: findColExcluding(H, ['REFINANCE'], ['TARGET']),
      value: findCol(H, ['VALUE']),
      comment: findCol(H, ['COMMENT']),
      activeReps: findCol(H, ['Number of Active Reps', 'NUMBER OF ACTIVE REPS', 'ACTIVE REPS']),
      minimumNoRequired: findCol(H, ['Minimum No. Required', 'MINIMUM NO. REQUIRED', 'MINIMUM NO REQUIRED']),
    };
  }
  if (product === 'LBF' || product === 'SME') {
    return {
      monthTarget: findCol(H, ['MONTH TARGET']),
      value: findCol(H, ['VALUE']),
      comment: findCol(H, ['COMMENT']),
      activeReps: findCol(H, ['Number of Active Reps', 'NUMBER OF ACTIVE REPS', 'ACTIVE REPS']),
      minimumNoRequired: findCol(H, ['Minimum No. Required', 'MINIMUM NO. REQUIRED', 'MINIMUM NO REQUIRED']),
    };
  }
  return {};
};

// Active target: from "Minimum No. Required" column if present, else fallback. Actual target = Active target * 1.4
const ACTUAL_TARGET_MULTIPLIER = 1.4;
const CS_ACTIVE_DIVISOR_MAINLAND = 3_000_000;
const CS_ACTIVE_DIVISOR_ZANZIBAR = 10_000_000;
const LBF_ACTIVE_DIVISOR = 10_000_000;
const ACTUAL_MULTIPLIER_ZANZIBAR = 1.2;

const pct = (achieved, target) => (target > 0 ? (achieved / target) * 100 : 0);
/** Accounting format: numbers with comma separators for readability */
const fmtNum = (n) =>
  Number.isFinite(n)
    ? Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
    : '-';
const fmtNumInt = (n) =>
  Number.isFinite(n)
    ? Math.round(n).toLocaleString('en-US')
    : '-';
const fmtPct = (n) =>
  Number.isFinite(n)
    ? Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%'
    : '-';

/** Row labels that are people counts: show 0 decimal places */
const PEOPLE_ROW_LABELS = ['Active Reps', 'Actual Reps', 'Active', 'Actual'];
const isPeopleRow = (rowLabel) => PEOPLE_ROW_LABELS.includes(rowLabel);
const normalizeActualAchieved = (activeAchieved, actualCandidate) => {
  const active = activeAchieved == null || activeAchieved === '' ? null : Math.round(num(activeAchieved));
  const actual = actualCandidate == null || actualCandidate === '' ? null : Math.round(num(actualCandidate));
  if (active == null && actual == null) return null;
  if (active == null) return actual;
  if (actual == null || actual < active) return active;
  return actual;
};

/** Build one gap row: Target, Achieved, Remaining, % Archived, % Unarchived, Comment (optional) */
const gapRow = (label, target, achieved, commentOnly = false) => {
  const t = num(target);
  const a = num(achieved);
  const rem = Math.max(0, t - a);
  const pctArch = pct(a, t);
  const pctUnarch = t > 0 ? 100 - pctArch : 0;
  return {
    rowLabel: label,
    Target: t,
    Achieved: a,
    Remaining: rem,
    '% Achived': pctArch,
    '% Unachived': pctUnarch,
    ...(commentOnly ? {} : { Comment: '' }),
  };
};

const gapRowWithComment = (label, target, achieved, commentText) => {
  const t = num(target);
  const a = num(achieved);
  const rem = Math.max(0, t - a);
  const pctArch = pct(a, t);
  const pctUnarch = t > 0 ? 100 - pctArch : 0;
  return {
    rowLabel: label,
    Target: t,
    Achieved: a,
    Remaining: rem,
    '% Achived': pctArch,
    '% Unachived': pctUnarch,
    Comment: commentText || '',
  };
};

/** Actual Reps row: Achieved left empty (null) until filled; Target/Remaining as integers */
const gapRowActualReps = (label, target, achieved) => {
  const t = Math.round(num(target));
  const a = achieved != null && achieved !== '' ? Math.round(num(achieved)) : null;
  const rem = Math.max(0, t - (a ?? 0));
  const pctArch = a != null && t > 0 ? (a / t) * 100 : 0;
  const pctUnarch = t > 0 ? 100 - pctArch : 0;
  return {
    rowLabel: label,
    Target: t,
    Achieved: a,
    Remaining: rem,
    '% Achived': pctArch,
    '% Unachived': pctUnarch,
    Comment: '',
  };
};

/** Build gap table rows for one CS team leader (or supervision aggregate row).
 *  Active/Actual targets: from "Minimum No. Required" if present (Actual = Min * 1.4), else fallback. */
export const buildCSGapRows = (rowData, colMap, supervisionName, actualRepsOverride) => {
  const monthTarget = num(rowData[colMap.monthTarget]);
  const value = num(rowData[colMap.value]);
  const comment = rowData[colMap.comment] != null ? String(rowData[colMap.comment]) : '';
  const activeRepsFromSheet = colMap.activeReps ? num(rowData[colMap.activeReps]) : null;

  const zan = isZanzibar(supervisionName);
  const activeDivisor = zan ? CS_ACTIVE_DIVISOR_ZANZIBAR : CS_ACTIVE_DIVISOR_MAINLAND;
  const minNoRequired = colMap.minimumNoRequired ? num(rowData[colMap.minimumNoRequired]) : null;
  // Active target: from "Minimum No. Required" as-is (no rounding); else fallback rounded to 1 decimal
  const activeTarget =
    minNoRequired != null && Number.isFinite(minNoRequired) && minNoRequired > 0
      ? minNoRequired
      : Math.round((monthTarget / activeDivisor) * 10) / 10;
  const actualTarget = Math.round(activeTarget * ACTUAL_TARGET_MULTIPLIER);
  const activeAchieved = activeRepsFromSheet != null ? Math.round(activeRepsFromSheet) : null;
  const actualCandidate = actualRepsOverride != null && actualRepsOverride !== '' ? num(actualRepsOverride) : null;
  const actualAchieved = normalizeActualAchieved(activeAchieved, actualCandidate);

  const newLoansTarget = num(rowData[colMap.newLoansTarget]);
  const newLoansAchieved = num(rowData[colMap.newLoans]);
  const refTarget = num(rowData[colMap.refinanceTarget]);
  const refAchieved = num(rowData[colMap.refinance]);

  const rows = [
    gapRow('New Loans', newLoansTarget, newLoansAchieved),
    gapRow('Repeat Loans', refTarget, refAchieved),
    gapRowWithComment('Monthly Disbursement (Month Target)', monthTarget, value, comment),
    gapRow('Active Reps', activeTarget, activeAchieved != null ? activeAchieved : activeTarget),
    gapRowActualReps('Actual Reps', actualTarget, actualAchieved),
  ];
  return rows;
};

/** Build gap table rows for one LBF/SME team leader (or supervision).
 *  Active/Actual targets: from "Minimum No. Required" if present (Actual = Min * 1.4), else fallback. */
export const buildLBFGapRows = (rowData, colMap, actualRepsOverride) => {
  const monthTarget = num(rowData[colMap.monthTarget]);
  const value = num(rowData[colMap.value]);
  const comment = rowData[colMap.comment] != null ? String(rowData[colMap.comment]) : '';
  const activeRepsFromSheet = colMap.activeReps ? num(rowData[colMap.activeReps]) : null;

  const minNoRequired = colMap.minimumNoRequired ? num(rowData[colMap.minimumNoRequired]) : null;
  // Active target: from "Minimum No. Required" as-is; else fallback rounded to 1 decimal
  const activeTarget =
    minNoRequired != null && Number.isFinite(minNoRequired) && minNoRequired > 0
      ? minNoRequired
      : Math.round((monthTarget / LBF_ACTIVE_DIVISOR) * 10) / 10;
  const actualTarget = Math.round(activeTarget * ACTUAL_TARGET_MULTIPLIER);
  const actualCandidate = actualRepsOverride != null && actualRepsOverride !== '' ? num(actualRepsOverride) : null;
  const actualAchieved = normalizeActualAchieved(activeRepsFromSheet != null ? Math.round(activeRepsFromSheet) : null, actualCandidate);

  const rows = [
    gapRowWithComment('Monthly Disbursement', monthTarget, value, comment),
    gapRow('Active', activeTarget, activeRepsFromSheet != null ? Math.round(activeRepsFromSheet) : activeTarget),
    gapRowActualReps('Actual', actualTarget, actualAchieved),
  ];
  return rows;
};

/** Build Branch section: list of { teamLeaderName, supervision, rows } for current product */
export const buildBranchData = (parsedData, product, actualRepsOverrides = {}) => {
  if (!parsedData?.groupedData || !parsedData?.headers) return [];
  const colMap = getColumnMap(parsedData.headers, product);
  const out = [];

  for (const sup of Object.values(parsedData.groupedData)) {
    const supervisionName = sup.supervision || '';
    for (const tl of sup.teamLeaders || []) {
      const name = tl.name || '';
      const key = `${name}|${supervisionName}`;
      const override = actualRepsOverrides[key];
      let rows;
      if (product === 'CS') {
        rows = buildCSGapRows(tl.data || {}, colMap, supervisionName, override);
      } else {
        rows = buildLBFGapRows(tl.data || {}, colMap, override);
      }
      out.push({
        teamLeaderName: name,
        supervision: supervisionName,
        rows,
        key,
      });
    }
  }
  return out;
};

const ROW_ORDER_CS = ['New Loans', 'Repeat Loans', 'Monthly Disbursement (Month Target)', 'Active Reps', 'Actual Reps'];
const ROW_ORDER_LBF = ['Monthly Disbursement', 'Active', 'Actual'];

/**
 * RSM section: built from one MTD report. Caller should pass parsedData for the report that is the
 * latest in the chosen month (e.g. Cluster KPI Analysis Feb 2026 → latest February MTD). Actual Reps
 * Achieved can be overridden via actualRepsOverrides (keyed RSM:SupervisionName or TL|Supervision),
 * e.g. from Gap Analysis localStorage for that reportId.
 */
const sumRowData = (rowsList, product) => {
  if (!rowsList.length) return [];
  const keys = ['Target', 'Achieved', 'Remaining', '% Achived', '% Unachived'];
  const byLabel = {};
  const order = product === 'CS' ? ROW_ORDER_CS : ROW_ORDER_LBF;
  for (const row of rowsList) {
    const label = row.rowLabel;
    if (!byLabel[label]) {
      byLabel[label] = { rowLabel: label, Comment: row.Comment || '' };
      keys.forEach((k) => (byLabel[label][k] = 0));
    }
    keys.forEach((k) => {
      if (k !== 'Comment' && typeof row[k] === 'number') byLabel[label][k] += row[k];
    });
    if (row.Comment) byLabel[label].Comment = row.Comment;
  }
  const recomp = (r) => {
    const t = num(r.Target);
    const a = num(r.Achieved);
    const rem = Math.max(0, t - a);
    const pctArch = pct(a, t);
    const pctUnarch = t > 0 ? 100 - pctArch : 0;
    const isActualRow = r.rowLabel === 'Actual Reps' || r.rowLabel === 'Actual';
    return {
      rowLabel: r.rowLabel,
      Target: t,
      Achieved: isActualRow && a === 0 ? null : a,
      Remaining: rem,
      '% Achived': pctArch,
      '% Unachived': pctUnarch,
      Comment: r.Comment || '',
    };
  };
  const ordered = order.filter((l) => byLabel[l]).map((l) => recomp(byLabel[l]));
  const rest = Object.keys(byLabel).filter((l) => !order.includes(l)).map((l) => recomp(byLabel[l]));
  return [...ordered, ...rest];
};

export const buildRSMData = (parsedData, product, actualRepsOverrides = {}) => {
  if (!parsedData?.groupedData || !parsedData?.headers) return [];
  const colMap = getColumnMap(parsedData.headers, product);
  const out = [];

  for (const sup of Object.values(parsedData.groupedData)) {
    const supervisionName = sup.supervision || '';
    const allRows = [];
    for (const tl of sup.teamLeaders || []) {
      const key = `${tl.name || ''}|${supervisionName}`;
      const override = actualRepsOverrides[key];
      if (product === 'CS') {
        allRows.push(...buildCSGapRows(tl.data || {}, colMap, supervisionName, override));
      } else {
        allRows.push(...buildLBFGapRows(tl.data || {}, colMap, override));
      }
    }
    const summedRows = sumRowData(allRows, product);

    const hasSupervisionRow =
      sup.supervisionData &&
      typeof sup.supervisionData === 'object' &&
      Object.keys(sup.supervisionData).length > 0 &&
      supervisionName !== 'All';

    const rsmKey = 'RSM:' + supervisionName;
    const rsmOverride = actualRepsOverrides[rsmKey];

    let rows;
    if (hasSupervisionRow) {
      // Use supervision row for all metrics; Actual Reps Achieved = sum of team leaders in this supervision (or override)
      rows =
        product === 'CS'
          ? buildCSGapRows(sup.supervisionData, colMap, supervisionName, undefined)
          : buildLBFGapRows(sup.supervisionData, colMap, undefined);
      const actualLabel = product === 'CS' ? 'Actual Reps' : 'Actual';
      const actualAchievedSum = allRows
        .filter((r) => r.rowLabel === actualLabel)
        .reduce((s, r) => s + (r.Achieved != null && r.Achieved !== '' ? Number(r.Achieved) : 0), 0);
      const activeLabel = product === 'CS' ? 'Active Reps' : 'Active';
      const activeRow = rows.find((r) => r.rowLabel === activeLabel);
      const activeAchieved = activeRow?.Achieved != null && activeRow?.Achieved !== '' ? Number(activeRow.Achieved) : null;
      const actualAchieved = normalizeActualAchieved(activeAchieved, rsmOverride != null && rsmOverride !== '' ? Number(rsmOverride) : actualAchievedSum);
      rows = rows.map((r) => {
        if (r.rowLabel !== actualLabel) return r;
        const t = num(r.Target);
        const a = actualAchieved;
        const rem = Math.max(0, t - a);
        const pctArch = t > 0 ? (a / t) * 100 : 0;
        const pctUnarch = t > 0 ? 100 - pctArch : 0;
        return {
          ...r,
          Achieved: a,
          Remaining: rem,
          '% Achived': pctArch,
          '% Unachived': pctUnarch,
        };
      });
    } else {
      rows = summedRows;
      if (rsmOverride != null && rsmOverride !== '') {
        const actualLabel = product === 'CS' ? 'Actual Reps' : 'Actual';
        rows = rows.map((r) =>
          r.rowLabel === actualLabel
            ? { ...r, Achieved: Number(rsmOverride) }
            : r
        );
      }
    }
    out.push({ supervision: supervisionName, key: rsmKey, rows });
  }
  return out;
};

const MONTH_NAMES_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const isMovementRowLabel = (product, rowLabel) =>
  product === 'CS'
    ? rowLabel === 'Active Reps' || rowLabel === 'Actual Reps'
    : rowLabel === 'Active' || rowLabel === 'Actual';

const recomputeRow = (base, target, achieved) => {
  const t = num(target);
  const a = achieved == null || achieved === '' ? null : num(achieved);
  const rem = Math.max(0, t - (a ?? 0));
  const pctArch = a != null && t > 0 ? (a / t) * 100 : 0;
  const pctUnarch = t > 0 ? 100 - pctArch : 0;
  return {
    ...base,
    Target: t,
    Achieved: a,
    Remaining: rem,
    '% Achived': pctArch,
    '% Unachived': pctUnarch,
  };
};

/** Build YTD trend rows with month columns (Achieved trend) + Cumulative.
 *  Additive rows: cumulative = sum Jan..latest.
 *  Movement rows (Active/Actual): cumulative = latest month value.
 */
export const buildYTDGapData = (monthlyParsedData = [], product, actualRepsOverrides = {}) => {
  const sorted = [...(monthlyParsedData || [])]
    .filter((m) => m && m.month && m.parsedData !== false)
    .sort((a, b) => Number(a.month) - Number(b.month));
  if (sorted.length === 0) return { monthColumns: [], branchData: [], rsmData: [], grandTotalRows: [] };

  const monthColumns = sorted.map((m) => MONTH_NAMES_SHORT[Math.max(0, Math.min(11, Number(m.month) - 1))]);
  const latest = sorted[sorted.length - 1];

  const monthlyBranch = sorted.map((m) => ({
    month: m.month,
    monthLabel: MONTH_NAMES_SHORT[Math.max(0, Math.min(11, Number(m.month) - 1))],
    data: buildBranchData(m, product, actualRepsOverrides),
  }));
  const monthlyRsm = sorted.map((m) => ({
    month: m.month,
    monthLabel: MONTH_NAMES_SHORT[Math.max(0, Math.min(11, Number(m.month) - 1))],
    data: buildRSMData(m, product, actualRepsOverrides),
  }));

  const latestBranchData = buildBranchData(latest, product, actualRepsOverrides);
  const latestRsmData = buildRSMData(latest, product, actualRepsOverrides);

  const buildEntity = (latestEntities, monthlyEntities, getKey, withNames = false) => {
    return latestEntities.map((entity) => {
      const key = getKey(entity);
      const rowMap = new Map();
      (entity.rows || []).forEach((r) => {
        rowMap.set(r.rowLabel, {
          ...r,
          __monthTarget: {},
          __monthAchieved: {},
          Cumulative: 0,
        });
      });

      monthlyEntities.forEach((pack) => {
        const found = (pack.data || []).find((x) => getKey(x) === key);
        if (!found) return;
        (found.rows || []).forEach((r) => {
          const row = rowMap.get(r.rowLabel);
          if (!row) return;
          row.__monthTarget[pack.monthLabel] = typeof r.Target === 'number' ? r.Target : 0;
          row.__monthAchieved[pack.monthLabel] = r.Achieved == null || r.Achieved === '' ? null : Number(r.Achieved);
        });
      });

      const rows = Array.from(rowMap.values()).map((row) => {
        const isMovement = isMovementRowLabel(product, row.rowLabel);
        const monthAch = {};
        const monthlyMetrics = {};
        monthColumns.forEach((m) => {
          const tRaw = Number(row.__monthTarget[m] || 0);
          const aRaw = row.__monthAchieved[m];
          const aNum = aRaw == null || aRaw === '' ? null : Number(aRaw);
          const t = isMovement ? Math.round(tRaw) : tRaw;
          const a = aNum == null ? null : (isMovement ? Math.round(aNum) : aNum);
          const rem = Math.max(0, t - (a ?? 0));
          const pctA = a != null && t > 0 ? (a / t) * 100 : 0;
          const pctU = t > 0 ? 100 - pctA : 0;
          monthAch[m] = a == null ? '' : a;
          monthlyMetrics[m] = {
            Target: t,
            Achieved: a,
            Remaining: rem,
            '% Achived': pctA,
            '% Unachived': pctU,
            Grade: getGradeFromPctArchived(pctA),
            Comment: getCommentFromPctArchived(pctA),
          };
        });
        const targetVals = monthColumns.map((m) => Number(row.__monthTarget[m] || 0));
        const achVals = monthColumns.map((m) => (row.__monthAchieved[m] == null ? 0 : Number(row.__monthAchieved[m])));
        const latestTarget = targetVals[targetVals.length - 1] || 0;
        const latestAch = row.__monthAchieved[monthColumns[monthColumns.length - 1]];
        const cumulativeTarget = isMovement ? Math.round(latestTarget) : targetVals.reduce((a, b) => a + b, 0);
        const cumulativeAch = isMovement ? (latestAch == null ? null : Math.round(Number(latestAch))) : achVals.reduce((a, b) => a + b, 0);
        const recomputed = recomputeRow(row, cumulativeTarget, cumulativeAch);
        return {
          ...recomputed,
          ...monthAch,
          __monthlyMetrics: monthlyMetrics,
          Cumulative: cumulativeAch == null ? '' : cumulativeAch,
        };
      });

      return withNames
        ? { ...entity, rows }
        : { ...entity, rows };
    });
  };

  const branchData = buildEntity(latestBranchData, monthlyBranch, (x) => x.key, true);
  const rsmData = buildEntity(latestRsmData, monthlyRsm, (x) => x.key, false);

  const colMap = getColumnMap(latest.headers, product);
  const grandBase = latest.grandTotalRow
    ? (product === 'CS' ? buildCSGapRows(latest.grandTotalRow, colMap, '') : buildLBFGapRows(latest.grandTotalRow, colMap, undefined))
    : [];
  const grandByLabel = new Map((grandBase || []).map((r) => [r.rowLabel, { ...r }]));
  branchData.forEach((b) => {
    b.rows.forEach((r) => {
      const g = grandByLabel.get(r.rowLabel);
      if (!g) return;
      if (!g.__monthTarget) g.__monthTarget = {};
      if (!g.__monthAchieved) g.__monthAchieved = {};
      monthColumns.forEach((m) => {
        const mm = r.__monthlyMetrics?.[m] || {};
        g.__monthTarget[m] = (Number(g.__monthTarget[m] || 0) || 0) + Number(mm.Target || 0);
        g.__monthAchieved[m] = (Number(g.__monthAchieved[m] || 0) || 0) + Number(mm.Achieved || 0);
      });
    });
  });
  const grandTotalRows = Array.from(grandByLabel.values()).map((g) => {
    const isMovement = isMovementRowLabel(product, g.rowLabel);
    const monthlyMetrics = {};
    monthColumns.forEach((m) => {
      const tRaw = Number(g.__monthTarget?.[m] || 0);
      const aRaw = Number(g.__monthAchieved?.[m] || 0);
      const t = isMovement ? Math.round(tRaw) : tRaw;
      const a = isMovement ? Math.round(aRaw) : aRaw;
      const rem = Math.max(0, t - a);
      const pctA = t > 0 ? (a / t) * 100 : 0;
      const pctU = t > 0 ? 100 - pctA : 0;
      monthlyMetrics[m] = {
        Target: t,
        Achieved: a,
        Remaining: rem,
        '% Achived': pctA,
        '% Unachived': pctU,
        Grade: getGradeFromPctArchived(pctA),
        Comment: getCommentFromPctArchived(pctA),
      };
    });
    const monthAchVals = monthColumns.map((m) => Number(g.__monthAchieved?.[m] || 0));
    const monthTargetVals = monthColumns.map((m) => Number(g.__monthTarget?.[m] || 0));
    const cumulativeAch = isMovement ? Math.round(monthAchVals[monthAchVals.length - 1]) : monthAchVals.reduce((a, b) => a + b, 0);
    const cumulativeTarget = isMovement ? Math.round(monthTargetVals[monthTargetVals.length - 1]) : monthTargetVals.reduce((a, b) => a + b, 0);
    const recomputed = recomputeRow(g, cumulativeTarget, cumulativeAch);
    return { ...recomputed, __monthlyMetrics: monthlyMetrics, Cumulative: cumulativeAch };
  });

  return { monthColumns, branchData, rsmData, grandTotalRows };
};

/**
 * Build RSM-style data from branch-level MTD when supervisions are not zone names.
 * Returns one entry per branch in branchNamesInCluster that appears as a team leader.
 * Same shape as buildRSMData: [{ supervision, key, rows }].
 */
export const buildRSMDataFromBranches = (parsedData, product, branchNamesInCluster, actualRepsOverrides = {}) => {
  if (!parsedData?.groupedData || !parsedData?.headers) return [];
  const colMap = getColumnMap(parsedData.headers, product);
  const branchSet = new Set((branchNamesInCluster || []).map((b) => String(b || '').trim()));
  const out = [];
  const seen = new Set();

  for (const sup of Object.values(parsedData.groupedData)) {
    const supervisionName = sup.supervision || '';
    for (const tl of sup.teamLeaders || []) {
      const branchName = String(tl.name || '').trim();
      if (!branchName || !branchSet.has(branchName)) continue;
      if (seen.has(branchName)) continue;
      seen.add(branchName);
      const key = `${branchName}|${supervisionName}`;
      const override = actualRepsOverrides[key];
      let rows;
      if (product === 'CS') {
        rows = buildCSGapRows(tl.data || {}, colMap, supervisionName, override);
      } else {
        rows = buildLBFGapRows(tl.data || {}, colMap, override);
      }
      out.push({ supervision: branchName, key: 'RSM:' + branchName, rows });
    }
  }
  return out;
};

/** Get actual reps count for a supervision from overrides: RSM:SupervisionName or sum of TLName|SupervisionName. Rounded to whole number (agents are people). */
export const getActualRepsForSupervision = (supervisionName, actualRepsOverrides = {}) => {
  if (!supervisionName || !actualRepsOverrides || typeof actualRepsOverrides !== 'object') return 0;
  const rsmKey = 'RSM:' + supervisionName;
  if (actualRepsOverrides[rsmKey] != null && actualRepsOverrides[rsmKey] !== '') {
    return Math.round(num(actualRepsOverrides[rsmKey]));
  }
  const suffix = '|' + supervisionName;
  let sum = 0;
  for (const [key, val] of Object.entries(actualRepsOverrides)) {
    if (key.endsWith(suffix) && val != null && val !== '') sum += num(val);
  }
  return Math.round(sum);
};

/** Grand totals for Active/Actual agents from MTD + actual reps overrides (for Sales Review summary). All agent counts rounded to whole numbers. */
export const getActiveActualTotals = (parsedData, product, actualRepsOverrides = {}) => {
  if (!parsedData?.groupedData || !parsedData?.headers) {
    return { activeTarget: 0, activeAchieved: 0, actualTarget: 0, actualAchieved: 0 };
  }
  const rsmData = buildRSMData(parsedData, product, actualRepsOverrides);
  const activeLabel = product === 'CS' ? 'Active Reps' : 'Active';
  const actualLabel = product === 'CS' ? 'Actual Reps' : 'Actual';
  let activeTarget = 0;
  let activeAchieved = 0;
  let actualTarget = 0;
  let actualAchieved = 0;
  for (const { rows } of rsmData) {
    for (const row of rows) {
      if (row.rowLabel === activeLabel) {
        activeTarget += num(row.Target);
        activeAchieved += row.Achieved != null && row.Achieved !== '' ? num(row.Achieved) : 0;
      } else if (row.rowLabel === actualLabel) {
        actualTarget += num(row.Target);
        actualAchieved += row.Achieved != null && row.Achieved !== '' ? num(row.Achieved) : 0;
      }
    }
  }
  return {
    activeTarget: Math.round(activeTarget),
    activeAchieved: Math.round(activeAchieved),
    actualTarget: Math.round(actualTarget),
    actualAchieved: Math.round(actualAchieved)
  };
};

/** Grade from % Archived: >=80% A, >=65% B, >=50% C, >=39% D, <39% E */
export const getGradeFromPctArchived = (pctArchived) => {
  if (pctArchived == null || typeof pctArchived !== 'number' || Number.isNaN(pctArchived)) return '';
  if (pctArchived >= 80) return 'A';
  if (pctArchived >= 65) return 'B';
  if (pctArchived >= 50) return 'C';
  if (pctArchived >= 39) return 'D';
  return 'E';
};

/** Comment from % Archived: >=100% Excellent, >=80% Standard, >=60% Below standard, <60% Not Acceptable (matches Excel formula) */
export const getCommentFromPctArchived = (pctArchived) => {
  if (pctArchived == null || typeof pctArchived !== 'number' || Number.isNaN(pctArchived)) return '';
  if (pctArchived >= 100) return 'EXCELLENT';
  if (pctArchived >= 80) return 'STANDARD';
  if (pctArchived >= 60) return 'BELOW STANDARD';
  return 'NOT ACCEPTABLE';
};

/** Format row for display. People rows (Active/Actual Reps): 0 decimals. Actual Achieved empty until filled. Adds Grade. */
export const formatGapRowForDisplay = (row) => {
  const isPeople = isPeopleRow(row.rowLabel);
  const fmt = isPeople ? fmtNumInt : fmtNum;
  const achievedVal = row.Achieved;
  const achievedDisplay = achievedVal == null || achievedVal === ''
    ? ''
    : (isPeople ? fmtNumInt(achievedVal) : fmtNum(achievedVal));
  const pctArchived = row['% Achived'];
  const grade = getGradeFromPctArchived(typeof pctArchived === 'number' ? pctArchived : null);
  const comment = getCommentFromPctArchived(typeof pctArchived === 'number' ? pctArchived : null);
  return {
    ...row,
    Target: typeof row.Target === 'number' ? fmt(row.Target) : row.Target,
    Achieved: achievedDisplay,
    Remaining: typeof row.Remaining === 'number' ? fmt(row.Remaining) : row.Remaining,
    '% Achived': typeof pctArchived === 'number' ? fmtPct(pctArchived) : pctArchived,
    '% Unachived': typeof row['% Unachived'] === 'number' ? fmtPct(row['% Unachived']) : row['% Unachived'],
    Grade: grade,
    Comment: comment || row.Comment || '',
  };
};

export const getCommentForRow = (row) => row?.Comment ?? '';
