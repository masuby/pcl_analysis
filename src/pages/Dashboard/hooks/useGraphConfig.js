import { useState, useEffect, useCallback } from 'react';
import { useExcelDataParser } from './useExcelDataParser';
import { generateChartConfig, getChartColors } from '../utils/chartUtils';
import { calculateStatistics, generateInsights, formatNumber } from '../utils/dataAggregator';

export const useGraphConfig = (reports, initialConfig = {}) => {
  const [graphConfig, setGraphConfig] = useState({
    rowColumn: 'Branch',
    dataColumn: 'Net Disbursement',
    aggregation: 'daily',
    calculation: 'sum',
    graphType: 'bar',
    dateRange: {
      from: null,
      to: null
    },
    ...initialConfig
  });
  
  const [chartData, setChartData] = useState(null);
  const [statistics, setStatistics] = useState(null);
  const [insights, setInsights] = useState([]);
  const [availableColumns, setAvailableColumns] = useState(['Disbursements This Month', 'New Business', 'Repeat Business', 'Reactivation', 'Refinance', '% New to Disbursements', '% Target Achieved', 'Number of loans', 'Average loan size', 'Active Reps']);
  const [loading, setLoading] = useState(false);
  
  const { parseExcelFiles, aggregateData } = useExcelDataParser();

  // Update graph configuration
  const updateConfig = useCallback((updates) => {
    setGraphConfig(prev => ({
      ...prev,
      ...updates
    }));
  }, []);

  // Load and process data
  const loadData = useCallback(async () => {
    if (!reports || reports.length === 0) {
      setChartData(null);
      setStatistics(null);
      setInsights([]);
      return;
    }

    setLoading(true);
    
    try {
      // Parse Excel files
      const parsedData = await parseExcelFiles(
        reports,
        graphConfig.rowColumn,
        graphConfig.dataColumn,
        graphConfig.aggregation,
        graphConfig.calculation,
        graphConfig.dateRange
      );

      if (parsedData.length === 0) {
        setChartData(null);
        setStatistics(null);
        setInsights([]);
        return;
      }

      // Generate chart configuration
      const chartConfig = generateChartConfig(parsedData, {
        ...graphConfig,
        department: getDepartmentFromReports(reports)
      });
      
      // Calculate statistics
      const stats = calculateStatistics(parsedData);
      
      // Generate insights
      const generatedInsights = generateInsights(parsedData, stats, graphConfig.dataColumn);

      setChartData(chartConfig);
      setStatistics(stats);
      setInsights(generatedInsights);

      // Extract available columns from first report
      if (reports.length > 0 && !availableColumns.includes(graphConfig.dataColumn)) {
        try {
          const sampleReport = reports[0];
          // You could parse the first report to get actual columns
          // For now, we'll keep the default columns
        } catch (error) {
          console.error('Error extracting columns:', error);
        }
      }
    } catch (error) {
      console.error('Error loading graph data:', error);
      setChartData(null);
      setStatistics(null);
      setInsights([]);
    } finally {
      setLoading(false);
    }
  }, [reports, graphConfig, parseExcelFiles, availableColumns]);

  // Get department from reports
  const getDepartmentFromReports = (reports) => {
    if (!reports || reports.length === 0) return null;
    
    const departments = [...new Set(reports.map(r => r.department))];
    if (departments.includes('ALL')) return 'country';
    if (departments.includes('CS')) return 'cs';
    if (departments.includes('LBF')) return 'lbf';
    if (departments.includes('SME')) return 'sme';
    
    return departments[0]?.toLowerCase() || null;
  };

  // Initialize data loading
  useEffect(() => {
    loadData();
  }, [loadData]);

  // Get formatted statistics
  const getFormattedStats = useCallback(() => {
    if (!statistics) return null;
    
    return {
      total: formatNumber(statistics.total),
      average: formatNumber(statistics.average),
      min: formatNumber(statistics.min),
      max: formatNumber(statistics.max),
      count: statistics.count,
      trend: statistics.trend || 'stable'
    };
  }, [statistics]);

  // Get chart colors
  const getColors = useCallback((department = null) => {
    return getChartColors(graphConfig.graphType, department);
  }, [graphConfig.graphType]);

  // Reset date range
  const resetDateRange = useCallback(() => {
    updateConfig({
      dateRange: {
        from: null,
        to: null
      }
    });
  }, [updateConfig]);

  // Set date range to last N days
  const setDateRangeLastNDays = useCallback((days) => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days);
    
    updateConfig({
      dateRange: {
        from: from.toISOString().split('T')[0],
        to: to.toISOString().split('T')[0]
      }
    });
  }, [updateConfig]);

  // Get available aggregations
  const getAvailableAggregations = useCallback(() => {
    return [
      { value: 'daily', label: 'Daily' },
      { value: 'weekly', label: 'Weekly' },
      { value: 'monthly', label: 'Monthly' }
    ];
  }, []);

  // Get available calculations
  const getAvailableCalculations = useCallback(() => {
    return [
      { value: 'actual', label: 'Actual' },
      { value: 'sum', label: 'Sum' },
      { value: 'average', label: 'Average' },
      { value: 'high', label: 'High' },
      { value: 'low', label: 'Low' }
    ];
  }, []);

  // Get available graph types
  const getAvailableGraphTypes = useCallback(() => {
    return [
      { value: 'bar', label: 'Bar Chart', icon: '📊' },
      { value: 'area', label: 'Area Graph', icon: '📈' },
      { value: 'pie', label: 'Pie Chart', icon: '🥧' },
      { value: 'line', label: 'Line Graph', icon: '📉' }
    ];
  }, []);

  return {
    // State
    graphConfig,
    chartData,
    statistics: getFormattedStats(),
    insights,
    loading,
    availableColumns,
    
    // Actions
    updateConfig,
    loadData,
    resetDateRange,
    setDateRangeLastNDays,
    getColors,
    
    // Getters
    getAvailableAggregations,
    getAvailableCalculations,
    getAvailableGraphTypes,
    
    // Derived values
    hasData: chartData !== null,
    dataPoints: statistics?.count || 0
  };
};