-- SECOND CHANCE initial schema. Mirrors src/db/schema.ts.
-- Apply with: npm run db:migrate   (or psql "$DATABASE_URL" -f drizzle/0000_init.sql)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  wallet_address text PRIMARY KEY,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_nonces (
  nonce text PRIMARY KEY,
  wallet_address text NOT NULL,
  message text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

CREATE TABLE IF NOT EXISTS theses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address text NOT NULL REFERENCES users(wallet_address) ON DELETE CASCADE,
  mint text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('paper','real')),
  token_symbol text,
  entry_market_cap double precision,
  original jsonb NOT NULL,
  current jsonb NOT NULL,
  original_position_raw numeric(40,0),
  planned_exit_sold_percent double precision NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed')),
  revision_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS theses_one_active_per_token ON theses (wallet_address, mint, mode) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS theses_wallet_idx ON theses (wallet_address);

-- The original thesis is immutable: block any UPDATE that changes it.
CREATE OR REPLACE FUNCTION theses_protect_original() RETURNS trigger AS $$
BEGIN
  IF NEW.original IS DISTINCT FROM OLD.original THEN
    RAISE EXCEPTION 'The original thesis cannot be modified';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS theses_protect_original ON theses;
CREATE TRIGGER theses_protect_original BEFORE UPDATE ON theses
  FOR EACH ROW EXECUTE FUNCTION theses_protect_original();

CREATE TABLE IF NOT EXISTS thesis_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thesis_id uuid NOT NULL REFERENCES theses(id) ON DELETE CASCADE,
  revision_no integer NOT NULL,
  content jsonb NOT NULL,
  changed_fields text[] NOT NULL,
  change_reason text NOT NULL,
  trigger text NOT NULL CHECK (trigger IN ('edit','second_chance')),
  market_cap_at_change double precision,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS thesis_revisions_no ON thesis_revisions (thesis_id, revision_no);

CREATE TABLE IF NOT EXISTS trade_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address text NOT NULL REFERENCES users(wallet_address) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('paper','real')),
  side text NOT NULL CHECK (side IN ('buy','sell')),
  mint text NOT NULL,
  amount_raw numeric(40,0) NOT NULL CHECK (amount_raw > 0),
  thesis_id uuid REFERENCES theses(id) ON DELETE SET NULL,
  evaluation jsonb,
  status text NOT NULL CHECK (status IN ('pending_ack','cleared','cancelled','consumed','expired')),
  acknowledgement text CHECK (acknowledgement IN ('keep_holding','update_thesis','sell_anyway')),
  ack_note text,
  idempotency_key text NOT NULL,
  order_request_id text,
  order_message_hash text,
  order_in_amount_raw numeric(40,0),
  order_out_amount_raw numeric(40,0),
  order_created_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS trade_intents_idem ON trade_intents (wallet_address, idempotency_key);

CREATE TABLE IF NOT EXISTS trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address text NOT NULL REFERENCES users(wallet_address) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('paper','real')),
  mint text NOT NULL,
  token_symbol text,
  token_decimals integer NOT NULL,
  side text NOT NULL CHECK (side IN ('buy','sell')),
  token_amount_raw numeric(40,0) NOT NULL,
  sol_amount_lamports numeric(40,0) NOT NULL,
  network_fee_lamports numeric(40,0) NOT NULL DEFAULT 0,
  platform_fee_lamports numeric(40,0) NOT NULL DEFAULT 0,
  price_sol double precision,
  price_usd double precision,
  market_cap double precision,
  signature text,
  jupiter_request_id text,
  status text NOT NULL CHECK (status IN ('pending','confirmed','failed')),
  error text,
  intent_id uuid REFERENCES trade_intents(id) ON DELETE SET NULL,
  simulated boolean NOT NULL,
  second_chance_shown boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  CHECK ((mode = 'paper') = simulated)
);
CREATE UNIQUE INDEX IF NOT EXISTS trades_signature ON trades (signature) WHERE signature IS NOT NULL;
CREATE INDEX IF NOT EXISTS trades_wallet_mode_idx ON trades (wallet_address, mode, created_at);

CREATE TABLE IF NOT EXISTS paper_accounts (
  wallet_address text PRIMARY KEY REFERENCES users(wallet_address) ON DELETE CASCADE,
  sol_balance_lamports numeric(40,0) NOT NULL CHECK (sol_balance_lamports >= 0),
  starting_balance_lamports numeric(40,0) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  reset_at timestamptz
);

CREATE TABLE IF NOT EXISTS watchlist (
  wallet_address text NOT NULL REFERENCES users(wallet_address) ON DELETE CASCADE,
  mint text NOT NULL,
  symbol text,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (wallet_address, mint)
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
