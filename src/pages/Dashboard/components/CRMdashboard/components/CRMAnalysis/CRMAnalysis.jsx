import { extractMetrics } from '../../utils/crmUtils';
import './CRMAnalysis.css';

/**
 * CRM Analysis — rendered to mirror the emailed CRM report (crm_reports.py,
 * SECTION 4): a spectrum masthead, centered subheaders, bold-blue prose, the
 * "For today" plan blocks, colour-graded agent/TL branch tables and a leads
 * counts+% table. Colours & layout intentionally match the email exactly.
 */

// ── palette (matches crm_reports.py) ────────────────────────────────────────
const SPECTRUM_CSS = 'linear-gradient(90deg,#7c3aed,#2563eb,#16a34a,#eab308,#ea580c,#dc2626)';
const STOPS = [[124, 58, 237], [37, 99, 235], [22, 163, 74], [234, 179, 8], [234, 88, 12], [220, 38, 38]];
const BLUE = '#1d4ed8';
const DARK = '#1e3a8a';
const NAVY = '#2f5597';

// frac 0 -> violet (best), 1 -> red (worst); multi-stop lerp (== spectrum_hex).
const spectrumHex = (frac) => {
  const f = Math.max(0, Math.min(1, frac));
  const seg = f * (STOPS.length - 1);
  const i = Math.min(Math.floor(seg), STOPS.length - 2);
  const [a, b, t] = [STOPS[i], STOPS[i + 1], seg - i];
  const c = [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * t));
  return `#${c.map((x) => x.toString(16).padStart(2, '0')).join('')}`;
};

// Bold + blue the key figures (numbers / percentages / dates) inside prose.
const NUM_RE = /(\d{1,2}[-/]\d{2}[-/]\d{4}|\d[\d,]*(?:\.\d+)?%?)/;
const highlight = (text) =>
  String(text).split(NUM_RE).map((part, i) =>
    (i % 2 === 1 ? <b key={i} style={{ color: BLUE }}>{part}</b> : part));

const num = (v) => {
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v ?? '').replace(/[%,]/g, ''));
  return Number.isNaN(n) ? 0 : n;
};

// ── presentational pieces ───────────────────────────────────────────────────
const HeaderBanner = ({ product, reportDate }) => {
  const gen = new Date().toLocaleDateString('en-GB').replace(/\//g, '-');
  return (
    <>
      <div style={{ height: 6, background: SPECTRUM_CSS }} />
      <div style={{ background: 'linear-gradient(135deg,#24466f 0%,#2f5597 55%,#3a67b0 100%)', padding: '30px 22px', textAlign: 'center' }}>
        <div style={{ fontSize: 12, letterSpacing: 4, color: '#cfe0f5', textTransform: 'uppercase', marginBottom: 9 }}>
          Platinum Credit &nbsp;&bull;&nbsp; CRM
        </div>
        <div style={{ fontSize: 33, fontWeight: 800, color: '#fff', letterSpacing: '0.5px' }}>{product} CRM User Report</div>
        <div style={{ fontSize: 14, color: '#dbeafe', marginTop: 11 }}>
          Report Date: <b style={{ color: '#fff' }}>{reportDate}</b> &nbsp;&bull;&nbsp; Generated on: <b style={{ color: '#fff' }}>{gen}</b>
        </div>
      </div>
      <div style={{ height: 6, background: SPECTRUM_CSS, marginBottom: 20 }} />
    </>
  );
};

const Subheader = ({ children }) => (
  <>
    <h3 style={{ textAlign: 'center', color: BLUE, fontSize: 21, fontWeight: 800, margin: '30px 0 6px', letterSpacing: '0.3px' }}>
      {children}
    </h3>
    <div style={{ height: 3, width: 250, margin: '0 auto 14px', background: SPECTRUM_CSS }} />
  </>
);

const Prose = ({ lines, icon = '◆' }) => (
  <div style={{ maxWidth: 820, margin: '0 auto 10px' }}>
    {lines.map((ln, i) => (
      <p key={i} style={{ fontSize: 13.5, lineHeight: 1.6, margin: '10px 0', color: '#333' }}>
        <span style={{ color: BLUE, fontSize: 12, marginRight: 9 }}>{icon}</span>{highlight(ln)}
      </p>
    ))}
  </div>
);

const TodayBlock = ({ date, lines }) => (
  <>
    <p style={{ textAlign: 'center', fontWeight: 700, color: DARK, fontSize: 14.5, margin: '16px 0 2px' }}>
      For today <b style={{ color: BLUE }}>{date}</b>
    </p>
    <Prose lines={lines} icon="★" />
  </>
);

// The 7 columns the email shows, graded on Activity Completion Rate.
const EMAIL_COLS = [
  'CRM Users (Logins)', 'Users Assigned Activities', 'Users Completing @ Location',
  'Activity Completion Rate', 'Locations Planned', 'Locations Reached', '% Locations Reached',
];
const KEY_COL = 'Activity Completion Rate';
const PCT_COLS = new Set(['Activity Completion Rate', '% Locations Reached']);

const fmtCell = (col, v) => {
  if (PCT_COLS.has(col)) return `${(num(v) * 100).toFixed(2)}%`;
  if (v === '' || v == null) return '';
  const n = num(v);
  return Number.isInteger(n) ? n.toLocaleString() : n.toFixed(1);
};

const BOX = { maxWidth: '100%', overflowX: 'auto', border: '1px solid #cbd5e1', boxShadow: '0 2px 8px rgba(30,58,138,0.10)', margin: '8px auto 18px' };
const TABLE = { borderCollapse: 'separate', borderSpacing: 0, width: 'max-content', minWidth: '100%' };
const TH = { padding: '9px 13px', background: NAVY, color: '#fff', fontSize: 12, fontWeight: 600, borderBottom: '2px solid #24466f', whiteSpace: 'nowrap', textAlign: 'center' };
const TH_CORNER = { ...TH, textAlign: 'left', position: 'sticky', left: 0, zIndex: 2 };
const TD = { padding: '7px 13px', borderBottom: '1px solid #eef1f6', fontSize: 12, color: '#222', textAlign: 'center', whiteSpace: 'nowrap' };
const TD_LEFT = { ...TD, textAlign: 'left', fontWeight: 600, color: '#1f2937', background: '#fff', position: 'sticky', left: 0, zIndex: 1 };

const GradedTable = ({ summary }) => {
  if (!summary || !summary.rows || summary.rows.length === 0) {
    return <p style={{ color: '#888', fontSize: 12, textAlign: 'center' }}>(no data for the day)</p>;
  }
  const dataRows = summary.rows.filter((r) => !r.__isTotal);
  const totalRow = summary.rows.find((r) => r.__isTotal);
  const sorted = [...dataRows].sort((a, b) => num(b[KEY_COL]) - num(a[KEY_COL]));
  const n = sorted.length;

  const renderRow = (row, rank, isTotal) => {
    const frac = n > 1 ? rank / (n - 1) : 0;
    return (
      <tr key={`${row.__index}-${rank}-${isTotal}`}>
        <td style={isTotal ? { ...TD_LEFT, fontWeight: 700 } : TD_LEFT}>{row.__index}</td>
        {EMAIL_COLS.map((col) => {
          const key = col === KEY_COL;
          const style = (key && !isTotal)
            ? { ...TD, background: spectrumHex(frac), color: '#fff', fontWeight: 700 }
            : (isTotal ? { ...TD, fontWeight: 700 } : TD);
          return <td key={col} style={style}>{fmtCell(col, row[col])}</td>;
        })}
      </tr>
    );
  };

  return (
    <div style={BOX}>
      <table style={TABLE}>
        <thead>
          <tr>
            <th style={TH_CORNER}>{summary.indexLabel}</th>
            {EMAIL_COLS.map((c) => <th key={c} style={TH}>{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => renderRow(r, i, false))}
          {totalRow && renderRow(totalRow, 0, true)}
        </tbody>
      </table>
    </div>
  );
};

const LeadsTable = ({ metrics }) => {
  const raw = (k) => num(metrics[k]);
  const total = raw('lead');
  const cols = [
    ['Accepted', 'accepted_lead'], ['Not Provided', 'not_provided_lead'],
    ['Rejected', 'rejected_lead'], ['Prospects', 'prospect_lead'], ['Grand Total', 'lead'],
  ];
  return (
    <div style={BOX}>
      <table style={TABLE}>
        <thead>
          <tr>{cols.map(([label]) => <th key={label} style={TH}>{label}</th>)}</tr>
        </thead>
        <tbody>
          <tr>{cols.map(([label, key]) => <td key={label} style={TD}>{raw(key).toLocaleString()}</td>)}</tr>
          <tr>
            {cols.map(([label, key]) => {
              const pct = key === 'lead' ? (total ? 1 : 0) : (total ? raw(key) / total : 0);
              return <td key={label} style={{ ...TD, color: '#1f3864', fontStyle: 'italic' }}>{(pct * 100).toFixed(2)}%</td>;
            })}
          </tr>
        </tbody>
      </table>
    </div>
  );
};

// ── main component ──────────────────────────────────────────────────────────
const CRMAnalysis = ({ parsedData, department }) => {
  if (!parsedData) return null;

  const metrics = extractMetrics(parsedData.emailData || []);

  // Format a value for display (percentage-aware), mirroring the email's _fmt.
  const getValue = (key, defaultVal = 'None') => {
    const rawValue = metrics[key.toLowerCase()] ?? defaultVal;
    if (rawValue === 'N/A' || rawValue === 'None' || rawValue === '' || rawValue == null) return 'None';
    const keyLower = key.toLowerCase();
    const isPct = ['percentage', 'percent', '%', 'rate', 'ratio'].some((i) => keyLower.includes(i));
    const n = typeof rawValue === 'string' ? parseFloat(rawValue.replace('%', '').trim()) : parseFloat(rawValue);
    if (Number.isNaN(n)) return String(rawValue);
    if (isPct) {
      const v = (n >= 0 && n <= 1) ? n * 100 : n;
      return `${v.toFixed(2)}%`;
    }
    return Number.isInteger(n) ? String(n) : String(Math.floor(n));
  };

  const product = department || 'CRM';
  const dateObj = parsedData.reportDate instanceof Date ? parsedData.reportDate : new Date(parsedData.reportDate);
  const reportDateFull = dateObj.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
  const todayDate = dateObj.toLocaleDateString('en-GB').replace(/\//g, '-');

  const leadLines = [
    `${getValue('lead')} leads were generated in the system across all ${product} branches.`,
    `${getValue('percentage_accepted_lead')} (${getValue('accepted_lead')}) of leads generated were consented, `
      + `${getValue('percentage_not_provided_lead')} (${getValue('not_provided_lead')}) were not provided and `
      + `${getValue('percentage_rejected_lead')} (${getValue('rejected_lead')}) were rejected.`,
    `Out of ${getValue('lead')} leads, ${getValue('prospect_lead')} are prospects.`,
  ];

  const agentLines = [
    `Total count of Sales Agents in CRM stood at ${getValue('total_agent')}, and only ${getValue('total_agent_logged_in')} logged in for the day.`,
    `Out of ${getValue('agent_assigned_activities')} Sales Agents assigned activities for the day, `
      + `${getValue('agent_completed_at_location')} (${getValue('percentage_agent_completed_at_location')}) completed at least one activity at the assigned location.`,
    `${getValue('agent_location_planned')} locations were planned for the day. Only `
      + `${getValue('agent_reached_location')} (${getValue('percentage_reached_location')}) locations were reached on the day.`,
    `${getValue('agent_branch_without_planned_location')} had no planned location visited by a Sales Agent.`,
    `${getValue('branches_without_assgned_activities')} had no assigned activities or planned locations to be visited by a Sales Agent.`,
  ];
  const agentToday = [
    `${getValue('todays_locations_planned')} locations have been planned.`,
    `${getValue('todays_agents_assigned')} (${getValue('percentage_todays_agents_assigned')}) Sales Agents have been assigned activities.`,
    `Average locations to be visited per Sales Agent is ${getValue('average_location_agent_visited')}.`,
  ];

  const tlLines = [
    `Total count of Team Leaders in CRM stood at ${getValue('count_team_leaders')}, and only ${getValue('logged_in_team_leaders')} logged in for the day.`,
    `Out of ${getValue('team_leaders_assigned_activities')} Team Leaders assigned activities for the day, `
      + `${getValue('team_leaders_completed_at_location')} (${getValue('percentage_completed_at_location')}) completed at least one activity at the assigned location.`,
    `${getValue('team_leaders_location_planned')} locations were planned for the day. Only `
      + `${getValue('team_leaders_location_reached')} (${getValue('percentage_tl_location_reached')}) locations were reached on the day.`,
    `${getValue('branches_tl_no_planned_location')} had no planned location visited by a Team Leader.`,
    `${getValue('branches_tl_no_assigned_activities')} had no assigned activities or planned locations to be visited by a Team Leader.`,
  ];
  const tlToday = [
    `${getValue('todays_tls_location_planned')} locations have been planned.`,
    `${getValue('todays_tls_assigned_activities')} (${getValue('percentage_today_tl_assigned_activities')}) Team Leaders have been assigned activities.`,
    `Average locations to be visited per Team Leader is ${getValue('average_location_visited_by_tl')}.`,
  ];

  return (
    <div className="crm-analysis-container"
         style={{ fontFamily: 'Arial,Helvetica,sans-serif', maxWidth: 920, margin: '0 auto', color: '#222', background: '#fff', padding: '8px 12px' }}>
      <HeaderBanner product={product} reportDate={reportDateFull} />

      <Subheader>Leads</Subheader>
      <Prose lines={leadLines} />
      <LeadsTable metrics={metrics} />

      <Subheader>Sales Agents</Subheader>
      <Prose lines={agentLines} />
      <TodayBlock date={todayDate} lines={agentToday} />
      <GradedTable summary={parsedData.agentSummary} />

      <Subheader>Team Leaders</Subheader>
      <Prose lines={tlLines} />
      <TodayBlock date={todayDate} lines={tlToday} />
      <GradedTable summary={parsedData.teamLeaderSummary} />

      <div style={{ borderTop: '1px solid #e5e7eb', marginTop: 28, paddingTop: 10, textAlign: 'center' }}>
        <p style={{ fontSize: 11, color: '#9ca3af', margin: 0 }}>
          Automated CRM report &nbsp;&bull;&nbsp; Platinum Credit Limited
        </p>
      </div>
    </div>
  );
};

export default CRMAnalysis;
