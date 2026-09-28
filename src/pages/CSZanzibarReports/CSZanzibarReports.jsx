import CSReports from '../CSReports/CSReports';

/* CS Zanzibar reports.
 *
 * Same page as CS Mainland, pointed at the 'CS ZANZIBAR' department. The split
 * follows crm_reports.py, where CS is generated as two departments off one
 * master: CS_CRM (Mainland) and CS_ZANZIBAR_CRM (Zanzibar).
 *
 * CRM only for now — the other pipelines have not been split yet, and showing
 * MANAGEMENT / CALL CENTER / MTD tabs that can only ever be empty would say
 * there is Zanzibar data missing rather than that it does not exist yet.
 */
const CSZanzibarReports = () => (
  <CSReports department="CS ZANZIBAR" reportTypes={['CRM']} />
);

export default CSZanzibarReports;
