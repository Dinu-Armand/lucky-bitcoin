-- ============================================================================
-- Lucky Bitcoin - schema PostgreSQL (8 tabele, normalizata)
-- Rulata automat la pornirea serverului (idempotent: IF NOT EXISTS).
-- ============================================================================

CREATE TABLE IF NOT EXISTS roles (
  id           SERIAL PRIMARY KEY,
  name         VARCHAR(30) NOT NULL UNIQUE,
  permissions  JSONB NOT NULL DEFAULT '{}'::jsonb,
  description  TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id              SERIAL PRIMARY KEY,
  username        VARCHAR(40)  NOT NULL UNIQUE,
  email           VARCHAR(120) NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  role_id         INTEGER NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  preferred_lang  VARCHAR(2) NOT NULL DEFAULT 'ro' CHECK (preferred_lang IN ('ro','en')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trading_sessions (
  id                      SERIAL PRIMARY KEY,
  user_id                 INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                    VARCHAR(80),
  notes                   TEXT,
  mode                    VARCHAR(12) NOT NULL CHECK (mode IN ('LIVE','TIME_MACHINE')),
  initial_balance         NUMERIC(14,2) NOT NULL CHECK (initial_balance IN (10, 100, 1000)),
  final_balance           NUMERIC(20,6),
  current_balance         NUMERIC(20,6) NOT NULL,
  simulated_start_time    TIMESTAMPTZ,
  simulated_current_time  TIMESTAMPTZ,
  status                  VARCHAR(8) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CLOSED')),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at                TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS orders (
  id           SERIAL PRIMARY KEY,
  session_id   INTEGER NOT NULL REFERENCES trading_sessions(id) ON DELETE CASCADE,
  side         VARCHAR(5) NOT NULL CHECK (side IN ('LONG','SHORT')),
  order_type   VARCHAR(6) NOT NULL CHECK (order_type IN ('MARKET','LIMIT')),
  leverage     INTEGER NOT NULL CHECK (leverage BETWEEN 1 AND 10),
  quantity_btc NUMERIC(24,10) NOT NULL DEFAULT 0 CHECK (quantity_btc >= 0),
  margin_usdc  NUMERIC(20,6) NOT NULL CHECK (margin_usdc > 0),
  limit_price  NUMERIC(20,8) CHECK (limit_price IS NULL OR limit_price > 0),
  stop_loss    NUMERIC(20,8) CHECK (stop_loss IS NULL OR stop_loss > 0),
  take_profit  NUMERIC(20,8) CHECK (take_profit IS NULL OR take_profit > 0),
  status       VARCHAR(10) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','FILLED','CANCELLED')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_limit_needs_price CHECK (order_type <> 'LIMIT' OR limit_price IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS positions (
  id                SERIAL PRIMARY KEY,
  session_id        INTEGER NOT NULL REFERENCES trading_sessions(id) ON DELETE CASCADE,
  order_id          INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  side              VARCHAR(5) NOT NULL CHECK (side IN ('LONG','SHORT')),
  leverage          INTEGER NOT NULL CHECK (leverage BETWEEN 1 AND 10),
  entry_price       NUMERIC(20,8) NOT NULL CHECK (entry_price > 0),
  exit_price        NUMERIC(20,8),
  liquidation_price NUMERIC(20,8) NOT NULL,
  margin_usdc       NUMERIC(20,6) NOT NULL CHECK (margin_usdc > 0),
  quantity_btc      NUMERIC(24,10) NOT NULL CHECK (quantity_btc > 0),
  stop_loss         NUMERIC(20,8),
  take_profit       NUMERIC(20,8),
  opening_fee_usdc  NUMERIC(20,8) NOT NULL DEFAULT 0 CHECK (opening_fee_usdc >= 0),
  closing_fee_usdc  NUMERIC(20,8) NOT NULL DEFAULT 0 CHECK (closing_fee_usdc >= 0),
  realized_pnl_usdc NUMERIC(20,8),
  status            VARCHAR(10) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED','LIQUIDATED')),
  close_reason      VARCHAR(20),
  opened_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at         TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS trader_reviews (
  id               SERIAL PRIMARY KEY,
  session_id       INTEGER NOT NULL UNIQUE REFERENCES trading_sessions(id) ON DELETE CASCADE,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score            INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  grade            VARCHAR(2) NOT NULL,
  archetype        VARCHAR(40) NOT NULL,
  win_rate         NUMERIC(7,2),
  avg_leverage     NUMERIC(7,2),
  sl_usage_rate    NUMERIC(7,2),
  total_fees_paid  NUMERIC(20,8),
  metrics          JSONB NOT NULL DEFAULT '{}'::jsonb,
  feedback_ro      TEXT,
  feedback_en      TEXT,
  mentor_notes     TEXT,
  trader_notes     TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS historical_candles (
  id         BIGSERIAL PRIMARY KEY,
  symbol     VARCHAR(12) NOT NULL DEFAULT 'BTCUSDC',
  timeframe  VARCHAR(3)  NOT NULL CHECK (timeframe IN ('1m','5m','15m','1h','4h','1d')),
  open_time  BIGINT NOT NULL,
  open       DOUBLE PRECISION NOT NULL,
  high       DOUBLE PRECISION NOT NULL,
  low        DOUBLE PRECISION NOT NULL,
  close      DOUBLE PRECISION NOT NULL,
  volume     DOUBLE PRECISION NOT NULL DEFAULT 0,
  CONSTRAINT uq_candles UNIQUE (symbol, timeframe, open_time),
  CONSTRAINT chk_candle_range CHECK (high >= low)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id           BIGSERIAL PRIMARY KEY,
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action       VARCHAR(40) NOT NULL,
  entity_name  VARCHAR(40),
  entity_id    VARCHAR(40),
  payload_json JSONB,
  ip_address   VARCHAR(64),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- INDECSI (demonstrati in modulul "DB Index Benchmark", vezi backend/src/benchmark.js)
-- ---------------------------------------------------------------------------
-- 1) Cautarea lumanarilor Time Machine pe interval de timp
CREATE INDEX IF NOT EXISTS idx_candles_lookup
  ON historical_candles (symbol, timeframe, open_time);
-- 2) Agregarea PnL pe sesiuni / pozitii inchise
CREATE INDEX IF NOT EXISTS idx_positions_session_status
  ON positions (session_id, status, closed_at);
-- 3) Indecsi suport pentru FK-uri frecvent folosite
CREATE INDEX IF NOT EXISTS idx_sessions_user    ON trading_sessions (user_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_session   ON orders (session_id, status);
CREATE INDEX IF NOT EXISTS idx_audit_created    ON audit_logs (created_at DESC);
