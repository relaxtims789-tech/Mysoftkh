-- Selling the system: free trial on sign-up, prices by number of staff, invoices paid with ABA PayWay or by bank transfer.

-- Monthly price (USD) per staff range. Edited by the super admin.
CREATE TABLE price_tiers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  min_staff      integer NOT NULL CHECK (min_staff >= 1),
  max_staff      integer NOT NULL CHECK (max_staff >= min_staff),
  monthly_price  numeric(10,2) NOT NULL CHECK (monthly_price >= 0),
  active         boolean NOT NULL DEFAULT true,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
INSERT INTO price_tiers (min_staff, max_staff, monthly_price) VALUES
  (1, 5, 9), (6, 10, 15), (11, 15, 20), (16, 25, 29), (26, 50, 49), (51, 100, 79), (101, 500, 199),
  (501, 1000, 349), (1001, 1500, 479), (1501, 2000, 599), (2001, 3000, 799);

-- One row: trial, grace, yearly discount, where customers pay, notifications.
CREATE TABLE platform_settings (
  id                     integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  trial_months           integer NOT NULL DEFAULT 1 CHECK (trial_months BETWEEN 0 AND 12),
  grace_days             integer NOT NULL DEFAULT 7 CHECK (grace_days BETWEEN 0 AND 60),
  yearly_free_months     integer NOT NULL DEFAULT 2 CHECK (yearly_free_months BETWEEN 0 AND 11),
  aba_account_name       text,
  aba_account_number     text,
  aba_qr                 text,
  acleda_account_name    text,
  acleda_account_number  text,
  acleda_qr              text,
  payway_enabled         boolean NOT NULL DEFAULT false,
  payway_sandbox         boolean NOT NULL DEFAULT true,
  payway_merchant_id     text,
  payway_api_key         text,            -- encrypted (common/crypto sealSecret)
  sales_phone            text,
  sales_telegram         text,
  sales_email            text,
  telegram_bot_token     text,            -- encrypted
  telegram_chat_id       text,
  updated_at             timestamptz NOT NULL DEFAULT now()
);
INSERT INTO platform_settings (id) VALUES (1);

ALTER TABLE companies ADD COLUMN billing_exempt boolean NOT NULL DEFAULT false;
ALTER TABLE companies ADD COLUMN tier_id uuid REFERENCES price_tiers(id) ON DELETE SET NULL;
ALTER TABLE companies ADD COLUMN trial_ends_at date;
ALTER TABLE companies ADD COLUMN paid_until date;
ALTER TABLE companies ADD COLUMN signup_source text NOT NULL DEFAULT 'admin' CHECK (signup_source IN ('admin', 'website'));
ALTER TABLE companies ADD COLUMN contact_name text;
ALTER TABLE companies ADD COLUMN contact_phone text;
ALTER TABLE companies ADD COLUMN contact_email text;
ALTER TABLE companies ADD COLUMN billing_note text;
-- Companies that exist before billing keep working as before; the super admin can change this.
UPDATE companies SET billing_exempt = true;

CREATE SEQUENCE invoice_number_seq START 1001;

CREATE TABLE invoices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  number          text NOT NULL UNIQUE,
  kind            text NOT NULL DEFAULT 'renewal' CHECK (kind IN ('renewal', 'upgrade')),
  tier_id         uuid REFERENCES price_tiers(id) ON DELETE SET NULL,
  min_staff       integer NOT NULL,
  max_staff       integer NOT NULL,
  cycle           text NOT NULL CHECK (cycle IN ('monthly', 'yearly')),
  months          integer NOT NULL CHECK (months > 0),
  amount          numeric(12,2) NOT NULL CHECK (amount >= 0),
  currency        text NOT NULL DEFAULT 'USD',
  status          text NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'submitted', 'paid', 'rejected', 'cancelled')),
  method          text CHECK (method IN ('payway', 'bank_transfer', 'manual')),
  bank            text CHECK (bank IN ('aba', 'acleda')),
  receipt_file    text,
  payer_note      text,
  payway_tran_id  text UNIQUE,
  paid_at         timestamptz,
  period_start    date,
  period_end      date,
  reviewed_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  review_note     text,
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invoices_company_idx ON invoices (company_id, created_at DESC);
CREATE INDEX invoices_status_idx ON invoices (status);
