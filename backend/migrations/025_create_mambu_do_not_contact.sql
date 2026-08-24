-- Numbers that must never appear in a distributed lead file.
--
-- These are people who have asked not to be called, staff numbers, or numbers
-- that caused a complaint. Until now the list lived as a hardcoded array in
-- process_refinance.py, so changing it meant editing code — which is why the
-- same number appears in it twice. It belongs in the database, where whoever
-- takes the complaint can add it.
--
-- The key is the NORMALISED number, so 0712317849, +255 712 317 849 and
-- 255712317849 are recognised as one person and cannot be added twice.
CREATE TABLE IF NOT EXISTS mambu_do_not_contact (
    phone       TEXT PRIMARY KEY,          -- normalised: 255XXXXXXXXX
    raw_input   TEXT,                      -- what was typed, for recognisability
    reason      TEXT,
    added_by    UUID,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mambu_dnc_created ON mambu_do_not_contact(created_at DESC);

-- The nine numbers currently hardcoded in process_refinance.py, carried over so
-- the list does not start empty and quietly lose the exclusions already agreed.
-- (The script listed 255764551817 twice; a primary key makes that impossible.)
INSERT INTO mambu_do_not_contact (phone, raw_input, reason) VALUES
    ('255712317849', '255712317849', 'Carried over from process_refinance.py'),
    ('255764551817', '255764551817', 'Carried over from process_refinance.py'),
    ('255717722121', '255717722121', 'Carried over from process_refinance.py'),
    ('255745402346', '255745402346', 'Carried over from process_refinance.py'),
    ('255704987990', '255704987990', 'Carried over from process_refinance.py'),
    ('255672549092', '255672549092', 'Carried over from process_refinance.py'),
    ('255657998899', '255657998899', 'Carried over from process_refinance.py'),
    ('255769005666', '255769005666', 'Carried over from process_refinance.py')
ON CONFLICT (phone) DO NOTHING;
