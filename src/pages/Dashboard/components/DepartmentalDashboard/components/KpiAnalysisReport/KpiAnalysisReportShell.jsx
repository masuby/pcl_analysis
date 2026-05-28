import { useState } from 'react';
import './KpiAnalysisReport.css';
import CSKPIAnalysis from './CSKPIAnalysis';
import LBFKPIAnalysis from './LBFKPIAnalysis';
import SMEKPIAnalysis from './SMEKPIAnalysis';

export default function KpiAnalysisReportShell() {
  const [product, setProduct] = useState('CS');

  return (
    <div>
      <div className="kpi-ar-product-toggles">
        <button type="button" className={`kpi-ar-product-btn ${product === 'CS' ? 'kpi-ar-product-btn--active' : ''}`} onClick={() => setProduct('CS')}>CS</button>
        <button type="button" className={`kpi-ar-product-btn ${product === 'LBF' ? 'kpi-ar-product-btn--active' : ''}`} onClick={() => setProduct('LBF')}>LBF</button>
        <button type="button" className={`kpi-ar-product-btn ${product === 'SME' ? 'kpi-ar-product-btn--active' : ''}`} onClick={() => setProduct('SME')}>SME</button>
      </div>
      {product === 'CS' && <CSKPIAnalysis />}
      {product === 'LBF' && <LBFKPIAnalysis />}
      {product === 'SME' && <SMEKPIAnalysis />}
    </div>
  );
}

