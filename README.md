# QR Attendance

Staff attendance with **a printed QR code at each office entrance and the employee's own smartphone**. No attendance
machine, tablet or kiosk is needed.

An employee opens the attendance app (an installable web app), taps **SCAN QR** and points the camera at the poster. The
server then checks, in this order:

**QR → branch → GPS geofence → employee → registered phone → work schedule → record**

If any check fails, nothing is recorded. The refused scan is logged for HR to review.

| Part | Technology |
|---|---|
| REST API | Node.js, NestJS 11, TypeScript |
| Database | PostgreSQL (SQL migrations in `apps/api/src/database/migrations`) |
| Admin dashboard + employee PWA | React 19, Vite (one build, two areas: `/admin` and `/app`) |
| Auth | JWT access token (15 min, in memory) + rotating refresh token (httpOnly cookie, 30 days) |
| Device binding | Non-extractable P-256 key in the phone's browser; every scan is signed |
| Maps | Leaflet + OpenStreetMap (branch location and radius) |
| Deployment | Docker Compose: PostgreSQL + app + Caddy (automatic HTTPS) |

## Quick start (Windows PC)

You need Node.js 20 or newer. Double-click **`start-demo.bat`**. The first run installs packages, builds the app and
creates a local PostgreSQL in `data\pg`; this takes a few minutes. It then adds the demo company and opens on
**http://localhost:3200**.

| Who | Where | Sign in |
|---|---|---|
| Company admin | http://localhost:3200/admin | `admin@camdemo.com` |
| HR | /admin | `hr@camdemo.com` |
| Manager (Sales + Customer Service only) | /admin | `manager@camdemo.com` |
| Platform super admin | /admin | `super@qr-attendance.local` |
| Employee Dara Sok | http://localhost:3200/app | company `camdemo`, employee ID `E0001` |

Every demo password is `Demo@1234`; the list is also written to `data\demo-logins.txt`. For real use, run
**`start.bat`** instead. Create the first super admin with `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD` (see Configuration),
or use the demo super admin.

The demo company has 120 employees across 3 branches. It includes 30 days of history, holidays, leave, a pending phone,
a pending "forgot to scan" correction, and some rejected scans.

Other commands, run from the repository root:

```bash
npm start
```
```bash
npm run seed
```
```bash
npm run reset-demo
```
```bash
npm run dev
```
```bash
npm test
```

`npm start` runs local PostgreSQL plus the app. `seed` adds the demo company. `reset-demo` wipes the local database
and seeds again. `dev` gives hot reload on http://localhost:5173. `npm test` runs unit and integration tests against a
throw-away PostgreSQL.

## Putting it on the internet

Follow **[docs/DEPLOY.md](docs/DEPLOY.md)**. In short: point a domain at a VPS, run `npm run package`, upload
`qr-attendance-deploy.zip`, fill in `.env`, then run `docker compose up -d --build`. This gives PostgreSQL, the app,
nightly backups and automatic HTTPS. It can also share the server that already runs SMW.

## Testing with a real phone

Phone browsers allow the **camera and GPS only on https** (or on `localhost`). A phone on your Wi-Fi opening
`http://192.168.x.x:3200` gets neither. Choose one:

1. **Deploy to a server with a domain** (see `docs/DEPLOY.md`). Caddy gets a free certificate automatically. This is
   the real set-up.
2. **Local HTTPS for testing.** Create a self-signed certificate with the OpenSSL that comes with Git for Windows, then
   start with it. The phone shows a certificate warning once.

   ```bash
   openssl req -x509 -newkey rsa:2048 -nodes -days 365 -keyout data/dev-key.pem -out data/dev-cert.pem -subj "/CN=qr-attendance" -addext "subjectAltName=IP:192.168.0.6"
   ```
   Then set `HTTPS_KEY_FILE=data/dev-key.pem`, `HTTPS_CERT_FILE=data/dev-cert.pem` and
   `PUBLIC_URL=https://192.168.0.6:3200` before `npm start`. Use your PC's IP address.

Branch "CAM Phnom Penh" in the demo is at 11.5564, 104.9282 with a 100 m radius. To scan from where you are, open
**Admin → Branches → Edit** and click **Use my current location**.

## How it stays secure

A printed QR can be photographed and shared, so the QR alone proves nothing. The system relies on four checks together,
each of which a company can switch on or off in **Settings**:

1. **Printed QR.** It holds only a random 256-bit branch token (`https://your-domain/scan/<token>`) and never any
   employee data. Regenerating a QR invalidates every printed copy at once.
2. **Employee sign-in.** Passwords are hashed with scrypt. Accounts lock for 15 minutes after 5 wrong passwords.
   Refresh tokens rotate, and a reused token ends the whole session family.
3. **GPS geofence.** The server computes the distance (haversine) from the reported position to the branch and rejects
   anything beyond the radius. It also rejects weak fixes (accuracy worse than the configured limit), and flags
   impossible travel speeds between scans as suspicious.
4. **Phone binding.** On first use the phone creates a P-256 key in the browser that cannot be exported. The server
   stores the public key. Each scan signs `challenge | QR token | type | latitude | longitude | accuracy` with that
   key, using a one-time, 2-minute server challenge. A copied session cookie on another phone, an edited location or a
   replayed request all fail. The first phone is approved automatically (or by an admin, per company). Any new phone
   waits for approval.

The server also checks:
- Every ID and value is re-checked on the server, including company scoping on every query. All SQL is parameterised.
- Requests are validated (unknown fields are rejected) and rate limited, with tighter limits on log-in and scanning.
- Two scans within the configured interval return **"Attendance already recorded."**. Scans are serialised per employee
  with a database lock, so even simultaneous taps create one record.
- Every change (corrections, approvals, settings, QR regeneration, phone approvals, log-ins) is written to the audit log.
- Responses carry security headers (CSP, HSTS behind https, Permissions-Policy limiting camera and GPS to the app).

Selfie or face verification can be added later as a fifth check. See "Not built yet".

## Attendance rules

Each work schedule has start/end times, an optional lunch break, **late after** (minutes after start), a **grace
period** and working days. With start 08:00, late after 15 min, end 17:00 and grace 5 min:

| Scan | Result |
|---|---|
| Check-in 07:55, 08:03, 08:15 | ON TIME |
| Check-in 08:16 | LATE (16 min) |
| Check-out before 16:55 | Early leave (the app asks the employee to confirm first) |
| Check-out 30+ min after 17:00 (configurable) | Overtime |
| No scan by 08:16 on a working day | Absent (Not yet in before that) |
| Holiday / day off / approved leave | Holiday / Day off / Leave; work on those days counts as overtime |

The app chooses check-in, lunch-out, lunch-in or check-out automatically from what is already recorded today (lunch
scans are optional per company). The last check-out of the day counts.

## Features

**Employee app (`/app`, installable PWA):** sign-in, home ("Good afternoon, Dara", check-in/out times, today's
status), QR scan with the camera (or the phone's camera app opening the scan link), GPS permission help, success/failed
screens, today's scans, monthly history with totals, leave requests and history, "fix a scan" correction requests,
profile, phone registration, payslips (with PDF download). Works in light and dark mode. Also runs as a **Telegram
Mini App** (platform bot): sign in once, Telegram QR scanner and location, and bot messages for check-ins, approvals,
payslips and forgotten check-outs. Companies can also connect their own **Telegram groups** (Settings → Telegram groups): check-ins,
check-outs, leave and fix-scan requests are posted there, chosen per group, in Khmer and/or English, optionally per branch.

**Public website (`/`):** features, prices by number of staff (monthly / yearly) and free-trial sign-up, in English and
Khmer. Sign-up creates the company and its admin; the trial length, prices, ABA / ACLEDA bank accounts and ABA PayWay
are set by the super admin (Plans & settings). Customers pay in **Billing & plan** (ABA PayWay, or bank transfer with a
receipt the super admin approves in **Payments**); after the paid period and 7 grace days the company becomes read-only.
Before every payment the customer ticks "I have read and agree" to the **Cancellation & Refund Policy** (English / Khmer,
also at `/refund-policy` and as a Word file); the accepted version, user, time and IP are saved on the invoice. The text
lives in `apps/web/src/lib/refund-policy.ts`; after changing it, raise the version there and in
`apps/api/src/modules/billing/billing.service.ts` (`REFUND_POLICY_VERSION`) and rebuild the Word file with
`node tools/refund-policy-docx.mjs`.

**Public demo (optional, `DEMO_MODE`):** a second container with its own database holding **DemoCompany** and about 6
months of sample data (attendance, leave, corrections, overtime, payroll), rebuilt every night at 03:00. Customers sign
in as `DemoCompany` / `democompany123456` (staff app: company code `DemoCompany`, employee `E0001`); the shared
sign-ins cannot be changed or locked. Set-up: docs/DEPLOY.md section 11. Code: `apps/api/src/database/demo-data.ts`,
`apps/api/src/modules/demo`.

**Admin dashboard (`/admin`):**
- **Dashboard:** total, present, late, absent, leave, checked out and overtime counts, a 14-day trend, departments and
  the latest scans, refreshing every 30 seconds.
- **Live attendance:** employee, department, branch, check-in, check-out, status and location, with filters.
- **Employees:** add, edit, disable, CSV import, photo, reset password, reset phone, per-employee monthly attendance and
  manual corrections.
- **Phones:** approve, reject or remove.
- **Branches:** map point, radius and "use my location".
- **QR codes:** create, regenerate, disable/enable, download PNG, print as an A4 poster or a 10×15 cm stand.
- **Schedules, holidays, departments and positions.**
- **Corrections, leave and overtime:** approve or reject (overtime: all or fewer minutes), each with an audit entry.
- **Payroll:** monthly runs from salary and attendance (unpaid absence and leave, late deduction), approved overtime,
  monthly allowances, one-off bonuses and deductions, salary advances repaid in instalments, Cambodian Tax on Salary
  (in riel, with dependants) and NSSF. Every item can be switched on or off. Draft → approved (locked) → paid; only a
  company admin approves or unlocks. Payroll Excel, bank transfer list and PDF payslips; staff see payslips on their phone.
- **Reports:** daily, monthly (payroll summary), employee, department, branch, late, absent, early leave, overtime,
  leave and exceptions. Each can be viewed on screen or exported to **Excel, CSV or PDF**.
- **Rejected scans log, staff accounts, settings (rules, logo, time zone, API keys) and audit log.**
- **Companies (super admin):** create companies with their first admin, and suspend or reactivate them.

**Roles:**

| Role | Can do |
|---|---|
| Super admin | Everything, in every company |
| Company admin | Everything in their company |
| HR | Everything in their company except company settings; prepares payroll but cannot approve or unlock it |
| Manager | Views their departments, approves their departments' leave |
| Employee | Own attendance, profile, leave and corrections only |

**Integrations:** ZKTeco terminals (through a bridge), face recognition, and HR or payroll systems push punches to
`POST /api/integrations/punches` with an API key. They land in the **same `attendance` table** with a different
`source`, and are de-duplicated by `externalId`. See `docs/API.md`.

## Configuration (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | local embedded PostgreSQL | `postgres://user:pass@host:5432/db` |
| `PUBLIC_URL` | `http://localhost:3200` | Base URL printed inside QR codes. **Set it before printing.** |
| `JWT_SECRET` | generated into `data/secret.key` | Required in production (32+ characters) |
| `PORT` | `3200` | |
| `STORAGE_DIR` | `data/` | Logos and photos (`uploads/`) |
| `SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD` | – | First super admin, created on start if none exists |
| `TRUST_PROXY` | `1` in production | Set behind a reverse proxy so client IPs are right |
| `HTTPS_KEY_FILE`, `HTTPS_CERT_FILE` | – | Serve https directly (local phone testing) |
| `RATE_LIMIT_PER_MINUTE` | `300` | General API limit per IP |
| `API_DOCS` | `true` | Swagger UI at `/api/docs` |
| `AUTO_MIGRATE` | `true` | Run migrations on start |

## Project layout

```
apps/api/                 NestJS API
  src/domain/             pure rules: geofence, punch evaluation, daily summary, time zones, overtime and
                          payroll / tax / NSSF (unit-tested)
  src/modules/            auth, organization (companies, branches, schedules, holidays), employees, users,
                          devices, qr, attendance (scan pipeline, live, history), corrections, leave, overtime,
                          payroll (+ payslip PDF), dashboard, reports (+ CSV/Excel/PDF), integrations, audit
  src/database/           migrations (SQL), migration runner, demo seed
  test/                   integration tests (real PostgreSQL)
apps/web/                 React app: src/employee (PWA), src/admin (dashboard)
tools/                    local PostgreSQL launcher, icon generator
docs/                     API.md, DEPLOY.md
```

## Not built yet

These are the planned next steps after this MVP:
- push or email notifications (late alerts, approval requests)
- selfie or face verification at scan time
- a ready-made ZKTeco bridge (the API it would call already exists)
- seniority indemnity and other severance payments
- overnight shifts and rotating rosters
- Khmer translation of the UI
- Khmer text in PDF exports (it shows as `?`; Excel and CSV handle Khmer fine)
