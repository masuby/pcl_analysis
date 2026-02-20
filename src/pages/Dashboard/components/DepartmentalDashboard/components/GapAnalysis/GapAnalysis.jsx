import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useMTDData } from '../../../MTDdashboard/hooks/useMTDData';
import LoadingSpinner from '../../../../../../components/Common/Loading/LoadingSpinner';
import {
  buildBranchData,
  buildRSMData,
  buildCSGapRows,
  buildLBFGapRows,
  getColumnMap,
  formatGapRowForDisplay,
  getGradeFromPctArchived,
  getCommentFromPctArchived,
} from './utils/gapAnalysisUtils';
import { exportMultipleSheetsWithStyles, buildWorkbookBuffer } from '../../utils/excelExportStyled';
import { sendGapAnalysisEmail } from './utils/emailGapAnalysis';
import {
  buildManagersGapEmailHTML,
  buildTeamLeaderGapEmailHTML,
  isPoorPerformanceComment,
} from './utils/emailTemplateGapAnalysis';
import { gapAnalysisAPI } from '../../../../../../services/api';
import * as XLSX from 'xlsx';
import './GapAnalysis.css';

// Fallback Google Sheet URL for TL "Submit Actual Sales Rep" link (when backend/env do not provide it)
const DEFAULT_GAP_SHEET_URL = 'https://docs.google.com/spreadsheets/d/11S_fypHqxt5JtCSbdrU8zy-VounqxQeEthC8NIgqEWQ/edit';

// Build personalized Google Form URL so TL sees their name/supervision and one field to fill.
// Template may use {reportId}, {tlKey}, {product}, {tlName}, {supervision} (or URL-encoded %7BreportId%7D etc).
const getFormUrlTemplate = () => (import.meta.env.VITE_GAP_GOOGLE_FORM_URL_TEMPLATE || '').trim();
const buildFormUrlForTL = (reportId, tlKey, product, teamLeaderName = '', supervision = '') => {
  let t = getFormUrlTemplate();
  if (!t || !reportId || !tlKey) return '';
  // Support both {reportId} and %7BreportId%7D in .env (so placeholders are replaced with real values)
  const subs = [
    [/\{reportId\}|%7BreportId%7D/gi, reportId],
    [/\{tlKey\}|%7BtlKey%7D/gi, tlKey],
    [/\{product\}|%7Bproduct%7D/gi, product || 'CS'],
    [/\{tlName\}|%7BtlName%7D/gi, teamLeaderName || ''],
    [/\{supervision\}|%7Bsupervision%7D/gi, supervision || ''],
  ];
  subs.forEach(([pattern, value]) => {
    t = t.replace(pattern, () => encodeURIComponent(String(value)));
  });
  return t;
};

const STORAGE_KEY_PREFIX = 'gap_analysis_actual_';
const RECIPIENTS_STORAGE_KEY = 'gap_analysis_email_recipients';

const getStorageKey = (reportId, product) => `${STORAGE_KEY_PREFIX}${reportId || 'unknown'}_${product}`;

const loadOverrides = (reportId, product) => {
  try {
    const raw = localStorage.getItem(getStorageKey(reportId, product));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

const saveOverrides = (reportId, product, overrides) => {
  try {
    localStorage.setItem(getStorageKey(reportId, product), JSON.stringify(overrides));
  } catch (e) {
    console.warn('Could not save gap analysis overrides', e);
  }
};

const GapAnalysis = () => {
  const [product, setProduct] = useState('CS');
  const [selectedDate, setSelectedDate] = useState(null);
  const [actualRepsOverrides, setActualRepsOverrides] = useState({});
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [showTLEmailModal, setShowTLEmailModal] = useState(null);
  const [recipients, setRecipients] = useState(() => {
    try {
      const saved = localStorage.getItem(RECIPIENTS_STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [newRecipient, setNewRecipient] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [editingKey, setEditingKey] = useState(null);
  const [tlRecipients, setTlRecipients] = useState({});
  const [rsmRecipients, setRsmRecipients] = useState({});
  const [savedFeedbackKey, setSavedFeedbackKey] = useState(null);
  const [downloadTemplateFeedback, setDownloadTemplateFeedback] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [uploadSuccess, setUploadSuccess] = useState('');
  const [showUploadedFileModal, setShowUploadedFileModal] = useState(false);
  const [uploadedFileSheets, setUploadedFileSheets] = useState(null);
  const [uploadedFileLoading, setUploadedFileLoading] = useState(false);
  const [uploadedFileError, setUploadedFileError] = useState('');
  const uploadInputRef = React.useRef(null);
  const [branchSearchQuery, setBranchSearchQuery] = useState('');
  const [rsmSearchQuery, setRsmSearchQuery] = useState('');

  // Fetch MTD report by product: CS → CS MTD, LBF → LBF MTD, SME → SME MTD (same as MTDCS/MTDLBF/MTDSME)
  const { reports, parsedData, loading, error, hasData } = useMTDData(product, selectedDate);
  const reportId = parsedData?.reportId;
  const reportDate = parsedData?.reportDate;

  useEffect(() => {
    try {
      localStorage.setItem(RECIPIENTS_STORAGE_KEY, JSON.stringify(recipients));
    } catch (e) {
      console.warn('Could not save recipients', e);
    }
  }, [recipients]);

  // Load from localStorage when report/product changes
  useEffect(() => {
    if (reportId && product) {
      setActualRepsOverrides(loadOverrides(reportId, product));
    }
  }, [reportId, product]);

  // Fetch server actual reps only (recipient name/email come from uploaded Excel file)
  useEffect(() => {
    if (!reportId) return;
    let cancelled = false;
    gapAnalysisAPI.getActualReps(reportId).then((res) => {
      if (cancelled) return;
      const data = res?.data ?? {};
      setActualRepsOverrides((prev) => {
        const next = { ...prev };
        Object.entries(data).forEach(([k, v]) => {
          if (v != null && v !== '') next[k] = Number(v);
        });
        return next;
      });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [reportId]);

  const persistOverrides = useCallback((keyOrUndefined, valueOrUndefined) => {
    if (!reportId || !product) return;
    saveOverrides(reportId, product, actualRepsOverrides);
    if (keyOrUndefined != null && valueOrUndefined !== undefined && valueOrUndefined !== '') {
      const numVal = Number(valueOrUndefined);
      if (!Number.isNaN(numVal)) {
        gapAnalysisAPI.saveActualRep(reportId, keyOrUndefined, numVal, product).catch(() => {});
      }
    }
  }, [reportId, product, actualRepsOverrides]);

  const availableDates = useMemo(() => {
    if (!reports?.length) return [];
    return reports
      .map((r) => {
        const d = r.date instanceof Date ? r.date : new Date(r.date);
        return {
          value: d.toISOString().split('T')[0],
          label: d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
          dateObj: d,
        };
      })
      .sort((a, b) => b.dateObj - a.dateObj);
  }, [reports]);

  const dateLabel = useMemo(() => {
    if (!reportDate) return '';
    const d = reportDate instanceof Date ? reportDate : new Date(reportDate);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }, [reportDate]);

  const emailDateParts = useMemo(() => {
    const d = reportDate ? (reportDate instanceof Date ? reportDate : new Date(reportDate)) : new Date();
    const day = String(d.getDate()).padStart(2, '0');
    const month = d.toLocaleDateString('en-US', { month: 'long' });
    const year = d.getFullYear();
    return { day, month, year };
  }, [reportDate]);

  const subjectForManagers = useMemo(
    () => `${product} GAP ANALYSIS FOR ${emailDateParts.month} ${emailDateParts.year}`.toUpperCase(),
    [product, emailDateParts.month, emailDateParts.year]
  );

  const subjectForTLRSM = useCallback(
    (name) =>
      `${product} GAP ANALYSIS FOR ${String(name || '').trim() || 'Summary'} ${emailDateParts.day} ${emailDateParts.month} ${emailDateParts.year}`.toUpperCase(),
    [product, emailDateParts.day, emailDateParts.month, emailDateParts.year]
  );

  const branchData = useMemo(
    () => (parsedData ? buildBranchData(parsedData, product, actualRepsOverrides) : []),
    [parsedData, product, actualRepsOverrides]
  );

  const rsmData = useMemo(
    () => (parsedData ? buildRSMData(parsedData, product, actualRepsOverrides) : []),
    [parsedData, product, actualRepsOverrides]
  );

  const branchSearchLower = (branchSearchQuery || '').trim().toLowerCase();
  const filteredBranchData = useMemo(() => {
    if (!branchSearchLower) return branchData;
    return branchData.filter(
      (item) =>
        (item.teamLeaderName || '').toLowerCase().includes(branchSearchLower) ||
        (item.supervision || '').toLowerCase().includes(branchSearchLower)
    );
  }, [branchData, branchSearchLower]);

  const rsmSearchLower = (rsmSearchQuery || '').trim().toLowerCase();
  const filteredRsmData = useMemo(() => {
    if (!rsmSearchLower) return rsmData;
    return rsmData.filter((item) => (item.supervision || '').toLowerCase().includes(rsmSearchLower));
  }, [rsmData, rsmSearchLower]);

  const columns = product === 'CS'
    ? ['rowLabel', 'Target', 'Achieved', 'Remaining', '% Achived', '% Unachived', 'Grade', 'Comment']
    : ['rowLabel', 'Target', 'Achieved', 'Remaining', '% Achived', '% Unachived', 'Grade', 'Comment'];

  const gradeColors = { A: '#7B1FA2', B: '#1976D2', C: '#388E3C', D: '#F57C00', E: '#C62828' };
  const commentColors = { EXCELLENT: '#388E3C', STANDARD: '#1976D2', 'BELOW STANDARD': '#F57C00', 'NOT ACCEPTABLE': '#C62828' };

  const setOverride = (key, value) => {
    setActualRepsOverrides((prev) => {
      const next = { ...prev, [key]: value };
      if (reportId && product) {
        saveOverrides(reportId, product, next);
      }
      return next;
    });
  };

  const getActualRowLabel = () => (product === 'CS' ? 'Actual Reps' : 'Actual');

  // Sum rows by rowLabel across all items (for grand total)
  const sumRowsByLabel = useCallback((rowsList) => {
    const keys = ['Target', 'Achieved', 'Remaining', '% Achived', '% Unachived'];
    const byLabel = {};
    const order = product === 'CS'
      ? ['New Loans', 'Repeat Loans', 'Monthly Disbursement (Month Target)', 'Active Reps', 'Actual Reps']
      : ['Monthly Disbursement', 'Active', 'Actual'];
    rowsList.forEach((row) => {
      const label = row.rowLabel;
      if (!byLabel[label]) {
        byLabel[label] = { rowLabel: label, Comment: row.Comment || '' };
        keys.forEach((k) => (byLabel[label][k] = 0));
      }
      keys.forEach((k) => {
        if (typeof row[k] === 'number') byLabel[label][k] += row[k];
      });
    });
    const pct = (a, t) => (t > 0 ? (a / t) * 100 : 0);
    const recomp = (r) => {
      const t = Number(r.Target) || 0;
      const a = Number(r.Achieved) || 0;
      const rem = Math.max(0, t - a);
      return {
        rowLabel: r.rowLabel,
        Target: t,
        Achieved: a,
        Remaining: rem,
        '% Achived': pct(a, t),
        '% Unachived': t > 0 ? 100 - pct(a, t) : 0,
        Comment: r.Comment || '',
      };
    };
    const ordered = order.filter((l) => byLabel[l]).map((l) => recomp(byLabel[l]));
    const rest = Object.keys(byLabel).filter((l) => !order.includes(l)).map((l) => recomp(byLabel[l]));
    return [...ordered, ...rest];
  }, [product]);

  // Grand total: from MTD "Grand Total" row when available; Actual Reps Achieved = sum of all team leaders' Actual Achieved
  const grandTotalRows = useMemo(() => {
    if (!parsedData?.headers) return [];
    const colMap = getColumnMap(parsedData.headers, product);
    const actualLabel = product === 'CS' ? 'Actual Reps' : 'Actual';
    const sumActualAchievedFromBranch = (rowsList) =>
      rowsList
        .filter((r) => r.rowLabel === actualLabel)
        .reduce((s, r) => s + (r.Achieved != null && r.Achieved !== '' ? Number(r.Achieved) : 0), 0);

    if (parsedData.grandTotalRow) {
      let rows =
        product === 'CS'
          ? buildCSGapRows(parsedData.grandTotalRow, colMap, '')
          : buildLBFGapRows(parsedData.grandTotalRow, colMap, undefined);
      const totalActualAchieved = sumActualAchievedFromBranch(branchData.flatMap((d) => d.rows));
      rows = rows.map((r) => {
        if (r.rowLabel !== actualLabel) return r;
        const t = Number(r.Target) || 0;
        const a = totalActualAchieved;
        const rem = Math.max(0, t - a);
        const pctArch = t > 0 ? (a / t) * 100 : 0;
        const pctUnarch = t > 0 ? 100 - pctArch : 0;
        return { ...r, Achieved: a, Remaining: rem, '% Achived': pctArch, '% Unachived': pctUnarch };
      });
      return rows;
    }
    return sumRowsByLabel(rsmData.flatMap((d) => d.rows));
  }, [parsedData, product, branchData, rsmData, sumRowsByLabel]);

  const buildSheetsForExport = useCallback(() => {
    const dataCols = columns.filter((c) => c !== 'rowLabel');
    const headerKeys = ['Zone', 'Branch', 'Team Leader Name', 'Metric', ...dataCols];
    const headerKeysRsm = ['Zone', 'Branch', 'Regional Sales Manager Name', 'Metric', ...dataCols];
    // Esoteric light palette (red → violet, ~40% opacity style) for columns and rows
    const esotericLight = ['#FFCDD2', '#FFE0B2', '#FFF9C4', '#C8E6C9', '#B3E5FC', '#C5CAE9', '#E1BEE7', '#F8BBD9', '#FFCCBC', '#D1C4E9', '#B2DFDB'];
    const headerColors = {};
    headerKeys.forEach((h, i) => { headerColors[h] = esotericLight[i % esotericLight.length]; });
    const headerColorsRsm = {};
    headerKeysRsm.forEach((h, i) => { headerColorsRsm[h] = esotericLight[i % esotericLight.length]; });
    const colWidths = [14, 18, 24, 26, 10, 10, 10, 10, 10, 8, 18];
    const accountingColumns = ['Target', 'Achieved', 'Remaining', '% Achived', '% Unachived'];
    const totalFill = '#E1BEE7';
    const DARK_BLUE_HEADER = '#1A237E';

    const sepRow = () => {
      const r = { Zone: '', Branch: '', 'Team Leader Name': '', Metric: '', __separator: true };
      dataCols.forEach((c) => (r[c] = ''));
      return r;
    };
    const emptyIdent = () => ({ Zone: '', Branch: '', 'Team Leader Name': '' });

    const branchRows = [];
    let lastSup = null;
    branchData.forEach((item) => {
      if (lastSup !== null && lastSup !== item.supervision) {
        const rsmItem = rsmData.find((d) => d.supervision === lastSup);
        if (rsmItem) {
          rsmItem.rows.forEach((r, idx) => {
            const row = {
              Zone: idx === 0 ? lastSup : '',
              Branch: idx === 0 ? 'Total (' + lastSup + ')' : '',
              'Team Leader Name': '',
              Metric: r.rowLabel,
              __supervisionTotalRow: true,
            };
            dataCols.forEach((c) => {
              if (c === 'Grade') row[c] = getGradeFromPctArchived(r['% Achived']);
              else if (c === 'Comment') row[c] = getCommentFromPctArchived(r['% Achived']);
              else row[c] = r[c];
            });
            branchRows.push(row);
          });
          branchRows.push(sepRow());
        }
      }
      lastSup = item.supervision;
      const branchName = item.teamLeaderName;
      const tlName = (getTLRecipient(item)?.name || '').trim();
      branchRows.push({
        Zone: item.supervision,
        Branch: branchName,
        'Team Leader Name': tlName,
        Metric: '',
        ...Object.fromEntries(dataCols.map((c) => [c, ''])),
      });
      item.rows.forEach((r, rIdx) => {
        const row = {
          ...emptyIdent(),
          Metric: r.rowLabel,
        };
        dataCols.forEach((c) => {
          if (c === 'Grade') row[c] = getGradeFromPctArchived(r['% Achived']);
          else if (c === 'Comment') row[c] = getCommentFromPctArchived(r['% Achived']);
          else row[c] = r[c];
        });
        branchRows.push(row);
      });
      branchRows.push(sepRow());
    });
    if (lastSup) {
      const rsmItem = rsmData.find((d) => d.supervision === lastSup);
      if (rsmItem) {
        rsmItem.rows.forEach((r, idx) => {
          const row = {
            Zone: idx === 0 ? lastSup : '',
            Branch: idx === 0 ? 'Total (' + lastSup + ')' : '',
            'Team Leader Name': '',
            Metric: r.rowLabel,
            __supervisionTotalRow: true,
          };
          dataCols.forEach((c) => {
            if (c === 'Grade') row[c] = getGradeFromPctArchived(r['% Achived']);
            else if (c === 'Comment') row[c] = getCommentFromPctArchived(r['% Achived']);
            else row[c] = r[c];
          });
          branchRows.push(row);
        });
        branchRows.push(sepRow());
      }
    }
    grandTotalRows.forEach((r, idx) => {
      const row = {
        Zone: idx === 0 ? 'TOTAL' : '',
        Branch: idx === 0 ? 'All Supervisions' : '',
        'Team Leader Name': '',
        Metric: r.rowLabel,
        __totalRow: true,
      };
      dataCols.forEach((c) => {
        if (c === 'Grade') row[c] = getGradeFromPctArchived(r['% Achived']);
        else if (c === 'Comment') row[c] = getCommentFromPctArchived(r['% Achived']);
        else row[c] = r[c];
      });
      branchRows.push(row);
    });

    const branchTable = {
      data: branchRows.length ? branchRows : [{ Zone: '', Branch: '', 'Team Leader Name': '', Metric: 'No data', ...Object.fromEntries(dataCols.map((c) => [c, ''])) }],
      headerColors,
      colWidths,
      accountingColumns,
      totalRowFillColor: totalFill,
      columnFillColors: esotericLight,
      headerDarkBlue: true,
      totalRowDarkBlue: true,
      gradeColors: { A: '#7B1FA2', B: '#1976D2', C: '#388E3C', D: '#F57C00', E: '#C62828' },
      commentColors: { EXCELLENT: '#388E3C', STANDARD: '#1976D2', 'BELOW STANDARD': '#F57C00', 'NOT ACCEPTABLE': '#C62828' },
    };

    const rsmRows = [];
    const sepRowRsm = () => {
      const r = { Zone: '', Branch: '', 'Regional Sales Manager Name': '', Metric: '', __separator: true };
      dataCols.forEach((c) => (r[c] = ''));
      return r;
    };
    rsmData.forEach((item, i) => {
      if (i > 0) rsmRows.push(sepRowRsm());
      const rsmName = (rsmRecipients[item.supervision]?.name || '').trim() || item.supervision;
      rsmRows.push({
        Zone: item.supervision,
        Branch: item.supervision,
        'Regional Sales Manager Name': rsmName,
        Metric: '',
        ...Object.fromEntries(dataCols.map((c) => [c, ''])),
      });
      item.rows.forEach((r, rIdx) => {
        const row = {
          Zone: rIdx === 0 ? item.supervision : '',
          Branch: rIdx === 0 ? item.supervision : '',
          'Regional Sales Manager Name': rIdx === 0 ? rsmName : '',
          Metric: r.rowLabel,
        };
        dataCols.forEach((c) => {
          if (c === 'Grade') row[c] = getGradeFromPctArchived(r['% Achived']);
          else if (c === 'Comment') row[c] = getCommentFromPctArchived(r['% Achived']);
          else row[c] = r[c];
        });
        rsmRows.push(row);
      });
    });
    rsmRows.push(sepRowRsm());
    grandTotalRows.forEach((r, idx) => {
      const row = {
        Zone: idx === 0 ? 'TOTAL' : '',
        Branch: idx === 0 ? 'All Supervisions' : '',
        'Regional Sales Manager Name': idx === 0 ? '' : '',
        Metric: r.rowLabel,
        __totalRow: true,
      };
      dataCols.forEach((c) => {
        if (c === 'Grade') row[c] = getGradeFromPctArchived(r['% Achived']);
        else if (c === 'Comment') row[c] = getCommentFromPctArchived(r['% Achived']);
        else row[c] = r[c];
      });
      rsmRows.push(row);
    });

    const rsmTable = {
      data: rsmRows.length ? rsmRows : [{ Zone: '', Branch: '', 'Regional Sales Manager Name': '', Metric: 'No data', ...Object.fromEntries(dataCols.map((c) => [c, ''])) }],
      headerColors: headerColorsRsm,
      colWidths,
      accountingColumns,
      totalRowFillColor: totalFill,
      columnFillColors: esotericLight,
      headerDarkBlue: true,
      totalRowDarkBlue: true,
      gradeColors: { A: '#7B1FA2', B: '#1976D2', C: '#388E3C', D: '#F57C00', E: '#C62828' },
      commentColors: { EXCELLENT: '#388E3C', STANDARD: '#1976D2', 'BELOW STANDARD': '#F57C00', 'NOT ACCEPTABLE': '#C62828' },
    };

    return [
      { name: 'Branch', tables: [branchTable], freeze: { row: 1, col: 4 } },
      { name: 'RSM', tables: [rsmTable], freeze: { row: 1, col: 4 } },
    ];
  }, [branchData, rsmData, grandTotalRows, product, columns, rsmRecipients, tlRecipients]);

  const handleDownloadXlsx = async () => {
    const sheets = buildSheetsForExport();
    const dateStr = reportDate ? new Date(reportDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
    const fileName = `Gap_Analysis_${product}_${dateStr}.xlsx`;
    await exportMultipleSheetsWithStyles(sheets, fileName);
  };

  /** Build a one-sheet workbook for a single TL or RSM subsection (for email attachment) */
  const buildSubsectionWorkbook = useCallback(async (rows, subsectionLabel, fileName) => {
    const dataCols = ['Target', 'Achieved', 'Remaining', '% Achived', '% Unachived', 'Grade', 'Comment'];
    const data = rows.map((r) => ({
      Metric: r.rowLabel ?? '',
      Target: r.Target,
      Achieved: r.Achieved,
      Remaining: r.Remaining,
      '% Achived': r['% Achived'],
      '% Unachived': r['% Unachived'],
      Grade: getGradeFromPctArchived(r['% Achived']),
      Comment: getCommentFromPctArchived(r['% Achived']),
    }));
    const headerKeys = ['Metric', ...dataCols];
    const esotericLight = ['#FFCDD2', '#FFE0B2', '#FFF9C4', '#C8E6C9', '#B3E5FC', '#C5CAE9', '#E1BEE7', '#B2DFDB'];
    const headerColors = {};
    headerKeys.forEach((h, i) => { headerColors[h] = esotericLight[i % esotericLight.length]; });
    const sheetName = subsectionLabel && String(subsectionLabel).length <= 31 ? String(subsectionLabel) : 'Gap Summary';
    const table = {
      data,
      headerColors,
      headerDarkBlue: true,
      colWidths: [26, 10, 10, 10, 10, 10, 8, 18],
      accountingColumns: ['Target', 'Achieved', 'Remaining', '% Achived', '% Unachived'],
      gradeColors: { A: '#7B1FA2', B: '#1976D2', C: '#388E3C', D: '#F57C00', E: '#C62828' },
      commentColors: { EXCELLENT: '#388E3C', STANDARD: '#1976D2', 'BELOW STANDARD': '#F57C00', 'NOT ACCEPTABLE': '#C62828' },
    };
    const sheets = [{ name: sheetName, tables: [table], freeze: { row: 1, col: 1 } }];
    return await buildWorkbookBuffer(sheets, fileName);
  }, []);

  const handleSendReportEmail = async () => {
    if (recipients.length === 0) {
      setSendError('Add at least one recipient.');
      return;
    }
    setSending(true);
    setSendError('');
    const rsmGrandTotalRows = grandTotalRows.map((r) => ({
      ...r,
      Grade: getGradeFromPctArchived(r['% Achived']),
      Comment: getCommentFromPctArchived(r['% Achived']),
    }));
    const subject = subjectForManagers;
    const htmlBody = buildManagersGapEmailHTML(dateLabel, product, rsmGrandTotalRows, gradeColors, commentColors);
    const sheets = buildSheetsForExport();
    const dateStr = reportDate ? new Date(reportDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
    const fileName = `Gap_Analysis_${product}_${dateStr}.xlsx`;
    const result = await buildWorkbookBuffer(sheets, fileName);
    let attachmentBase64 = '';
    let attachmentName = '';
    if (result?.buffer) {
      const binary = Array.from(result.buffer).map((b) => String.fromCharCode(b)).join('');
      attachmentBase64 = btoa(binary);
      attachmentName = result.fileName;
    }
    const emailResult = await sendGapAnalysisEmail(recipients, subject, htmlBody, {
      attachmentBase64,
      attachmentName,
    });
    setSending(false);
    if (emailResult.success) {
      setShowEmailModal(false);
    } else {
      setSendError(emailResult.error || 'Failed to send');
    }
  };

  const updateTLRecipient = (key, field, value) => {
    setTlRecipients((prev) => ({
      ...prev,
      [key]: { ...(prev[key] || {}), [field]: value },
    }));
  };

  const handleSaveTLRow = (item) => {
    const rec = tlRecipients[item.key] ?? { name: '', email: '' };
    setTlRecipients((prev) => ({
      ...prev,
      [item.key]: { name: (rec.name ?? '').trim(), email: (rec.email ?? '').trim() },
    }));
    setSavedFeedbackKey(item.key);
    setTimeout(() => setSavedFeedbackKey(null), 2000);
  };

  // Recipient from uploaded Excel only (strict key lookup; no fallback)
  const getTLRecipient = (item) => tlRecipients[item.key] ?? { name: '', email: '' };

  const savedTLList = useMemo(() => {
    if (!branchData.length) return [];
    return branchData
      .map((item) => ({ item, rec: getTLRecipient(item) }))
      .filter(({ rec }) => rec?.email?.trim())
      .map(({ item, rec }) => ({ key: item.key, name: rec?.name || '', email: rec?.email || '', supervision: item.supervision }));
  }, [branchData, tlRecipients]);

  const savedRSMList = useMemo(() => {
    return rsmData
      .filter((item) => rsmRecipients[item.supervision]?.email?.trim())
      .map((item) => ({
        supervision: item.supervision,
        email: rsmRecipients[item.supervision].email,
        name: rsmRecipients[item.supervision].name || '',
      }));
  }, [rsmData, rsmRecipients]);

  const handleSendToTL = async (item, tlEmail, displayName) => {
    if (!tlEmail?.trim()) {
      setSendError('Enter team leader email address.');
      return;
    }
    const name = (displayName || '').trim() || (getTLRecipient(item)?.name ?? '');
    setTlRecipients((prev) => ({
      ...prev,
      [item.key]: { name, email: tlEmail.trim() },
    }));
    setSending(true);
    setSendError('');
    let responseUrl = '';
    let isFormLink = false;
    if (reportId) {
      responseUrl = buildFormUrlForTL(reportId, item.key, product, item.teamLeaderName, item.supervision);
      if (responseUrl) isFormLink = true;
    }
    if (!responseUrl) {
      try {
        responseUrl = await gapAnalysisAPI.getSheetUrl();
      } catch (_) {}
    }
    if (!responseUrl) responseUrl = (import.meta.env.VITE_GAP_GOOGLE_SHEET_URL || DEFAULT_GAP_SHEET_URL || '').trim();
    if (!responseUrl && reportId) {
      try {
        responseUrl = await gapAnalysisAPI.getResponseLink(reportId, item.key, product);
      } catch (_) {}
    }
    const commentRow = item.rows.find((r) => r.rowLabel && (r.rowLabel.includes('Disbursement') || r.rowLabel === 'Monthly Disbursement'));
    const poorPerf = isPoorPerformanceComment(commentRow?.Comment);
    const rowsWithGradeComment = item.rows.map((r) => ({
      ...r,
      Grade: getGradeFromPctArchived(r['% Achived']),
      Comment: getCommentFromPctArchived(r['% Achived']),
    }));
    const subject = subjectForTLRSM(name || item.teamLeaderName);
    const htmlBody = buildTeamLeaderGapEmailHTML(
      name,
      item.supervision,
      product,
      rowsWithGradeComment,
      dateLabel,
      poorPerf,
      responseUrl,
      { isFormLink, gradeColors, commentColors }
    );
    const dateStr = reportDate ? new Date(reportDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
    const subFileName = `Gap_Summary_${(name || item.teamLeaderName).replace(/[^a-z0-9]/gi, '_')}_${product}_${dateStr}.xlsx`;
    const subResult = await buildSubsectionWorkbook(item.rows, name || item.teamLeaderName, subFileName);
    let attachmentBase64 = '';
    let attachmentName = '';
    if (subResult?.buffer) {
      const binary = Array.from(subResult.buffer).map((b) => String.fromCharCode(b)).join('');
      attachmentBase64 = btoa(binary);
      attachmentName = subResult.fileName;
    }
    const emailResult = await sendGapAnalysisEmail([tlEmail.trim()], subject, htmlBody, { attachmentBase64, attachmentName });
    setSending(false);
    if (emailResult.success) {
      setShowTLEmailModal(null);
    } else {
      setSendError(emailResult.error || 'Failed to send');
    }
  };

  const handleSendToRSM = async (item, email) => {
    if (!email?.trim()) {
      setSendError('Enter RSM email address.');
      return;
    }
    setRsmRecipients((prev) => ({ ...prev, [item.supervision]: { ...(prev[item.supervision] || {}), email: email.trim() } }));
    setSending(true);
    setSendError('');
    const displayName = (rsmRecipients[item.supervision]?.name || '').trim();
    const rowsWithGradeComment = item.rows.map((r) => ({
      ...r,
      Grade: getGradeFromPctArchived(r['% Achived']),
      Comment: getCommentFromPctArchived(r['% Achived']),
    }));
    const subject = subjectForTLRSM(displayName || item.supervision);
    const htmlBody = buildTeamLeaderGapEmailHTML(displayName, item.supervision, product, rowsWithGradeComment, dateLabel, false, '', { isFormLink: false, isRSM: true, gradeColors, commentColors });
    const dateStr = reportDate ? new Date(reportDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
    const subFileName = `Gap_Summary_RSM_${String(item.supervision).replace(/[^a-z0-9]/gi, '_')}_${product}_${dateStr}.xlsx`;
    const subResult = await buildSubsectionWorkbook(item.rows, item.supervision, subFileName);
    let attachmentBase64 = '';
    let attachmentName = '';
    if (subResult?.buffer) {
      const binary = Array.from(subResult.buffer).map((b) => String.fromCharCode(b)).join('');
      attachmentBase64 = btoa(binary);
      attachmentName = subResult.fileName;
    }
    const emailResult = await sendGapAnalysisEmail([email.trim()], subject, htmlBody, { attachmentBase64, attachmentName });
    setSending(false);
    if (emailResult.success) {
      setShowTLEmailModal(null);
    } else {
      setSendError(emailResult.error || 'Failed to send');
    }
  };

  const handleSendToAllRSM = async () => {
    const toSendRSM = rsmData
      .map((item) => ({ item, rec: rsmRecipients[item.supervision] }))
      .filter(({ rec }) => rec?.email?.trim());
    if (toSendRSM.length === 0) {
      setSendError('Add at least one RSM email. Use the template to fill RSM emails and upload.');
      return;
    }
    setSending(true);
    setSendError('');
    let sent = 0;
    for (const { item, rec } of toSendRSM) {
      const displayName = (rec?.name || '').trim();
      const rowsWithGradeComment = item.rows.map((r) => ({
        ...r,
        Grade: getGradeFromPctArchived(r['% Achived']),
        Comment: getCommentFromPctArchived(r['% Achived']),
      }));
      const subject = `Gap Analysis – Your Summary (${product}) - ${dateLabel}`;
      const htmlBody = buildTeamLeaderGapEmailHTML(displayName, item.supervision, product, rowsWithGradeComment, dateLabel, false, '', { isFormLink: false, isRSM: true, gradeColors, commentColors });
      const dateStr = reportDate ? new Date(reportDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
      const subFileName = `Gap_Summary_RSM_${String(item.supervision).replace(/[^a-z0-9]/gi, '_')}_${product}_${dateStr}.xlsx`;
      const subResult = await buildSubsectionWorkbook(item.rows, item.supervision, subFileName);
      let attachmentBase64 = '';
      let attachmentName = '';
      if (subResult?.buffer) {
        const binary = Array.from(subResult.buffer).map((b) => String.fromCharCode(b)).join('');
        attachmentBase64 = btoa(binary);
        attachmentName = subResult.fileName;
      }
      const email = (rec?.email || '').trim();
      if (!email) continue;
      const result = await sendGapAnalysisEmail([email], subject, htmlBody, { attachmentBase64, attachmentName });
      if (result.success) sent++;
    }
    setSending(false);
    if (sent > 0) {
      setShowTLEmailModal(null);
      setSendError('');
    } else {
      setSendError('No emails were sent. Check RSM addresses and try again.');
    }
  };

  const handleSendToAllTLs = async () => {
    const toSendBranch = branchData
      .map((item) => ({ item, rec: getTLRecipient(item), type: 'branch' }))
      .filter(({ rec }) => rec?.email?.trim());
    const toSend = toSendBranch;
    if (toSend.length === 0) {
      setSendError('Add at least one Team Leader email. Use the template to fill emails and upload. Then Send.');
      return;
    }
    setSending(true);
    setSendError('');
    let sheetUrl = '';
    try {
      sheetUrl = await gapAnalysisAPI.getSheetUrl();
    } catch (_) {}
    if (!sheetUrl) sheetUrl = (import.meta.env.VITE_GAP_GOOGLE_SHEET_URL || DEFAULT_GAP_SHEET_URL || '').trim();
    let sent = 0;
    for (const { item, rec, type } of toSend) {
      let responseUrl = '';
      let isFormLink = false;
      if (type === 'branch') {
        responseUrl = reportId ? buildFormUrlForTL(reportId, item.key, product, item.teamLeaderName, item.supervision) : '';
        isFormLink = !!responseUrl;
        if (!responseUrl) responseUrl = sheetUrl;
        if (!responseUrl && reportId) {
          try {
            responseUrl = await gapAnalysisAPI.getResponseLink(reportId, item.key, product);
          } catch (_) {}
        }
      }
      const displayName = (rec?.name || '').trim();
      const rowsWithGradeComment = item.rows.map((r) => ({
        ...r,
        Grade: getGradeFromPctArchived(r['% Achived']),
        Comment: getCommentFromPctArchived(r['% Achived']),
      }));
      const commentRow = item.rows.find((r) => r.rowLabel && (r.rowLabel.includes('Disbursement') || r.rowLabel === 'Monthly Disbursement'));
      const poorPerf = isPoorPerformanceComment(commentRow?.Comment);
      const subject = subjectForTLRSM(displayName || item.teamLeaderName);
      const htmlBody = buildTeamLeaderGapEmailHTML(displayName, item.supervision, product, rowsWithGradeComment, dateLabel, poorPerf, responseUrl, { isFormLink, gradeColors, commentColors });
      const dateStr = reportDate ? new Date(reportDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
      const subFileName = `Gap_Summary_${(displayName || item.teamLeaderName).replace(/[^a-z0-9]/gi, '_')}_${product}_${dateStr}.xlsx`;
      const subResult = buildSubsectionWorkbook(item.rows, displayName || item.teamLeaderName, subFileName);
      let attachmentBase64 = '';
      let attachmentName = '';
      if (subResult?.buffer) {
        const binary = Array.from(subResult.buffer).map((b) => String.fromCharCode(b)).join('');
        attachmentBase64 = btoa(binary);
        attachmentName = subResult.fileName;
      }
      const email = (rec?.email || '').trim();
      if (!email) continue;
      const result = await sendGapAnalysisEmail([email], subject, htmlBody, { attachmentBase64, attachmentName });
      if (result.success) sent++;
    }
    setSending(false);
    if (sent > 0) {
      setShowTLEmailModal(null);
      setSendError('');
    } else {
      setSendError('No emails were sent. Check addresses and try again.');
    }
  };

  const addRecipient = () => {
    const email = (newRecipient || '').trim().toLowerCase();
    if (!email) return;
    if (recipients.includes(email)) return;
    setRecipients((prev) => [...prev, email]);
    setNewRecipient('');
  };

  const removeRecipient = (email) => {
    setRecipients((prev) => prev.filter((r) => r !== email));
  };

  const separatorRow = () => ({ Supervision: '', Product: '', 'Team Leader Name': '', Email: '', Name: '', 'Actual Sales Reps': '', __separator: true });

  const handleDownloadTemplateForUpload = async () => {
    if (!reportId || (!branchData.length && !rsmData.length)) return;
    // Load previously uploaded file so template is pre-filled with last upload data
    const uploaded = await loadUploadedFilePreview();
    const tlMap = uploaded?.tlMap ?? tlRecipients;
    const rsmMap = uploaded?.rsmMap ?? rsmRecipients;
    const actualFromFile = uploaded?.actualRepsFromFile ?? {};
    const getActual = (key) => actualFromFile[key] ?? actualRepsOverrides[key] ?? '';

    const templateGradient = ['#2a5298', '#5B4B9E', '#9B6B34', '#2E7D32', '#6A1B9A', '#B8CFEB'];
    const headerColors = {
      Supervision: templateGradient[0],
      Product: templateGradient[1],
      'Team Leader Name': templateGradient[2],
      Email: templateGradient[3],
      Name: templateGradient[4],
      'Actual Sales Reps': templateGradient[5],
    };
    const colWidths = [22, 10, 24, 28, 22, 18];

    const branchRows = [];
    let lastSup = null;
    branchData.forEach((item) => {
      if (lastSup !== null && lastSup !== item.supervision) branchRows.push(separatorRow());
      lastSup = item.supervision;
      const rec = tlMap[item.key];
      branchRows.push({
        Supervision: item.supervision,
        Product: product,
        'Team Leader Name': item.teamLeaderName,
        Email: rec?.email ?? '',
        Name: rec?.name ?? '',
        'Actual Sales Reps': getActual(item.key),
      });
    });
    if (branchRows.length) branchRows.push(separatorRow());

    const rsmRows = [];
    rsmData.forEach((item) => {
      rsmRows.push({
        Supervision: item.supervision,
        Product: product,
        'Team Leader Name': item.supervision,
        Email: rsmMap[item.supervision]?.email ?? '',
        Name: rsmMap[item.supervision]?.name ?? '',
        'Actual Sales Reps': getActual(item.key),
      });
      rsmRows.push(separatorRow());
    });
    if (rsmRows.length) rsmRows.pop();

    const emptyRow = { Supervision: '', Product: '', 'Team Leader Name': '', Email: '', Name: '', 'Actual Sales Reps': '' };
    const branchTable = {
      data: branchRows.length ? branchRows : [emptyRow],
      headerColors,
      colWidths,
    };
    const rsmTable = {
      data: rsmRows.length ? rsmRows : [emptyRow],
      headerColors,
      colWidths,
    };

    const sheets = [
      { name: 'Branch', tables: [branchTable], freeze: { row: 1, col: 3 } },
      { name: 'RSM', tables: [rsmTable], freeze: { row: 1, col: 3 } },
    ];
    const dateStr = reportDate ? new Date(reportDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
    const fileName = `Gap_Actual_Reps_Template_${product}_${dateStr}.xlsx`;
    await exportMultipleSheetsWithStyles(sheets, fileName);
    setDownloadTemplateFeedback(true);
    setTimeout(() => setDownloadTemplateFeedback(false), 3000);
  };

  const loadUploadedFilePreview = useCallback(async () => {
    if (!reportId || !product) return null;
    setUploadedFileLoading(true);
    setUploadedFileError('');
    setUploadedFileSheets(null);
    try {
      const blob = await gapAnalysisAPI.getUploadedFile(reportId, product);
      if (!blob) {
        setUploadedFileSheets(null);
        setTlRecipients({});
        setRsmRecipients({});
        setUploadedFileLoading(false);
        return null;
      }
      const ab = await blob.arrayBuffer();
      const wb = XLSX.read(ab, { type: 'array' });
      const sheets = { Branch: [], RSM: [] };
      const names = (wb.SheetNames || []).map((n) => ({ raw: n, norm: (n || '').trim().toUpperCase() }));
      const branchSheet = names.find((n) => n.norm === 'BRANCH')?.raw;
      const rsmSheet = names.find((n) => n.norm === 'RSM')?.raw;
      if (wb.Sheets[branchSheet]) {
        sheets.Branch = XLSX.utils.sheet_to_json(wb.Sheets[branchSheet], { header: 1, defval: '', raw: false });
      }
      if (wb.Sheets[rsmSheet]) {
        sheets.RSM = XLSX.utils.sheet_to_json(wb.Sheets[rsmSheet], { header: 1, defval: '', raw: false });
      }
      // If names didn't match but we have 2 sheets, use first as Branch and second as RSM
      if (sheets.Branch.length === 0 && sheets.RSM.length === 0 && wb.SheetNames.length >= 2) {
        sheets.Branch = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: false });
        sheets.RSM = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[1]], { header: 1, defval: '', raw: false });
      } else if (sheets.Branch.length === 0 && wb.SheetNames.length >= 1) {
        sheets.Branch = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: false });
      }
      if (sheets.RSM.length === 0 && wb.SheetNames.length >= 2) {
        sheets.RSM = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[1]], { header: 1, defval: '', raw: false });
      }
      setUploadedFileSheets(sheets);

      // Populate tlRecipients and rsmRecipients + actualRepsFromFile (columns: Supervision, Product, Team Leader Name, Email, Name, Actual Sales Reps)
      const productUpper = (product || 'CS').toUpperCase();
      const tlMap = {};
      const actualRepsFromFile = {};
      const rowsBranch = sheets.Branch || [];
      for (let i = 1; i < rowsBranch.length; i++) {
        const row = rowsBranch[i] || [];
        const rowProduct = (row[1] != null ? String(row[1]) : '').trim().toUpperCase();
        if (rowProduct && rowProduct !== productUpper) continue;
        const supervision = (row[0] != null ? String(row[0]) : '').trim();
        const teamLeaderName = (row[2] != null ? String(row[2]) : '').trim();
        const email = (row[3] != null ? String(row[3]) : '').trim();
        const name = (row[4] != null ? String(row[4]) : '').trim();
        const actualReps = row[5] != null && row[5] !== '' ? Number(row[5]) : undefined;
        if (!teamLeaderName && !supervision) continue;
        const key = teamLeaderName + '|' + supervision;
        tlMap[key] = { email, name: name || teamLeaderName };
        if (actualReps !== undefined && !Number.isNaN(actualReps)) actualRepsFromFile[key] = actualReps;
      }
      setTlRecipients(tlMap);

      const rsmMap = {};
      const rowsRSM = sheets.RSM || [];
      for (let i = 1; i < rowsRSM.length; i++) {
        const row = rowsRSM[i] || [];
        const rowProduct = (row[1] != null ? String(row[1]) : '').trim().toUpperCase();
        if (rowProduct && rowProduct !== productUpper) continue;
        const supervision = (row[0] != null ? String(row[0]) : '').trim();
        const teamLeaderName = (row[2] != null ? String(row[2]) : '').trim();
        const email = (row[3] != null ? String(row[3]) : '').trim();
        const name = (row[4] != null ? String(row[4]) : '').trim();
        const actualReps = row[5] != null && row[5] !== '' ? Number(row[5]) : undefined;
        if (!supervision) continue;
        rsmMap[supervision] = { email, name: name || teamLeaderName || supervision };
        if (actualReps !== undefined && !Number.isNaN(actualReps)) actualRepsFromFile['RSM:' + supervision] = actualReps;
      }
      setRsmRecipients(rsmMap);
      return { tlMap, rsmMap, actualRepsFromFile };
    } catch (err) {
      setUploadedFileError(err?.message || 'Failed to load file');
      setUploadedFileSheets(null);
      setTlRecipients({});
      setRsmRecipients({});
      return null;
    } finally {
      setUploadedFileLoading(false);
    }
  }, [reportId, product]);

  useEffect(() => {
    if (showUploadedFileModal && reportId && product) loadUploadedFilePreview();
  }, [showUploadedFileModal, reportId, product, loadUploadedFilePreview]);

  // When opening Email this Team Leader (or other email modal), load uploaded file so getTLRecipient can show Email/Name from file
  useEffect(() => {
    if (showTLEmailModal && reportId && product) loadUploadedFilePreview();
  }, [showTLEmailModal?.all, showTLEmailModal?.allRSM, showTLEmailModal?.item, showTLEmailModal?.rsm, reportId, product, loadUploadedFilePreview]);

  const handleUploadSheet = async (e) => {
    const file = e?.target?.files?.[0];
    if (!file || !reportId) return;
    setUploading(true);
    setUploadError('');
    setUploadSuccess('');
    try {
      const uploadRes = await gapAnalysisAPI.uploadActualReps(reportId, file, product);
      setUploadSuccess(uploadRes?.message || 'Upload complete. File saved for future use.');
      setTimeout(() => setUploadSuccess(''), 5000);
      const res = await gapAnalysisAPI.getActualReps(reportId);
      const data = res?.data ?? {};
      setActualRepsOverrides((prev) => {
        const next = { ...prev };
        Object.entries(data).forEach(([k, v]) => {
          if (v != null && v !== '') next[k] = Number(v);
        });
        return next;
      });
      // Recipients come only from the uploaded Excel; re-load file to refresh tlRecipients/rsmRecipients
      await loadUploadedFilePreview();
    } catch (err) {
      setUploadError(err?.message || 'Upload failed');
    } finally {
      setUploading(false);
      if (uploadInputRef.current) uploadInputRef.current.value = '';
    }
  };

  if (loading && !parsedData) {
    return (
      <div className="gap-analysis-loading">
        <LoadingSpinner size="large" />
        <p>Loading MTD data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="gap-analysis-error">
        <div className="gap-analysis-error-icon">⚠️</div>
        <h3>Error Loading Data</h3>
        <p>{error}</p>
      </div>
    );
  }

  // When no data at all (no reports): full-page empty only for non-SME. For SME, keep layout and show message in content.
  const noDataFullPage = !hasData && product !== 'SME';
  if (noDataFullPage) {
    return (
      <div className="gap-analysis-empty">
        <div className="gap-analysis-empty-icon">📊</div>
        <h2>No {product} MTD Reports Found</h2>
        <p>Upload {product} MTD reports in the Administration page to see Gap Analysis.</p>
      </div>
    );
  }

  const showSMEEmptyMessage = product === 'SME' && !hasData;

  return (
    <div className="gap-analysis-container">
      <div className="gap-analysis-header-bar">
        <h1 className="gap-analysis-title">GAP ANALYSIS REPORT FOR {dateLabel.toUpperCase()}</h1>
        <div className="gap-analysis-header-controls">
          <select
            className="gap-analysis-date-select"
            value={selectedDate ? selectedDate.toISOString().split('T')[0] : ''}
            onChange={(e) => {
              const v = e.target.value;
              setSelectedDate(v ? new Date(v) : null);
            }}
          >
            <option value="">Latest Report</option>
            {availableDates.map((opt, idx) => (
              <option key={idx} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="gap-analysis-btn gap-analysis-btn-email"
            onClick={() => setShowEmailModal(true)}
            title="Send report by email"
          >
            <span className="gap-analysis-btn-icon">✉</span>
            Send Email
          </button>
          <button type="button" className="gap-analysis-btn gap-analysis-btn-download" onClick={handleDownloadXlsx}>
            <span className="gap-analysis-btn-icon">📥</span>
            Download XLSX
          </button>
          <input
            ref={uploadInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="gap-analysis-upload-input"
            onChange={handleUploadSheet}
            style={{ display: 'none' }}
          />
          <button
            type="button"
            className="gap-analysis-btn gap-analysis-btn-upload"
            onClick={() => uploadInputRef.current?.click()}
            title="Upload filled Excel (Branch + RSM) to update Actual Sales Reps and emails"
            disabled={!reportId || uploading}
          >
            <span className="gap-analysis-btn-icon">{uploading ? '⏳' : '📤'}</span>
            {uploading ? 'Uploading…' : 'Upload Sheet'}
          </button>
          <button
            type="button"
            className="gap-analysis-btn gap-analysis-btn-download-template"
            onClick={handleDownloadTemplateForUpload}
            title="Download Excel template with Branch and RSM sheets; fill Email and Actual Sales Reps then upload"
            disabled={!reportId || (!branchData.length && !rsmData.length)}
          >
            <span className="gap-analysis-btn-icon">📋</span>
            {downloadTemplateFeedback ? 'Downloaded!' : 'Download template for upload'}
          </button>
          <button
            type="button"
            className="gap-analysis-btn gap-analysis-btn-view-uploaded"
            onClick={() => setShowUploadedFileModal(true)}
            title="View the Excel file you uploaded for this product (Branch + RSM sheets)"
            disabled={!reportId}
          >
            <span className="gap-analysis-btn-icon" aria-hidden>👁</span>
            View uploaded file
          </button>
          {uploadError && <span className="gap-analysis-upload-error">{uploadError}</span>}
          {uploadSuccess && <span className="gap-analysis-upload-success">{uploadSuccess}</span>}
        </div>
      </div>

      <div className="gap-analysis-product-toggles">
        <button
          type="button"
          className={`gap-analysis-product-btn ${product === 'CS' ? 'gap-analysis-product-btn--active' : ''}`}
          onClick={() => setProduct('CS')}
        >
          CS
        </button>
        <button
          type="button"
          className={`gap-analysis-product-btn ${product === 'LBF' ? 'gap-analysis-product-btn--active' : ''}`}
          onClick={() => setProduct('LBF')}
        >
          LBF
        </button>
        <button
          type="button"
          className={`gap-analysis-product-btn ${product === 'SME' ? 'gap-analysis-product-btn--active' : ''}`}
          onClick={() => setProduct('SME')}
        >
          SME
        </button>
      </div>

      <div className="gap-analysis-sections">
        {showSMEEmptyMessage ? (
          <div className="gap-analysis-sme-empty">
            <p className="gap-analysis-no-data">No SME Data for Analysis, Try Again later.</p>
          </div>
        ) : (
          <>
        <section className="gap-analysis-section">
          <div className="gap-analysis-section-header">
            <h2 className="gap-analysis-section-title">BRANCH (Team Leader)</h2>
            <input
              type="search"
              className="gap-analysis-section-search"
              placeholder="Search team leader or supervision..."
              value={branchSearchQuery}
              onChange={(e) => setBranchSearchQuery(e.target.value)}
              aria-label="Filter team leaders"
            />
          </div>
          <div className="gap-analysis-section-scroll">
            {branchData.length === 0 ? (
              <p className="gap-analysis-no-data">No team leader data for this report.</p>
            ) : filteredBranchData.length === 0 ? (
              <p className="gap-analysis-no-data">No team leader matches &quot;{branchSearchQuery}&quot;.</p>
            ) : (
              <div className="gap-analysis-branch-inner">
                {filteredBranchData.map((item) => (
                  <div key={item.key} className="gap-analysis-block">
                    <h3 className="gap-analysis-block-title">{item.teamLeaderName}</h3>
                    <p className="gap-analysis-block-sub">Supervision: {item.supervision}</p>
                    <div className="gap-analysis-table-wrap">
                      <table className="gap-analysis-table">
                        <thead>
                          <tr>
                            {columns.map((col) => (
                              <th key={col}>{col === 'rowLabel' ? 'Metric' : col}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {item.rows.map((row, rIdx) => {
                            const isActualRow = row.rowLabel === getActualRowLabel();
                            const displayRow = formatGapRowForDisplay(row);
                            return (
                              <tr key={rIdx}>
                                {columns.map((col) => {
                                  if (col === 'rowLabel') {
                                    return (
                                      <td key={col} className="gap-analysis-cell-metric">
                                        {displayRow.rowLabel}
                                      </td>
                                    );
                                  }
                                  if (col === 'Comment') {
                                    const comment = (displayRow.Comment || '').toUpperCase().trim();
                                    const bg = commentColors[comment] || 'transparent';
                                    return (
                                      <td
                                        key={col}
                                        className="gap-analysis-cell-comment"
                                        style={{ backgroundColor: bg, color: bg ? '#fff' : 'inherit', fontWeight: 600 }}
                                      >
                                        {displayRow.Comment}
                                      </td>
                                    );
                                  }
                                  if (col === 'Grade') {
                                    const g = displayRow.Grade || '';
                                    const bg = g ? (gradeColors[g] || 'transparent') : 'transparent';
                                    return (
                                      <td
                                        key={col}
                                        className="gap-analysis-cell-grade"
                                        style={{ backgroundColor: bg, color: g ? '#fff' : 'inherit', fontWeight: 600 }}
                                      >
                                        {g}
                                      </td>
                                    );
                                  }
                                  if (isActualRow && col === 'Achieved' && editingKey === item.key) {
                                    return (
                                      <td key={col}>
                                        <input
                                          type="number"
                                          min={0}
                                          className="gap-analysis-edit-input"
                                          value={actualRepsOverrides[item.key] ?? ''}
                                          onChange={(e) => setOverride(item.key, e.target.value)}
                                          onBlur={() => persistOverrides(item.key, actualRepsOverrides[item.key])}
                                          placeholder="Actual"
                                        />
                                      </td>
                                    );
                                  }
                                  if (isActualRow && col === 'Achieved' && editingKey !== item.key) {
                                    return (
                                      <td key={col} className="gap-analysis-cell-num">
                                        {displayRow.Achieved ?? ''}
                                      </td>
                                    );
                                  }
                                  return (
                                    <td key={col} className="gap-analysis-cell-num">
                                      {displayRow[col]}
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="gap-analysis-block-actions">
                      <button
                        type="button"
                        className="gap-analysis-edit-btn"
                        onClick={() => setEditingKey(editingKey === item.key ? null : item.key)}
                      >
                        {editingKey === item.key ? 'Done editing' : 'Edit Actual Reps'}
                      </button>
                      <button
                        type="button"
                        className="gap-analysis-tl-email-btn"
                        onClick={() => setShowTLEmailModal({ item })}
                      >
                        Email this Team Leader
                      </button>
                    </div>
                  </div>
                ))}
                <div className="gap-analysis-branch-footer">
                  <button
                    type="button"
                    className="gap-analysis-email-all-btn"
                    onClick={() => setShowTLEmailModal({ all: true })}
                  >
                    Email all Team Leader only
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        <div className="gap-analysis-divider" />

        <section className="gap-analysis-section">
          <div className="gap-analysis-section-header">
            <h2 className="gap-analysis-section-title">RSM (Supervision)</h2>
            <input
              type="search"
              className="gap-analysis-section-search"
              placeholder="Search supervision..."
              value={rsmSearchQuery}
              onChange={(e) => setRsmSearchQuery(e.target.value)}
              aria-label="Filter RSM / supervision"
            />
          </div>
          <div className="gap-analysis-section-scroll">
            {rsmData.length === 0 ? (
              <p className="gap-analysis-no-data">No supervision data for this report.</p>
            ) : filteredRsmData.length === 0 ? (
              <p className="gap-analysis-no-data">No supervision matches &quot;{rsmSearchQuery}&quot;.</p>
            ) : (
              <div className="gap-analysis-rsm-inner">
                {filteredRsmData.map((item) => (
                  <div key={item.supervision} className="gap-analysis-block">
                    <h3 className="gap-analysis-block-title">{item.supervision}</h3>
                    <div className="gap-analysis-table-wrap">
                      <table className="gap-analysis-table">
                        <thead>
                          <tr>
                            {columns.map((col) => (
                              <th key={col}>{col === 'rowLabel' ? 'Metric' : col}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {item.rows.map((row, rIdx) => {
                            const displayRow = formatGapRowForDisplay(row);
                            return (
                              <tr key={rIdx}>
                                {columns.map((col) => {
                                  if (col === 'Grade') {
                                    const g = displayRow.Grade || '';
                                    const bg = g ? (gradeColors[g] || 'transparent') : 'transparent';
                                    return (
                                      <td
                                        key={col}
                                        className="gap-analysis-cell-grade"
                                        style={{ backgroundColor: bg, color: g ? '#fff' : 'inherit', fontWeight: 600 }}
                                      >
                                        {g}
                                      </td>
                                    );
                                  }
                                  if (col === 'Comment') {
                                    const comment = (displayRow.Comment || '').toUpperCase().trim();
                                    const bg = commentColors[comment] || 'transparent';
                                    return (
                                      <td
                                        key={col}
                                        className="gap-analysis-cell-comment"
                                        style={{ backgroundColor: bg, color: bg ? '#fff' : 'inherit', fontWeight: 600 }}
                                      >
                                        {displayRow.Comment}
                                      </td>
                                    );
                                  }
                                  return (
                                    <td
                                      key={col}
                                      className={
                                        col === 'rowLabel'
                                          ? 'gap-analysis-cell-metric'
                                          : 'gap-analysis-cell-num'
                                      }
                                    >
                                      {displayRow[col === 'rowLabel' ? 'rowLabel' : col]}
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="gap-analysis-block-actions">
                      <button
                        type="button"
                        className="gap-analysis-tl-email-btn"
                        onClick={() => setShowTLEmailModal({ rsm: item })}
                      >
                        Email this RSM
                      </button>
                    </div>
                  </div>
                ))}
                <div className="gap-analysis-branch-footer">
                  <button
                    type="button"
                    className="gap-analysis-email-all-btn"
                    onClick={() => setShowTLEmailModal({ allRSM: true })}
                  >
                    Email all RSM
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
          </>
        )}
      </div>

      {showEmailModal && (
        <div className="gap-analysis-modal-overlay" onClick={() => !sending && setShowEmailModal(false)}>
          <div className="gap-analysis-modal" onClick={(e) => e.stopPropagation()}>
            <div className="gap-analysis-modal-header">
              <h3>Send Gap Analysis Report by Email</h3>
              <button
                type="button"
                className="gap-analysis-modal-close"
                onClick={() => !sending && setShowEmailModal(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="gap-analysis-modal-body">
              <p className="gap-analysis-modal-hint">Recipients (saved):</p>
              <div className="gap-analysis-recipients-input">
                <input
                  type="email"
                  placeholder="Enter email"
                  value={newRecipient}
                  onChange={(e) => setNewRecipient(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addRecipient()}
                />
                <button type="button" className="gap-analysis-add-recipient-btn" onClick={addRecipient}>
                  Add
                </button>
              </div>
              <ul className="gap-analysis-recipients-list">
                {recipients.map((email) => (
                  <li key={email} className="gap-analysis-recipient-item">
                    <span>{email}</span>
                    <button type="button" onClick={() => removeRecipient(email)} title="Remove">
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
              {recipients.length === 0 && <p className="gap-analysis-modal-empty">Add at least one recipient.</p>}
              {sendError && <p className="gap-analysis-modal-error">{sendError}</p>}
            </div>
            <div className="gap-analysis-modal-footer">
              <button type="button" className="gap-analysis-modal-cancel" onClick={() => !sending && setShowEmailModal(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="gap-analysis-modal-send"
                onClick={handleSendReportEmail}
                disabled={sending || recipients.length === 0}
              >
                {sending ? 'Sending…' : 'Send Email'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showTLEmailModal && (
        <div className="gap-analysis-modal-overlay" onClick={() => !sending && setShowTLEmailModal(null)}>
          <div className={`gap-analysis-modal gap-analysis-modal-tl ${showTLEmailModal.all ? 'gap-analysis-modal-tl-all' : ''} ${showTLEmailModal.allRSM ? 'gap-analysis-modal-tl-all' : ''}`} onClick={(e) => e.stopPropagation()}>
            <div className="gap-analysis-modal-header">
              <h3>
                {showTLEmailModal.all ? 'Email all Team Leader only' : showTLEmailModal.allRSM ? 'Email all RSM' : showTLEmailModal.rsm ? 'Email this RSM' : 'Email Team Leader'}
              </h3>
              <button
                type="button"
                className="gap-analysis-modal-close"
                onClick={() => !sending && setShowTLEmailModal(null)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="gap-analysis-modal-body">
              {showTLEmailModal.rsm ? (
                <>
                  <p className="gap-analysis-modal-hint">
                    Send gap summary to this supervision (RSM). Enter or confirm email below.
                  </p>
                  <label className="gap-analysis-modal-label">Supervision:</label>
                  <p className="gap-analysis-modal-rsm-name">{showTLEmailModal.rsm.supervision}</p>
                  <label className="gap-analysis-modal-label">Email:</label>
                  <input
                    type="email"
                    id="gap-rsm-email-input"
                    className="gap-analysis-tl-email-input"
                    placeholder="rsm@example.com"
                    value={rsmRecipients[showTLEmailModal.rsm.supervision]?.email ?? ''}
                    onChange={(e) =>
                      setRsmRecipients((prev) => ({
                        ...prev,
                        [showTLEmailModal.rsm.supervision]: { ...(prev[showTLEmailModal.rsm.supervision] || {}), email: e.target.value },
                      }))
                    }
                  />
                </>
              ) : showTLEmailModal.allRSM ? (
                <>
                  <p className="gap-analysis-modal-hint">
                    RSM emails come from the uploaded sheet. The list below will receive a gap summary each. Click &quot;Send&quot; to email all.
                  </p>
                  {savedRSMList.length > 0 ? (
                    <div className="gap-analysis-saved-section">
                      <p className="gap-analysis-saved-section-title">RSM – will receive ({savedRSMList.length})</p>
                      <ul className="gap-analysis-saved-list">
                        {savedRSMList.map(({ supervision, email, name }) => (
                          <li key={supervision} className="gap-analysis-saved-item">
                            <span className="gap-analysis-saved-item-name">{name?.trim() ? `${name} (${supervision})` : supervision}</span>
                            <span className="gap-analysis-saved-item-email">{email}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p className="gap-analysis-modal-saved-hint">Add RSM emails in the template and upload. Then open this modal again and &quot;Send&quot;.</p>
                  )}
                </>
              ) : showTLEmailModal.all ? (
                <>
                  <p className="gap-analysis-modal-hint">
                    Set name and email for each team leader. Click &quot;Save&quot; to store; saved data is used when you &quot;Send&quot; or open &quot;Email this Team Leader&quot;.
                  </p>
                  {savedTLList.length === 0 && branchData.length > 0 && (
                    <p className="gap-analysis-modal-error" role="alert">
                      No emails loaded. Upload the Excel template (with columns: <strong>Supervision</strong>, Product, Team Leader Name, <strong>Email</strong>, <strong>Name</strong>, Actual Sales Reps) for this product ({product}) and report, then open this modal again. Open browser console (F12) for debug details.
                    </p>
                  )}
                  <div className="gap-analysis-tl-list">
                    {branchData.map((item) => {
                      const rec = getTLRecipient(item);
                      const justSaved = savedFeedbackKey === item.key;
                      return (
                        <div key={item.key} className="gap-analysis-tl-row">
                          <span className="gap-analysis-tl-row-label">{item.teamLeaderName} ({item.supervision})</span>
                          <input
                            type="text"
                            className="gap-analysis-tl-row-name"
                            placeholder="Name"
                            value={rec.name ?? ''}
                            onChange={(e) => updateTLRecipient(item.key, 'name', e.target.value)}
                          />
                          <div className="gap-analysis-tl-row-save-wrap">
                            <button
                              type="button"
                              className="gap-analysis-tl-row-save-btn"
                              onClick={() => handleSaveTLRow(item)}
                              title="Save name and email for this team leader"
                            >
                              Save
                            </button>
                            {justSaved && <span className="gap-analysis-tl-row-saved-msg">Saved ✓</span>}
                          </div>
                          <input
                            type="email"
                            className="gap-analysis-tl-row-email"
                            placeholder="Email"
                            value={rec.email ?? ''}
                            onChange={(e) => updateTLRecipient(item.key, 'email', e.target.value)}
                          />
                        </div>
                      );
                    })}
                  </div>
                  {savedTLList.length > 0 ? (
                    <div className="gap-analysis-saved-section">
                      <p className="gap-analysis-saved-section-title">Team Leaders – will receive ({savedTLList.length})</p>
                      <ul className="gap-analysis-saved-list">
                        {savedTLList.map(({ key, name, email, supervision }) => (
                          <li key={key} className="gap-analysis-saved-item">
                            <span className="gap-analysis-saved-item-name">{name ? `${name} (${supervision})` : supervision}</span>
                            <span className="gap-analysis-saved-item-email">{email}</span>
                          </li>
                        ))}
                      </ul>
                      <p className="gap-analysis-modal-saved-hint">Edit name/email above or use the template and upload. Send emails all listed Team Leaders only.</p>
                    </div>
                  ) : (
                    <p className="gap-analysis-modal-saved-hint">Add Team Leader emails in the template and upload, or enter above and Save. Then Send.</p>
                  )}
                </>
              ) : showTLEmailModal.item ? (
                <>
                  <p className="gap-analysis-modal-hint">
                    Send gap summary to this team leader. They will be asked to reply with their Actual Sales Rep count.
                  </p>
                  <label className="gap-analysis-modal-label">Name:</label>
                  <input
                    type="text"
                    id="gap-tl-name-input"
                    className="gap-analysis-tl-name-input"
                    placeholder="Team leader name"
                    value={showTLEmailModal.item ? (getTLRecipient(showTLEmailModal.item)?.name ?? '') : ''}
                    onChange={(e) => showTLEmailModal.item && updateTLRecipient(showTLEmailModal.item.key, 'name', e.target.value)}
                  />
                  <label className="gap-analysis-modal-label">Email:</label>
                  <div className="gap-analysis-single-tl-email-row">
                    <input
                      type="email"
                      id="gap-tl-email-input"
                      className="gap-analysis-tl-email-input"
                      placeholder="team.leader@example.com"
                      value={showTLEmailModal.item ? (getTLRecipient(showTLEmailModal.item)?.email ?? '') : ''}
                      onChange={(e) => showTLEmailModal.item && updateTLRecipient(showTLEmailModal.item.key, 'email', e.target.value)}
                    />
                    <button
                      type="button"
                      className="gap-analysis-tl-row-save-btn"
                      onClick={() => showTLEmailModal.item && handleSaveTLRow(showTLEmailModal.item)}
                      title="Save name and email"
                    >
                      Save
                    </button>
                  </div>
                  {showTLEmailModal.item && savedFeedbackKey === showTLEmailModal.item.key && (
                    <span className="gap-analysis-tl-row-saved-msg">Saved ✓</span>
                  )}
                </>
              ) : null}
              {sendError && <p className="gap-analysis-modal-error">{sendError}</p>}
            </div>
            <div className="gap-analysis-modal-footer">
              <button type="button" className="gap-analysis-modal-cancel" onClick={() => !sending && setShowTLEmailModal(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="gap-analysis-modal-send"
                onClick={() => {
                  if (showTLEmailModal.all) {
                    handleSendToAllTLs();
                  } else if (showTLEmailModal.allRSM) {
                    handleSendToAllRSM();
                  } else if (showTLEmailModal.rsm) {
                    const emailInput = document.getElementById('gap-rsm-email-input');
                    handleSendToRSM(showTLEmailModal.rsm, emailInput?.value?.trim());
                  } else if (showTLEmailModal.item) {
                    const emailInput = document.getElementById('gap-tl-email-input');
                    const nameInput = document.getElementById('gap-tl-name-input');
                    handleSendToTL(
                      showTLEmailModal.item,
                      emailInput?.value?.trim(),
                      nameInput?.value?.trim()
                    );
                  }
                }}
                disabled={sending}
              >
                {sending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showUploadedFileModal && (
        <div className="gap-analysis-modal-overlay" onClick={() => setShowUploadedFileModal(false)}>
          <div className="gap-analysis-modal gap-analysis-modal-uploaded-view" onClick={(e) => e.stopPropagation()}>
            <div className="gap-analysis-modal-header">
              <h3>Uploaded file ({product})</h3>
              <button
                type="button"
                className="gap-analysis-modal-close"
                onClick={() => setShowUploadedFileModal(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="gap-analysis-modal-body">
              {uploadedFileLoading ? (
                <p className="gap-analysis-uploaded-loading">Loading…</p>
              ) : uploadedFileError ? (
                <p className="gap-analysis-modal-error">{uploadedFileError}</p>
              ) : !uploadedFileSheets || (!uploadedFileSheets.Branch?.length && !uploadedFileSheets.RSM?.length) ? (
                <div className="gap-analysis-uploaded-empty">
                  <p>No file uploaded for {product} yet.</p>
                  <p className="gap-analysis-modal-hint">Upload a file using &quot;Upload Sheet&quot; above, or click below.</p>
                  <button
                    type="button"
                    className="gap-analysis-btn gap-analysis-btn-upload"
                    onClick={() => uploadInputRef.current?.click()}
                    disabled={!reportId || uploading}
                  >
                    Upload a file
                  </button>
                </div>
              ) : (
                <>
                  <div className="gap-analysis-uploaded-sheets">
                    {(uploadedFileSheets.Branch?.length > 0 || uploadedFileSheets.RSM?.length > 0) && (
                      <>
                        {uploadedFileSheets.Branch?.length > 0 && (
                          <div className="gap-analysis-uploaded-sheet">
                            <h4>Branch ({uploadedFileSheets.Branch.length} rows)</h4>
                            <div className="gap-analysis-uploaded-table-wrap">
                              <table className="gap-analysis-table">
                                <thead>
                                  <tr>
                                    {(uploadedFileSheets.Branch[0] || []).map((cell, ci) => (
                                      <th key={ci}>{cell != null ? String(cell) : ''}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {(uploadedFileSheets.Branch.slice(1) || []).map((row, ri) => (
                                    <tr key={ri}>
                                      {(Array.isArray(row) ? row : []).map((cell, ci) => (
                                        <td key={ci}>{cell != null && cell !== undefined ? String(cell) : ''}</td>
                                      ))}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                        {uploadedFileSheets.RSM?.length > 0 && (
                          <div className="gap-analysis-uploaded-sheet">
                            <h4>RSM ({uploadedFileSheets.RSM.length} rows)</h4>
                            <div className="gap-analysis-uploaded-table-wrap">
                              <table className="gap-analysis-table">
                                <thead>
                                  <tr>
                                    {(uploadedFileSheets.RSM[0] || []).map((cell, ci) => (
                                      <th key={ci}>{cell != null ? String(cell) : ''}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {(uploadedFileSheets.RSM.slice(1) || []).map((row, ri) => (
                                    <tr key={ri}>
                                      {(Array.isArray(row) ? row : []).map((cell, ci) => (
                                        <td key={ci}>{cell != null && cell !== undefined ? String(cell) : ''}</td>
                                      ))}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  <div className="gap-analysis-uploaded-actions">
                    <button
                      type="button"
                      className="gap-analysis-btn gap-analysis-btn-upload"
                      onClick={() => uploadInputRef.current?.click()}
                      disabled={!reportId || uploading}
                    >
                      {uploading ? 'Uploading…' : 'Replace with new file'}
                    </button>
                    <button
                      type="button"
                      className="gap-analysis-modal-cancel"
                      onClick={async () => {
                        try {
                          await gapAnalysisAPI.deleteUploadedFile(reportId, product);
                          setUploadedFileSheets(null);
                        } catch (e) {
                          setUploadedFileError(e?.message || 'Failed to remove file');
                        }
                      }}
                      disabled={!reportId}
                    >
                      Remove file
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default GapAnalysis;
