-- Telegram groups of a company: the bot posts check-ins, check-outs, leave and fix-scan requests there.
CREATE TABLE telegram_groups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  chat_id     bigint NOT NULL,
  title       text,
  bot         text NOT NULL CHECK (bot IN ('staff', 'admin')),          -- the bot that is in the group
  events      text[] NOT NULL DEFAULT '{check_in,check_out,leave,correction}',
  lang        text NOT NULL DEFAULT 'km' CHECK (lang IN ('km', 'en', 'both')),
  branch_id   uuid REFERENCES branches(id) ON DELETE SET NULL,          -- NULL = every branch
  active      boolean NOT NULL DEFAULT true,
  status_note text,                                                   -- why it stopped (bot removed, ...)
  linked_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, chat_id)
);
CREATE INDEX telegram_groups_company ON telegram_groups (company_id) WHERE active;

-- One-time codes for "Connect a Telegram group" (t.me/<bot>?startgroup=<code>), valid 30 minutes.
CREATE TABLE telegram_group_tokens (
  token_hash  text PRIMARY KEY,
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES users(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL
);
