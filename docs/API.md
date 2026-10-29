# QR Attendance API

Interactive documentation (OpenAPI/Swagger) is served by the app at **`/api/docs`**; the raw spec is at
`/api/docs/openapi.json`. This page explains the flows that need more than an endpoint list.

All endpoints are under `/api`. Requests and responses are JSON. Errors always look like:

```json
{ "statusCode": 403, "code": "OUTSIDE_GEOFENCE", "message": "Your location is outside the allowed attendance area.", "details": { "distance": 412, "radius": 100 } }
```

`message` is written for the end user; `code` is stable for programs.

## Authentication

| Endpoint | |
|---|---|
| `POST /auth/login` | `{ companyCode?, login, password }` → `{ accessToken, expiresIn, user }` and an httpOnly `qra_rt` cookie (path `/api/auth`). Employees use company code + employee ID; staff may use their email without a company code. |
| `POST /auth/refresh` | Uses the cookie; returns a new access token and rotates the cookie. Re-using an old refresh token (after a 20 s grace window) revokes the whole session family. |
| `POST /auth/logout` | Revokes the session family and clears the cookie. |
| `GET /auth/me` | Profile, company and employee record. |
| `PUT /auth/password` | `{ currentPassword, newPassword }`. Accounts created with a temporary password can call nothing else until they do this (`PASSWORD_CHANGE_REQUIRED`). |

Send the access token as `Authorization: Bearer <token>`. It lives 15 minutes. A super admin may act inside a company
by adding `X-Company-Id: <company uuid>`.

## Scanning (the attendance flow)

```
GET  /attendance/challenge              -> { challenge, expiresAt }      one-time, 2 minutes, bound to the user
POST /devices/register                  (first time on a phone)
POST /attendance/scan                   (or /attendance/check-in, /attendance/check-out to force the type)
```

### 1. Device key (once per phone)

The app creates an ECDSA P-256 key pair with WebCrypto (`extractable: false`) and stores it in IndexedDB. The device id
is the RFC 7638 JWK thumbprint (base64url SHA-256 of `{"crv","kty","x","y"}`).

```http
POST /api/devices/register
{ "publicKey": { "kty": "EC", "crv": "P-256", "x": "…", "y": "…" },
  "deviceName": "iPhone", "platform": "iOS",
  "challenge": "<from /attendance/challenge>",
  "signature": "<base64url raw r||s of 'QRA-REGISTER|' + challenge>" }
```

Response `device.status` is `active` (first phone with automatic approval, or binding turned off) or `pending` (an
admin must approve under **Phones**).

### 2. Scan

```http
POST /api/attendance/scan
{ "qrToken": "https://attendance.example.com/scan/AbC…",   // whatever the camera read
  "latitude": 11.55652, "longitude": 104.92843, "accuracy": 12,
  "type": "check_in",            // optional; omitted = server decides
  "confirmEarly": false,         // true to confirm an early check-out
  "device": { "id": "<thumbprint>", "challenge": "<fresh challenge>",
              "signature": "<signature of the scan message>" } }
```

The scan message is the UTF-8 string below. Missing values are empty; numbers use JavaScript's default `String(n)`:

```
QRA-SCAN|<challenge>|<qrToken exactly as sent>|<type or empty>|<latitude>|<longitude>|<accuracy>
```

Checks, in order: **QR** (token exists, same company, active) → **branch** (active; home branch if required) →
**GPS** (present, accuracy ≤ limit) → **geofence** (distance ≤ radius) → **employee** (active) → **device** (registered,
active, challenge unused and unexpired, signature valid) → **rules** (duplicate interval, already checked in, lunch rules,
early check-out confirmation) → **record**.

Success (`200`):

```json
{ "ok": true, "type": "check_in", "typeLabel": "Check-in", "status": "on_time", "statusLabel": "ON TIME",
  "message": "Check-in recorded at 07:55", "time": "07:55", "date": "2026-10-06", "branchName": "CAM Phnom Penh",
  "distance": 38, "lateMinutes": 0, "record": { … }, "today": { … } }
```

Failure codes (nothing is recorded; all except `CONFIRM_EARLY_CHECKOUT` are written to the rejected-scans log):

| HTTP | code | Meaning |
|---|---|---|
| 400 | `INVALID_QR` | Not an attendance QR, unknown token, or another company's QR |
| 400 | `QR_DISABLED` / `BRANCH_INACTIVE` | QR or branch switched off |
| 403 | `WRONG_BRANCH` | Company allows scanning only at the employee's own branch |
| 400 | `GPS_REQUIRED` / `GPS_INACCURATE` | No location / fix weaker than the limit |
| 403 | `OUTSIDE_GEOFENCE` | "Your location is outside the allowed attendance area." (`details.distance`, `details.radius`) |
| 403 | `EMPLOYEE_INACTIVE` | |
| 403 | `DEVICE_REQUIRED` / `DEVICE_NOT_REGISTERED` / `DEVICE_PENDING` / `DEVICE_NOT_ALLOWED` | Phone binding |
| 400 | `BAD_CHALLENGE` | Challenge expired, forged or already used (replay) |
| 403 | `BAD_DEVICE_SIGNATURE` | Body changed after signing, or wrong key |
| 409 | `DUPLICATE_SCAN` | "Attendance already recorded." (within the minimum interval) |
| 409 | `ALREADY_CHECKED_IN`, `ALREADY_CHECKED_OUT`, `ALREADY_RECORDED`, `LUNCH_NOT_STARTED`, `LUNCH_SCAN_DISABLED`, `NOT_CHECKED_IN` | Rule violations |
| 409 | `CONFIRM_EARLY_CHECKOUT` | Check-out before end − grace; repeat with `confirmEarly: true` (and a new challenge) |
| 429 | `RATE_LIMITED` | |

### Public QR lookup

`GET /api/qr/resolve/{token}` (no sign-in) returns `{ valid, branchName, companyName, companyCode }` so the app can show
"You scanned the QR at CAM Phnom Penh" on the sign-in screen after the phone's camera app opened the link.

## Integrations: other attendance sources

ZKTeco fingerprint/face terminals (via a small bridge, e.g. reading the ADMS push or the SDK), face-recognition systems and
HR imports push punches with a company API key (**Settings → Integrations**):

```http
POST /api/integrations/punches
x-api-key: qra_…
{ "punches": [
  { "employeeCode": "E0001", "time": "2026-10-06T07:58:12+07:00", "externalId": "ZK-SN123:45678",
    "source": "zkteco", "method": "fingerprint", "branchCode": "PP" } ] }
```

- Punches are stored in the same `attendance` table as QR scans, with `source` = `zkteco` / `face` / `import`.
- `externalId` makes the call idempotent: re-sending the same punch returns `duplicate`.
- `type` may be given; otherwise the first punch of the day is check-in and later ones are check-out.
- Status (late, early leave, overtime) is calculated with the employee's schedule exactly like a QR scan.
- Response: `{ received, created, results: [{ externalId, result: created|duplicate|unknown_employee|invalid, type?, status? }] }`
  in the order sent.

## Endpoint overview

| Area | Endpoints |
|---|---|
| Companies | `GET/POST /companies` (super admin), `GET/PUT /companies/:id`, `GET/PUT /companies/current`, `POST /companies/current/logo` |
| Settings | `GET/PUT /settings/attendance-rules` |
| Branches | `GET/POST /branches`, `GET/PUT /branches/:id` |
| Departments / positions | `GET/POST /departments`, `PUT/DELETE /departments/:id` (same for `/positions`) |
| Schedules | `GET/POST /schedules`, `PUT /schedules/:id` |
| Holidays | `GET /holidays?year=`, `POST /holidays`, `DELETE /holidays/:id` |
| Employees | `GET /employees?search&departmentId&branchId&status&page`, `POST /employees`, `POST /employees/import`, `GET/PUT/DELETE /employees/:id`, `POST /employees/:id/reset-device`, `POST /employees/:id/reset-password`, `POST /employees/:id/photo` |
| Staff users | `GET/POST /users`, `PUT /users/:id`, `POST /users/:id/reset-password` |
| Devices | `POST /devices/register`, `GET /devices/me`, `GET /devices/me/status?identifier=`, `GET /devices?status=`, `POST /devices/:id/approve|reject|revoke` |
| QR codes | `POST /qr`, `GET /qr?branchId=`, `GET /qr/:id`, `POST /qr/:id/regenerate|disable|enable`, `GET /qr/:id/print`, `GET /qr/:id/image.png`, `GET /qr/resolve/:token` |
| Attendance | `GET /attendance/challenge`, `POST /attendance/scan|check-in|check-out`, `GET /attendance/today`, `GET /attendance/history?from&to&employeeId`, `GET /attendance/live?date&branchId&departmentId&status&search`, `GET /attendance/records`, `GET /attendance/attempts`, `GET /attendance/:id`, `POST /attendance/:id/void` |
| Corrections | `GET /corrections?status&mine`, `POST /corrections`, `POST /corrections/manual`, `POST /corrections/:id/approve|reject|cancel` |
| Leave | `GET /leave?status&mine`, `POST /leave`, `POST /leave/:id/approve|reject|cancel` |
| Overtime | `GET/PUT /overtime/policy`, `GET /overtime?from&to&status`, `GET /overtime/pending-count`, `POST /overtime/review`, `GET /overtime/mine`, `POST /overtime/reason` |
| Payroll | `GET/PUT /payroll/settings`, `GET /payroll/runs`, `GET /payroll/runs/:month`, `POST /payroll/runs/:month/calculate|approve|paid|unlock`, `DELETE /payroll/runs/:month`, `GET /payroll/runs/:month/export?kind=summary|bank|payslips&format=xlsx|csv|pdf&employeeId`, `GET/POST /payroll/items?month`, `DELETE /payroll/items/:id`, `GET/POST /payroll/employees/:id/allowances`, `DELETE /payroll/allowances/:id`, `GET/POST /payroll/advances`, `POST /payroll/advances/:id/cancel`, `GET /payroll/mine`, `GET /payroll/mine/:month`, `GET /payroll/mine/:month/pdf` |
| Dashboard | `GET /dashboard?date=` |
| Reports | `GET /reports/{daily|monthly|employee|department|branch|late|absent|early-leave|overtime|leave|exceptions}?date|month|from&to&departmentId&branchId&employeeId`, `GET /reports/export?type=…&format=csv|xlsx|pdf` |
| Integrations | `POST /integrations/punches`, `GET/POST /integrations/keys`, `POST /integrations/keys/:id/revoke` |
| Audit | `GET /audit-logs?module&action&recordId&from&to&page` |
| Health | `GET /health` |
