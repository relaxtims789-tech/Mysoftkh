-- A second bot for admins / HR / managers: its own Mini App (/manage) and alerts (new requests, morning summary,
-- late and absent, rejected scans). Staff keep the first bot.

ALTER TABLE platform_settings ADD COLUMN telegram_admin_bot_token text;          -- encrypted
ALTER TABLE platform_settings ADD COLUMN telegram_admin_bot_username text;
ALTER TABLE platform_settings ADD COLUMN telegram_admin_webhook_secret text;
ALTER TABLE platform_settings ADD COLUMN telegram_admin_setup_at timestamptz;

-- Which alerts each admin wants (all by default).
ALTER TABLE users ADD COLUMN telegram_admin_notify boolean NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN telegram_admin_alerts text[] NOT NULL DEFAULT '{requests,summary,late_absent,rejected}';

-- Time of the morning summary in the company's time zone.
ALTER TABLE attendance_rules ADD COLUMN telegram_summary_time time NOT NULL DEFAULT '09:00';

-- Daily messages already sent (morning summary, absent list), once per company and day.
CREATE TABLE telegram_daily_alerts (
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind        text NOT NULL,
  work_date   date NOT NULL,
  sent_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, kind, work_date)
);
