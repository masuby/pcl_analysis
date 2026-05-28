import { createContext, useContext, useState, useCallback, useEffect } from 'react';

const ReportRefreshContext = createContext({});

export const useReportRefresh = () => useContext(ReportRefreshContext);

export const ReportRefreshProvider = ({ children }) => {
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [lastReportUpdate, setLastReportUpdate] = useState(null);

  // Trigger refresh for all dashboards
  const triggerRefresh = useCallback((reportData = null) => {
    console.log('[ReportRefresh] Triggering refresh for all dashboards', reportData);
    setLastReportUpdate(reportData);
    setRefreshTrigger(prev => prev + 1);
  }, []);

  // Listen for storage events (for cross-tab communication)
  useEffect(() => {
    const handleStorageChange = (e) => {
      if (e.key === 'pcl_report_refresh') {
        try {
          const data = JSON.parse(e.newValue);
          if (data) {
            triggerRefresh(data);
          }
        } catch (err) {
          console.error('Error parsing refresh event:', err);
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [triggerRefresh]);

  const value = {
    refreshTrigger,
    lastReportUpdate,
    triggerRefresh,
  };

  return (
    <ReportRefreshContext.Provider value={value}>
      {children}
    </ReportRefreshContext.Provider>
  );
};

export default ReportRefreshContext;
