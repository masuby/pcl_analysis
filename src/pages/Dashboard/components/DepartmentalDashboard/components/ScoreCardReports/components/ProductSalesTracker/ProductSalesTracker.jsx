import { useMemo, useImperativeHandle, forwardRef, useRef, Fragment } from 'react';
import './ProductSalesTracker.css';
import { useMTDData } from '../../../../../MTDdashboard/hooks/useMTDData';
import { useManagementData } from '../../../../../ManagementDashboard/hooks/useManagementData';
import { exportSingleSectionWithStyles } from '../../../../utils/excelExportStyled';
import { exportToExcel } from '../../../../utils/excelExport';
import LoadingSpinner from '../../../../../../../../components/Common/Loading/LoadingSpinner';

const ProductSalesTracker = forwardRef(({ mode, userData, targetMonth }, ref) => {
  const mtdCS = useMTDData('CS', targetMonth);
  const mtdLBF = useMTDData('LBF', targetMonth);
  const mtdSME = useMTDData('SME', targetMonth);
  const { parsedReports: managementReports } = useManagementData();

  const trackerData = useMemo(() => {
    const departments = ['CS', 'LBF', 'SME', 'AgriFinance'];
    const hooks = { CS: mtdCS, LBF: mtdLBF, SME: mtdSME };

    const isReportDateInMonth = (reportDate, yyyyMm) => {
      if (!reportDate || !yyyyMm || typeof yyyyMm !== 'string') return false;
      const d = reportDate instanceof Date ? reportDate : new Date(reportDate);
      const [y, m] = yyyyMm.split('-').map(Number);
      if (!y || !m) return false;
      return d.getFullYear() === y && d.getMonth() === m - 1;
    };

    const getLatestManagementReport = () => {
      if (!managementReports?.length) return null;
      const sorted = [...managementReports].sort((a, b) => {
        const dateA = a.date ? new Date(a.date) : new Date(a.createdAt);
        const dateB = b.date ? new Date(b.date) : new Date(b.createdAt);
        return dateB - dateA;
      });
      return sorted[0];
    };

    return departments.map(dept => {
      // SME: use MTD when available and (no targetMonth or MTD is for same month); otherwise fall back to Management data
      if (dept === 'SME') {
        const hook = hooks.SME;
        const useSmeMtd = hook?.parsedData?.groupedData && (!targetMonth || isReportDateInMonth(hook.parsedData.reportDate, targetMonth));
        if (useSmeMtd) {
          // Same structure as CS/LBF from MTD
          const columnMap = hook.parsedData.columnMap || {};
          const termCol = columnMap.term || Object.keys((hook.parsedData.listingData || [])[0] || {}).find(k => String(k).toUpperCase() === 'TERM');
          const amountCol = columnMap.amount || Object.keys((hook.parsedData.listingData || [])[0] || {}).find(k => String(k).toUpperCase().includes('DISBURSE') && String(k).toUpperCase().includes('AMOUNT'));
          const salesRepCol = columnMap.salesRep || Object.keys((hook.parsedData.listingData || [])[0] || {}).find(k => {
            const u = String(k).toUpperCase();
            return u === 'SALES REP' || u === 'SALES REP. NAME';
          });
          const countActiveReps = (salesReps) => {
            if (!salesReps?.length || !salesRepCol) return 0;
            const withTerm = salesReps.filter(rep => {
              const term = termCol ? (rep[termCol] || rep['Term'] || rep['TERM']) : null;
              return term != null && String(term).trim() !== '';
            });
            const uniqueReps = new Set(withTerm.map(rep => {
              const name = rep[salesRepCol] || rep['SALES REP'] || rep['SALES REP. NAME'];
              return name != null ? String(name).trim() : null;
            }).filter(Boolean));
            return uniqueReps.size;
          };
          const supervisionRows = [];
          const teamLeaderRows = [];
          Object.values(hook.parsedData.groupedData).forEach(supervision => {
            const supTarget = Number(supervision.supervisionData?.['MONTH TARGET'] || supervision.supervisionData?.['Month Target'] || 0);
            let supSalesReps = [];
            if (supervision.supervisionData) {
              const value = Number(supervision.supervisionData['VALUE'] || supervision.supervisionData['Value'] || 0);
              const loans = Number(supervision.supervisionData['NO. OF LOANS'] || supervision.supervisionData['No. of Loans'] || 0);
              const target = Number(supervision.supervisionData['MONTH TARGET'] || supervision.supervisionData['Month Target'] || 0);
              supervision.teamLeaders?.forEach(tl => { supSalesReps.push(...(tl.salesReps || [])); });
              const activeReps = countActiveReps(supSalesReps);
              supervisionRows.push({ name: supervision.supervision || 'Unknown', value, loans, target, activeReps });
            }
            supervision.teamLeaders?.forEach(tl => {
              if (tl.data) {
                const value = Number(tl.data['VALUE'] || tl.data['Value'] || 0);
                const loans = Number(tl.data['NO. OF LOANS'] || tl.data['No. of Loans'] || 0);
                const target = Number(tl.data['MONTH TARGET'] || tl.data['Month Target'] || supTarget) || 0;
                const activeReps = countActiveReps(tl.salesReps || []);
                const salesReps = tl.salesReps || [];
                const termData = {};
                salesReps.forEach(rep => {
                  const term = termCol ? (rep[termCol] || rep['Term'] || rep['TERM']) : null;
                  const amt = amountCol ? (Number(rep[amountCol]) || 0) : 0;
                  if (term && String(term).trim()) {
                    const t = String(term).trim();
                    if (!termData[t]) termData[t] = { count: 0, value: 0 };
                    termData[t].count += 1;
                    termData[t].value += amt;
                  }
                });
                const productsSold = Object.entries(termData)
                  .map(([term, d]) => ({ term, count: d.count, value: d.value }))
                  .sort((a, b) => b.value - a.value);
                const pctAchieved = (target || supTarget) > 0 ? (value / (target || supTarget) * 100) : 0;
                teamLeaderRows.push({
                  name: tl.name || 'Unknown',
                  value,
                  loans,
                  target: target || supTarget,
                  activeReps,
                  productsSold,
                  percentAchieved: pctAchieved
                });
              }
            });
          });
          supervisionRows.sort((a, b) => b.value - a.value);
          teamLeaderRows.sort((a, b) => (b.percentAchieved || 0) - (a.percentAchieved || 0));
          const totalValue = supervisionRows.reduce((s, r) => s + r.value, 0);
          const totalLoans = supervisionRows.reduce((s, r) => s + r.loans, 0);
          const totalTarget = supervisionRows.reduce((s, r) => s + r.target, 0);
          const totalActiveReps = supervisionRows.reduce((s, r) => s + r.activeReps, 0);
          const wholeTotalRow = { name: 'Whole Total', value: totalValue, loans: totalLoans, target: totalTarget, activeReps: totalActiveReps, isWholeTotal: true };
          return {
            product: 'SME',
            totalValue,
            totalLoans,
            totalTarget,
            totalActiveReps,
            percentAchieved: totalTarget > 0 ? (totalValue / totalTarget * 100) : 0,
            percentUnachieved: totalTarget > 0 ? Math.max(0, (totalTarget - totalValue) / totalTarget * 100) : 0,
            averageLoanSize: totalLoans > 0 ? totalValue / totalLoans : 0,
            supervisionRows,
            teamLeaderRows,
            wholeTotalRow,
            reportDate: hook.parsedData.reportDate
          };
        }
        // Fallback: Management data only (no MTD)
        if (!managementReports || managementReports.length === 0) return null;
        const sorted = [...managementReports].sort((a, b) => {
          const dateA = a.date ? new Date(a.date) : new Date(a.createdAt);
          const dateB = b.date ? new Date(b.date) : new Date(b.createdAt);
          return dateB - dateA;
        });
        const latestReport = sorted[0];
        const data = latestReport.sme || {};
        const target = Number(data['Target'] || data['Monthly Target'] || 0) || 0;
        const value = Number(data['Disbursements This Month'] || data['Disbursement This Month'] || data['Disbursement this Month'] || 0) || 0;
        const loans = Number(data['Number of loans'] || data['Number of Loans'] || data['No. of Loans'] || 0) || 0;
        const activeReps = Number(data['Active Reps'] || data['Active reps'] || 0) || 0;
        const supervisionRows = [{ name: 'SME', value, loans, target, activeReps }];
        const wholeTotalRow = { name: 'Whole Total', value, loans, target, activeReps, isWholeTotal: true };
        return {
          product: 'SME',
          totalValue: value,
          totalLoans: loans,
          totalTarget: target,
          totalActiveReps: activeReps,
          percentAchieved: target > 0 ? (value / target * 100) : 0,
          percentUnachieved: target > 0 ? Math.max(0, (target - value) / target * 100) : 0,
          averageLoanSize: loans > 0 ? value / loans : 0,
          supervisionRows,
          teamLeaderRows: [],
          wholeTotalRow,
          reportDate: latestReport.date ? new Date(latestReport.date) : (latestReport.createdAt ? new Date(latestReport.createdAt) : null)
        };
      }

      if (dept === 'AgriFinance') {
        if (!managementReports || managementReports.length === 0) return null;
        const sorted = [...managementReports].sort((a, b) => {
          const dateA = a.date ? new Date(a.date) : new Date(a.createdAt);
          const dateB = b.date ? new Date(b.date) : new Date(b.createdAt);
          return dateB - dateA;
        });
        const latestReport = sorted[0];
        const data = latestReport.agrifinance || latestReport.AgriFinance || {};
        const target = Number(data['Target'] || data['Monthly Target'] || 0) || 0;
        const value = Number(data['Disbursements This Month'] || data['Disbursement This Month'] || data['Disbursement this Month'] || 0) || 0;
        const loans = Number(data['Number of loans'] || data['Number of Loans'] || data['No. of Loans'] || 0) || 0;
        const activeReps = Number(data['Active Reps'] || data['Active reps'] || 0) || 0;
        const supervisionRows = [{ name: 'AgriFinance', value, loans, target, activeReps }];
        const wholeTotalRow = { name: 'Whole Total', value, loans, target, activeReps, isWholeTotal: true };
        return {
          product: 'AgriFinance',
          totalValue: value,
          totalLoans: loans,
          totalTarget: target,
          totalActiveReps: activeReps,
          percentAchieved: target > 0 ? (value / target * 100) : 0,
          percentUnachieved: target > 0 ? Math.max(0, (target - value) / target * 100) : 0,
          averageLoanSize: loans > 0 ? value / loans : 0,
          supervisionRows,
          teamLeaderRows: [],
          wholeTotalRow,
          reportDate: latestReport.date ? new Date(latestReport.date) : (latestReport.createdAt ? new Date(latestReport.createdAt) : null)
        };
      }

      // CS / LBF: use MTD only when it is for the same month as score card; otherwise use Management data
      if ((dept === 'CS' || dept === 'LBF') && targetMonth && managementReports?.length) {
        const hook = hooks[dept];
        const useMtd = hook?.parsedData?.groupedData && isReportDateInMonth(hook.parsedData.reportDate, targetMonth);
        if (!useMtd) {
          const latestReport = getLatestManagementReport();
          const data = dept === 'CS' ? (latestReport.cs || {}) : (latestReport.lbf || {});
          const branches = dept === 'CS' ? (latestReport.csBranches || {}) : (latestReport.lbfBranches || {});
          const valKey = 'Disbursements This Month';
          const loanKey = 'Number of loans';
          const targetKey = 'Monthly Target';
          const repKey = 'Active Reps';
          const supervisionRows = Object.entries(branches).map(([name, b]) => {
            const v = Number(b[valKey] || b['Disbursement This Month'] || b['Disbursement this Month'] || 0) || 0;
            const l = Number(b[loanKey] || b['Number of Loans'] || b['No. of Loans'] || 0) || 0;
            const t = Number(b[targetKey] || b['Month Target'] || 0) || 0;
            const r = Number(b[repKey] || b['Active reps'] || 0) || 0;
            return { name, value: v, loans: l, target: t, activeReps: r };
          });
          const totalValue = Number(data[valKey] || data['Disbursement This Month'] || data['Disbursement this Month'] || 0) || supervisionRows.reduce((s, r) => s + r.value, 0);
          const totalLoans = Number(data[loanKey] || data['Number of Loans'] || data['No. of Loans'] || 0) || supervisionRows.reduce((s, r) => s + r.loans, 0);
          const totalTarget = Number(data[targetKey] || data['Month Target'] || 0) || supervisionRows.reduce((s, r) => s + r.target, 0);
          const totalActiveReps = Number(data[repKey] || data['Active reps'] || 0) || supervisionRows.reduce((s, r) => s + r.activeReps, 0);
          const wholeTotalRow = { name: 'Whole Total', value: totalValue, loans: totalLoans, target: totalTarget, activeReps: totalActiveReps, isWholeTotal: true };
          return {
            product: dept,
            totalValue,
            totalLoans,
            totalTarget,
            totalActiveReps,
            percentAchieved: totalTarget > 0 ? (totalValue / totalTarget * 100) : 0,
            percentUnachieved: totalTarget > 0 ? Math.max(0, (totalTarget - totalValue) / totalTarget * 100) : 0,
            averageLoanSize: totalLoans > 0 ? totalValue / totalLoans : 0,
            supervisionRows: supervisionRows.length > 0 ? supervisionRows : [{ name: dept, value: totalValue, loans: totalLoans, target: totalTarget, activeReps: totalActiveReps }],
            teamLeaderRows: [],
            wholeTotalRow,
            reportDate: latestReport.date ? new Date(latestReport.date) : (latestReport.createdAt ? new Date(latestReport.createdAt) : null)
          };
        }
      }

      const hook = hooks[dept];
      if (!hook.parsedData || !hook.parsedData.groupedData) return null;
      if (targetMonth && !isReportDateInMonth(hook.parsedData.reportDate, targetMonth)) return null;

      const columnMap = hook.parsedData.columnMap || {};
      const termCol = columnMap.term || Object.keys((hook.parsedData.listingData || [])[0] || {}).find(k => String(k).toUpperCase() === 'TERM');
      const amountCol = columnMap.amount || Object.keys((hook.parsedData.listingData || [])[0] || {}).find(k => String(k).toUpperCase().includes('DISBURSE') && String(k).toUpperCase().includes('AMOUNT'));
      const salesRepCol = columnMap.salesRep || Object.keys((hook.parsedData.listingData || [])[0] || {}).find(k => {
        const u = String(k).toUpperCase();
        return u === 'SALES REP' || u === 'SALES REP. NAME';
      });

      const countActiveReps = (salesReps) => {
        if (!salesReps?.length || !salesRepCol) return 0;
        const withTerm = salesReps.filter(rep => {
          const term = termCol ? (rep[termCol] || rep['Term'] || rep['TERM']) : null;
          return term != null && String(term).trim() !== '';
        });
        const uniqueReps = new Set(withTerm.map(rep => {
          const name = rep[salesRepCol] || rep['SALES REP'] || rep['SALES REP. NAME'];
          return name != null ? String(name).trim() : null;
        }).filter(Boolean));
        return uniqueReps.size;
      };

      const supervisionRows = [];
      const teamLeaderRows = [];

      Object.values(hook.parsedData.groupedData).forEach(supervision => {
        const supTarget = Number(supervision.supervisionData?.['MONTH TARGET'] || supervision.supervisionData?.['Month Target'] || 0);
        let supSalesReps = [];
        if (supervision.supervisionData) {
          const value = Number(supervision.supervisionData['VALUE'] || supervision.supervisionData['Value'] || 0);
          const loans = Number(supervision.supervisionData['NO. OF LOANS'] || supervision.supervisionData['No. of Loans'] || 0);
          const target = Number(supervision.supervisionData['MONTH TARGET'] || supervision.supervisionData['Month Target'] || 0);
          supervision.teamLeaders?.forEach(tl => { supSalesReps.push(...(tl.salesReps || [])); });
          const activeReps = countActiveReps(supSalesReps);
          supervisionRows.push({ name: supervision.supervision || 'Unknown', value, loans, target, activeReps });
        }
        supervision.teamLeaders?.forEach(tl => {
          if (tl.data) {
            const value = Number(tl.data['VALUE'] || tl.data['Value'] || 0);
            const loans = Number(tl.data['NO. OF LOANS'] || tl.data['No. of Loans'] || 0);
            const target = Number(tl.data['MONTH TARGET'] || tl.data['Month Target'] || supTarget) || 0;
            const activeReps = countActiveReps(tl.salesReps || []);
            const salesReps = tl.salesReps || [];
            const termData = {};
            salesReps.forEach(rep => {
              const term = termCol ? (rep[termCol] || rep['Term'] || rep['TERM']) : null;
              const amt = amountCol ? (Number(rep[amountCol]) || 0) : 0;
              if (term && String(term).trim()) {
                const t = String(term).trim();
                if (!termData[t]) termData[t] = { count: 0, value: 0 };
                termData[t].count += 1;
                termData[t].value += amt;
              }
            });
            const productsSold = Object.entries(termData)
              .map(([term, d]) => ({ term, count: d.count, value: d.value }))
              .sort((a, b) => b.value - a.value);
            const pctAchieved = (target || supTarget) > 0 ? (value / (target || supTarget) * 100) : 0;
            teamLeaderRows.push({
              name: tl.name || 'Unknown',
              value,
              loans,
              target: target || supTarget,
              activeReps,
              productsSold,
              percentAchieved: pctAchieved
            });
          }
        });
      });

      supervisionRows.sort((a, b) => b.value - a.value);
      teamLeaderRows.sort((a, b) => (b.percentAchieved || 0) - (a.percentAchieved || 0));

      const totalValue = supervisionRows.reduce((s, r) => s + r.value, 0);
      const totalLoans = supervisionRows.reduce((s, r) => s + r.loans, 0);
      const totalTarget = supervisionRows.reduce((s, r) => s + r.target, 0);
      const totalActiveReps = supervisionRows.reduce((s, r) => s + r.activeReps, 0);

      const wholeTotalRow = {
        name: 'Whole Total',
        value: totalValue,
        loans: totalLoans,
        target: totalTarget,
        activeReps: totalActiveReps,
        isWholeTotal: true
      };

      return {
        product: dept,
        totalValue,
        totalLoans,
        totalTarget,
        totalActiveReps,
        percentAchieved: totalTarget > 0 ? (totalValue / totalTarget * 100) : 0,
        percentUnachieved: totalTarget > 0 ? Math.max(0, (totalTarget - totalValue) / totalTarget * 100) : 0,
        averageLoanSize: totalLoans > 0 ? totalValue / totalLoans : 0,
        supervisionRows,
        teamLeaderRows,
        wholeTotalRow,
        reportDate: hook.parsedData.reportDate
      };
    }).filter(Boolean);
  }, [mtdCS.parsedData, mtdLBF.parsedData, mtdSME.parsedData, managementReports, targetMonth]);

  const isLoading = mtdCS.loading || mtdLBF.loading || mtdSME.loading;

  const handleExport = () => {
    const exportData = [];
    trackerData.forEach(row => {
      exportData.push({ 'Section': `${row.product} - SUMMARY` });
      exportData.push({
        'Product': row.product,
        'Total Value': row.totalValue,
        'Total Loans': row.totalLoans,
        'Target': row.totalTarget,
        '% Achieved': row.percentAchieved.toFixed(1) + '%',
        '% Unachieved': row.percentUnachieved.toFixed(1) + '%',
        'Average Loan Size': row.averageLoanSize.toFixed(2),
        'Active Reps': row.totalActiveReps
      });
      exportData.push({ 'Product': 'Whole Total', 'Total Value': row.wholeTotalRow.value, 'Total Loans': row.wholeTotalRow.loans, 'Target': row.wholeTotalRow.target, '% Achieved': row.percentAchieved.toFixed(1) + '%', '% Unachieved': row.percentUnachieved.toFixed(1) + '%', 'Average Loan Size': row.averageLoanSize.toFixed(2), 'Active Reps': row.wholeTotalRow.activeReps });
      exportData.push({});
      exportData.push({ 'Section': `${row.product} - SUPERVISION` });
      exportData.push({ 'Name': 'Name', 'Value': 'Value', '% Achieved': '% Achieved', '% Unachieved': '% Unachieved', 'Loans': 'Loans', 'Month Target': 'Month Target', 'Active Reps': 'Active Reps' });
      row.supervisionRows.forEach(r => {
        const pctA = r.target > 0 ? (r.value / r.target * 100).toFixed(1) + '%' : '-';
        const pctU = r.target > 0 ? Math.max(0, (r.target - r.value) / r.target * 100).toFixed(1) + '%' : '-';
        exportData.push({ 'Name': r.name, 'Value': r.value, '% Achieved': pctA, '% Unachieved': pctU, 'Loans': r.loans, 'Month Target': r.target, 'Active Reps': r.activeReps });
      });
      const supVal = row.supervisionRows.reduce((s, r) => s + r.value, 0);
      const supTarget = row.supervisionRows.reduce((s, r) => s + r.target, 0);
      const supReps = row.supervisionRows.reduce((s, r) => s + r.activeReps, 0);
      const pctA = supTarget > 0 ? (supVal / supTarget * 100).toFixed(1) + '%' : '-';
      const pctU = supTarget > 0 ? Math.max(0, (supTarget - supVal) / supTarget * 100).toFixed(1) + '%' : '-';
      exportData.push({ 'Name': 'Whole Total', 'Value': supVal, '% Achieved': pctA, '% Unachieved': pctU, 'Loans': row.supervisionRows.reduce((s, r) => s + r.loans, 0), 'Month Target': supTarget, 'Active Reps': supReps });
      exportData.push({});
      exportData.push({ 'Section': `${row.product} - TEAM LEADERS` });
      exportData.push({ 'Name': 'Name', 'Value': 'Value', '% of Target': '%', 'Month Target': 'Target', 'Active Reps': 'Reps', 'Loans': 'Loans', 'Products Sold (Term)': 'Products Sold' });
      row.teamLeaderRows.forEach(tl => {
        const pct = (tl.target && tl.target > 0) ? (tl.value / tl.target * 100).toFixed(1) + '%' : '-';
        exportData.push({
          'Name': tl.name,
          'Value': tl.value,
          '% of Target': pct,
          'Month Target': tl.target,
          'Active Reps': tl.activeReps,
          'Loans': tl.loans,
          'Products Sold (Term)': tl.productsSold.map(p => `${p.term} (${p.count}, ${p.value})`).join('; ') || '-'
        });
        tl.productsSold.forEach(p => exportData.push({ 'Name': `  ${p.term}`, 'Value': p.value, '% of Target': '', 'Month Target': '', 'Active Reps': p.count, 'Loans': '', 'Products Sold (Term)': '' }));
      });
      const pctTotal = row.totalTarget > 0 ? (row.wholeTotalRow.value / row.totalTarget * 100).toFixed(1) + '%' : '-';
      exportData.push({ 'Name': 'Whole Total', 'Value': row.wholeTotalRow.value, '% of Target': pctTotal, 'Month Target': row.totalTarget, 'Active Reps': row.wholeTotalRow.activeReps, 'Loans': row.wholeTotalRow.loans, 'Products Sold (Term)': '' });
      exportData.push({});
    });
    exportToExcel(exportData, 'Product_Sales_Tracker_MTD', { colWidths: [22, 18, 14, 16, 14, 12, 45] });
  };

  const getExportSheets = () => {
    const tables = [];
    if (trackerData.length === 0) return [];
    const formatVal = (v) => {
      if (v === null || v === undefined || v === 0) return '-';
      if (typeof v === 'number') {
        if (v >= 1000000000) return (v / 1000000000).toFixed(2) + 'B';
        if (v >= 1000000) return (v / 1000000).toFixed(2) + 'M';
        if (v >= 1000) return (v / 1000).toFixed(2) + 'K';
        return v.toLocaleString();
      }
      return v;
    };
    const summaryRows = trackerData.map(row => ({
      'Product': row.product,
      'Total Value': row.totalValue,
      'Total Loans': row.totalLoans,
      'Target': row.totalTarget,
      '% Achieved': row.percentAchieved.toFixed(1) + '%',
      '% Unachieved': row.percentUnachieved.toFixed(1) + '%',
      'Average Loan Size': Math.round(row.averageLoanSize * 100) / 100,
      'Active Reps': row.totalActiveReps
    }));
    const sumVal = trackerData.reduce((s, r) => s + r.totalValue, 0);
    const sumLoans = trackerData.reduce((s, r) => s + r.totalLoans, 0);
    const sumTarget = trackerData.reduce((s, r) => s + r.totalTarget, 0);
    const avgLoanSize = sumLoans > 0 ? sumVal / sumLoans : null;
    const grandTotal = {
      'Product': 'Whole Total',
      'Total Value': sumVal,
      'Total Loans': sumLoans,
      'Target': sumTarget,
      '% Achieved': sumTarget > 0 ? (sumVal / sumTarget * 100).toFixed(1) + '%' : '-',
      '% Unachieved': sumTarget > 0 ? Math.max(0, (sumTarget - sumVal) / sumTarget * 100).toFixed(1) + '%' : '-',
      'Average Loan Size': avgLoanSize != null ? Math.round(avgLoanSize * 100) / 100 : '-',
      'Active Reps': trackerData.reduce((s, r) => s + r.totalActiveReps, 0)
    };
    tables.push({
      title: 'Summary',
      data: [...summaryRows, grandTotal],
      totalRowIndices: [summaryRows.length],
      colWidths: [12, 16, 14, 14, 12, 14, 16, 12],
      headerColors: { 'Product': '#4472C4', 'Total Value': '#70AD47', 'Target': '#ED7D31' },
      accountingColumns: ['Total Value', 'Total Loans', 'Target', 'Average Loan Size', 'Active Reps']
    });
    // CS, LBF, and SME (when SME has MTD with supervision/TL breakdown)
    trackerData.filter(r => r.product !== 'AgriFinance' && (r.product !== 'SME' || (r.teamLeaderRows?.length ?? 0) > 0)).forEach(row => {
      const supRows = row.supervisionRows.map(r => {
        const pctA = r.target > 0 ? (r.value / r.target * 100).toFixed(1) + '%' : '-';
        const pctU = r.target > 0 ? Math.max(0, (r.target - r.value) / r.target * 100).toFixed(1) + '%' : '-';
        return { 'Name': r.name, 'Value': r.value, '% Achieved': pctA, '% Unachieved': pctU, 'Loans': r.loans, 'Month Target': r.target, 'Active Reps': r.activeReps };
      });
      const supVal = row.supervisionRows.reduce((s, r) => s + r.value, 0);
      const supTarget = row.supervisionRows.reduce((s, r) => s + r.target, 0);
      const supReps = row.supervisionRows.reduce((s, r) => s + r.activeReps, 0);
      const supPctA = supTarget > 0 ? (supVal / supTarget * 100).toFixed(1) + '%' : '-';
      const supPctU = supTarget > 0 ? Math.max(0, (supTarget - supVal) / supTarget * 100).toFixed(1) + '%' : '-';
      const supTotal = { 'Name': 'Whole Total', 'Value': supVal, '% Achieved': supPctA, '% Unachieved': supPctU, 'Loans': row.supervisionRows.reduce((s, r) => s + r.loans, 0), 'Month Target': supTarget, 'Active Reps': supReps };
      if (supRows.length > 0) {
        tables.push({
          title: `${row.product} - Supervision`,
          data: [...supRows, supTotal],
          totalRowIndices: [supRows.length],
          colWidths: [22, 16, 12, 14, 12, 14, 14],
          headerColors: { 'Name': '#4472C4', 'Value': '#70AD47', 'Month Target': '#ED7D31' }
        });
      }
      const tlRows = [];
      const emptyRow = { 'Name': '', 'Value': '', '% of Target': '', 'Month Target': '', 'Active Reps': '', 'Loans': '', 'Products Sold': '' };
      row.teamLeaderRows.forEach((tl, tlIdx) => {
        const pctTarget = (tl.target && tl.target > 0) ? (tl.value / tl.target * 100).toFixed(1) + '%' : '-';
        tlRows.push({
          'Name': tl.name,
          'Value': tl.value,
          '% of Target': pctTarget,
          'Month Target': tl.target,
          'Active Reps': tl.activeReps,
          'Loans': tl.loans,
          'Products Sold': tl.productsSold.map(p => `${p.term} (${p.count}, ${formatVal(p.value)})`).join('; ') || '-'
        });
        tl.productsSold.forEach(p => tlRows.push({ ...emptyRow, 'Name': `  ${p.term}`, 'Value': p.value, 'Active Reps': p.count }));
        if (tlIdx < row.teamLeaderRows.length - 1) {
          tlRows.push({ ...emptyRow, __separator: true });
        }
      });
      const pctTotal = row.totalTarget > 0 ? (row.wholeTotalRow.value / row.totalTarget * 100).toFixed(1) + '%' : '-';
      const tlTotal = { 'Name': 'Whole Total', 'Value': row.wholeTotalRow.value, '% of Target': pctTotal, 'Month Target': row.totalTarget, 'Active Reps': row.wholeTotalRow.activeReps, 'Loans': row.wholeTotalRow.loans, 'Products Sold': '' };
      if (tlRows.length > 0) {
        const totalRowIdx = tlRows.length;
        tables.push({
          title: `${row.product} - Team Leaders`,
          data: [...tlRows, tlTotal],
          totalRowIndices: [totalRowIdx],
          colWidths: [22, 16, 12, 14, 12, 12, 40],
          headerColors: { 'Name': '#4472C4', 'Value': '#70AD47', 'Products Sold': '#7030A0' }
        });
      }
    });
    // SME (management-only fallback) and AgriFinance: simple table
    trackerData.filter(r => r.product === 'AgriFinance' || (r.product === 'SME' && (r.teamLeaderRows?.length ?? 0) === 0)).forEach(row => {
      const smeRows = row.supervisionRows.map(r => ({ 'Name': r.name, 'Value': r.value, 'Loans': r.loans, 'Target': r.target, 'Active Reps': r.activeReps }));
      row.teamLeaderRows.forEach(tl => smeRows.push({ 'Name': tl.name, 'Value': tl.value, 'Loans': tl.loans, 'Target': tl.target, 'Active Reps': tl.activeReps }));
      const smeTotal = { 'Name': 'Whole Total', 'Value': row.wholeTotalRow.value, 'Loans': row.wholeTotalRow.loans, 'Target': row.totalTarget, 'Active Reps': row.wholeTotalRow.activeReps };
      if (smeRows.length > 0) tables.push({ title: row.product, data: [...smeRows, smeTotal], totalRowIndices: [smeRows.length], colWidths: [22, 16, 12, 14, 14], headerColors: { 'Name': '#4472C4', 'Value': '#70AD47' } });
    });
    if (tables.length === 0) return [];
    return [{ name: 'Product Sales Tracker (MTD)', tables }];
  };

  useImperativeHandle(ref, () => ({ getExportSheets }), [trackerData]);

  const formatValue = (value, options = {}) => {
    if (value === null || value === undefined || value === 0) return '-';
    if (typeof value === 'number') {
      if (options.noAbbreviate) return value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
      if (value >= 1000000000) return (value / 1000000000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + 'B';
      if (value >= 1000000) return (value / 1000000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + 'M';
      if (value >= 1000) return (value / 1000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + 'K';
      return value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    }
    return value;
  };

  if (isLoading) {
    return (
      <div className="mtd-container">
        <div className="mtd-header">
          <h3 className="mtd-title">PRODUCT/SALES TRACKER (MTD)</h3>
        </div>
        <div className="mtd-loading">
          <LoadingSpinner size="medium" />
        </div>
      </div>
    );
  }

  return (
    <div className="mtd-container">
      <div className="mtd-header">
        <h3 className="mtd-title">PRODUCT/SALES TRACKER (MTD)</h3>
      </div>
      
      <div className="mtd-content">
        {/* Summary Table */}
        <div className="mtd-table-wrapper">
          <table className="mtd-table">
            <thead>
              <tr>
                <th className="mtd-th-product">Product</th>
                <th className="mtd-th-value">Total Value</th>
                <th className="mtd-th-loans">Total Loans</th>
                <th className="mtd-th-value">Target</th>
                <th className="mtd-th-value">% Achieved</th>
                <th className="mtd-th-value">% Unachieved</th>
                <th className="mtd-th-loans">Avg Loan Size</th>
                <th className="mtd-th-performer">Active Reps</th>
              </tr>
            </thead>
            <tbody>
              {trackerData.length > 0 ? (
                <>
                  {trackerData.map((row, index) => (
                    <tr key={index}>
                      <td className="mtd-td-product">{row.product}</td>
                      <td className="mtd-td-number">{formatValue(row.totalValue)}</td>
                      <td className="mtd-td-number">{formatValue(row.totalLoans)}</td>
                      <td className="mtd-td-number">{formatValue(row.totalTarget)}</td>
                      <td className="mtd-td-number">{row.percentAchieved.toFixed(1)}%</td>
                      <td className="mtd-td-number">{row.percentUnachieved.toFixed(1)}%</td>
                      <td className="mtd-td-number">{formatValue(row.averageLoanSize, { noAbbreviate: true })}</td>
                      <td className="mtd-td-number">{formatValue(row.totalActiveReps)}</td>
                    </tr>
                  ))}
                  <tr className="mtd-whole-total-row">
                    <td className="mtd-td-product mtd-whole-total-cell">Whole Total</td>
                    <td className="mtd-td-number mtd-whole-total-cell">{formatValue(trackerData.reduce((s, r) => s + r.totalValue, 0))}</td>
                    <td className="mtd-td-number mtd-whole-total-cell">{formatValue(trackerData.reduce((s, r) => s + r.totalLoans, 0))}</td>
                    <td className="mtd-td-number mtd-whole-total-cell">{formatValue(trackerData.reduce((s, r) => s + r.totalTarget, 0))}</td>
                    <td className="mtd-td-number mtd-whole-total-cell">{trackerData.reduce((s, r) => s + r.totalTarget, 0) > 0 ? (trackerData.reduce((s, r) => s + r.totalValue, 0) / trackerData.reduce((s, r) => s + r.totalTarget, 0) * 100).toFixed(1) + '%' : '-'}</td>
                    <td className="mtd-td-number mtd-whole-total-cell">{trackerData.reduce((s, r) => s + r.totalTarget, 0) > 0 ? (Math.max(0, (trackerData.reduce((s, r) => s + r.totalTarget, 0) - trackerData.reduce((s, r) => s + r.totalValue, 0)) / trackerData.reduce((s, r) => s + r.totalTarget, 0) * 100)).toFixed(1) + '%' : '-'}</td>
                    <td className="mtd-td-number mtd-whole-total-cell">{(() => { const tv = trackerData.reduce((s, r) => s + r.totalValue, 0); const tl = trackerData.reduce((s, r) => s + r.totalLoans, 0); return tv > 0 && tl > 0 ? formatValue(tv / tl, { noAbbreviate: true }) : '-'; })()}</td>
                    <td className="mtd-td-number mtd-whole-total-cell">{formatValue(trackerData.reduce((s, r) => s + r.totalActiveReps, 0))}</td>
                  </tr>
                </>
              ) : (
                <tr>
                  <td colSpan="8" className="mtd-no-data">No data available</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Supervision – horizontal: CS | LBF | SME (same structure when MTD data available) */}
        <div className="mtd-section mtd-supervision-section">
          <h4 className="mtd-section-title">Supervision</h4>
          <div className="mtd-horizontal-tables">
            {trackerData.filter(r => r.product !== 'AgriFinance').map((row, index) => (
              <div key={index} className="mtd-product-card">
                <h5 className="mtd-product-card-title">{row.product}</h5>
                <div className="mtd-performers-table-wrapper">
                  <table className="mtd-performers-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Name</th>
                        <th>Value</th>
                        <th>% Achieved</th>
                        <th>% Unachieved</th>
                        <th>Target</th>
                        <th>Active Reps</th>
                        <th>Loans</th>
                      </tr>
                    </thead>
                    <tbody>
                      {row.supervisionRows.map((r, i) => {
                        const pctAch = r.target > 0 ? (r.value / r.target * 100) : 0;
                        const pctUnach = r.target > 0 ? Math.max(0, (r.target - r.value) / r.target * 100) : 0;
                        return (
                          <tr key={i}>
                            <td className="mtd-rank-cell">{i + 1}</td>
                            <td>{r.name}</td>
                            <td className="mtd-td-number">{formatValue(r.value)}</td>
                            <td className="mtd-td-percent">{r.target > 0 ? pctAch.toFixed(1) + '%' : '-'}</td>
                            <td className="mtd-td-percent">{r.target > 0 ? pctUnach.toFixed(1) + '%' : '-'}</td>
                            <td className="mtd-td-number">{formatValue(r.target)}</td>
                            <td className="mtd-td-number">{formatValue(r.activeReps)}</td>
                            <td className="mtd-td-number">{formatValue(r.loans)}</td>
                          </tr>
                        );
                      })}
                      <tr className="mtd-whole-total-row">
                        <td colSpan="2" className="mtd-whole-total-cell">Whole Total</td>
                        <td className="mtd-td-number mtd-whole-total-cell">{formatValue(row.supervisionRows.reduce((s, r) => s + r.value, 0))}</td>
                        <td className="mtd-whole-total-cell">{row.totalTarget > 0 ? (row.supervisionRows.reduce((s, r) => s + r.value, 0) / row.totalTarget * 100).toFixed(1) + '%' : '-'}</td>
                        <td className="mtd-whole-total-cell">{row.totalTarget > 0 ? (Math.max(0, (row.totalTarget - row.supervisionRows.reduce((s, r) => s + r.value, 0)) / row.totalTarget * 100)).toFixed(1) + '%' : '-'}</td>
                        <td className="mtd-td-number mtd-whole-total-cell">{formatValue(row.supervisionRows.reduce((s, r) => s + r.target, 0))}</td>
                        <td className="mtd-td-number mtd-whole-total-cell">{formatValue(row.supervisionRows.reduce((s, r) => s + r.activeReps, 0))}</td>
                        <td className="mtd-td-number mtd-whole-total-cell">{formatValue(row.supervisionRows.reduce((s, r) => s + r.loans, 0))}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Team Leaders – horizontal: CS | LBF | SME, with products sold per TL */}
        <div className="mtd-section mtd-teamleaders-section">
          <h4 className="mtd-section-title">Team Leaders</h4>
          <div className="mtd-horizontal-tables">
            {trackerData.filter(r => r.product !== 'AgriFinance').map((row, index) => (
              <div key={index} className="mtd-product-card">
                <h5 className="mtd-product-card-title">{row.product}</h5>
                <div className="mtd-performers-table-wrapper">
                  <table className="mtd-performers-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Name</th>
                        <th>Value</th>
                        <th>%</th>
                        <th>Target</th>
                        <th>Active Reps</th>
                        <th>Loans</th>
                        <th>Products Sold</th>
                      </tr>
                    </thead>
                    <tbody>
                      {row.teamLeaderRows.map((tl, i) => (
                        <Fragment key={i}>
                          <tr>
                            <td className="mtd-rank-cell">{i + 1}</td>
                            <td className="mtd-td-name">{tl.name}</td>
                            <td className="mtd-td-number">{formatValue(tl.value)}</td>
                            <td className="mtd-td-percent">{tl.target > 0 ? (tl.value / tl.target * 100).toFixed(1) + '%' : '-'}</td>
                            <td className="mtd-td-number">{formatValue(tl.target)}</td>
                            <td className="mtd-td-number">{formatValue(tl.activeReps)}</td>
                            <td className="mtd-td-number">{formatValue(tl.loans)}</td>
                            <td className="mtd-products-cell">{tl.productsSold.length > 0 ? tl.productsSold.map(p => `${p.term} (${p.count}, ${formatValue(p.value)})`).join('; ') : '-'}</td>
                          </tr>
                          {tl.productsSold.map((p, j) => (
                            <tr key={`${i}-${j}`} className="mtd-sub-row">
                              <td></td>
                              <td colSpan="5" className="mtd-sub-indent">{p.term}: {p.count} loans, {formatValue(p.value)}</td>
                              <td className="mtd-td-number">{formatValue(p.value)}</td>
                              <td></td>
                            </tr>
                          ))}
                        </Fragment>
                      ))}
                      <tr className="mtd-whole-total-row">
                        <td colSpan="2" className="mtd-whole-total-cell">Whole Total</td>
                        <td className="mtd-td-number mtd-whole-total-cell">{formatValue(row.wholeTotalRow.value)}</td>
                        <td className="mtd-whole-total-cell">{row.totalTarget > 0 ? (row.wholeTotalRow.value / row.totalTarget * 100).toFixed(1) + '%' : '-'}</td>
                        <td className="mtd-td-number mtd-whole-total-cell">{formatValue(row.totalTarget)}</td>
                        <td className="mtd-td-number mtd-whole-total-cell">{formatValue(row.wholeTotalRow.activeReps)}</td>
                        <td className="mtd-td-number mtd-whole-total-cell">{formatValue(row.wholeTotalRow.loans)}</td>
                        <td className="mtd-whole-total-cell"></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </div>
        {/* AgriFinance only (no MTD; SME uses same Supervision/Team Leaders sections as CS/LBF) */}
        {trackerData.some(r => r.product === 'AgriFinance') && (
          <div className="mtd-section">
            <h4 className="mtd-section-title">AgriFinance</h4>
            {trackerData.filter(r => r.product === 'AgriFinance').map((row, index) => (
              <div key={index} className="mtd-product-card mtd-sme-card">
                <h5 className="mtd-product-card-title">{row.product}</h5>
                <div className="mtd-performers-table-wrapper">
                  <table className="mtd-performers-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Name</th>
                        <th>Value</th>
                        <th>%</th>
                        <th>Target</th>
                        <th>Active Reps</th>
                        <th>Loans</th>
                      </tr>
                    </thead>
                    <tbody>
                      {row.supervisionRows.map((r, i) => (
                        <tr key={`s-${i}`}>
                          <td className="mtd-rank-cell">{i + 1}</td>
                          <td>{r.name}</td>
                          <td className="mtd-td-number">{formatValue(r.value)}</td>
                          <td className="mtd-td-percent">{r.target > 0 ? (r.value / r.target * 100).toFixed(1) + '%' : '-'}</td>
                          <td className="mtd-td-number">{formatValue(r.target)}</td>
                          <td className="mtd-td-number">{formatValue(r.activeReps)}</td>
                          <td className="mtd-td-number">{formatValue(r.loans)}</td>
                        </tr>
                      ))}
                      {row.teamLeaderRows.map((tl, i) => (
                        <tr key={`t-${i}`}>
                          <td className="mtd-rank-cell">{row.supervisionRows.length + i + 1}</td>
                          <td>{tl.name}</td>
                          <td className="mtd-td-number">{formatValue(tl.value)}</td>
                          <td className="mtd-td-percent">{tl.target > 0 ? (tl.value / tl.target * 100).toFixed(1) + '%' : '-'}</td>
                          <td className="mtd-td-number">{formatValue(tl.target)}</td>
                          <td className="mtd-td-number">{formatValue(tl.activeReps)}</td>
                          <td className="mtd-td-number">{formatValue(tl.loans)}</td>
                        </tr>
                      ))}
                      <tr className="mtd-whole-total-row">
                        <td colSpan="2" className="mtd-whole-total-cell">Whole Total</td>
                        <td className="mtd-td-number mtd-whole-total-cell">{formatValue(row.wholeTotalRow.value)}</td>
                        <td className="mtd-whole-total-cell">{row.totalTarget > 0 ? (row.wholeTotalRow.value / row.totalTarget * 100).toFixed(1) + '%' : '-'}</td>
                        <td className="mtd-td-number mtd-whole-total-cell">{formatValue(row.totalTarget)}</td>
                        <td className="mtd-td-number mtd-whole-total-cell">{formatValue(row.wholeTotalRow.activeReps)}</td>
                        <td className="mtd-td-number mtd-whole-total-cell">{formatValue(row.wholeTotalRow.loans)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mtd-footer">
        <button className="mtd-export-btn" onClick={handleExport} title="Download this section as Excel">
          <span className="mtd-export-icon">📥</span>
        </button>
      </div>
    </div>
  );
});

ProductSalesTracker.displayName = 'ProductSalesTracker';
export default ProductSalesTracker;
