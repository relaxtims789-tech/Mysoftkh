-- Payroll: monthly runs (draft -> approved -> paid, locked once approved), allowances, one-off items, salary advances,
-- Cambodian Tax on Salary and NSSF settings, and the employee details payroll needs.

CREATE TABLE payroll_settings (
  company_id             uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  base_from_attendance   boolean NOT NULL DEFAULT true,
  days_basis             text NOT NULL DEFAULT 'fixed' CHECK (days_basis IN ('fixed', 'schedule')),
  fixed_days             numeric(4,1) NOT NULL DEFAULT 26 CHECK (fixed_days BETWEEN 1 AND 31),
  unpaid_leave_types     text[] NOT NULL DEFAULT '{unpaid}',
  late_deduction         boolean NOT NULL DEFAULT false,
  late_mode              text NOT NULL DEFAULT 'per_minute' CHECK (late_mode IN ('per_minute', 'per_time')),
  late_value             numeric(12,2) NOT NULL DEFAULT 1 CHECK (late_value >= 0),
  late_free              integer NOT NULL DEFAULT 0 CHECK (late_free >= 0),
  include_early_leave    boolean NOT NULL DEFAULT true,
  overtime               boolean NOT NULL DEFAULT true,
  allowances             boolean NOT NULL DEFAULT true,
  deductions             boolean NOT NULL DEFAULT true,
  tax                    boolean NOT NULL DEFAULT true,
  nssf                   boolean NOT NULL DEFAULT true,
  exchange_rate          numeric(10,2) NOT NULL DEFAULT 4100 CHECK (exchange_rate > 0),
  tax_brackets           jsonb NOT NULL DEFAULT '[{"upTo":1500000,"rate":0},{"upTo":2000000,"rate":5},{"upTo":8500000,"rate":10},{"upTo":12500000,"rate":15},{"upTo":null,"rate":20}]',
  dependent_allowance    numeric(12,0) NOT NULL DEFAULT 150000 CHECK (dependent_allowance >= 0),
  non_resident_rate      numeric(5,2) NOT NULL DEFAULT 20,
  fringe_rate            numeric(5,2) NOT NULL DEFAULT 20,
  pension_deductible     boolean NOT NULL DEFAULT true,
  nssf_pension_employee  numeric(5,2) NOT NULL DEFAULT 2,
  nssf_pension_employer  numeric(5,2) NOT NULL DEFAULT 2,
  nssf_health_employer   numeric(5,2) NOT NULL DEFAULT 2.6,
  nssf_risk_employer     numeric(5,2) NOT NULL DEFAULT 0.8,
  nssf_min_wage          numeric(12,0) NOT NULL DEFAULT 400000,
  nssf_max_wage          numeric(12,0) NOT NULL DEFAULT 1200000,
  updated_at             timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE employees ADD COLUMN dependents integer NOT NULL DEFAULT 0 CHECK (dependents BETWEEN 0 AND 20);
ALTER TABLE employees ADD COLUMN tax_resident boolean NOT NULL DEFAULT true;
ALTER TABLE employees ADD COLUMN nssf_enrolled boolean NOT NULL DEFAULT true;
ALTER TABLE employees ADD COLUMN bank_name text;
ALTER TABLE employees ADD COLUMN bank_account text;
ALTER TABLE employees ADD COLUMN bank_account_name text;

-- Paid every month until removed.
CREATE TABLE employee_allowances (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id    uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  name           text NOT NULL,
  amount         numeric(14,2) NOT NULL CHECK (amount > 0),
  tax_treatment  text NOT NULL DEFAULT 'salary' CHECK (tax_treatment IN ('salary', 'exempt', 'fringe')),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX employee_allowances_employee_idx ON employee_allowances (employee_id);

-- One month only: bonus, commission, extra allowance (earning) or penalty, uniform, loss (deduction).
CREATE TABLE payroll_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id    uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  month          date NOT NULL CHECK (extract(day FROM month) = 1),
  kind           text NOT NULL CHECK (kind IN ('earning', 'deduction')),
  name           text NOT NULL,
  amount         numeric(14,2) NOT NULL CHECK (amount > 0),
  tax_treatment  text NOT NULL DEFAULT 'salary' CHECK (tax_treatment IN ('salary', 'exempt', 'fringe')),
  created_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payroll_items_month_idx ON payroll_items (company_id, month);

CREATE TABLE payroll_runs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  month          date NOT NULL CHECK (extract(day FROM month) = 1),
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'paid')),
  currency       text NOT NULL DEFAULT 'USD',
  exchange_rate  numeric(10,2) NOT NULL CHECK (exchange_rate > 0),
  rules          jsonb NOT NULL DEFAULT '{}',
  totals         jsonb NOT NULL DEFAULT '{}',
  note           text,
  calculated_at  timestamptz,
  calculated_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at    timestamptz,
  approved_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  paid_at        timestamptz,
  paid_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, month)
);

CREATE TABLE payroll_lines (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id       uuid NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id  uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  gross        numeric(14,2) NOT NULL,
  net          numeric(14,2) NOT NULL,
  data         jsonb NOT NULL,
  UNIQUE (run_id, employee_id)
);
CREATE INDEX payroll_lines_employee_idx ON payroll_lines (employee_id);

CREATE TABLE salary_advances (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id  uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  amount       numeric(14,2) NOT NULL CHECK (amount > 0),
  installment  numeric(14,2) NOT NULL CHECK (installment > 0),
  start_month  date NOT NULL CHECK (extract(day FROM start_month) = 1),
  issued_on    date NOT NULL,
  note         text,
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX salary_advances_company_idx ON salary_advances (company_id, status);

-- Written when a run is approved, removed when it is unlocked.
CREATE TABLE salary_advance_repayments (
  advance_id  uuid NOT NULL REFERENCES salary_advances(id) ON DELETE CASCADE,
  run_id      uuid NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  amount      numeric(14,2) NOT NULL CHECK (amount > 0),
  PRIMARY KEY (advance_id, run_id)
);
