# Put QR Attendance on the internet (website + employee app)

This guide puts the system at `https://attendance.yourcompany.com`, with HTTPS, automatic restarts and nightly
database backups. The same address serves the admin dashboard (`/admin`) and the employee phone app (`/app`). A
set-up script does the server work; plan on about 30–45 minutes, most of it waiting for DNS and the first build.

**HTTPS is required.** Phones only allow the camera and GPS on secure (https) websites. Without it employees cannot
scan.

## What you need

| Item | Recommended |
|---|---|
| A VPS (server) | Ubuntu 24.04, 2 GB RAM, 1–2 vCPU, 40 GB SSD, about US$10–15/month. Pick a Singapore data centre (close to Cambodia): DigitalOcean, Vultr, AWS Lightsail or a Cambodian provider. When creating it, choose **Ubuntu 24.04** and a **root password**, and note the **IP address**. You can also use the server that already runs SMW; the script handles that. |
| A domain name | A sub-domain of a domain you already own is easiest, e.g. `attendance.camprotec.com.kh`. You need access to that domain's DNS settings (at the company that sold the domain, or Cloudflare). |
| Your PC | This project folder, **Windows Terminal** (built into Windows 11) and **WinSCP** (free) to copy files |

> **Choose the address before printing QR posters.** Every QR contains `https://<your domain>/scan/…`. If the domain
> changes later, the posters must be printed again.

## 1. Point the domain at the server

In your domain's DNS settings, add a record:

| Type | Name | Value |
|---|---|---|
| A | `attendance` (for `attendance.yourcompany.com`) | the VPS IP address |

DNS can take from a few minutes to a few hours. Check it from your PC with `ping attendance.yourcompany.com`. It must
show the VPS IP before you continue, or the HTTPS certificate cannot be issued.

## 2. Make the upload file (on your PC)

In the project folder, open a terminal and run:

```bash
npm run package
```

This creates `qr-attendance-deploy.zip` (about 0.3 MB): the source code, Dockerfile and settings templates. It
contains no `node_modules`, local database, demo data or passwords. The server builds everything itself.

## 3. Upload the file to the server

1. Install **WinSCP** on your PC (free, winscp.net). Open it, choose **SFTP**, type the server IP, user `root` and the
   password from your VPS provider, then click **Login**.
2. On the right (server) side, go to `/opt`. Create a folder **`qr-attendance`** (right-click → New → Directory) and
   open it.
3. Drag `qr-attendance-deploy.zip` from the project folder on the left into it.

## 4. Run the set-up script

Open **Windows Terminal** (or PowerShell) on your PC and log in to the server:

```bash
ssh root@YOUR-SERVER-IP
```

Type `yes` the first time, then the root password (nothing shows while you type; that is normal). On the server, run
these three commands:

```bash
apt update && apt install -y unzip
```
```bash
cd /opt/qr-attendance && unzip -o qr-attendance-deploy.zip
```
```bash
bash setup.sh
```

The script asks two questions:

| Question | Type |
|---|---|
| Web address for the system | `attendance.yourcompany.com` (your address from step 1) |
| Your email | the email you will sign in with |

It then does everything else by itself:
- installs Docker (if it is missing) and adds a swap file on small servers
- generates the database password, the token secret and your temporary admin password, and saves them in `.env`
- checks that your domain points to this server
- builds and starts PostgreSQL, the app, the nightly backup and the HTTPS proxy (first time: 3–6 minutes)
- checks that `https://your-address` works

At the end it prints:

```
QR Attendance is installed.

  Admin dashboard:  https://attendance.yourcompany.com/admin
  Employee app:     https://attendance.yourcompany.com/app
  First sign-in:    you@yourcompany.com
  Temporary password: Qa…7        (you must change it at first sign-in)
```

**Write down the temporary password.** It is also in `/opt/qr-attendance/.env` (`SUPERADMIN_PASSWORD`). Download a
copy of `.env` with WinSCP and keep it somewhere safe. It holds the keys to your database.

### On the server that already runs SMW

The script notices that SMW's Caddy already uses ports 80/443. It starts everything except its own HTTPS proxy, then
prints **ONE MORE STEP** with three small edits to SMW's files, already filled in with your address. Do them exactly as
printed. SMW keeps running; only its Caddy restarts for a second.

If the script says DNS is not ready or HTTPS is not answering yet, that is fine. Wait until `ping your-address` shows
the server IP; the certificate is then fetched automatically within a few minutes.

## 5. Check it works

Open `https://attendance.yourcompany.com/api/health` in your browser. It should show `{"ok":true,…}` with a padlock. On
the server, `docker compose ps` (in `/opt/qr-attendance`) should list `db`, `app`, `backup` (and `caddy`) as running.
If something is wrong:

```bash
cd /opt/qr-attendance && docker compose logs --tail 100 app
```

## 6. First set-up in the admin dashboard

1. Open `https://attendance.yourcompany.com/admin` and sign in with `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD`. Choose
   a new password when asked.
2. **Companies → New company**: name, company code (employees type it when signing in, e.g. `camprotec`), first admin
   email. Note the temporary password shown, then click **Open** to work inside the company. Alternatively, sign out and
   sign in as that company admin.
3. **Settings**: upload the logo, check the time zone (Asia/Phnom_Penh) and the attendance rules.
4. **Branches**: add each office. Paste the coordinates from Google Maps, or stand at the entrance and click **Use my
   current location**. Set the radius (100–150 m is typical).
5. **Work schedules** and **Holidays**.
6. **Employees**: add them one by one, or **Import CSV**. Each employee gets an employee ID and a temporary password.
7. **QR codes → Print**: print an A4 poster for each entrance (or the 10×15 cm stand size) and post it.
8. Give employees the app (next step).

## 7. The employee app on phones

The employee app is a **web app (PWA)**. It is installed from the website, so there is nothing to publish in an app
store. It opens full-screen with its own icon like a normal app, and updates by itself whenever you update the server.

Send employees this message, by Telegram for example:

> Open **https://attendance.yourcompany.com/app** on your phone. Sign in with company code **yourcode**, your employee ID
> and the temporary password from HR, then choose your own password.

Then they install it:

| Phone | Steps |
|---|---|
| **Android** (Chrome) | Open the link → tap **⋮** (top right) → **Install app** or **Add to Home screen** → **Install** (or tap the app's own **Install app** button) |
| **Samsung** (Samsung Internet) | Open the link → **☰** → **Add page to** → **Home screen** |
| **Huawei / Honor** (HarmonyOS or EMUI, Huawei Browser) | Open the link → **⋮** or **☰** → **Add to home screen** (or **Add to desktop**) |
| **iPhone** (Safari, not Chrome) | Open the link → tap the **Share** button (square with arrow) → **Add to Home Screen** → **Add** |

Supported: iPhone (iOS 15 or newer) with Safari, Chrome or Edge; Android 8 or newer with Chrome, Samsung Internet,
Edge, Firefox or the phone maker's browser (Xiaomi, OPPO, vivo...); and Huawei/Honor phones on HarmonyOS (including
HarmonyOS NEXT) or EMUI with Huawei Browser, even without Google services. Each employee can use any model. The admin's
**Phones** page shows each one's model, browser and OS version.

**Opened from Telegram, Facebook, LINE...?** Links tapped inside those apps open in the app's built-in browser, where the
camera, location and phone registration don't work reliably. The app detects this and tells the employee to open it in
their real browser (with a **Copy the link** button).

**Problems on one phone?** Ask the employee to open **Profile → Check my phone** and tap **Test location and camera**.
It checks the connection, phone key, registration, GPS and camera, shows the fix for that phone's OS and browser, and
can be sent to HR as a screenshot.

The first time they tap **SCAN QR**, the phone asks for **camera** and **location**. They must choose **Allow** (on
iPhone also keep **Precise Location** on). Their first scan also registers the phone as their attendance phone.

**Google Play / App Store (optional, later).** If you want the app listed in Google Play, the same web app can be
wrapped as an Android app (Trusted Web Activity) without rewriting it. You need a Google Play developer account ($25,
one-time). The Apple App Store needs a native wrapper and an Apple developer account ($99/year), and Apple often rejects
wrapped websites. Most companies simply use the installed web app on iPhones.

## 8. Selling online: website, free trial and payments

The public website (features, prices in English and Khmer, free-trial sign-up) is at `https://<DOMAIN>/`.
Customers who sign up get their own company and admin account, with a free trial.

**Show it on your main address (e.g. mysoftkh.com):**
1. At your domain registrar (GoDaddy): remove the parking page / forwarding, then set
   - an **A record** `@` → the server IP (e.g. 188.166.230.17)
   - a **CNAME** `www` → `mysoftkh.com` (or another A record to the same IP)
2. Wait until `ping mysoftkh.com` shows the server IP.
3. On the server: `nano /opt/qr-attendance/.env`, set `WEBSITE_DOMAINS=mysoftkh.com www.mysoftkh.com`, save, and run
   `bash setup.sh` again. (On the shared SMW server, add the same names to the `${DOMAIN}` line in /opt/smw/Caddyfile instead
   and run `cd /opt/smw && docker compose up -d caddy`.)

On those addresses only the website is shown: Sign in, Start free trial, /admin, /app and QR links go to
`https://<DOMAIN>` (logins and registered phones belong to one address), keeping the chosen language.

**Set prices and payments** (super admin → Plans & settings):
- Free-trial length (1–3 months), grace days, yearly discount and the price for each staff range.
- ABA and ACLEDA account name, number and KHQR image for bank transfers. You approve receipts in **Payments**.
- ABA PayWay: ask ABA (paywaysales@ababank.com) for a merchant account, enter the merchant ID and API key, give ABA the
  pushback URL shown on the page, test in sandbox, then turn sandbox off.
- Optional: Telegram bot token and chat ID to be told about each sign-up and payment.

**Branches per plan** (column *Branches* in the price list; empty = unlimited): 1–5 and 6–10 staff: 1 branch;
11–15 and 16–25: 2; 26–50 and 51–100: 10; bigger plans: unlimited. For one company, **Subscriptions → Adjust →
Branches allowed** sets a custom number or unlimited. Free-plan companies have no branch limit unless you set one.

Companies that existed before this version are marked **Free plan** and keep working as before. Change that in
**Subscriptions → Adjust**, where you can also give any company a longer trial or extra time.

## 9. Telegram Mini App for staff

Staff can open the attendance app inside Telegram, from your platform bot.
1. Super admin → **Plans & settings** → enter and save the **bot token** (from @BotFather).
2. Click **Set up the Mini App**. It points the bot at this server (webhook), adds the **Attendance** menu button and the
   /start command, in English and Khmer. All steps should show ✓.
3. Share the bot link (e.g. `https://t.me/Mysoftkhbot`). Staff press **Start**, then **Attendance**, sign in **once**
   with company code + employee ID; next time Telegram signs them in by itself.
4. Staff get messages: check-in/out receipts, leave / correction / overtime / phone decisions, payslip ready, and a
   reminder 1 hour after the end of work if they have not checked out. They can turn messages off in Profile.
Staff who use the browser app can connect Telegram in **Profile → Connect Telegram**.
Optional, in @BotFather: **Bot Settings → Configure Mini App → Enable** (adds an "Open" button on the bot profile).

## 10. Admin bot and admin Mini App

Admins, HR and managers use a **second bot** with its own phone app (`/manage`): today's numbers, live list,
one-tap approvals (phones, leave, corrections, overtime), staff search and history, and alert settings.
1. In @BotFather send `/newbot` and create the admin bot (e.g. *MySoft Attendance Admin*, `MysoftkhAdminBot`). Copy its token.
2. Super admin → **Plans & settings** → **Admin bot** card → paste the token → **Save plans & settings** at the bottom.
3. Click **Set up the Mini App** in the Admin bot card. All steps should show ✓ (menu button **Admin**).
4. Admins, HR and managers open the admin bot, press **Start** → **Admin**, and sign in once with their email or phone.
   Staff accounts are refused there (they use the staff bot).
5. Alerts (each person chooses in **More → Telegram alerts**): new requests to approve, morning summary (time set by the
   company admin, default 09:00), late check-ins and the "not checked in yet" list (30 min after the late time), and
   refused scans. Managers only get alerts about their own departments.

**Telegram groups (per company).** In **Settings → Telegram groups** a company admin or HR presses **Connect a Telegram
group**: Telegram opens, they pick their group, the bot joins and the group is linked (the admin bot when it is set up,
otherwise the staff bot). The group then gets check-ins, check-outs, leave requests and fix-scan requests; each group
chooses which of the four, Khmer / English / both, and all branches or one branch. Once after updating to this version:
1. Super admin → **Plans & settings** → press **Set up the Mini App** again on each bot card, so the bot is also told when it
   is removed from a group.
2. In @BotFather: `/setjoingroups` → choose the bot → **Enable** (on by default).

## 11. Public demo for customers

A separate copy of the app on the same server lets customers look inside before they sign up. It has its own database
(`qr_demo`, in the same PostgreSQL) with one company, **Demo Company Co., Ltd.**, and about 6 months of sample data:
120 employees, 3 branches, attendance since the 1st of the month 6 months ago, leave, corrections, overtime, rejected
scans, and payroll (older months paid, last month approved, this month a draft). Real customers are never affected.

| Address | What it shows |
|---|---|
| `https://demo.attendance.mysoftkh.com/admin` | Dashboard. Sign in as **DemoCompany**, password **democompany123456** |
| `https://demo.attendance.mysoftkh.com/app` | Staff app. Company code **DemoCompany**, employee **E0001**, same password |
| `https://demo.mysoftkh.com`, `https://www.demo.mysoftkh.com` | The website with a bar showing the demo sign-in |

HR (`hr@demo.mysoftkh.com`) and a department manager (`manager@demo.mysoftkh.com`) use the same password.

1. At your DNS provider add three **A** records pointing to the server (188.166.230.17):
   `demo.attendance`, `demo` and `www.demo` (for the domain mysoftkh.com).
2. Upload the new zip and run `bash setup.sh`. It asks once:
   - *Demo address*: `demo.attendance.mysoftkh.com`
   - *Demo website addresses*: `demo.mysoftkh.com www.demo.mysoftkh.com`

   It saves them in `.env` (`DEMO_DOMAIN`, `DEMO_WEBSITE_DOMAINS`, `DEMO_JWT_SECRET`, `COMPOSE_PROFILES=demo`), starts the
   `demo` container and gets the HTTPS certificates. Demo addresses must start with `demo.` or `www.demo.`.

How the demo behaves:
- Every night at 03:00 (Phnom Penh) the demo data is rebuilt from scratch with dates up to that day, so what visitors
  change (approvals, new employees, check-ins) is gone the next morning.
- The staff app works from anywhere: GPS area and phone approval are off, and the check-in button is on.
- Visitors cannot change passwords, the shared sign-ins, employee E0001, the company code or attendance rules, and cannot
  sign up, pay, connect Telegram or make API keys there. Wrong passwords never lock the shared sign-ins.
- "Start free trial" buttons on the demo go to the real website (`MAIN_SITE_URL`, default https://www.mysoftkh.com).
- Other password: set `DEMO_PASSWORD=...` in `.env`, then `docker compose up -d demo` (applies at the next rebuild;
  to rebuild now: `docker compose exec -T db psql -U qr_attendance -c "DROP DATABASE qr_demo WITH (FORCE)" && docker compose restart demo`).
- Logs: `docker compose logs -f demo`. To switch the demo off: empty `DEMO_DOMAIN=` in `.env`, run `bash setup.sh`, then
  `docker compose rm -sf demo`.

## Updating to a new version

On your PC run `npm run package` again and upload the new zip with WinSCP (replace the old one). Then on the server:

```bash
cd /opt/qr-attendance && unzip -o qr-attendance-deploy.zip && bash setup.sh
```

The script keeps your `.env`, `data` and `backups`, rebuilds, and restarts. Database changes are applied
automatically. Employees' phones pick up the new version the next time they open the app.

## Backups

- Every night at 01:00 Cambodia time (and once each time the stack starts), the `backup` container writes
  `/opt/qr-attendance/backups/qr_attendance-YYYY-MM-DD.dump`. Backups older than `BACKUP_DAYS` days are deleted.
- **Copy backups off the server** regularly (WinSCP, or your VPS provider's snapshot feature). A backup that only exists
  on the same server does not protect you if the server is lost.
- Also keep a copy of `.env` (especially `JWT_SECRET` and `DB_PASSWORD`) and the `data` folder (logos and photos).

To restore a backup into the running database (this **replaces** the current data):

```bash
cd /opt/qr-attendance && docker compose stop app
```
```bash
docker compose exec -T db pg_restore -U qr_attendance -d qr_attendance --clean --if-exists --no-owner --no-privileges < backups/qr_attendance-2026-10-06.dump
```
```bash
docker compose start app
```

## Useful commands

| What | Command (in `/opt/qr-attendance`) |
|---|---|
| Status | `docker compose ps` |
| App logs (live) | `docker compose logs -f app` |
| Restart the app | `docker compose restart app` |
| Stop everything | `docker compose down` (data is kept) |
| Make a backup now | `docker compose restart backup` |

## Troubleshooting

| Problem | Cause and fix |
|---|---|
| Browser shows a certificate error or "connection refused" | DNS doesn't point to the server yet, or ports 80/443 are closed. Check `ping`, `ufw status`, then `docker compose logs caddy` (option A) or SMW's Caddy logs (option B). |
| `https://…/api/health` gives 502 | The app is still starting or failed. Check `docker compose logs app`. A wrong `DB_PASSWORD` after the first start is a common cause: the database keeps the password it was created with. |
| Employees get "Location needed" / the camera doesn't open | The page isn't on https, or the phone blocked location/camera for the site. The app shows step-by-step help. |
| Everyone is "outside the attendance area" | The branch point is wrong. Check it on the map in **Branches**, or raise the radius. |
| Logo upload fails | `data` isn't writable. Run `chown -R 1000:1000 /opt/qr-attendance/data`. |
| Map in Branches shows "Access blocked" | Make sure you are on the latest version (the fix that sends the Referer to OpenStreetMap). |

## Appendix: manual set-up (what setup.sh does)

Only needed if you prefer to do each step yourself instead of running `setup.sh`.

### A. Prepare the server

Log in with SSH as root (or a sudo user). On a **new** server run:

```bash
apt update && apt upgrade -y && apt install -y unzip
```

```bash
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
```

```bash
curl -fsSL https://get.docker.com | sh
```

On the **SMW server** Docker and the firewall are already set up; only run `apt install -y unzip`.

### B. Copy the files

```bash
mkdir -p /opt/qr-attendance
```

With WinSCP, upload `qr-attendance-deploy.zip` to `/opt/qr-attendance`. Then on the server:

```bash
cd /opt/qr-attendance && unzip -o qr-attendance-deploy.zip && mkdir -p data backups && chown -R 1000:1000 data
```

(The app runs as user id 1000 inside its container and needs to write logos and photos to `data`.)

### C. Settings

```bash
cp .env.example .env && nano .env
```

| Setting | Example | What it is |
|---|---|---|
| `DOMAIN` | `attendance.yourcompany.com` | The address, without `https://` |
| `DB_PASSWORD` | output of `openssl rand -hex 32` | Database password (never typed by people) |
| `JWT_SECRET` | output of `openssl rand -hex 32` | Signs log-in tokens. Keep it secret. Changing it signs everyone out. |
| `SUPERADMIN_EMAIL` | `you@yourcompany.com` | Your platform log-in |
| `SUPERADMIN_PASSWORD` | a temporary password | Used on the very first start only; you must change it at first sign-in |
| `BACKUP_DAYS` | `14` | Days of nightly backups to keep |

Make the two random values with `openssl rand -hex 32` (run it twice and paste each result). Save with Ctrl+O, Enter,
Ctrl+X.

### D. Start

#### Option A: a server with nothing else on it

```bash
docker compose up -d --build
```

The first build takes 3–5 minutes. Caddy gets the HTTPS certificate on the first visit.

#### Option B: the same server as SMW

SMW's Caddy already uses ports 80 and 443, so start everything except this project's Caddy:

```bash
docker compose up -d --build db app backup
```

Then let SMW's Caddy also serve the attendance domain.

1. In `/opt/smw/docker-compose.yml`, connect the `caddy` service to this app's network. Add `networks` under the
   `caddy:` service, and a top-level `networks:` block at the end of the file:

   ```yaml
     caddy:
       # ...everything that is already there...
       networks: [default, qr-attendance]

   networks:
     qr-attendance:
       external: true
   ```

2. At the end of `/opt/smw/Caddyfile`, add (with your real domain):

   ```
   attendance.yourcompany.com {
   	encode gzip
   	header -Server
   	reverse_proxy qr-attendance-app:3200
   }
   ```

3. Restart SMW's Caddy:

   ```bash
   cd /opt/smw && docker compose up -d caddy
   ```

   SMW keeps running; only Caddy restarts, which takes a second.

### E. Check it works

```bash
cd /opt/qr-attendance && docker compose ps
```

`db`, `app` and `backup` (and `caddy` in option A) should be **running** / **healthy**. Then open
`https://attendance.yourcompany.com/api/health` in a browser. It should show `{"ok":true,…}` with a padlock.

If something is wrong, look at the logs:

```bash
docker compose logs --tail 100 app
```

## Moving your local test data (optional)

Usually you start fresh on the server, and the demo company stays on your PC. If you set up real branches and employees
on your PC and want to keep them, make a dump on the PC. Start `start.bat`, then in another terminal in the project
folder run:

```bash
node -e "require('child_process').execFileSync('node_modules/@embedded-postgres/windows-x64/native/bin/pg_dump.exe',['-Fc','-h','127.0.0.1','-p','54330','-U','postgres','-f','local.dump','qr_attendance'],{stdio:'inherit',env:{...process.env,PGPASSWORD:'postgres'}})"
```

Upload `local.dump` to `/opt/qr-attendance/backups/` and restore it as shown in **Backups**. The demo accounts come
along too; disable or delete the demo company afterwards.
