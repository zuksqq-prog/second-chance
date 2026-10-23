import { body, json, requireWallet, route } from "@/lib/server/http";
import { settingsBody } from "@/lib/server/validation";
import * as repo from "@/lib/server/repo";
import { env } from "@/lib/server/env";
import { SETTINGS_DEFAULTS } from "@/lib/settings-defaults";

export const runtime = "nodejs";

const DEFAULTS = SETTINGS_DEFAULTS;

export const GET = route(
  async (ctx) => {
    const wallet = requireWallet(ctx);
    const s = await repo.getSettings(wallet);
    const e = env();
    return json({
      settings: { ...DEFAULTS, ...s },
      limits: { maxSlippageBps: e.MAX_SLIPPAGE_BPS, maxPriorityFeeLamports: e.MAX_PRIORITY_FEE_LAMPORTS, maxRealTradeSol: e.MAX_REAL_TRADE_SOL },
    });
  },
  { auth: true },
);

export const PUT = route(
  async (ctx) => {
    const wallet = requireWallet(ctx);
    const b = await body(ctx.req, settingsBody);
    await repo.saveSettings(wallet, b);
    return json({ settings: { ...DEFAULTS, ...(await repo.getSettings(wallet)) } });
  },
  { auth: true },
);
