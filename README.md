# Lucky Bitcoin

BTC/USDC leveraged trading simulator — Node.js/Express + PostgreSQL + React (Vite, Tailwind).
Full documentation: [DOCUMENTATION.md](DOCUMENTATION.md) (also served at `/documentation` in the app).

## Requirements

- Node.js 18+ (tested on 22)
- PostgreSQL 13+ running locally

## Quick start (one click, all in one)

- **Windows:** double-click `start.bat`
- **macOS / Linux:** `./start.sh`

It installs dependencies on first run, builds the web interface, starts the server and opens
**http://localhost:4000** in your browser. One window, one address: the backend serves the web app too.
Close the window (or press Ctrl+C) to stop. PostgreSQL must be running and `backend/.env` must contain your database password.

> After changing frontend code, run `start.bat` again (it rebuilds). For live-reload development use the manual steps below.

## Run on localhost (manual)

```bash
# 1. PostgreSQL: make sure the server is running and a user can create databases.
#    Default connection: postgres://postgres:postgres@localhost:5432/luckybitcoin
#    (the database itself is created automatically)

# 2. Backend
cd backend
cp .env.example .env        # edit DATABASE_URL / JWT_SECRET if needed
npm install
npm start                   # applies schema.sql + seeds fixtures, API on http://localhost:4000

# 3. Frontend (second terminal)
cd frontend
npm install
npm run dev                 # http://localhost:5173  (proxies /api to :4000)
```

Production-style single server: `cd frontend && npm run build`, then `npm start` in `backend/` serves
`frontend/dist` on http://localhost:4000.

## Test accounts

| Role | Email | Password |
|---|---|---|
| ADMIN | admin@luckybtc.ro | Admin123! |
| ANALYST | analyst@luckybtc.ro | Analyst123! |
| TRADER | trader@luckybtc.ro | Trader123! |

## Useful commands (in `backend/`)

| Command | What it does |
|---|---|
| `npm start` | migrate + seed + API |
| `npm run dev` | same, with auto-restart |
| `npm run loadtest` | autocannon load test (server must be running); `LT_CONNECTIONS=100 LT_DURATION=10 npm run loadtest` |

## The 9 academic requirements — where to find them

1. **Documentation** — `DOCUMENTATION.md` and `/documentation`
2. **Data model (8 tables)** — `backend/schema.sql`
3. **Fixtures** — `backend/src/seed.js` (runs on every start, only fills an empty DB)
4. **CRUD** — `backend/src/routes/*.js`, UI in Simulator, Session history and Data manager
5. **Authentication** — bcrypt (12 rounds) + JWT; explained live at `/security`
6. **Roles** — TRADER / ANALYST / ADMIN, enforced in Express middleware and the React UI
7. **Indexes** — Admin → DB Index Benchmark (`backend/src/benchmark.js`)
8. **Load test** — Admin → Run API Load Test, or `npm run loadtest`
9. **Reports** — PDF / CSV / Excel from Session history (`backend/src/routes/reports.js`)

## Notes

- Live mode needs internet access to Binance (REST + WebSocket). Without internet, Time Machine still works from the seeded candles (generated deterministically offline).
- Change `JWT_SECRET` in `backend/.env` before exposing the app beyond localhost.
