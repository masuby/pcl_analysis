import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { downloadReportFile } from '../../../../services/supabase';
import './ExcelViewer.css';

const ExcelViewer = ({ fileUrl, fileName, fileType, filePath }) => {
  const [data, setData] = useState([]);
  const [filteredData, setFilteredData] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage] = useState(15);
  const [fileInfo, setFileInfo] = useState(null);
  const [workbook, setWorkbook] = useState(null);
  const [availableSheets, setAvailableSheets] = useState([]);
  const [currentSheet, setCurrentSheet] = useState(null);
  const [sheetData, setSheetData] = useState({});
  const [columnWidths, setColumnWidths] = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFilters, setSearchFilters] = useState({});
  const [showAdvancedFilter, setShowAdvancedFilter] = useState(false);
  const [filteredRowsCount, setFilteredRowsCount] = useState(0);
  const tableContainerRef = useRef(null);
  const tableRef = useRef(null);

  // Filter data based on search query
  useEffect(() => {
    if (!searchQuery.trim() && Object.keys(searchFilters).length === 0) {
      setFilteredData(data);
      setFilteredRowsCount(data.length);
      setCurrentPage(1);
      return;
    }

    const query = searchQuery.toLowerCase().trim();
    const filtered = data.filter(row => {
      // Text search across all columns
      let matchesSearch = true;
      if (query) {
        matchesSearch = Object.values(row).some(value => {
          if (value === null || value === undefined) return false;
          return String(value).toLowerCase().includes(query);
        });
      }

      // Column-specific filters
      let matchesFilters = true;
      Object.entries(searchFilters).forEach(([column, filterValue]) => {
        if (filterValue && column !== 'id') {
          const cellValue = row[column];
          const cellStr = cellValue ? String(cellValue).toLowerCase() : '';
          const filterStr = String(filterValue).toLowerCase();
          
          if (!cellStr.includes(filterStr)) {
            matchesFilters = false;
          }
        }
      });

      return matchesSearch && matchesFilters;
    });

    setFilteredData(filtered);
    setFilteredRowsCount(filtered.length);
    setCurrentPage(1);
  }, [data, searchQuery, searchFilters]);

  useEffect(() => {
    if (!fileUrl && !filePath) {
      setError('No file URL or path provided');
      setLoading(false);
      return;
    }

    fetchAndParseExcel();
  }, [fileUrl, filePath]);

  // Calculate column widths when data or headers change
  useEffect(() => {
    if (headers.length > 0 && data.length > 0) {
      calculateColumnWidths();
    }
  }, [headers, data, currentSheet]);

  const calculateColumnWidths = () => {
    const baseWidths = {};
    
    headers.forEach((header, index) => {
      let maxWidth = Math.min(Math.max(header.length * 9, 100), 400);
      
      const sampleRows = data.slice(0, Math.min(10, data.length));
      sampleRows.forEach(row => {
        const cellValue = row[header];
        if (cellValue !== null && cellValue !== undefined) {
          const strValue = String(cellValue);
          const cellWidth = Math.min(strValue.length * 8, 500);
          if (cellWidth > maxWidth) {
            maxWidth = cellWidth;
          }
        }
      });
      
      maxWidth += 32;
      baseWidths[header] = Math.min(maxWidth, 600);
    });
    
    setColumnWidths(baseWidths);
  };

  // Adjust table container size
  useEffect(() => {
    const adjustContainerSize = () => {
      if (tableContainerRef.current && tableRef.current) {
        const container = tableContainerRef.current;
        const table = tableRef.current;
        
        const totalWidth = Object.values(columnWidths).reduce((sum, width) => sum + width, 0);
        
        container.style.width = '100%';
        container.style.maxWidth = 'none';
        table.style.width = `${Math.max(totalWidth, container.clientWidth)}px`;
        table.style.minWidth = '100%';
      }
    };

    adjustContainerSize();
    
    window.addEventListener('resize', adjustContainerSize);
    return () => window.removeEventListener('resize', adjustContainerSize);
  }, [columnWidths, headers]);

  const fetchAndParseExcel = async () => {
    try {
      setLoading(true);
      setError(null);
      setFileInfo(null);
      setWorkbook(null);
      setAvailableSheets([]);
      setCurrentSheet(null);
      setSheetData({});
      setColumnWidths({});
      setSearchQuery('');
      setSearchFilters({});
      setShowAdvancedFilter(false);

      let excelData;
      let blob;
      
      if (filePath) {
        const downloadResult = await downloadReportFile(filePath);
        if (!downloadResult.success) {
          throw new Error(`Failed to download: ${downloadResult.error}`);
        }
        excelData = downloadResult.data;
        blob = excelData;
        excelData = await blob.arrayBuffer();
      } else if (fileUrl) {
        const response = await fetch(fileUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch: ${response.statusText}`);
        }
        blob = await response.blob();
        excelData = await blob.arrayBuffer();
      }

      setFileInfo({
        size: excelData.byteLength,
        type: blob?.type || 'application/vnd.ms-excel'
      });
      
      await parseExcelData(excelData, blob);
    } catch (err) {
      console.error('Error accessing Excel file:', err);
      setError(`Failed to load Excel file: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const parseExcelData = async (arrayBuffer, blob) => {
    try {
      let workbook;
      
      const readOptions = {
        type: 'array',
        cellFormula: false,
        cellHTML: false,
        cellStyles: false,
        cellDates: true,
        cellNF: false,
        cellText: false,
        raw: true,
        sheetStubs: true,
        bookVBA: false,
        password: '',
        WTF: false,
      };
      
      try {
        workbook = XLSX.read(arrayBuffer, readOptions);
      } catch (parseError) {
        workbook = XLSX.read(arrayBuffer, {
          ...readOptions,
          cellDates: false,
          raw: false,
        });
      }

      if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
        throw new Error('No sheets found in Excel file');
      }

      // Set workbook first
      setWorkbook(workbook);

      // Analyze and categorize sheets
      const sheetAnalysis = workbook.SheetNames.map(sheetName => {
        const worksheet = workbook.Sheets[sheetName];
        const range = worksheet['!ref'];
        let rowCount = 0;
        let colCount = 0;
        let hasData = false;
        
        if (range) {
          const decoded = XLSX.utils.decode_range(range);
          rowCount = decoded.e.r + 1;
          colCount = decoded.e.c + 1;
          hasData = rowCount > 0 && colCount > 0;
        }
        
        const isPivot = sheetName.toLowerCase().includes('pivot') || 
                       sheetName.toLowerCase().includes('pt_') ||
                       sheetName.toLowerCase().includes('pivot_');
        
        const isChart = sheetName.toLowerCase().includes('chart');
        const isDashboard = sheetName.toLowerCase().includes('dashboard');
        
        return {
          name: sheetName,
          index: workbook.SheetNames.indexOf(sheetName),
          rowCount,
          colCount,
          hasData,
          isPivot,
          isChart,
          isDashboard,
          type: isPivot ? 'pivot' : 
                isChart ? 'chart' : 
                isDashboard ? 'dashboard' : 'data'
        };
      });

      const dataSheets = sheetAnalysis.filter(sheet => 
        sheet.hasData && !sheet.isPivot && !sheet.isChart
      ).sort((a, b) => b.rowCount - a.rowCount);
      
      const pivotSheets = sheetAnalysis.filter(sheet => sheet.isPivot);
      const chartSheets = sheetAnalysis.filter(sheet => sheet.isChart);
      const otherSheets = sheetAnalysis.filter(sheet => 
        !sheet.hasData && !sheet.isPivot && !sheet.isChart
      );

      const allSheets = [
        ...dataSheets,
        ...pivotSheets,
        ...chartSheets,
        ...otherSheets
      ];

      setAvailableSheets(allSheets);

      let selectedSheet = allSheets[0];
      if (dataSheets.length > 0) {
        selectedSheet = dataSheets[0];
      }
      
      setCurrentSheet(selectedSheet);
      // Load sheet data using the local workbook variable (not state)
      if (selectedSheet) {
        await loadSheetData(selectedSheet.name, workbook);
      }

    } catch (parseError) {
      console.error('Parse error details:', parseError);
      throw new Error(`Cannot parse Excel file: ${parseError.message}`);
    }
  };

  const loadSheetData = async (sheetName, workbookToUse = null) => {
    try {
      if (sheetData[sheetName]) {
        setHeaders(sheetData[sheetName].headers);
        setData(sheetData[sheetName].data);
        setFilteredData(sheetData[sheetName].data);
        setFilteredRowsCount(sheetData[sheetName].data.length);
        setCurrentPage(1);
        return;
      }

      // Use provided workbook or state workbook
      let activeWorkbook = workbookToUse || workbook;
      
      if (!activeWorkbook) {
        // Wait a bit and retry if workbook is not yet loaded
        await new Promise(resolve => setTimeout(resolve, 100));
        activeWorkbook = workbookToUse || workbook;
        if (!activeWorkbook) {
          throw new Error('Workbook not loaded');
        }
      }

      const worksheet = activeWorkbook.Sheets[sheetName];
      
      if (!worksheet) {
        throw new Error(`Worksheet "${sheetName}" not found`);
      }

      let jsonData;
      let headers = [];
      let dataRows = [];
      
      try {
        jsonData = XLSX.utils.sheet_to_json(worksheet, { 
          header: 1,
          defval: '',
          blankrows: false,
          raw: true
        });
        
        if (jsonData && jsonData.length > 0) {
          const headerRow = Array.isArray(jsonData[0]) ? jsonData[0] : [];
          headers = headerRow.map((header, index) => {
            if (header === null || header === undefined || header === '') {
              return `Column ${index + 1}`;
            }
            return String(header).trim() || `Column ${index + 1}`;
          });
          
          dataRows = jsonData
            .slice(1)
            .filter(row => row && (Array.isArray(row) ? row.some(cell => cell != null) : true))
            .map((row, index) => {
              const rowObj = { id: index + 1 };
              headers.forEach((header, colIndex) => {
                const cellValue = Array.isArray(row) ? row[colIndex] : row[header];
                rowObj[header] = cellValue != null ? cellValue : '';
              });
              return rowObj;
            });
        }
      } catch (e1) {
        try {
          jsonData = XLSX.utils.sheet_to_json(worksheet, {
            defval: '',
            blankrows: false,
            raw: true
          });
          
          if (jsonData && jsonData.length > 0) {
            const firstRow = jsonData[0];
            headers = Object.keys(firstRow).map((key, index) => 
              key.trim() || `Column ${index + 1}`
            );
            
            dataRows = jsonData.map((row, index) => ({
              id: index + 1,
              ...row
            }));
          }
        } catch (e2) {
          headers = ['Column 1'];
          dataRows = [{ id: 1, 'Column 1': 'Sheet appears to be empty or contains only formatting' }];
        }
      }

      const sheetDataCache = {
        headers,
        data: dataRows,
        timestamp: Date.now()
      };
      
      setSheetData(prev => ({
        ...prev,
        [sheetName]: sheetDataCache
      }));

      setHeaders(headers);
      setData(dataRows);
      setFilteredData(dataRows);
      setFilteredRowsCount(dataRows.length);
      setCurrentPage(1);

    } catch (error) {
      console.error(`Error loading sheet "${sheetName}":`, error);
      setError(`Failed to load sheet "${sheetName}": ${error.message}`);
    }
  };

  const handleSheetChange = (sheetName) => {
    const selectedSheet = availableSheets.find(sheet => sheet.name === sheetName);
    if (selectedSheet) {
      setCurrentSheet(selectedSheet);
      setSearchQuery('');
      setSearchFilters({});
      setShowAdvancedFilter(false);
      loadSheetData(sheetName, workbook);
    }
  };

  // Calculate pagination for filtered data
  const totalPages = Math.ceil(filteredData.length / rowsPerPage);
  const startIndex = (currentPage - 1) * rowsPerPage;
  const endIndex = startIndex + rowsPerPage;
  const currentData = filteredData.slice(startIndex, endIndex);

  const handlePreviousPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
    }
  };

  const handleNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
    }
  };

  const handleSearchChange = (e) => {
    setSearchQuery(e.target.value);
  };

  const handleColumnFilterChange = (column, value) => {
    setSearchFilters(prev => ({
      ...prev,
      [column]: value
    }));
  };

  const clearAllFilters = () => {
    setSearchQuery('');
    setSearchFilters({});
  };

  const formatCellValue = (value) => {
    if (value === null || value === undefined || value === '') {
      return <span className="empty-cell">-</span>;
    }
    
    if (typeof value === 'object' && value.f) {
      return (
        <span className="formula-cell" title={`Formula: ${value.f}`}>
          {value.v !== undefined ? formatValue(value.v) : '=Formula'}
        </span>
      );
    }
    
    return formatValue(value);
  };

  const formatValue = (value) => {
    if (value === null || value === undefined || value === '') {
      return '-';
    }
    
    if (value instanceof Date) {
      return value.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    }
    
    if (typeof value === 'string') {
      const date = new Date(value);
      if (!isNaN(date.getTime())) {
        return date.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric'
        });
      }
    }
    
    if (typeof value === 'number') {
      if (Number.isInteger(value)) {
        return value.toLocaleString();
      } else {
        return value.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        });
      }
    }
    
    return String(value);
  };

  const handleDownloadExternal = () => {
    if (fileUrl) {
      window.open(fileUrl, '_blank');
    } else if (filePath) {
      const downloadUrl = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/Reports/${filePath}`;
      window.open(downloadUrl, '_blank');
    }
  };

  const getSheetTypeBadge = (sheet) => {
    if (sheet.isPivot) return { label: 'PIVOT', color: '#805ad5', bgColor: 'rgba(128, 90, 213, 0.1)' };
    if (sheet.isChart) return { label: 'CHART', color: '#d69e2e', bgColor: 'rgba(214, 158, 46, 0.1)' };
    if (sheet.isDashboard) return { label: 'DASH', color: '#3182ce', bgColor: 'rgba(49, 130, 206, 0.1)' };
    if (sheet.hasData) return { label: 'DATA', color: '#38a169', bgColor: 'rgba(56, 161, 105, 0.1)' };
    return { label: 'EMPTY', color: '#718096', bgColor: 'rgba(113, 128, 150, 0.1)' };
  };

  // Get unique values for a column (for filter suggestions)
  const getColumnUniqueValues = (column) => {
    const values = new Set();
    data.forEach(row => {
      if (row[column]) {
        values.add(String(row[column]));
      }
    });
    return Array.from(values).sort();
  };

  if (loading) {
    return (
      <div className="excel-viewer loading">
        <div className="loading-spinner">⏳</div>
        <p>Loading Excel file...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="excel-viewer error">
        <div className="error-icon">⚠️</div>
        <h4>Unable to Load Excel Preview</h4>
        <p>{error}</p>
        <div className="error-actions">
          <button 
            className="retry-button"
            onClick={fetchAndParseExcel}
          >
            Retry Loading
          </button>
          <button 
            className="download-external-button"
            onClick={handleDownloadExternal}
          >
            📥 Download File
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="excel-viewer">
      <div className="viewer-header">
        <div className="search-filter-container">
          {/* Global Search */}
          <div className="search-box">
            <div className="search-icon">🔍</div>
            <input
              type="text"
              value={searchQuery}
              onChange={handleSearchChange}
              placeholder={`Search in ${currentSheet?.name || 'sheet'}...`}
              className="search-input"
            />
            {searchQuery && (
              <button
                className="clear-search"
                onClick={() => setSearchQuery('')}
                title="Clear search"
              >
                ✕
              </button>
            )}
          </div>


          {/* Column Filter Badges */}
          {Object.keys(searchFilters).length > 0 && (
            <div className="filter-badges">
              {Object.entries(searchFilters).map(([column, value]) => (
                <span key={column} className="filter-badge">
                  {column}: {value}
                  <button
                    className="remove-filter"
                    onClick={() => handleColumnFilterChange(column, '')}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
        
        <div className="sheet-selector-container">
          <div className="sheet-selector">
            <select
              id="sheet-select"
              value={currentSheet?.name || ''}
              onChange={(e) => handleSheetChange(e.target.value)}
              className="sheet-dropdown"
            >
              {availableSheets.map((sheet) => {
                const badge = getSheetTypeBadge(sheet);
                return (
                  <option key={sheet.name} value={sheet.name}>
                    {sheet.name} ({sheet.rowCount}x{sheet.colCount}) [{badge.label}]
                  </option>
                );
              })}
            </select>
          </div>
          
          <div className="pagination-controls">
          </div>
        </div>
      </div>

      {/* Advanced Filters Panel */}
      {showAdvancedFilter && headers.length > 0 && (
        <div className="advanced-filters-panel">
          <div className="filters-header">
            <h4>Advanced Filters</h4>
            <button className="close-filters" onClick={() => setShowAdvancedFilter(false)}>
              ✕
            </button>
          </div>
          <div className="column-filters">
            {headers.slice(0, 10).map((header, index) => {
              const uniqueValues = getColumnUniqueValues(header);
              return (
                <div key={index} className="column-filter">
                  <label htmlFor={`filter-${header}`} className="filter-label">
                    {header}
                  </label>
                  <input
                    id={`filter-${header}`}
                    type="text"
                    value={searchFilters[header] || ''}
                    onChange={(e) => handleColumnFilterChange(header, e.target.value)}
                    placeholder={`Filter ${header}...`}
                    className="filter-input"
                    list={`datalist-${header}`}
                  />
                  {uniqueValues.length > 0 && uniqueValues.length <= 20 && (
                    <datalist id={`datalist-${header}`}>
                      {uniqueValues.map((value, idx) => (
                        <option key={idx} value={value} />
                      ))}
                    </datalist>
                  )}
                </div>
              );
            })}
          </div>
          <div className="filters-actions">
            <button className="clear-all-filters" onClick={clearAllFilters}>
              Clear All Filters
            </button>
            <button className="apply-filters" onClick={() => setShowAdvancedFilter(false)}>
              Apply Filters
            </button>
          </div>
        </div>
      )}

      {availableSheets.length > 1 && (
        <div className="sheet-tabs">
          <div className="tabs-container">
            {availableSheets.map((sheet) => {
              const badge = getSheetTypeBadge(sheet);
              const isActive = sheet.name === currentSheet?.name;
              
              return (
                <button
                  key={sheet.name}
                  className={`sheet-tab ${isActive ? 'active' : ''}`}
                  onClick={() => handleSheetChange(sheet.name)}
                  title={`${sheet.name} (${sheet.rowCount} rows × ${sheet.colCount} cols)`}
                >
                  <span className="tab-name">{sheet.name}</span>
                  <span 
                    className="tab-badge"
                    style={{
                      color: badge.color,
                      backgroundColor: badge.bgColor
                    }}
                  >
                    {badge.label}
                  </span>
                  {sheet.rowCount > 0 && (
                    <span className="tab-size">
                      {sheet.rowCount}×{sheet.colCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="sheet-summary">
            <span className="sheet-total">
              {availableSheets.length} sheets
            </span>
            <span className="sheet-types">
              {availableSheets.filter(s => s.hasData).length} data • 
              {availableSheets.filter(s => s.isPivot).length} pivot • 
              {availableSheets.filter(s => s.isChart).length} chart
            </span>
          </div>
        </div>
      )}

      {currentSheet && (
          <div className="sheet-actions">

            {(searchQuery || Object.keys(searchFilters).length > 0) && (
              <button
                className="clear-filters-button"
                onClick={clearAllFilters}
                title="Clear all filters"
              >
                Clear Filters
              </button>
            )}

        </div>
      )}

      <div className="excel-table-container" ref={tableContainerRef}>
        <div className="excel-table-wrapper">
          <table 
            className="excel-table" 
            ref={tableRef}
            style={{ 
              tableLayout: 'auto',
              width: 'auto',
              minWidth: '100%'
            }}
          >
            <thead>
              <tr>
                {headers.map((header, index) => {
                  const width = columnWidths[header] || 'auto';
                  return (
                    <th 
                      key={index} 
                      style={{ 
                        minWidth: `${Math.max(100, width)}px`,
                        maxWidth: '600px',
                        width: 'auto'
                      }}
                    >
                      <div className="header-cell" title={header}>
                        {header}
                      </div>
                      <div className="column-header-actions">
                        <button
                          className="column-filter-btn"
                          onClick={() => {
                            setShowAdvancedFilter(true);
                            // Scroll to this column's filter
                            setTimeout(() => {
                              const filterInput = document.getElementById(`filter-${header}`);
                              if (filterInput) {
                                filterInput.focus();
                              }
                            }, 100);
                          }}
                          title={`Filter ${header}`}
                        >
                          🔍
                        </button>
                      </div>
                      <div 
                        className="column-resizer"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          const startX = e.clientX;
                          const startWidth = width;
                          
                          const onMouseMove = (moveEvent) => {
                            const delta = moveEvent.clientX - startX;
                            const newWidth = Math.max(100, startWidth + delta);
                            setColumnWidths(prev => ({
                              ...prev,
                              [header]: newWidth
                            }));
                          };
                          
                          const onMouseUp = () => {
                            document.removeEventListener('mousemove', onMouseMove);
                            document.removeEventListener('mouseup', onMouseUp);
                          };
                          
                          document.addEventListener('mousemove', onMouseMove);
                          document.addEventListener('mouseup', onMouseUp);
                        }}
                      />
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {currentData.map((row) => (
                <tr key={row.id}>
                  {headers.map((header, colIndex) => (
                    <td key={`${row.id}-${colIndex}`}>
                      <div 
                        className="data-cell" 
                        title={String(row[header] || '')}
                        style={{
                          maxWidth: '600px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {formatCellValue(row[header])}
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="viewer-footer">
        <div className="summary">
          Showing {startIndex + 1}-{Math.min(endIndex, filteredRowsCount)} of {filteredRowsCount} rows
          {currentSheet && (
            <span className="sheet-indicator">
              • Sheet: {currentSheet.name}
            </span>
          )}
          {searchQuery && (
            <span className="search-indicator">
              • Searching: "{searchQuery}"
            </span>
          )}
        </div>
        <div className="navigation">
          <button
            className="nav-button first"
            onClick={() => setCurrentPage(1)}
            disabled={currentPage === 1}
            aria-label="Go to first page"
          >
            First
          </button>
          <button
            className="nav-button prev"
            onClick={handlePreviousPage}
            disabled={currentPage === 1}
            aria-label="Go to previous page"
          >
            Previous
          </button>
          <button
            className="nav-button next"
            onClick={handleNextPage}
            disabled={currentPage === totalPages}
            aria-label="Go to next page"
          >
            Next
          </button>
          <button
            className="nav-button last"
            onClick={() => setCurrentPage(totalPages)}
            disabled={currentPage === totalPages}
            aria-label="Go to last page"
          >
            Last
          </button>

        </div>
      </div>
    </div>
  );
};

export default ExcelViewer;

