import React, { useState, useMemo, useEffect } from 'react';
import './MTDAnalysis.css';

// Format number with K, M, B suffixes
const formatNumber = (num) => {
  if (num === null || num === undefined || isNaN(num)) return '0';
  const n = Number(num);
  if (isNaN(n)) return String(num);
  
  const absNum = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  
  if (absNum >= 1000000000) {
    return sign + (absNum / 1000000000).toFixed(2) + 'B';
  } else if (absNum >= 1000000) {
    return sign + (absNum / 1000000).toFixed(2) + 'M';
  } else if (absNum >= 1000) {
    return sign + (absNum / 1000).toFixed(2) + 'K';
  }
  return sign + absNum.toLocaleString(undefined, { maximumFractionDigits: 2 });
};

// Format percentage
const formatPercent = (num) => {
  if (num === null || num === undefined || isNaN(num)) return '0%';
  const n = Number(num);
  if (isNaN(n)) return String(num);
  
  if (Math.abs(n) > 1) {
    return n.toFixed(2) + '%';
  }
  return (n * 100).toFixed(2) + '%';
};

// Get comment color class
const getCommentClass = (comment) => {
  if (!comment) return '';
  const upper = String(comment).toUpperCase().trim();
  if (upper.includes('EXCELLENT')) return 'mtd-comment-excellent';
  if (upper.includes('BELOW STANDARD')) return 'mtd-comment-below';
  // Check for STANDARD (but not BELOW STANDARD - already handled above)
  if (upper.includes('STANDARD')) return 'mtd-comment-standard';
  return 'mtd-comment-other';
};

const MTDAnalysis = ({ parsedData, department }) => {
  const [viewMode, setViewMode] = useState('supervision');
  const [selectedMetric, setSelectedMetric] = useState('');
  const [selectedItem, setSelectedItem] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  // Get column mappings from parsed data
  const columnMap = parsedData?.columnMap || {};

  // Get available metrics from headers
  const availableMetrics = useMemo(() => {
    if (!parsedData?.headers) return [];
    
    return parsedData.headers.filter(h => {
      if (!h) return false;
      const upper = String(h).toUpperCase();
      if (upper.includes('BRANCH') || upper.includes('NAME') || upper.includes('TEAM')) {
        return false;
      }
      return true;
    });
  }, [parsedData]);

  // Define specific display metrics (8 total)
  const displayMetrics = useMemo(() => {
    const metrics = [];
    const data = parsedData?.headers || [];
    
    // Find specific columns
    const findCol = (patterns) => {
      for (const pattern of patterns) {
        const found = data.find(h => h && String(h).toUpperCase().includes(pattern.toUpperCase()));
        if (found) return found;
      }
      return null;
    };
    
    // 1. NO. OF LOANS (total)
    const loansCol = findCol(['NO. OF LOANS', 'NUMBER OF LOANS']);
    if (loansCol && !loansCol.toUpperCase().includes('NEW')) {
      metrics.push({ key: loansCol, label: 'No. of Loans' });
    }
    
    // 2. VALUE
    const valueCol = findCol(['VALUE']);
    if (valueCol) {
      metrics.push({ key: valueCol, label: 'Value' });
    }
    
    // 3. MONTH TARGET
    const targetCol = findCol(['MONTH TARGET']);
    if (targetCol) {
      metrics.push({ key: targetCol, label: 'Month Target' });
    }
    
    // 4. % Achieved (calculated)
    metrics.push({ key: '_percentAchieved', label: '% Achieved', calculated: true });
    
    // 5. NEW LOANS
    const newLoansCol = findCol(['NEW LOANS']);
    if (newLoansCol && !newLoansCol.toUpperCase().includes('TARGET')) {
      metrics.push({ key: newLoansCol, label: 'New Loans' });
    }
    
    // 6. REFINANCE
    const refinanceCol = findCol(['REFINANCE']);
    if (refinanceCol && !refinanceCol.toUpperCase().includes('TARGET') && !refinanceCol.toUpperCase().includes('%')) {
      metrics.push({ key: refinanceCol, label: 'Refinance' });
    }
    
    // 7. Number of Active Reps
    const activeRepsCol = findCol(['NUMBER OF ACTIVE REPS', 'ACTIVE REPS']);
    if (activeRepsCol) {
      metrics.push({ key: activeRepsCol, label: 'Active Reps' });
    }
    
    // 8. COMMENT
    const commentCol = findCol(['COMMENT']);
    if (commentCol) {
      metrics.push({ key: commentCol, label: 'Comment', isText: true, isComment: true });
    }
    
    // Fill remaining slots with other metrics if needed
    if (metrics.length < 8) {
      const usedKeys = new Set(metrics.map(m => m.key));
      for (const h of availableMetrics) {
        if (!usedKeys.has(h) && metrics.length < 8) {
          const upper = String(h).toUpperCase();
          // Skip duplicates and targets
          if (!upper.includes('TARGET') || upper === 'MONTH TARGET') {
            if (!metrics.some(m => m.label.toUpperCase() === upper)) {
              metrics.push({ key: h, label: h });
              usedKeys.add(h);
            }
          }
        }
      }
    }
    
    return metrics.slice(0, 8);
  }, [parsedData, availableMetrics]);

  // Set default metric
  useEffect(() => {
    if (availableMetrics.length > 0 && !selectedMetric) {
      const defaultMetric = availableMetrics.find(m => 
        String(m).toUpperCase().includes('TARGET')
      ) || availableMetrics[0];
      setSelectedMetric(defaultMetric);
    }
  }, [availableMetrics, selectedMetric]);

  // Auto-select first item when data loads or view mode changes
  useEffect(() => {
    if (!parsedData?.groupedData) return;
    
    if (viewMode === 'supervision') {
      // Select first supervision
      const supervisions = Object.keys(parsedData.groupedData);
      if (supervisions.length > 0) {
        // Get sorted supervisions by value
        const sorted = Object.values(parsedData.groupedData)
          .map(s => ({
            name: s.supervision,
            value: Number(s.supervisionData?.[selectedMetric]) || 0
          }))
          .sort((a, b) => b.value - a.value);
        
        if (sorted.length > 0) {
          setSelectedItem({ type: 'supervision', name: sorted[0].name });
        }
      }
    } else {
      // Select first team leader (top ranked)
      const allTLs = [];
      Object.values(parsedData.groupedData).forEach(s => {
        s.teamLeaders.forEach(tl => {
          allTLs.push({
            name: tl.name,
            value: Number(tl.data?.[selectedMetric]) || 0
          });
        });
      });
      allTLs.sort((a, b) => b.value - a.value);
      
      if (allTLs.length > 0) {
        setSelectedItem({ type: 'teamleader', name: allTLs[0].name });
      }
    }
  }, [parsedData, viewMode, selectedMetric]);

  // Get ranked data based on view mode
  const rankedData = useMemo(() => {
    if (!parsedData?.groupedData || !selectedMetric) return [];
    
    let data = [];
    
    if (viewMode === 'supervision') {
      data = Object.values(parsedData.groupedData)
        .map(s => ({
          name: s.supervision,
          value: Number(s.supervisionData?.[selectedMetric]) || 0,
          data: s.supervisionData,
          teamLeaders: s.teamLeaders
        }))
        .sort((a, b) => b.value - a.value);
    } else {
      Object.values(parsedData.groupedData).forEach(s => {
        s.teamLeaders.forEach(tl => {
          data.push({
            name: tl.name,
            supervision: s.supervision,
            value: Number(tl.data?.[selectedMetric]) || 0,
            data: tl.data,
            salesReps: tl.salesReps
          });
        });
      });
      data.sort((a, b) => b.value - a.value);
    }
    
    return data;
  }, [parsedData, viewMode, selectedMetric]);

  // Filter data by search term
  const filteredData = useMemo(() => {
    if (!searchTerm.trim()) return rankedData;
    
    const term = searchTerm.toLowerCase();
    return rankedData.filter(item => 
      item.name?.toLowerCase().includes(term) ||
      item.supervision?.toLowerCase().includes(term)
    );
  }, [rankedData, searchTerm]);

  // VALUE column key (for active team leader check: non-zero VALUE in that month)
  const valueColumnKey = useMemo(() => {
    const headers = parsedData?.headers || [];
    const found = headers.find(h => h && String(h).toUpperCase().trim() === 'VALUE');
    return found || null;
  }, [parsedData]);

  // Actual vs Active Team Leaders (only when view is By Team Leader): exclude names containing "BLO"
  const teamLeaderCounts = useMemo(() => {
    if (viewMode !== 'teamleader' || !rankedData.length) return null;
    const withoutBLO = rankedData.filter(item => !String(item.name || '').toUpperCase().includes('BLO'));
    const actual = withoutBLO.length;
    const active = valueColumnKey
      ? withoutBLO.filter(item => (Number(item.data?.[valueColumnKey]) || 0) !== 0).length
      : 0;
    return { actual, active };
  }, [viewMode, rankedData, valueColumnKey]);

  // Get summary data for selected item
  const summaryData = useMemo(() => {
    if (!selectedItem || !parsedData) return null;
    
    if (selectedItem.type === 'supervision') {
      const supData = parsedData.groupedData[selectedItem.name];
      if (!supData) return null;
      
      const totalTLs = supData.teamLeaders.length;
      
      // Collect all sales reps for term analysis
      const allSalesReps = supData.teamLeaders.flatMap(tl => tl.salesReps || []);
      
      // Count UNIQUE active reps (by name)
      const salesRepCol = columnMap.salesRep || 
        Object.keys(allSalesReps[0] || {}).find(k => 
          k.toUpperCase() === 'SALES REP' || k.toUpperCase() === 'SALES REP. NAME'
        );
      const uniqueReps = new Set(
        allSalesReps.map(r => r[salesRepCol]).filter(Boolean)
      );
      
      return {
        type: 'supervision',
        name: selectedItem.name,
        data: supData.supervisionData,
        totalTeamLeaders: totalTLs,
        totalActiveReps: uniqueReps.size,
        teamLeaders: supData.teamLeaders,
        allSalesReps
      };
    } else if (selectedItem.type === 'teamleader') {
      const tl = rankedData.find(r => r.name === selectedItem.name);
      if (!tl) return null;
      
      // Count UNIQUE active reps
      const salesRepCol = columnMap.salesRep || 
        Object.keys((tl.salesReps || [])[0] || {}).find(k => 
          k.toUpperCase() === 'SALES REP' || k.toUpperCase() === 'SALES REP. NAME'
        );
      const uniqueReps = new Set(
        (tl.salesReps || []).map(r => r[salesRepCol]).filter(Boolean)
      );
      
      return {
        type: 'teamleader',
        name: selectedItem.name,
        supervision: tl.supervision,
        data: tl.data,
        salesReps: tl.salesReps || [],
        totalActiveReps: uniqueReps.size
      };
    }
    
    return null;
  }, [selectedItem, parsedData, rankedData, columnMap]);

  // Calculate term/product summary with value (sum of disbursed amounts)
  const termSummary = useMemo(() => {
    if (!summaryData) return [];
    
    const reps = summaryData.type === 'supervision' 
      ? summaryData.allSalesReps 
      : summaryData.salesReps;
    
    if (!reps || reps.length === 0) return [];
    
    // Use the term column from column map
    const termCol = columnMap.term || Object.keys(reps[0] || {}).find(k => 
      k.toUpperCase() === 'TERM' || k.toUpperCase().includes('TERM')
    );
    
    // Find amount column
    const amountCol = columnMap.amount || Object.keys(reps[0] || {}).find(k => 
      k.toUpperCase().includes('DISBURSE') && k.toUpperCase().includes('AMOUNT')
    );
    
    if (!termCol) return [];
    
    // Count terms and sum values
    const termData = {};
    reps.forEach(rep => {
      const term = rep[termCol];
      if (term && String(term).trim()) {
        const termStr = String(term).trim();
        if (!termData[termStr]) {
          termData[termStr] = { count: 0, value: 0 };
        }
        termData[termStr].count += 1;
        termData[termStr].value += Number(rep[amountCol]) || 0;
      }
    });
    
    return Object.entries(termData)
      .map(([term, data]) => ({ term, count: data.count, value: data.value }))
      .sort((a, b) => b.value - a.value);
  }, [summaryData, columnMap]);

  // Get metric value (handles calculated metrics)
  const getMetricValue = (metricDef, data) => {
    if (!data) return '-';
    
    if (metricDef.calculated && metricDef.key === '_percentAchieved') {
      // Calculate % Achieved = VALUE / MONTH TARGET
      const valueCol = parsedData?.headers?.find(h => h && String(h).toUpperCase() === 'VALUE');
      const targetCol = parsedData?.headers?.find(h => h && String(h).toUpperCase() === 'MONTH TARGET');
      
      if (valueCol && targetCol) {
        const value = Number(data[valueCol]) || 0;
        const target = Number(data[targetCol]) || 0;
        if (target > 0) {
          return ((value / target) * 100).toFixed(2) + '%';
        }
      }
      return '0%';
    }
    
    if (metricDef.isText) {
      return data[metricDef.key] || '-';
    }
    
    const val = data[metricDef.key];
    if (String(metricDef.key).toUpperCase().includes('%')) {
      return formatPercent(val);
    }
    return formatNumber(val);
  };

  // Sort sales reps by amount (largest to smallest)
  const sortedSalesReps = useMemo(() => {
    if (!summaryData?.salesReps || summaryData.salesReps.length === 0) return [];
    
    const amountCol = columnMap.amount ||
      Object.keys(summaryData.salesReps[0] || {}).find(k => 
        k.toUpperCase().includes('DISBURSE') && k.toUpperCase().includes('AMOUNT')
      ) ||
      Object.keys(summaryData.salesReps[0] || {}).find(k => 
        k.toUpperCase().includes('AMOUNT')
      );
    
    return [...summaryData.salesReps].sort((a, b) => {
      const amountA = Number(a[amountCol]) || 0;
      const amountB = Number(b[amountCol]) || 0;
      return amountB - amountA; // Largest first
    });
  }, [summaryData, columnMap]);

  const handleItemClick = (type, name) => {
    setSelectedItem({ type, name });
  };

  if (!parsedData || !parsedData.groupedData || Object.keys(parsedData.groupedData).length === 0) {
    return (
      <div className="mtd-analysis-empty">
        <p>No MTD data available. The file may not contain the expected structure.</p>
      </div>
    );
  }

  return (
    <div className="mtd-analysis-wrapper">
      <div className="mtd-analysis-content">
        {/* Left - Ranking Section */}
        <div className="mtd-ranking-panel">
          <div className="mtd-ranking-header">
            <h3 className="mtd-ranking-title">Performance Ranking</h3>
          </div>
          
          <div className="mtd-ranking-controls">
            <select 
              value={viewMode} 
              onChange={(e) => {
                setViewMode(e.target.value);
                setSearchTerm('');
                // selectedItem will be auto-updated by useEffect
              }}
              className="mtd-select"
            >
              <option value="supervision">By Supervision</option>
              <option value="teamleader">By Team Leader</option>
            </select>
            <select 
              value={selectedMetric} 
              onChange={(e) => setSelectedMetric(e.target.value)}
              className="mtd-select mtd-select-metric"
            >
              {availableMetrics.map(metric => (
                <option key={metric} value={metric}>{metric}</option>
              ))}
            </select>
          </div>

          <div className="mtd-search-container">
            <input
              type="text"
              placeholder={`Search ${viewMode === 'supervision' ? 'supervision' : 'team leader'}...`}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="mtd-search-input"
            />
          </div>

          <div className="mtd-ranking-list">
            {filteredData.length === 0 ? (
              <div className="mtd-ranking-empty">No results found</div>
            ) : (
              filteredData.map((item, index) => (
                <div 
                  key={`${item.name}-${index}`}
                  className={`mtd-ranking-item ${selectedItem?.name === item.name ? 'mtd-ranking-item-selected' : ''}`}
                  onClick={() => handleItemClick(viewMode === 'supervision' ? 'supervision' : 'teamleader', item.name)}
                >
                  <span className="mtd-rank-number">{index + 1}</span>
                  <div className="mtd-rank-info">
                    <span className="mtd-rank-name">{item.name}</span>
                    {viewMode === 'teamleader' && item.supervision && (
                      <span className="mtd-rank-sub">{item.supervision}</span>
                    )}
                  </div>
                  <span className="mtd-rank-value">{formatNumber(item.value)}</span>
                </div>
              ))
            )}
          </div>
          
          {filteredData.length > 0 && (
            <div className="mtd-ranking-footer">
              Total: {filteredData.length} {viewMode === 'supervision' ? 'supervisions' : 'team leaders'}
            </div>
          )}

          {viewMode === 'teamleader' && teamLeaderCounts && (
            <>
              <div className="mtd-ranking-tl-divider" />
              <div className="mtd-ranking-tl-summary">
                <div className="mtd-ranking-tl-summary-side">
                  <span className="mtd-ranking-tl-label">Active Team Leaders</span>
                  <span className="mtd-ranking-tl-value">{teamLeaderCounts.active}</span>
                </div>
                <div className="mtd-ranking-tl-summary-divider" />
                <div className="mtd-ranking-tl-summary-side">
                  <span className="mtd-ranking-tl-label">Actual Team Leaders</span>
                  <span className="mtd-ranking-tl-value">{teamLeaderCounts.actual}</span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Vertical Divider */}
        <div className="mtd-divider-vertical"></div>

        {/* Right - Summary Section */}
        <div className="mtd-summary-panel">
          {!summaryData ? (
            <div className="mtd-summary-placeholder">
              <span className="mtd-placeholder-icon">←</span>
              <p>Select an item from the ranking to view details</p>
            </div>
          ) : (
            <div className="mtd-summary-content">
              <div className="mtd-summary-header">
                <h3 className="mtd-summary-title">{summaryData.name}</h3>
                {summaryData.type === 'teamleader' && summaryData.supervision && (
                  <span className="mtd-summary-subtitle">Supervision: {summaryData.supervision}</span>
                )}
              </div>
              
              {/* Stats */}
              <div className="mtd-stats-row">
                {summaryData.type === 'supervision' && (
                  <>
                    <div className="mtd-stat-box">
                      <span className="mtd-stat-value">{summaryData.totalTeamLeaders}</span>
                      <span className="mtd-stat-label">Team Leaders</span>
                    </div>
                    <div className="mtd-stat-box">
                      <span className="mtd-stat-value">{summaryData.totalActiveReps}</span>
                      <span className="mtd-stat-label">Active Reps</span>
                    </div>
                  </>
                )}
                {summaryData.type === 'teamleader' && (
                  <div className="mtd-stat-box">
                    <span className="mtd-stat-value">{summaryData.totalActiveReps}</span>
                    <span className="mtd-stat-label">Active Reps</span>
                  </div>
                )}
              </div>
              
              {/* Key Metrics */}
              <div className="mtd-metrics-section">
                <h4 className="mtd-section-label">Key Metrics</h4>
                <div className="mtd-metrics-grid">
                  {displayMetrics.map((metric, idx) => {
                    const value = getMetricValue(metric, summaryData.data);
                    const commentClass = metric.isComment ? getCommentClass(value) : '';
                    
                    return (
                      <div key={idx} className={`mtd-metric-item ${metric.isText ? 'mtd-metric-text' : ''} ${commentClass}`}>
                        <span className="mtd-metric-label">{metric.label}</span>
                        <span className="mtd-metric-value">{value}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Term/Product Summary */}
              {termSummary.length > 0 && (
                <div className="mtd-term-section">
                  <h4 className="mtd-section-label">Products Sold (Term)</h4>
                  <div className="mtd-term-table-wrapper">
                    <table className="mtd-term-table">
                      <thead>
                        <tr>
                          <th>Product / Term</th>
                          <th>Count</th>
                          <th>Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {termSummary.map((item, idx) => (
                          <tr key={idx}>
                            <td>{item.term}</td>
                            <td>{item.count}</td>
                            <td>{formatNumber(item.value)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Team Leaders List (for supervision view) */}
              {summaryData.type === 'supervision' && summaryData.teamLeaders && summaryData.teamLeaders.length > 0 && (
                <div className="mtd-tl-section">
                  <h4 className="mtd-section-label">Team Leaders ({summaryData.teamLeaders.length})</h4>
                  <div className="mtd-tl-table-wrapper">
                    <table className="mtd-tl-table">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Name</th>
                          <th>{selectedMetric || 'Value'}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summaryData.teamLeaders
                          .sort((a, b) => (Number(b.data?.[selectedMetric]) || 0) - (Number(a.data?.[selectedMetric]) || 0))
                          .map((tl, idx) => (
                            <tr key={idx}>
                              <td>{idx + 1}</td>
                              <td>{tl.name}</td>
                              <td>{formatNumber(Number(tl.data?.[selectedMetric]) || 0)}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              
              {/* Sales Reps List (for team leader view) - sorted by amount */}
              {summaryData.type === 'teamleader' && sortedSalesReps.length > 0 && (
                <div className="mtd-reps-section">
                  <h4 className="mtd-section-label">Sales Representatives ({sortedSalesReps.length})</h4>
                  <div className="mtd-reps-table-wrapper">
                    <table className="mtd-reps-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Disbursed Amount</th>
                          <th>Term</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedSalesReps.map((rep, idx) => {
                          // Use column map or fallback to searching
                          const nameCol = columnMap.salesRep || 
                            Object.keys(rep).find(k => k.toUpperCase() === 'SALES REP') ||
                            Object.keys(rep).find(k => k.toUpperCase() === 'SALES REP. NAME') ||
                            Object.keys(rep).find(k => k.toUpperCase().includes('SALES') && k.toUpperCase().includes('REP'));
                          
                          const amountCol = columnMap.amount ||
                            Object.keys(rep).find(k => k.toUpperCase().includes('DISBURSE') && k.toUpperCase().includes('AMOUNT')) ||
                            Object.keys(rep).find(k => k.toUpperCase().includes('AMOUNT'));
                          
                          const termCol = columnMap.term ||
                            Object.keys(rep).find(k => k.toUpperCase() === 'TERM');
                          
                          return (
                            <tr key={idx}>
                              <td>{rep[nameCol] || '-'}</td>
                              <td>{formatNumber(rep[amountCol])}</td>
                              <td>{rep[termCol] || '-'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MTDAnalysis;
