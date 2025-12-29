import { useState, useEffect } from 'react';
import { getReportsByDepartment } from '../../../services/reports';

export const useDashboardData = (reportType, department) => {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [availableDepartments, setAvailableDepartments] = useState(['CS', 'LBF', 'SME', 'ALL']);

  useEffect(() => {
    fetchDashboardData();
  }, [reportType, department]);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Fetch reports for selected department
      const result = await getReportsByDepartment(department);
      
      if (result.success) {
        // Filter by report type if needed
        let filteredReports = result.data;
        if (reportType !== 'MANAGEMENT') {
          filteredReports = result.data.filter(report => 
            report.type?.toUpperCase() === reportType
          );
        }
        
        setReports(filteredReports);
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const refreshData = () => {
    fetchDashboardData();
  };

  return {
    reports,
    loading,
    error,
    availableDepartments,
    refreshData
  };
};