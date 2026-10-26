import "server-only";
import { z } from "zod";

/**
 * Server-only environment. Never import this from client components:
 * the "server-only" import makes the build fail if that happens.
 */
const schema = z.object({
  DATABASE_URL: z.string().url(),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  HELIUS_API_KEY: z.string().min(1).optional(),
  /** Override RPC entirely (e.g. a dedicated Helius endpoint or Triton). */
  SOLANA_RPC_URL: z.string().url().optional(),
  JUPITER_API_KEY: z.string().min(1).optional(),
  JUPITER_BASE_URL: z.string().url().default("https://api.jup.ag/swap/v2"),

  /** Master switch for real-money execution. Off unless explicitly "true". */
  REAL_TRADING_ENABLED: z.enum(["true", "false"]).default("false"),
  /** Comma-separated wallets allowed to trade real money during the controlled beta. Empty = nobody. */
  REAL_TRADING_ALLOWLIST: z.string().default(""),
  /** Hard cap per real buy, in SOL. */
  MAX_REAL_TRADE_SOL: z.coerce.number().positive().default(0.25),
  /** Max slippage the server will accept, bps. */
  MAX_SLIPPAGE_BPS: z.coerce.number().int().min(1).max(5000).default(2000),
  /** Max priority fee the server will accept, lamports. */
  MAX_PRIORITY_FEE_LAMPORTS: z.coerce.number().int().min(0).default(5_000_000),
  /**
   * Optional platform fee on real trades, collected through Jupiter's referral
   * program (allowed range 50–255 bps). 0 = no fee and therefore no cashback.
   */
  PLATFORM_FEE_BPS: z.coerce.number().int().min(0).max(255).default(0),
  /** Jupiter referral account that receives the platform fee. Required when PLATFORM_FEE_BPS > 0. */
  JUPITER_REFERRAL_ACCOUNT: z.string().optional(),
  /** Share of the platform fee returned to the trader as SOL cashback. */
  REWARDS_CASHBACK_PCT: z.coerce.number().min(0).max(100).default(25),
  /** Starting paper balance in SOL. */
  PAPER_STARTING_SOL: z.coerce.number().positive().default(10),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid server environment: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Platform fee in bps, or 0 when not fully configured. */
export function platformFeeBps(): number {
  const e = env();
  if (e.PLATFORM_FEE_BPS < 50) return 0;
  if (!e.JUPITER_REFERRAL_ACCOUNT || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(e.JUPITER_REFERRAL_ACCOUNT)) return 0;
  return e.PLATFORM_FEE_BPS;
}

export function rpcUrl(): string {
  const e = env();
  if (e.SOLANA_RPC_URL) return e.SOLANA_RPC_URL;
  if (e.HELIUS_API_KEY) return `https://mainnet.helius-rpc.com/?api-key=${e.HELIUS_API_KEY}`;
  // Public endpoint: read-only, heavily rate limited. Fine for local dev, not production.
  return "https://api.mainnet-beta.solana.com";
}

export function realTradingStatus(wallet: string | null): { enabled: boolean; reason: string | null } {
  const e = env();
  if (e.REAL_TRADING_ENABLED !== "true") return { enabled: false, reason: "Real-money trading is turned off on this server." };
  if (!e.HELIUS_API_KEY && !e.SOLANA_RPC_URL) return { enabled: false, reason: "No dedicated Solana RPC is configured." };
  const allow = e.REAL_TRADING_ALLOWLIST.split(",").map((s) => s.trim()).filter(Boolean);
  if (!wallet || !allow.includes(wallet)) return { enabled: false, reason: "This wallet isn't in the controlled beta yet." };
  return { enabled: true, reason: null };
}
