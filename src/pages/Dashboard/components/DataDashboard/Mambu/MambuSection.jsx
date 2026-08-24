import { useState } from 'react';
import MambuData from './MambuData';
import './MambuData.css';

/**
 * MAMBU DATA — one tab per lending product.
 *
 * CS is the affordability pipeline: a payroll extract of ~650,000 employees is
 * held as a register and run through the affordability formula.
 *
 * LBF, SME and Agrifinance work differently — there is no payroll extract for
 * them. Their potential clients come from a loan or client export that is
 * filtered on age and how far through their current loan they are, which is the
 * refinance / reactivation logic.
 */

const PRODUCTS = [
  { key: 'CS',   label: 'CS' },
  { key: 'LBF',  label: 'LBF' },
  { key: 'SME',  label: 'SME' },
  { key: 'AGRI', label: 'AGRIFINANCE' },
];

const NotYet = ({ label }) => (
  <div className="mambu-notyet">
    <h3 className="mambu-notyet-title">{label} — refinance &amp; reactivation</h3>
    <p>
      This product does not use the payroll register. Its potential clients come
      from a loan export (for refinance) or a client export (for reactivation),
      filtered to people under 64 who are far enough through their current loan.
    </p>
    <p className="mambu-notyet-next">Being built next.</p>
  </div>
);

const MambuSection = () => {
  const [product, setProduct] = useState('CS');

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
      </div>

      {product === 'CS' ? <MambuData /> : <NotYet label={PRODUCTS.find((p) => p.key === product).label} />}
    </div>
  );
};

export default MambuSection;
