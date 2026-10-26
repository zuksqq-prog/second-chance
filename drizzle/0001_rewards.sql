-- Rewards: platform fee per trade (for cashback) and claim requests.
ALTER TABLE trades ADD COLUMN IF NOT EXISTS referral_fee_lamports numeric(40,0) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS reward_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address text NOT NULL REFERENCES users(wallet_address) ON DELETE CASCADE,
  amount_lamports numeric(40,0) NOT NULL CHECK (amount_lamports > 0),
  payout_address text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','rejected')),
  paid_signature text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reward_claims_wallet_idx ON reward_claims (wallet_address, created_at);
-- At most one open claim per wallet.
CREATE UNIQUE INDEX IF NOT EXISTS reward_claims_one_pending ON reward_claims (wallet_address) WHERE status = 'pending';
