import { useState, useCallback } from 'react';
import { 
  parseMultipleReports, 
  extractCountryData 
} from '../utils/fastExcelParser';
import { groupByAggregation, applyCalculation } from '../utils/dataAggregator';

export const useExcelDataParser = () => {
  const [parsing, setParsing] = useState(false);

  const parseExcelFiles = useCallback(async (
    reports,
    rowColumn = 'Branch',
    dataColumn,
    aggregation,
    calculation,
    dateRange
  ) => {
    if (!reports || reports.length === 0) {
      return [];
    }

    setParsing(true);
    
    try {
      const allData = await parseMultipleReports(reports, rowColumn, dataColumn);
      
      if (allData.length === 0) {
        return [];
      }

      let filteredData = allData;
      if (dateRange.from || dateRange.to) {
        filteredData = allData.filter(item => {
          if (!item.date) return false;
          
          const itemDate = new Date(item.date);
          const fromDate = dateRange.from ? new Date(dateRange.from) : null;
          const toDate = dateRange.to ? new Date(dateRange.to) : null;
          
          if (fromDate && itemDate < fromDate) return false;
          if (toDate && itemDate > toDate) return false;
          
          return true;
        });
      }

      const groupedData = groupByAggregation(filteredData, aggregation);
      const aggregatedData = applyCalculation(groupedData, calculation);
      
      return aggregatedData;
    } catch (error) {
      return [];
    } finally {
      setParsing(false);
    }
  }, []);

  const parseCountryData = useCallback(async (reports, dataColumn) => {
    setParsing(true);
    
    try {
      const countryData = await extractCountryData(reports, dataColumn);
      return countryData;
    } catch (error) {
      return [];
    } finally {
      setParsing(false);
    }
  }, []);

  const aggregateData = useCallback((data, config) => {
    if (!data || data.length === 0) return [];

    const { aggregation, calculation, dateRange } = config;

    let filteredData = data;
    if (dateRange.from || dateRange.to) {
      filteredData = data.filter(item => {
        if (!item.date) return false;
        
        const itemDate = new Date(item.date);
        const fromDate = dateRange.from ? new Date(dateRange.from) : null;
        const toDate = dateRange.to ? new Date(dateRange.to) : null;
        
        if (fromDate && itemDate < fromDate) return false;
        if (toDate && itemDate > toDate) return false;
        
        return true;
      });
    }

    const groupedData = groupByAggregation(filteredData, aggregation);
    const aggregatedData = applyCalculation(groupedData, calculation);
    
    return aggregatedData;
  }, []);

  return {
    parsing,
    parseExcelFiles,
    parseCountryData,
    aggregateData
  };
};