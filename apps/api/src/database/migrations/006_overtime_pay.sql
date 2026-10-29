-- Overtime pay rates, approval and the salary needed to price overtime.

-- One OT policy per company. Modes: multiplier (x hourly rate), fixed_hour (amount per hour), fixed_day (amount per day,
-- days off / holidays only, when at least *_min_hours were worked).
CREATE TABLE overtime_policies (
  company_id         uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  requires_approval  boolean NOT NULL DEFAULT false,
  currency           text NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD', 'KHR', 'THB', 'VND')),
  monthly_hours      numeric(6,2) NOT NULL DEFAULT 208 CHECK (monthly_hours > 0 AND monthly_hours <= 400),
  workday_mode       text NOT NULL DEFAULT 'multiplier' CHECK (workday_mode IN ('multiplier', 'fixed_hour')),
  workday_value      numeric(12,2) NOT NULL DEFAULT 1.5 CHECK (workday_value >= 0),
  dayoff_mode        text NOT NULL DEFAULT 'multiplier' CHECK (dayoff_mode IN ('multiplier', 'fixed_hour', 'fixed_day')),
  dayoff_value       numeric(12,2) NOT NULL DEFAULT 2 CHECK (dayoff_value >= 0),
  dayoff_min_hours   numeric(4,2) NOT NULL DEFAULT 4 CHECK (dayoff_min_hours BETWEEN 0 AND 24),
  holiday_mode       text NOT NULL DEFAULT 'multiplier' CHECK (holiday_mode IN ('multiplier', 'fixed_hour', 'fixed_day')),
  holiday_value      numeric(12,2) NOT NULL DEFAULT 2 CHECK (holiday_value >= 0),
  holiday_min_hours  numeric(4,2) NOT NULL DEFAULT 4 CHECK (holiday_min_hours BETWEEN 0 AND 24),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Pay basis per employee (only admins / HR see it).
ALTER TABLE employees ADD COLUMN monthly_salary numeric(12,2) CHECK (monthly_salary >= 0);
ALTER TABLE employees ADD COLUMN hourly_rate numeric(12,2) CHECK (hourly_rate >= 0);

-- Decisions on a day's overtime. A day with OT and no row is "pending" (when approval is required).
CREATE TABLE overtime_approvals (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id       uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  work_date         date NOT NULL,
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  approved_minutes  integer CHECK (approved_minutes >= 0),
  reason            text,
  review_note       text,
  reviewed_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, work_date)
);
CREATE INDEX overtime_approvals_company_idx ON overtime_approvals (company_id, work_date);
