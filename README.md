# Ledger

A single-user personal money manager for LKR, built as an installable iPhone PWA.

Every salary cycle, Ledger shows:

- where your money went, compared with last cycle;
- which bills are still unpaid;
- **safe to spend**: what is left after bills and planned savings.

It also helps you decide what to cut, through budgets, an affordability simulator, a forecast, goals and recommendations.

| Layer | Stack |
| --- | --- |
| API | Python 3.12, FastAPI, Pydantic v2, Beanie/Motor on MongoDB 7 (Atlas or self-hosted), Gunicorn + Uvicorn workers |
| Auth | Argon2id passwords, TOTP 2FA (pyotp, Fernet-encrypted secret), JWT access + rotating refresh tokens in HttpOnly cookies, CSRF double-submit, slowapi |
| Web | React 18 + TypeScript + Vite, Tailwind, TanStack Query, Zustand, React Router, Framer Motion, Radix Dialog, ECharts, Lucide |
| Deploy | Docker Compose: `caddy` (HTTPS) → `web` (Nginx: static build + `/api` proxy) → `api` → MongoDB Atlas (or an optional local `mongo` container) |

```
ledger/
  backend/   app/ (main, config, cli, core/, models/, schemas/, routers/, services/), tests/
  frontend/  src/ (app/, features/, components/, lib/, styles/), public/ (icons, splash), e2e/
  deploy/    Caddyfile, nginx.conf, security-headers.conf, mongo-init.js, backup.sh
  docker-compose.yml  .env.example
```

---

## 1. Database: MongoDB Atlas

The app connects with `MONGO_URL` from `.env`. For Atlas (Cluster0) you need to set up three things.

**1. Create a dedicated database user** under **Database Access → Add New Database User**:

- authentication: Password;
- username: for example `ledger_app`;
- privileges: **Specific Privileges → `readWrite` on database `ledger`**, with the collection left blank.

Don't use an admin or "Atlas admin" user for the app. If the server were ever compromised, a least-privilege user limits the damage to this one database.

**2. Allow only your VPS** under **Network Access → Add IP Address**:

- add your VPS's public IP;
- avoid `0.0.0.0/0`;
- to run the backend from your PC during development, add your home IP too.

**3. Set the connection string** in `.env`:

```
MONGO_URL=mongodb+srv://ledger_app:<db_password>@cluster0.17mul.mongodb.net/ledger?retryWrites=true&w=majority&appName=Cluster0
MONGO_DB=ledger
```

Replace `<db_password>`, URL-encoding special characters (`@` → `%40`, `:` → `%3A`, `/` → `%2F`, `#` → `%23`). Never paste the password into chats, tickets or git.

Check the connection without printing any secret:

```sh
docker compose run --rm api python -m app.cli check-db
# ✓ Connected to cluster0.17mul.mongodb.net (MongoDB 7.x), ping=1.0
# ✓ Read/write OK on database 'ledger'
```

Login rate-limit counters are stored in the same database in production, so limits hold across Gunicorn workers.

**Self-hosting instead:** set `COMPOSE_PROFILES=local-db` and the local Mongo variables in `.env` (see `.env.example`). Compose then starts a `mongo` container on an internal-only network, with authentication on and a `readWrite` app user created by `deploy/mongo-init.js`.

## 2. Deploy on a VPS

A server with 1 vCPU and 1 GB RAM is enough. You need Docker with the Compose plugin, and a domain with an `A` record pointing at the server.

```sh
git clone <your repo> /opt/ledger && cd /opt/ledger
cp .env.example .env
```

Fill in `.env`:

- `DOMAIN`, `ACME_EMAIL`, `MONGO_URL`;
- `JWT_SECRET`: `python3 -c "import secrets; print(secrets.token_urlsafe(48))"`;
- `TOTP_ENC_KEY`: `python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`.

> Keep `TOTP_ENC_KEY` safe and backed up. Without it, the stored 2FA secret can't be decrypted.

```sh
docker compose up -d --build
docker compose run --rm api python -m app.cli check-db
docker compose ps
```

Caddy fetches the HTTPS certificate on first request and redirects HTTP to HTTPS.

The API container is read-only, non-root and `no-new-privileges`. It has outbound internet access, which it needs to reach Atlas, but no published ports.

## 3. Create your user and set up Google Authenticator

```sh
docker compose exec -it api python -m app.cli create-user --username oshith
```

The command does the following:

1. Prompts for a password. It must be at least 12 characters, not a common password, and must not contain the username.
2. Prints a **terminal QR code** and an `otpauth://` URI.
3. Prints **10 one-time recovery codes**. Store them offline.

In Google Authenticator, tap **+** → **Scan a QR code**. If your terminal font distorts the QR, choose **Enter a setup key** and use the `secret=` value instead. A second user is refused.

## 4. Install on iPhone

1. Open `https://<your domain>` in **Safari**.
2. Sign in, then **Share** → **Add to Home Screen**.
3. On first launch, Ledger asks for your monthly salary, the **date of your most recent salary**, and your salary day (default 5). That date starts your first cycle.

## 5. Salary cycles

**A cycle runs from salary day 00:00 to the day before the next salary day, 23:59 (Asia/Colombo).** With salary day 5, "Nov 2026" is 5 Nov to 4 Dec. Salary days 29–31 use the last day of shorter months, so day 31 gives 31 Jan to 27 Feb, then 28 Feb to 30 Mar.

- **Attribution.** Every income entry, bill payment and expense goes to the cycle that contains **its own date**: the date you pick, not when you typed it.
  - The server computes and stores `cycle`. The client never sends one.
  - With salary day 5, an electricity bill paid on 2 Nov or an ATM withdrawal on 4 Nov comes out of the **October** salary. In November that bill shows as **pending** again.
  - Every date picker shows a live **"From Oct salary" / "From Nov salary"** chip, from `GET /cycles/resolve`.
  - Editing a date re-assigns the cycle.
- **Stored boundaries.** Cycles live in the `cycles` collection (`label`, `start_date`, `end_date`, `salary_amount`, `is_override`, `closed`). Every query and comparison uses these stored dates, so history never shifts.
- **Salary amount.** Changing it in **Settings → Income & Cycle** applies from the current cycle onward (`salary_history`). Closed cycles keep their amount.
- **Salary day.** Changing it affects only the current and future cycles. The current cycle keeps its start and gets a new end. Before saving, the app previews *"N entries will move from Dec 2026 cycle to Nov 2026 cycle"* with the list, and asks you to confirm.
- **Early or late salary.** If you mark the salary received on another date, for example the 4th because the 5th is a Sunday, the app asks *"Start November cycle on 4 Nov?"* If you agree, it stores a start override and re-assigns entries in the gap.

## 6. Dashboard

The sticky header holds the cycle switcher and the comparison selector: **vs last cycle**, **vs 3-cycle avg** or **vs same cycle last year**. For the current cycle, every comparison is cut at the same elapsed day ("vs Oct 2026, same day 8").

There are five swipeable tabs. Each loads lazily and prefetches its neighbours.

| Tab | Contents |
| --- | --- |
| **Overview** | Safe to spend (balance − pending bills − goal reserves), daily allowance, cycle-elapsed vs income-spent bars, Money Health score (0–100) with its drivers and change vs last cycle, 8 KPI cards with 6-cycle sparklines, cash-flow waterfall (sums exactly to income − spent), alerts strip |
| **Spending** | Donut (% of spending or % of income), sortable category table (amount, shares, change, sparkline, budget used), Bank & Cash by reason, method and a reason × method heat table, biggest movers, weekday, weekend and half-cycle patterns, daily heatmap, transaction sizes, top 10 expenses, frequency stats |
| **Bills** | Paid/pending, 12-cycle amount trend per bill (flags > 10% above the 6-cycle average), fixed-cost ratio vs a 50% target, usual payment day, annual cost per bill, planned vs actual |
| **Trends** | 12-cycle income/spend/savings with savings-rate line, category mix area, pace vs last cycle and 3-cycle average, cumulative savings, cycle-by-cycle table, best/worst cycles, year to date ("Trends unlock after 2 cycles") |
| **Plan** | Budgets per category or Bank & Cash reason (on track, near limit ≥ 80%, over; pace marker), "Can I afford it?" simulator (read-only), low/likely/high forecast cone, savings goals (required per cycle, on track, ETA), recommendations, 50/30/20 check with Need/Want tags from Settings |

Tapping a card, chart element, heatmap day or legend row opens the underlying entries. Every chart has a one-line plain-English takeaway. A category with no history shows **New** instead of an infinite percentage.

**Insights engine** (`services/insights.py`): a pure, unit-tested function producing ranked `{type, severity, title, detail, metric, delta_pct, delta_abs, action_link}` objects.

- Types: `overspend`, `budget_warning`, `anomaly` (more than 2× the category's average entry, or more than 2 standard deviations), `trend` (3 cycles rising or falling), `bill_increase`, `pace_warning`, `goal_progress`, `positive_win`, `bills_pending`.
- At least one positive insight is always included when one exists.

## 7. API

All endpoints are under `/api/v1`. Every amount is in **integer cents**.

| Area | Endpoints |
| --- | --- |
| Auth | `GET /auth/csrf`, `POST /auth/login`, `/auth/verify-2fa`, `/auth/refresh`, `/auth/lock`, `/auth/unlock`, `/auth/logout`, `/auth/logout-all`, `GET /auth/me` |
| Security | `POST /security/change-password`, `/security/reset-2fa` (+`/confirm`), `/security/recovery-codes`, `GET /security/activity` |
| Salary & cycles | `GET/PATCH /settings/salary`, `POST /settings/salary/preview`, `GET /cycles`, `GET /cycles/resolve?date=`, `POST /cycles/{label}/override-start`, `POST /settings/onboarding` |
| Income | `GET/POST /income`, `PATCH/DELETE /income/{id}`, `POST /income/{id}/restore`, `GET/POST/PATCH /income-sources` |
| Bills | `GET /fixed-expenses?cycle=`, `POST /fixed-expenses/{id}/pay`, `DELETE /fixed-payments/{id}` (+`/restore`), `GET/POST/PATCH /settings/fixed-expenses` (+`/reorder`) |
| Spending | `GET/POST /expenses`, `PATCH/DELETE /expenses/{id}` (+`/restore`), `GET /spending/summary`, `GET/POST/PATCH /categories`, `GET/POST/PATCH /reasons` |
| Analytics | `GET /analytics/overview?cycle=&compare=`, `/analytics/spending?cycle=&compare=`, `/analytics/bills?cycle=&months=12`, `/analytics/trends?months=12`, `/analytics/plan?cycle=`, `/analytics/insights`, `POST /analytics/simulate` |
| Planning | `GET/POST/PATCH/DELETE /budgets` (+`/restore`), `GET/POST/PATCH/DELETE /goals` (+`/restore`) |
| Data | `GET /export/csv`, `GET /export/json`, `POST /import/json` |
| Settings | `GET/PATCH /settings` |

How analytics are computed:

- Three MongoDB aggregation pipelines group each tab's cycles into compact buckets: cycle × day × category × reason × method for spending, cycle × day × bill for payments, and cycle × day × source for income.
- All metrics are derived from those buckets, so each tab costs 3–5 small queries.
- Results are cached per cycle and comparison mode. Any write bumps a version counter in Mongo, which invalidates the cache across workers. The simulator and salary preview are read-only and don't invalidate it.

OpenAPI docs (`/api/v1/docs`) are served only when `ENV` is not `production`.

## 8. Backups and restore

`deploy/backup.sh` works with Atlas (using `mongodump --uri` in a throwaway `mongo:7` container) and with the local profile. It keeps 14 days of backups.

```sh
chmod +x /opt/ledger/deploy/backup.sh
crontab -e
15 2 * * * /opt/ledger/deploy/backup.sh >> /var/log/ledger-backup.log 2>&1
```

Restore to Atlas (this replaces the data):

```sh
set -a; . ./.env; set +a
docker run --rm -i -e MONGO_URL mongo:7.0 sh -c 'mongorestore --uri "$MONGO_URL" --drop --archive --gzip' < backups/ledger-YYYYMMDD-HHMMSS.archive.gz
```

**Settings → Data** also offers a CSV export, a JSON backup (including cycles, budgets and goals) and JSON import. The Atlas free tier has no automatic backups, so keep the cron job.

## 9. Local development

```sh
cd backend
python3.12 -m venv .venv && . .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
cp ../.env .env    # set ENV=development and COOKIE_SECURE=false for http://localhost
python -m app.cli check-db
python -m app.cli create-user --username me
uvicorn app.main:app --reload --port 8000

cd ../frontend && npm install && npm run dev                 # http://localhost:5173 (proxies /api)
```

## 10. Tests

```sh
cd backend && pytest       # 106 tests, including salary-cycle acceptance, analytics tabs, insight types
cd frontend && npm test    # Vitest: money maths, keypad, OTP, optimistic Safe-to-spend updates
cd frontend && npm run build && npx playwright install webkit && npm run e2e
```

The Playwright run screenshots every screen and all five dashboard tabs at iPhone 16, iPhone 7 Plus and iPhone SE sizes. Screenshots go to `frontend/e2e/screenshots/`.

The run also asserts layout:

- no horizontal page scroll (wide tables scroll inside their card);
- the header clears the status bar and Dynamic Island;
- the tab bar clears the home indicator;
- touch targets are 44 pt or larger.

The API is mocked with fixtures that `e2e/make_fixtures.py` builds by running the real backend over seven cycles of data.

---

## Security model

| Threat | Control |
| --- | --- |
| Password guessing | Argon2id (t=3, m=64 MB); 5 logins / 15 min per IP; account locks 30 min after 10 failures in an hour; same error for bad user or bad password |
| Stolen password | Login only issues a 5-minute pre-auth token; a TOTP or one-time recovery code is required; 5 wrong codes kill the pre-auth token |
| TOTP replay | ±1 step accepted; `last_totp_step` refuses any step already used |
| Session theft | Access JWT (15 min) + refresh token (7 days) in `HttpOnly; Secure; SameSite=Strict` cookies; refresh rotates and is stored as SHA-256; reuse of a rotated token revokes the whole session family; logout and logout-all are immediate |
| CSRF | Double-submit cookie + `X-CSRF-Token` header on every state-changing request |
| Unattended phone | Auto-lock after 10 idle minutes, enforced client-side and server-side; unlocking needs only the 2FA code |
| XSS / framing | Strict CSP (`script-src 'self'`, no inline scripts), `X-Frame-Options: DENY`, HSTS, `Referrer-Policy: no-referrer`, minimal `Permissions-Policy` |
| Secrets | TOTP secret encrypted with Fernet and never returned by the API; recovery codes Argon2-hashed; all secrets in `.env` (git-ignored); `check-db` never prints the URI |
| Data exposure | Least-privilege `readWrite@ledger` database user; Atlas IP allowlist (or an internal-only network for local Mongo); read-only, non-root API container |

## Not included

**Web Push reminders for pending bills.** The original brief marks these optional and they weren't built. Pending bills appear in the alerts strip, the Bills tab and the end-of-cycle highlight instead.
