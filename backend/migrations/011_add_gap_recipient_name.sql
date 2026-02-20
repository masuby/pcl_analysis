-- Add optional display name for recipient (used in email when filled; otherwise TL/supervision name is used)
ALTER TABLE gap_recipient_emails ADD COLUMN IF NOT EXISTS name VARCHAR(255) DEFAULT '';
