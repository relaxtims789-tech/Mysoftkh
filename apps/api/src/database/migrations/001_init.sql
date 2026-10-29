-- QR attendance: initial schema.
-- Every company-owned table carries company_id; the API always filters by the caller's company.

CREATE TABLE companies (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  code        text NOT NULL,
  logo        text,
  timezone    text NOT NULL DEFAULT 'Asia/Phnom_Penh',
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX companies_code_uq ON companies (lower(code));

-- One row per company: which security checks and attendance rules apply.
CREATE TABLE attendance_rules (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                 uuid NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
  allow_lunch_scan           boolean NOT NULL DEFAULT false,
  require_gps                boolean NOT NULL DEFAULT true,
  require_device_binding     boolean NOT NULL DEFAULT true,
  device_approval_mode       text NOT NULL DEFAULT 'auto_first' CHECK (device_approval_mode IN ('auto_first', 'admin')),
  allow_overtime             boolean NOT NULL DEFAULT true,
  overtime_min_minutes       integer NOT NULL DEFAULT 30 CHECK (overtime_min_minutes BETWEEN 0 AND 600),
  geofence_radius            integer NOT NULL DEFAULT 100 CHECK (geofence_radius BETWEEN 10 AND 5000),
  max_gps_accuracy           integer NOT NULL DEFAULT 150 CHECK (max_gps_accuracy BETWEEN 5 AND 5000),
  min_scan_interval_seconds  integer NOT NULL DEFAULT 30 CHECK (min_scan_interval_seconds BETWEEN 0 AND 3600),
  restrict_to_home_branch    boolean NOT NULL DEFAULT false,
  allow_employee_corrections boolean NOT NULL DEFAULT true,
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE branches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        text NOT NULL,
  code        text NOT NULL,
  address     text,
  latitude    double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude   double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  radius      integer CHECK (radius BETWEEN 10 AND 5000), -- NULL = company default (attendance_rules.geofence_radius)
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX branches_code_uq ON branches (company_id, lower(code));

CREATE TABLE departments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        text NOT NULL,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX departments_name_uq ON departments (company_id, lower(name));

CREATE TABLE positions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        text NOT NULL,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX positions_name_uq ON positions (company_id, lower(name));

-- Times are local to the company's timezone.
-- Late    = check-in after start_time + late_after_minutes.
-- Early   = check-out before end_time - grace_minutes.
-- Lunch   = lunch-in after lunch_end + grace_minutes is a late return.
CREATE TABLE work_schedules (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name                text NOT NULL,
  start_time          time NOT NULL,
  end_time            time NOT NULL,
  lunch_start         time,
  lunch_end           time,
  late_after_minutes  integer NOT NULL DEFAULT 15 CHECK (late_after_minutes BETWEEN 0 AND 240),
  grace_minutes       integer NOT NULL DEFAULT 5 CHECK (grace_minutes BETWEEN 0 AND 120),
  work_days           smallint[] NOT NULL DEFAULT '{1,2,3,4,5}', -- ISO weekday: 1 = Monday ... 7 = Sunday
  is_default          boolean NOT NULL DEFAULT false,
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time > start_time),
  CHECK ((lunch_start IS NULL) = (lunch_end IS NULL)),
  CHECK (lunch_start IS NULL OR (lunch_end > lunch_start AND lunch_start >= start_time AND lunch_end <= end_time))
);
CREATE UNIQUE INDEX work_schedules_default_uq ON work_schedules (company_id) WHERE is_default;

CREATE TABLE employees (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_code  text NOT NULL,
  name           text NOT NULL,
  phone          text,
  email          text,
  department_id  uuid REFERENCES departments(id) ON DELETE SET NULL,
  position_id    uuid REFERENCES positions(id) ON DELETE SET NULL,
  branch_id      uuid REFERENCES branches(id) ON DELETE SET NULL,
  schedule_id    uuid REFERENCES work_schedules(id) ON DELETE SET NULL, -- NULL = company default schedule
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  profile_photo  text,
  hired_on       date,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX employees_code_uq ON employees (company_id, lower(employee_code));
CREATE INDEX employees_company_idx ON employees (company_id, status);
CREATE INDEX employees_department_idx ON employees (department_id);

-- Log-in accounts. Employees sign in with company code + employee ID; staff users may also use their email.
CREATE TABLE users (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid REFERENCES companies(id) ON DELETE CASCADE, -- NULL only for super_admin
  employee_id           uuid UNIQUE REFERENCES employees(id) ON DELETE CASCADE,
  username              text NOT NULL,
  email                 text,
  name                  text NOT NULL,
  role                  text NOT NULL CHECK (role IN ('super_admin', 'company_admin', 'hr', 'manager', 'employee')),
  password_hash         text NOT NULL,
  status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  must_change_password  boolean NOT NULL DEFAULT false,
  failed_logins         integer NOT NULL DEFAULT 0,
  locked_until          timestamptz,
  last_login_at         timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK ((role = 'super_admin') = (company_id IS NULL))
);
CREATE UNIQUE INDEX users_username_uq ON users (coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(username));
CREATE UNIQUE INDEX users_email_uq ON users (lower(email)) WHERE email IS NOT NULL;

-- Departments a manager may see.
CREATE TABLE manager_departments (
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  department_id  uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, department_id)
);

-- Refresh tokens are stored hashed; each log-in starts a family so a reused (stolen) token revokes the whole family.
CREATE TABLE refresh_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id    uuid NOT NULL,
  token_hash   text NOT NULL UNIQUE,
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  rotated_at   timestamptz, -- set when revoked because it was exchanged for a new token (not a log-out)
  user_agent   text,
  ip_address   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);

-- Phones. The device_identifier is the SHA-256 thumbprint of a non-extractable P-256 key kept in the phone's browser;
-- every scan is signed with that key, so copying a session cookie to another phone is not enough.
CREATE TABLE devices (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id        uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  device_identifier  text NOT NULL,
  public_key         jsonb NOT NULL,
  device_name        text,
  platform           text,
  user_agent         text,
  status             text NOT NULL CHECK (status IN ('active', 'pending', 'revoked', 'rejected')),
  registered_at      timestamptz NOT NULL DEFAULT now(),
  approved_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at        timestamptz,
  last_used_at       timestamptz
);
CREATE UNIQUE INDEX devices_employee_identifier_uq ON devices (employee_id, device_identifier);
CREATE INDEX devices_company_status_idx ON devices (company_id, status);

CREATE TABLE qr_codes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  branch_id       uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  token           text NOT NULL UNIQUE,
  label           text,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  regenerated_at  timestamptz,
  disabled_at     timestamptz
);
CREATE INDEX qr_codes_branch_idx ON qr_codes (branch_id);

-- Valid attendance from every source (QR today; ZKTeco, face recognition, imports later).
-- Rejected scans never land here; they go to attendance_attempts.
CREATE TABLE attendance (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id           uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  branch_id             uuid REFERENCES branches(id) ON DELETE SET NULL,
  qr_code_id            uuid REFERENCES qr_codes(id) ON DELETE SET NULL,
  attendance_type       text NOT NULL CHECK (attendance_type IN ('check_in', 'lunch_out', 'lunch_in', 'check_out')),
  scan_time             timestamptz NOT NULL,
  work_date             date NOT NULL, -- scan_time's date in the company timezone
  latitude              double precision,
  longitude             double precision,
  gps_accuracy          double precision,
  distance_from_branch  double precision,
  device_id             uuid REFERENCES devices(id) ON DELETE SET NULL,
  source                text NOT NULL DEFAULT 'qr' CHECK (source IN ('qr', 'manual', 'correction', 'zkteco', 'face', 'import')),
  status                text NOT NULL CHECK (status IN ('on_time', 'late', 'early_leave', 'overtime', 'off_day')),
  late_minutes          integer NOT NULL DEFAULT 0,
  early_minutes         integer NOT NULL DEFAULT 0,
  overtime_minutes      integer NOT NULL DEFAULT 0,
  remarks               text,
  external_ref          text, -- idempotency key for integrations (e.g. device serial + log id)
  is_void               boolean NOT NULL DEFAULT false,
  void_reason           text,
  voided_by             uuid REFERENCES users(id) ON DELETE SET NULL,
  voided_at             timestamptz,
  created_by            uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attendance_company_date_idx ON attendance (company_id, work_date);
CREATE INDEX attendance_employee_date_idx ON attendance (employee_id, work_date);
CREATE INDEX attendance_employee_time_idx ON attendance (employee_id, scan_time DESC);
CREATE UNIQUE INDEX attendance_external_ref_uq ON attendance (company_id, source, external_ref) WHERE external_ref IS NOT NULL;

-- Every rejected scan, for security review. Never counted as attendance.
CREATE TABLE attendance_attempts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid REFERENCES companies(id) ON DELETE CASCADE,
  employee_id           uuid REFERENCES employees(id) ON DELETE CASCADE,
  branch_id             uuid REFERENCES branches(id) ON DELETE SET NULL,
  qr_code_id            uuid REFERENCES qr_codes(id) ON DELETE SET NULL,
  attendance_type       text,
  reason_code           text NOT NULL,
  message               text NOT NULL,
  latitude              double precision,
  longitude             double precision,
  gps_accuracy          double precision,
  distance_from_branch  double precision,
  device_identifier     text,
  ip_address            text,
  user_agent            text,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attendance_attempts_company_idx ON attendance_attempts (company_id, created_at DESC);

CREATE TABLE attendance_corrections (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id      uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  work_date        date NOT NULL,
  attendance_type  text NOT NULL CHECK (attendance_type IN ('check_in', 'lunch_out', 'lunch_in', 'check_out')),
  current_time_at  timestamptz, -- the existing scan of that type when the request was made, if any
  requested_time   timestamptz NOT NULL,
  reason           text NOT NULL,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at      timestamptz,
  review_note      text,
  attendance_id    uuid REFERENCES attendance(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attendance_corrections_company_idx ON attendance_corrections (company_id, status, created_at DESC);

CREATE TABLE holidays (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        text NOT NULL,
  date        date NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX holidays_date_uq ON holidays (company_id, date);

CREATE TABLE leave_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id  uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type   text NOT NULL CHECK (leave_type IN ('annual', 'sick', 'personal', 'maternity', 'unpaid', 'other')),
  start_date   date NOT NULL,
  end_date     date NOT NULL,
  days         numeric(5,1) NOT NULL DEFAULT 0,
  reason       text,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  approved_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at  timestamptz,
  review_note  text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);
CREATE INDEX leave_requests_company_idx ON leave_requests (company_id, status, start_date);
CREATE INDEX leave_requests_employee_idx ON leave_requests (employee_id, start_date);

CREATE TABLE audit_logs (
  id          bigserial PRIMARY KEY,
  company_id  uuid REFERENCES companies(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  action      text NOT NULL,
  module      text NOT NULL,
  record_id   text,
  old_value   jsonb,
  new_value   jsonb,
  ip_address  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_company_idx ON audit_logs (company_id, created_at DESC);

-- One-time scan challenges already used (replay protection).
CREATE TABLE used_nonces (
  nonce       text PRIMARY KEY,
  expires_at  timestamptz NOT NULL
);

-- API keys for machines (ZKTeco bridge, HR/payroll systems) that push attendance into the same table.
CREATE TABLE integration_keys (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name          text NOT NULL,
  key_prefix    text NOT NULL,
  key_hash      text NOT NULL UNIQUE,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  last_used_at  timestamptz,
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
