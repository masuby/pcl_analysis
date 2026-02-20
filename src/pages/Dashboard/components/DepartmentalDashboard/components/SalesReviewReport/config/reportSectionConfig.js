/**
 * Config for product-specific performance sections (CS, LBF, IPF, SME, etc.).
 * Each section uses the same flow: title page, summary, trend chart, comparison, (optional) product contribution.
 * getData(reports) must return array of { date, ...metrics } (same shape as countrywiseData).
 */

function rowFromReport(report, spread) {
  const date = report.date ? (report.date instanceof Date ? report.date : new Date(report.date)) : new Date();
  return { fileName: report.fileName || 'Unknown', date, ...spread };
}

/**
 * Sections in TOC order. getData receives parsedReports and returns time-series array for that product.
 */
export const REPORT_SECTIONS = [
  {
    id: 'cs-mainland',
    tocNumber: '2.i',
    title: 'CS MAINLAND PERFORMANCE HIGHLIGHTS',
    trendTitle: 'CS MAINLAND SALES TREND',
    getData: (reports) =>
      (reports || [])
        .filter((r) => r.cs && Object.keys(r.cs).length > 0)
        .map((r) => ({ fileName: r.fileName, date: r.date ? (r.date instanceof Date ? r.date : new Date(r.date)) : new Date(), ...r.cs })),
    productKeys: ['CS', 'Cs Asset Finance']
  },
  {
    id: 'cs-zanzibar',
    tocNumber: '2.ii',
    title: 'CS ZANZIBAR PERFORMANCE HIGHLIGHTS',
    trendTitle: 'CS ZANZIBAR SALES TREND',
    getData: (reports) =>
      (reports || [])
        .filter((r) => r.zanzibar && Object.keys(r.zanzibar).length > 0)
        .map((r) => rowFromReport(r, r.zanzibar)),
    productKeys: ['ZANZIBAR']
  },
  {
    id: 'lbf',
    tocNumber: '3',
    title: 'LBF PRODUCT PERFORMANCE HIGHLIGHTS',
    trendTitle: 'LBF SALES TREND',
    getData: (reports) =>
      (reports || [])
        .filter((r) => r.lbf && Object.keys(r.lbf).length > 0)
        .map((r) => ({ fileName: r.fileName, date: r.date ? (r.date instanceof Date ? r.date : new Date(r.date)) : new Date(), ...r.lbf })),
    productKeys: ['LBF', 'IPF', 'MIF', 'MIF Customs', 'Lbf Yard Finance', 'LBF QUICKCASH', 'LBF-FLEX']
  },
  {
    id: 'ipf',
    tocNumber: '3.i',
    title: 'IPF PRODUCT PERFORMANCE HIGHLIGHTS',
    trendTitle: 'IPF SALES TREND',
    getData: (reports) =>
      (reports || [])
        .filter((r) => r.lbfBranches && r.lbfBranches['IPF'] && Object.keys(r.lbfBranches['IPF']).length > 0)
        .map((r) => rowFromReport(r, r.lbfBranches['IPF'])),
    productKeys: null
  },
  {
    id: 'quickcash',
    tocNumber: '3.ii',
    title: 'QUICK CASH PERFORMANCE HIGHLIGHTS',
    trendTitle: 'QUICK CASH SALES TREND',
    getData: (reports) =>
      (reports || [])
        .filter((r) => r.lbfBranches && r.lbfBranches['LBF QUICKCASH'] && Object.keys(r.lbfBranches['LBF QUICKCASH']).length > 0)
        .map((r) => rowFromReport(r, r.lbfBranches['LBF QUICKCASH'])),
    productKeys: null
  },
  {
    id: 'mif',
    tocNumber: '3.iii',
    title: 'MIF (SHORT TERM & LONG TERM) PERFORMANCE HIGHLIGHTS',
    trendTitle: 'MIF SALES TREND',
    getData: (reports) =>
      (reports || [])
        .filter((r) => r.lbfBranches && r.lbfBranches['MIF'] && Object.keys(r.lbfBranches['MIF']).length > 0)
        .map((r) => rowFromReport(r, r.lbfBranches['MIF'])),
    productKeys: null
  },
  {
    id: 'mifCustoms',
    tocNumber: '3.iv',
    title: 'MIF CUSTOMS PERFORMANCE HIGHLIGHTS',
    trendTitle: 'MIF CUSTOMS SALES TREND',
    getData: (reports) =>
      (reports || [])
        .filter((r) => r.lbfBranches && r.lbfBranches['MIF Customs'] && Object.keys(r.lbfBranches['MIF Customs']).length > 0)
        .map((r) => rowFromReport(r, r.lbfBranches['MIF Customs'])),
    productKeys: null
  },
  {
    id: 'yardFinance',
    tocNumber: '3.v',
    title: 'YARD FINANCE PERFORMANCE HIGHLIGHTS',
    trendTitle: 'YARD FINANCE SALES TREND',
    getData: (reports) =>
      (reports || [])
        .filter((r) => r.lbfBranches && r.lbfBranches['Lbf Yard Finance'] && Object.keys(r.lbfBranches['Lbf Yard Finance']).length > 0)
        .map((r) => rowFromReport(r, r.lbfBranches['Lbf Yard Finance'])),
    productKeys: null
  },
  {
    id: 'lbf-flex',
    tocNumber: '3.vi',
    title: 'LBF-FLEX PERFORMANCE HIGHLIGHTS',
    trendTitle: 'LBF-FLEX SALES TREND',
    getData: (reports) =>
      (reports || [])
        .filter((r) => r.lbfBranches && r.lbfBranches['LBF-FLEX'] && Object.keys(r.lbfBranches['LBF-FLEX']).length > 0)
        .map((r) => rowFromReport(r, r.lbfBranches['LBF-FLEX'])),
    productKeys: null
  },
  {
    id: 'sme',
    tocNumber: '4',
    title: 'SME PERFORMANCE HIGHLIGHTS',
    trendTitle: 'SME SALES TREND',
    getData: (reports) =>
      (reports || [])
        .filter((r) => r.sme && Object.keys(r.sme).length > 0)
        .map((r) => ({ fileName: r.fileName, date: r.date ? (r.date instanceof Date ? r.date : new Date(r.date)) : new Date(), ...r.sme })),
    productKeys: null
  },
  {
    id: 'agrifinance',
    tocNumber: '5',
    title: 'AGRIFINANCE PERFORMANCE HIGHLIGHT',
    trendTitle: 'AGRIFINANCE SALES TREND',
    getData: (reports) =>
      (reports || [])
        .filter((r) => r.agrifinance && Object.keys(r.agrifinance).length > 0)
        .map((r) => ({ fileName: r.fileName, date: r.date ? (r.date instanceof Date ? r.date : new Date(r.date)) : new Date(), ...r.agrifinance })),
    productKeys: null
  }
];
