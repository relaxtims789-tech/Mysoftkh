-- Telegram Mini App: staff open the attendance app inside Telegram (one platform bot), sign in once, and get messages
-- (check-in receipts, approvals, payslip ready, forgot-to-check-out reminders).

ALTER TABLE users ADD COLUMN telegram_user_id bigint;
ALTER TABLE users ADD COLUMN telegram_username text;
ALTER TABLE users ADD COLUMN telegram_lang text;
ALTER TABLE users ADD COLUMN telegram_notify boolean NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN telegram_linked_at timestamptz;
-- One Telegram account opens one log-in.
CREATE UNIQUE INDEX users_telegram_uq ON users (telegram_user_id) WHERE telegram_user_id IS NOT NULL;

ALTER TABLE platform_settings ADD COLUMN telegram_bot_username text;
ALTER TABLE platform_settings ADD COLUMN telegram_webhook_secret text;
ALTER TABLE platform_settings ADD COLUMN telegram_setup_at timestamptz;

-- "Connect Telegram" from the browser app: a one-time code sent to the bot as /start <code>.
CREATE TABLE telegram_link_tokens (
  token_hash  text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL
);

-- At most one "you have not checked out" reminder per employee and day.
CREATE TABLE telegram_reminders (
  employee_id  uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  work_date    date NOT NULL,
  sent_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (employee_id, work_date)
);
