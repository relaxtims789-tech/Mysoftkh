-- Cancellation & Refund Policy: the customer accepts it before each payment; the version, who, when and from where are kept on the invoice.
ALTER TABLE invoices
  ADD COLUMN policy_version text,
  ADD COLUMN policy_accepted_at timestamptz,
  ADD COLUMN policy_accepted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN policy_accepted_ip text;
