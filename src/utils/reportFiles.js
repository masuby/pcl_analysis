/**
 * Deciding whether an uploaded report file belongs to the department that asked
 * for it.
 *
 * The database is what actually files a report: the API is queried with a
 * department and a type, and it answers with the rows stored under them. The
 * file NAME is a human artefact typed at upload time, and it is only consulted
 * here to catch one mistake the database cannot — a file filed under the wrong
 * department.
 *
 * It used to be consulted for more than that. Both the MTD dashboard and the
 * challenge sales builder required the literal string 'MTD' in the name, so
 * `CS_MTSD_AS_OF_29th_SEPT_2026.xlsx` — MTSD, a typo made at upload — was
 * dropped without a word, and every MTD view carried on showing the 26th as
 * though the 29th had never been uploaded. Worse, the score card reads some of
 * its figures through this filter and some straight from the API, so it ended
 * up mixing one date's parse with another's agent count.
 *
 * A report type is not spelled reliably enough to gate on. The department is,
 * because it is also a folder name on disk.
 */

/** Upper-case and strip everything that is not a letter or a digit. */
const norm = (v) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** The departments a report file can be filed under. */
export const KNOWN_DEPARTMENTS = ['CS ZANZIBAR', 'CS', 'LBF', 'SME', 'AGRI'];

/**
 * True when `fileName` may be treated as belonging to `department`.
 *
 * Accepts when the name mentions the department, and also when it mentions no
 * department at all — a file called `MTD_AS_OF_29th_SEPT.xlsx` filed under CS
 * is taken at its filing. Rejects only when the name clearly belongs to a
 * different department, which is the mis-filing worth catching.
 *
 * Punctuation and case are ignored, so `CS_ZANZIBAR_CRM…` matches the
 * department `CS ZANZIBAR`.
 */
export const belongsToDepartment = (fileName, department) => {
  const name = norm(fileName);
  const dept = norm(department);
  if (!name || !dept) return true;
  if (name.includes(dept)) return true;

  // Longest first, so a file named for 'CS ZANZIBAR' is not read as 'CS'.
  const others = KNOWN_DEPARTMENTS
    .map(norm)
    .filter((d) => d && d !== dept)
    .sort((a, b) => b.length - a.length);

  // 'CS ZANZIBAR' contains 'CS', so a Zanzibar file must not count as another
  // department's when the department asked for is CS, and vice versa.
  const claimed = others.find((d) => name.includes(d));
  if (!claimed) return true;
  return claimed.includes(dept) || dept.includes(claimed);
};
