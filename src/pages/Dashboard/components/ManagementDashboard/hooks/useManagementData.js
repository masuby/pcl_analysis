import { useState, useEffect } from 'react';
import { collection, getDocs, query, where, orderBy } from 'firebase/firestore';
import { db } from '../../../../../services/firebase';
import { readCountrySheet } from '../utils/reportUtils';
import { getReportFileUrl } from '../../../../../services/supabase';

export const useManagementData = (selectedDepartment, fromDate = null, toDate = null) => {
  const [allReports, setAllReports] = useState([]);
  const [managementReports, setManagementReports] = useState([]);
  const [parsedReports, setParsedReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState({
    totalFiles: 0,
    totalSize: 0,
    totalViews: 0,
    totalDownloads: 0
  });

  useEffect(() => {
    fetchReports();
  }, []);

  useEffect(() => {
    filterReports();
  }, [allReports, selectedDepartment, fromDate, toDate]);

  useEffect(() => {
    if (managementReports.length > 0) {
      parseExcelFiles();
    } else {
      setParsedReports([]);
    }
  }, [managementReports]);

  const fetchReports = async () => {
    try {
      setLoading(true);
      setError(null);

      const reportsRef = collection(db, 'reports');
      const snapshot = await getDocs(reportsRef);

      const reportsData = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt || Date.now())
        };
      });

      setAllReports(reportsData);
    } catch (err) {
      console.error('Error fetching reports:', err);
      setError('Failed to load reports from database');
    } finally {
      setLoading(false);
    }
  };

  const filterReports = () => {
    if (!allReports.length) {
      setManagementReports([]);
      return;
    }

    const filtered = allReports.filter(report => {
      const isManagement = report.type === 'MANAGEMENT';
      const matchesDepartment = 
        !selectedDepartment || 
        selectedDepartment === 'ALL' || 
        report.department === selectedDepartment ||
        report.department === 'ALL';

      const isActive = report.isActive !== false;

      // Filter by date
      let inDateRange = true;
      if (fromDate || toDate) {
        const reportDate = report.date ? new Date(report.date) : report.createdAt;
        if (fromDate && reportDate < new Date(fromDate)) inDateRange = false;
        if (toDate && reportDate > new Date(toDate)) inDateRange = false;
      }

      return isManagement && matchesDepartment && isActive && inDateRange;
    });

    const sorted = filtered.sort((a, b) => {
      const dateA = a.createdAt?.getTime ? a.createdAt.getTime() : new Date(a.createdAt).getTime();
      const dateB = b.createdAt?.getTime ? b.createdAt.getTime() : new Date(b.createdAt).getTime();
      return dateB - dateA;
    });

    setManagementReports(sorted);
    calculateStats(sorted);
  };

  const parseExcelFiles = async () => {
    if (!managementReports.length) return;

    setParsing(true);
    try {
      const parsed = await Promise.all(
        managementReports.map(async (report) => {
          try {
            if (!report.fileUrl && !report.filePath) {
              console.warn(`No file URL for report: ${report.fileName}`);
              return null;
            }

            // Use fileUrl if available, otherwise fetch from filePath
            let fileUrl = report.fileUrl;
            if (!fileUrl && report.filePath) {
              try {
                fileUrl = await getReportFileUrl(report.filePath);
              } catch (e) {
                console.warn(`Could not get file URL for ${report.fileName}:`, e);
              }
            }

            if (!fileUrl) {
              return null;
            }

            // Read Country sheet
            const rows = await readCountrySheet(fileUrl);
            
            if (!rows || rows.length === 0) {
              console.warn(`No data found in Country sheet for: ${report.fileName}`);
              return null;
            }

            // Extract all numeric columns from the first row
            const numericColumns = {};
            if (rows.length > 0) {
              Object.keys(rows[0]).forEach(key => {
                if (typeof rows[0][key] === 'number') {
                  numericColumns[key] = true;
                }
              });
            }

            // Extract data for each section
            const countrywiseData = {};
            const csData = {};
            const csBranches = {}; // Individual CS branches
            const lbfData = {};
            const lbfBranches = {}; // Individual LBF branches
            const smeData = {};
            const zanzibarData = {};

            // CS branch names
            const csBranchNames = ['CS', 'Cs Asset Finance'];
            // LBF branch names
            const lbfBranchNames = ['LBF', 'IPF', 'MIF', 'MIF Customs', 'Lbf Yard Finance', 'LBF QUICKCASH'];

            // Extract all numeric columns for each section
            Object.keys(numericColumns).forEach(column => {
              // Countrywise - find Country branch
              const countryRow = rows.find(r => r.Branch === 'Country');
              if (countryRow && typeof countryRow[column] === 'number') {
                countrywiseData[column] = countryRow[column];
              }

              // CS - sum CS and Cs Asset Finance, and store individual branches
              const csRows = rows.filter(r => 
                r.Branch === 'CS' || r.Branch === 'Cs Asset Finance'
              );
              csData[column] = csRows.reduce((sum, r) => sum + (r[column] || 0), 0);
              
              // Store individual CS branch data
              csBranchNames.forEach(branchName => {
                if (!csBranches[branchName]) {
                  csBranches[branchName] = {};
                }
                const branchRow = rows.find(r => r.Branch === branchName);
                if (branchRow && typeof branchRow[column] === 'number') {
                  csBranches[branchName][column] = branchRow[column];
                }
              });

              // LBF - sum all LBF branches, and store individual branches
              const lbfRows = rows.filter(r =>
                lbfBranchNames.includes(r.Branch)
              );
              lbfData[column] = lbfRows.reduce((sum, r) => sum + (r[column] || 0), 0);
              
              // Store individual LBF branch data
              lbfBranchNames.forEach(branchName => {
                if (!lbfBranches[branchName]) {
                  lbfBranches[branchName] = {};
                }
                const branchRow = rows.find(r => r.Branch === branchName);
                if (branchRow && typeof branchRow[column] === 'number') {
                  lbfBranches[branchName][column] = branchRow[column];
                }
              });

              // SME - find SME branch
              const smeRow = rows.find(r => r.Branch === 'SME');
              if (smeRow && typeof smeRow[column] === 'number') {
                smeData[column] = smeRow[column];
              }

              // ZANZIBAR - find ZANZIBAR branch
              const zanzibarRow = rows.find(r => r.Branch === 'ZANZIBAR');
              if (zanzibarRow && typeof zanzibarRow[column] === 'number') {
                zanzibarData[column] = zanzibarRow[column];
              }
            });

            return {
              ...report,
              countrywise: countrywiseData,
              cs: csData,
              csBranches: csBranches,
              lbf: lbfData,
              lbfBranches: lbfBranches,
              sme: smeData,
              zanzibar: zanzibarData,
              date: report.date || report.createdAt
            };
          } catch (err) {
            console.error(`Error parsing Excel for ${report.fileName}:`, err);
            return {
              ...report,
              countrywise: {},
              cs: {},
              csBranches: {},
              lbf: {},
              lbfBranches: {},
              sme: {},
              zanzibar: {},
              date: report.date || report.createdAt,
              parseError: err.message
            };
          }
        })
      );

      // Filter out null results
      const validParsed = parsed.filter(r => r !== null);
      setParsedReports(validParsed);
    } catch (err) {
      console.error('Error parsing Excel files:', err);
      setError('Failed to parse Excel files');
    } finally {
      setParsing(false);
    }
  };

  const calculateStats = (reports) => {
    const totalSize = reports.reduce((sum, r) => sum + (r.fileSize || 0), 0);
    const totalViews = reports.reduce((sum, r) => sum + (r.views || 0), 0);
    const totalDownloads = reports.reduce((sum, r) => sum + (r.downloads || 0), 0);

    setStats({
      totalFiles: reports.length,
      totalSize,
      totalViews,
      totalDownloads
    });
  };

  const refreshData = () => {
    fetchReports();
  };

  return {
    allReports,
    managementReports,
    parsedReports,
    stats,
    loading: loading || parsing,
    error,
    refreshData
  };
};
