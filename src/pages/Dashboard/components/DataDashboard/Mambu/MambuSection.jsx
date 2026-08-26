import { useCallback, useState } from 'react';
import MambuData from './MambuData';
import SourceFiles from './SourceFiles';
import ProductRuns from './ProductRuns';
import DoNotContactModal from './DoNotContactModal';
import './MambuData.css';

/**
 * MAMBU DATA — one tab per lending product.
 *
 * CS is the affordability pipeline: a payroll extract of ~650,000 employees is
 * held as a register and run through the affordability formula.
 *
 * LBF, SME and Agrifinance work differently. There is no payroll extract for
 * them — their potential clients come from the Loan and Clients exports, which
 * are uploaded ONCE and shared by all three. That is why Source files sits
 * above the tabs rather than inside any one of them.
 */

const PRODUCTS = [
  { key: 'CS', label: 'CS' },
  { key: 'LBF', label: 'LBF' },
  { key: 'SME', label: 'SME' },
  { key: 'Agrifinance', label: 'AGRIFINANCE' },
];

const MambuSection = () => {
  const [product, setProduct] = useState('CS');
  const [showDnc, setShowDnc] = useState(false);
  const [sources, setSources] = useState({});
  const [sourcesLoaded, setSourcesLoaded] = useState(false);

  const handleSources = useCallback((active, loaded) => {
    setSources(active);
    if (loaded) setSourcesLoaded(true);
  }, []);
  const isCS = product === 'CS';
  const current = PRODUCTS.find((p) => p.key === product);

  return (
    <div className="mambu-section">
      <div className="mambu-prodbar">
        {PRODUCTS.map((p) => (
          <button
            key={p.key}
            className={`mambu-prodbtn ${product === p.key ? 'is-active' : ''}`}
            onClick={() => setProduct(p.key)}
          >
            {p.label}
          </button>
        ))}

        {/* Applies across all products, so it sits with the tabs. */}
        <button className="mambu-dncbtn" onClick={() => setShowDnc(true)}>
          Do not contact
        </button>
      </div>

      {isCS ? (
        <MambuData />
      ) : (
        <>
          <SourceFiles onChange={handleSources} />
          <div className="mambu-prodhead">
            <h3 className="mambu-title">{current.label} — refinance &amp; reactivation</h3>
            <p className="mambu-sub">
              Built from the exports above and the live Zone and Clusters roster.
              Numbers on the do-not-contact list are removed before anything is
              distributed.
            </p>
          </div>
          <ProductRuns
            product={product}
            label={current.label}
            sources={sources}
            sourcesLoaded={sourcesLoaded}
          />
        </>
      )}

      {showDnc && <DoNotContactModal onClose={() => setShowDnc(false)} />}
    </div>
  );
};

export default MambuSection;
