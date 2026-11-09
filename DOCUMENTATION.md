<!-- LANG:RO -->
# Lucky Bitcoin — Documentație

Lucky Bitcoin este un simulator de tranzacționare BTC/USDC cu levier (1x–10x), rulat local: **React + Vite + Tailwind** în frontend, **Node.js + Express** în backend și **PostgreSQL** ca unic SGBD.

## 1. Domeniul temei

**Perechea BTC/USDC.** Se tranzacționează Bitcoin contra USDC (stablecoin legat de dolar). Prețul se exprimă în USDC pentru 1 BTC.

**Long / Short.** *Long* câștigă când prețul crește; *Short* câștigă când prețul scade.

**Levier (leverage).** Cu marjă *M* și levier *L*, poziția are valoare nominală *M × L* și cantitate *(M × L) / preț_intrare* BTC. PnL-ul nerealizat este `(preț − intrare) × cantitate` (inversat la Short); ROE% = PnL / marjă.

**Lichidare.** Dacă prețul atinge pragul de lichidare, poziția se închide automat (`LIQUIDATED`) și marja se pierde. Formula folosită (rată de marjă de mentenanță 0,4%):

- Long: `intrare × (1 − 1/L + 0,004)`
- Short: `intrare × (1 + 1/L − 0,004)`

**Comisioane (structură Binance Futures).** Calculate la valoarea nominală, la deschidere *și* la închidere:

| Tip ordin | Rol | Comision |
|---|---|---|
| Limit | Maker | 0,02% |
| Market, Stop-Loss, Take-Profit, închidere manuală | Taker | 0,05% |

**Tipuri de ordine.** *Market* (execuție imediată la prețul curent), *Limit* (se execută automat când prețul atinge limita; Long sub preț, Short peste preț), plus *Stop-Loss* și *Take-Profit* atașabile la plasare sau editabile ulterior. Se declanșează pe High/Low-ul lumânării.

**Sesiuni.** Orice tranzacționare se face într-o sesiune cu sold de start de 10, 100 sau 1000 USDC, în modul Live sau Time Machine. Butonul „Sesiune nouă” închide pozițiile la prețul curent, generează și salvează recenzia de trader, arhivează sesiunea și deschide ecranul de selecție.

**Live vs Time Machine.**

- **Live:** istoric recent prin REST Binance și actualizări prin `wss://stream.binance.com:9443/ws/btcusdc@kline_<tf>`. Fast-forward este dezactivat.
- **Time Machine:** alegi un moment *T0* din trecut. Graficul conține strict lumânările până la *T0* (**anti-lookahead**); lumânările viitoare rămân pe server și sunt livrate doar pe măsură ce timpul simulat avansează. Controale: Play/Pauză, Next Candle și viteze x1, x2, x5, x10, x25, x50, x100. La fiecare minut simulat motorul verifică High/Low/Close pentru Limit, SL, TP și lichidare, deci nimic nu este „sărit” la viteze mari.

**Recenzia de trader.** Algoritmul calculează scor 0–100 și notă (S, A, B, C, D, F), arhetip (Sniper Disciplinat, Jucător cu Levier Mare, Scalper Impulsiv, Strateg Averse la Risc, Revenge Trader, Oportunist Echilibrat, Observator) și metrici: win rate, profit factor, risc/recompensă mediu, utilizare Stop-Loss, levier mediu, impact comisioane (fee bleed), drawdown maxim și durata medie. Diagnosticul narativ este generat în RO și EN.

## 2. Pagini și componente

| Pagină / rută | Roluri | Descriere |
|---|---|---|
| `/login` | public | Autentificare și înregistrare; conturile de test sunt afișate pentru completare rapidă. |
| `/` Simulator | TRADER, ADMIN | Ecranul de start (mod, dată Time Machine, evenimente istorice, butoanele $10/$100/$1000), apoi ecranul de tranzacționare. |
| `/history` Istoric sesiuni | toți | Tabel cu sold de start/final, PnL $/%, trade-uri, comisioane, scor și arhetip; redenumire/notițe, ștergere, deschidere recenzie, export PDF/CSV/Excel. Staff-ul vede toți traderii și un tabel agregat. |
| `/data` Gestiune date | ANALYST, ADMIN | CRUD vizual pe tabele, conform rolului. |
| `/admin` Admin | ADMIN | DB Index Benchmark, API Load Test și jurnalul de audit. |
| `/security` | toți | Explicație live: hash bcrypt din DB, payload JWT, expirare, flux de verificare, matricea RBAC. |
| `/documentation` | public | Acest document. |

**Componente principale:** `Navbar` (logo, meniu, comutator RO/EN), `Chart` (lightweight-charts: lumânări + volum + linii Entry/SL/TP/Limit/Lichidare), `OrderPanel` (Market/Limit, slider levier 1–10x, calcule live de marjă, notional, comision și preț de lichidare), `TimeMachineBar` (Play/Pauză/Next/viteze), `Tables` (poziții deschise, ordine în așteptare, istoric poziții și ordine; SL/TP/Limit editabile pe loc), `ReviewDrawer` (panou lateral retractabil, recalculabil oricând), `ReviewView` (scor, metrici, diagnostic, notițe), `Common` (Modal, Pager, butoane de export).

## 3. Modelul de date (8 tabele)

```
roles ─┐
       └< users ─┬< trading_sessions ─┬< orders ──< positions (order_id, SET NULL)
                 │                    ├< positions
                 │                    └─ trader_reviews (1:1 cu sesiunea)
                 ├< trader_reviews
                 └< audit_logs (SET NULL)
historical_candles (independentă; UNIQUE symbol+timeframe+open_time)
```

| Tabel | Constrângeri importante |
|---|---|
| `roles` | `name` UNIQUE, `permissions` JSONB |
| `users` | `username`, `email` UNIQUE; `role_id` FK RESTRICT; `preferred_lang` CHECK ('ro','en') |
| `trading_sessions` | FK `user_id` CASCADE; `mode` CHECK; `initial_balance` CHECK IN (10,100,1000); `status` CHECK |
| `orders` | FK `session_id` CASCADE; `leverage` CHECK 1–10; `side`, `order_type`, `status` CHECK; Limit cere `limit_price` |
| `positions` | FK `session_id` CASCADE, `order_id` SET NULL; `status` CHECK (OPEN/CLOSED/LIQUIDATED) |
| `trader_reviews` | `session_id` UNIQUE FK CASCADE; `score` CHECK 0–100 |
| `historical_candles` | UNIQUE (symbol, timeframe, open_time); CHECK high ≥ low |
| `audit_logs` | FK `user_id` SET NULL; `payload_json` JSONB |

Schema completă: `backend/schema.sql` (aplicată automat, idempotent, la pornire).

## 4. Fixtures

La `npm start`, serverul creează baza de date dacă lipsește, aplică schema și, dacă baza este goală, inserează: cele 3 roluri, 3 conturi de test, minimum 5.000 de lumânări BTC/USDC (descărcate din Binance REST sau, offline, generate determinist și agregate pe 1m/5m/15m/1h/4h/1d), plus sesiuni istorice închise cu ordine, poziții și recenzii.

| Rol | Email | Parolă |
|---|---|---|
| ADMIN | admin@luckybtc.ro | Admin123! |
| ANALYST | analyst@luckybtc.ro | Analyst123! |
| TRADER | trader@luckybtc.ro | Trader123! |

## 5. CRUD

Rute REST (toate cer autentificare; drepturile sunt verificate pe server):

| Entitate | Rute |
|---|---|
| Sesiuni | `POST/GET /api/sessions`, `GET/PUT/DELETE /api/sessions/:id` |
| Ordine | `POST /api/sessions/:id/orders`, `PUT/DELETE .../orders/:oid` |
| Poziții | `PUT/DELETE /api/sessions/:id/positions/:pid`, `POST .../positions/:pid/close` |
| Recenzii | `POST/GET /api/sessions/:id/review`, `GET/PUT/DELETE /api/reviews/:id` |
| Toate cele 8 tabele | `GET/POST /api/data/:table`, `GET/PUT/PATCH/DELETE /api/data/:table/:id` |

## 6. Autentificare

- **Parole:** `bcryptjs`, 12 salt rounds. În baza de date se păstrează doar hash-ul (`$2a$12$<salt 22><digest 31>`).
- **Sesiune:** JWT HS256 (valabil 8 ore) în cookie HttpOnly, SameSite=Lax; middleware-ul `authenticate` verifică semnătura, expirarea și existența utilizatorului.
- Pagina **Securitate & Autentificare** arată în timp real hash-ul tău, parametrii bcrypt, o verificare de parolă, demo-ul de salt, payload-ul JWT decodat și timpul rămas.

## 7. Roluri (RBAC)

| Capabilitate | TRADER | ANALYST | ADMIN |
|---|:-:|:-:|:-:|
| Simulator, sesiuni/ordine/poziții proprii, recenzii proprii | ✔ | — | ✔ |
| Vede sesiunile și statisticile tuturor | — | ✔ | ✔ |
| Editează `mentor_notes` pe recenzii | — | ✔ | ✔ |
| CRUD lumânări istorice | — | ✔ | ✔ |
| CRUD pe toate cele 8 tabele | — | — | ✔ |
| Benchmark indecși, Load Test, audit log | — | — | ✔ |

## 8. Indecși și benchmark

Indecșii ceruți: `idx_candles_lookup (symbol, timeframe, open_time)` și `idx_positions_session_status (session_id, status, closed_at)`. În **Admin → DB Index Benchmark**, butonul rulează într-o tranzacție: `DROP INDEX IF EXISTS` (și eliminarea constrângerii UNIQUE care ar crea un index implicit), `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` **înainte**, `CREATE INDEX`, apoi **după**, și afișează tipul de scan, timpul, costul, buffers și procentul de accelerare. La final tranzacția este anulată (ROLLBACK), deci schema rămâne neschimbată. Interogările: (1) lumânări Time Machine pe interval de timp; (2) agregarea PnL-ului pe sesiune.

## 9. Load test

`npm run loadtest` (din `backend/`, cu serverul pornit) sau butonul „Run API Load Test” din Admin. Folosește `autocannon` cu 50–100 de conexiuni concurente pe: cotații (`GET /api/market/price`), istoric sesiuni (`GET /api/sessions`) și plasare ordine (`POST /api/sessions/:id/orders`), pe o sesiune temporară care se șterge la final. Raportează RPS, latență (avg, min, max, p50, p95, p99), throughput MB/s și rata de succes 2xx.

## 10. Rapoarte

Export real din PostgreSQL în **PDF** (cu antet Lucky Bitcoin, tabele și profilul de trader), **CSV** și **Excel (.xlsx)**: `GET /api/reports/session|history|aggregate?format=pdf|csv|xlsx&lang=ro|en`. Disponibile în Istoric sesiuni și în panoul de analiză; raportul agregat este rezervat rolurilor ANALYST/ADMIN.

## 11. Internaționalizare

Comutatorul RO 🇷🇴 | EN 🇬🇧 din Navbar schimbă instant toată interfața, inclusiv documentația și diagnosticul traderului, și salvează preferința în `users.preferred_lang`.

<!-- LANG:EN -->
# Lucky Bitcoin — Documentation

Lucky Bitcoin is a local BTC/USDC leveraged trading simulator (1x–10x): **React + Vite + Tailwind** on the frontend, **Node.js + Express** on the backend and **PostgreSQL** as the only database.

## 1. Domain

**BTC/USDC pair.** Bitcoin is traded against USDC (a dollar-pegged stablecoin). Price is quoted in USDC per 1 BTC.

**Long / Short.** *Long* profits when the price rises; *Short* profits when it falls.

**Leverage.** With margin *M* and leverage *L*, the position has notional value *M × L* and quantity *(M × L) / entry_price* BTC. Unrealized PnL is `(price − entry) × quantity` (reversed for Short); ROE% = PnL / margin.

**Liquidation.** If price touches the liquidation price, the position is closed automatically (`LIQUIDATED`) and the margin is lost. Formula (maintenance margin rate 0.4%):

- Long: `entry × (1 − 1/L + 0.004)`
- Short: `entry × (1 + 1/L − 0.004)`

**Fees (Binance Futures structure).** Charged on notional value, on open *and* on close:

| Order type | Role | Fee |
|---|---|---|
| Limit | Maker | 0.02% |
| Market, Stop-Loss, Take-Profit, manual close | Taker | 0.05% |

**Order types.** *Market* (instant at the current price), *Limit* (fills automatically when price reaches the limit; Long below price, Short above), plus *Stop-Loss* and *Take-Profit*, attachable at placement or editable later. They trigger on the candle High/Low.

**Sessions.** All trading happens inside a session with a starting balance of 10, 100 or 1000 USDC in Live or Time Machine mode. “New session” closes positions at the current price, generates and saves the trader review, archives the session and opens the selection screen.

**Live vs Time Machine.**

- **Live:** recent history via Binance REST and updates via `wss://stream.binance.com:9443/ws/btcusdc@kline_<tf>`. Fast-forward is disabled.
- **Time Machine:** pick a past moment *T0*. The chart contains strictly the candles up to *T0* (**no look-ahead**); future candles stay on the server and are delivered only as simulated time advances. Controls: Play/Pause, Next Candle and speeds x1, x2, x5, x10, x25, x50, x100. Every simulated minute is checked against High/Low/Close for Limit, SL, TP and liquidation hits, so nothing is skipped at high speed.

**Trader review.** The algorithm computes a 0–100 score and grade (S, A, B, C, D, F), an archetype (Disciplined Sniper, High-Leverage Gambler, Impulsive Scalper, Risk-Averse Strategist, Revenge Trader, Balanced Opportunist, Observer) and metrics: win rate, profit factor, average risk/reward, Stop-Loss usage, average leverage, fee bleed, max drawdown and average duration. The narrative diagnosis is generated in RO and EN.

## 2. Pages and components

| Page / route | Roles | Description |
|---|---|---|
| `/login` | public | Log in and register; test accounts are shown for quick fill. |
| `/` Simulator | TRADER, ADMIN | Start screen (mode, Time Machine date, historical events, $10/$100/$1000 buttons), then the trading screen. |
| `/history` Session history | all | Table with start/final balance, PnL $/%, trades, fees, score and archetype; rename/notes, delete, open review, PDF/CSV/Excel export. Staff see all traders plus an aggregate table. |
| `/data` Data manager | ANALYST, ADMIN | Visual CRUD over tables, according to role. |
| `/admin` Admin | ADMIN | DB Index Benchmark, API Load Test and the audit log. |
| `/security` | all | Live explanation: bcrypt hash from the DB, JWT payload, expiry, verification flow, RBAC matrix. |
| `/documentation` | public | This document. |

**Main components:** `Navbar` (logo, menu, RO/EN toggle), `Chart` (lightweight-charts: candles + volume + Entry/SL/TP/Limit/Liquidation lines), `OrderPanel` (Market/Limit, 1–10x leverage slider, live margin, notional, fee and liquidation price), `TimeMachineBar` (Play/Pause/Next/speeds), `Tables` (open positions, pending orders, position and order history; SL/TP/Limit editable in place), `ReviewDrawer` (collapsible side panel, recalculable anytime), `ReviewView` (score, metrics, diagnosis, notes), `Common` (Modal, Pager, export buttons).

## 3. Data model (8 tables)

```
roles ─┐
       └< users ─┬< trading_sessions ─┬< orders ──< positions (order_id, SET NULL)
                 │                    ├< positions
                 │                    └─ trader_reviews (1:1 with the session)
                 ├< trader_reviews
                 └< audit_logs (SET NULL)
historical_candles (standalone; UNIQUE symbol+timeframe+open_time)
```

| Table | Key constraints |
|---|---|
| `roles` | `name` UNIQUE, `permissions` JSONB |
| `users` | `username`, `email` UNIQUE; `role_id` FK RESTRICT; `preferred_lang` CHECK ('ro','en') |
| `trading_sessions` | FK `user_id` CASCADE; `mode` CHECK; `initial_balance` CHECK IN (10,100,1000); `status` CHECK |
| `orders` | FK `session_id` CASCADE; `leverage` CHECK 1–10; `side`, `order_type`, `status` CHECK; Limit requires `limit_price` |
| `positions` | FK `session_id` CASCADE, `order_id` SET NULL; `status` CHECK (OPEN/CLOSED/LIQUIDATED) |
| `trader_reviews` | `session_id` UNIQUE FK CASCADE; `score` CHECK 0–100 |
| `historical_candles` | UNIQUE (symbol, timeframe, open_time); CHECK high ≥ low |
| `audit_logs` | FK `user_id` SET NULL; `payload_json` JSONB |

Full schema: `backend/schema.sql` (applied automatically and idempotently at startup).

## 4. Fixtures

On `npm start` the server creates the database if missing, applies the schema and, if the database is empty, inserts: the 3 roles, 3 test accounts, at least 5,000 BTC/USDC candles (downloaded from Binance REST or, offline, generated deterministically and aggregated into 1m/5m/15m/1h/4h/1d), plus closed historical sessions with orders, positions and reviews.

| Role | Email | Password |
|---|---|---|
| ADMIN | admin@luckybtc.ro | Admin123! |
| ANALYST | analyst@luckybtc.ro | Analyst123! |
| TRADER | trader@luckybtc.ro | Trader123! |

## 5. CRUD

REST routes (all require authentication; rights are enforced on the server):

| Entity | Routes |
|---|---|
| Sessions | `POST/GET /api/sessions`, `GET/PUT/DELETE /api/sessions/:id` |
| Orders | `POST /api/sessions/:id/orders`, `PUT/DELETE .../orders/:oid` |
| Positions | `PUT/DELETE /api/sessions/:id/positions/:pid`, `POST .../positions/:pid/close` |
| Reviews | `POST/GET /api/sessions/:id/review`, `GET/PUT/DELETE /api/reviews/:id` |
| All 8 tables | `GET/POST /api/data/:table`, `GET/PUT/PATCH/DELETE /api/data/:table/:id` |

## 6. Authentication

- **Passwords:** `bcryptjs`, 12 salt rounds. Only the hash is stored (`$2a$12$<22-char salt><31-char digest>`).
- **Session:** HS256 JWT (8 hours) in an HttpOnly, SameSite=Lax cookie; the `authenticate` middleware verifies signature, expiry and that the user still exists.
- The **Security & Authentication** page shows your own hash, the bcrypt parameters, a password check, a salt demo, the decoded JWT payload and the remaining lifetime in real time.

## 7. Roles (RBAC)

| Capability | TRADER | ANALYST | ADMIN |
|---|:-:|:-:|:-:|
| Simulator, own sessions/orders/positions, own reviews | ✔ | — | ✔ |
| See all traders’ sessions and statistics | — | ✔ | ✔ |
| Edit `mentor_notes` on reviews | — | ✔ | ✔ |
| CRUD on historical candles | — | ✔ | ✔ |
| CRUD on all 8 tables | — | — | ✔ |
| Index benchmark, Load Test, audit log | — | — | ✔ |

## 8. Indexes and benchmark

Required indexes: `idx_candles_lookup (symbol, timeframe, open_time)` and `idx_positions_session_status (session_id, status, closed_at)`. In **Admin → DB Index Benchmark** the button runs inside one transaction: `DROP INDEX IF EXISTS` (and drops the UNIQUE constraint that would otherwise provide an implicit index), `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` **before**, `CREATE INDEX`, then **after**, and shows scan type, time, cost, buffers and the speed-up percentage. The transaction is rolled back at the end, so your schema is unchanged. Queries: (1) Time Machine candle range lookup; (2) PnL aggregation per session.

## 9. Load test

`npm run loadtest` (from `backend/`, with the server running) or the “Run API Load Test” button in Admin. It uses `autocannon` with 50–100 concurrent connections against quotes (`GET /api/market/price`), session history (`GET /api/sessions`) and place-order (`POST /api/sessions/:id/orders`) on a temporary session that is deleted afterwards. It reports RPS, latency (avg, min, max, p50, p95, p99), throughput in MB/s and the 2xx success rate.

## 10. Reports

Real exports from PostgreSQL as **PDF** (Lucky Bitcoin header, tables and trader profile), **CSV** and **Excel (.xlsx)**: `GET /api/reports/session|history|aggregate?format=pdf|csv|xlsx&lang=ro|en`. Available in Session history and the analysis panel; the aggregate report is limited to ANALYST/ADMIN.

## 11. Internationalization

The RO 🇷🇴 | EN 🇬🇧 toggle in the Navbar switches the whole UI instantly, including this documentation and the trader diagnosis, and saves the preference in `users.preferred_lang`.
