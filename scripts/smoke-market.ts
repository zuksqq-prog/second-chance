/**
 * Live smoke test of the external read-only integrations. Run from a machine
 * with normal internet access (it can't run in a sandbox without egress):
 *   npm run smoke
 * Optional: SOLANA_RPC_URL or HELIUS_API_KEY, JUPITER_API_KEY.
 * Exits non-zero if any check fails. Makes no transactions.
 */
import { fromDexScreenerPair, fromGeckoPool, parseGeckoOhlcv, WSOL_MINT } from "../src/lib/domain/market";

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const results: { name: string; ok: boolean; detail: string }[] = [];

async function check(name: string, fn: () => Promise<string>) {
  try {
    results.push({ name, ok: true, detail: await fn() });
  } catch (e) {
    results.push({ name, ok: false, detail: (e as Error).message });
  }
}

async function get(url: string, headers: Record<string, string> = {}) {
  const r = await fetch(url, { headers: { accept: "application/json", ...headers }, signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`${r.status} from ${new URL(url).host}`);
  return r.json();
}

async function main() {
  let pairAddress = "";
  await check("DexScreener token-pairs", async () => {
    const pairs = await get(`https://api.dexscreener.com/token-pairs/v1/solana/${BONK}`);
    const snaps = (pairs as unknown[]).map((p) => fromDexScreenerPair(p, Date.now())).filter(Boolean);
    if (!snaps.length) throw new Error("no pairs parsed");
    const best = snaps.sort((a, b) => (b!.liquidityUsd ?? 0) - (a!.liquidityUsd ?? 0))[0]!;
    pairAddress = best.pairAddress;
    return `${snaps.length} pairs, BONK mcap $${Math.round(best.marketCap ?? 0).toLocaleString()}`;
  });
  await check("DexScreener search", async () => {
    const d = await get(`https://api.dexscreener.com/latest/dex/search?q=bonk`);
    return `${d.pairs?.length ?? 0} pairs`;
  });
  await check("GeckoTerminal trending (solana)", async () => {
    const d = await get(`https://api.geckoterminal.com/api/v2/networks/solana/trending_pools?include=base_token,quote_token`, { accept: "application/json;version=20230302" });
    const n = (d.data as unknown[]).map((p) => fromGeckoPool(p, d.included ?? [], Date.now())).filter(Boolean).length;
    if (!n) throw new Error("no pools parsed");
    return `${n} pools parsed`;
  });
  await check("GeckoTerminal new pools (solana)", async () => {
    const d = await get(`https://api.geckoterminal.com/api/v2/networks/solana/new_pools?include=base_token,quote_token`, { accept: "application/json;version=20230302" });
    return `${d.data?.length ?? 0} pools`;
  });
  await check("GeckoTerminal OHLCV", async () => {
    if (!pairAddress) throw new Error("no pair from DexScreener");
    const d = await get(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${pairAddress}/ohlcv/minute?aggregate=5&limit=100&currency=usd&token=base`, { accept: "application/json;version=20230302" });
    const c = parseGeckoOhlcv(d.data?.attributes?.ohlcv_list);
    if (!c.length) throw new Error("no candles");
    return `${c.length} candles`;
  });
  const rpc = process.env.SOLANA_RPC_URL ?? (process.env.HELIUS_API_KEY ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}` : "https://api.mainnet-beta.solana.com");
  await check("Solana RPC getTokenSupply", async () => {
    const r = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTokenSupply", params: [BONK] }) });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message);
    return `decimals ${j.result.value.decimals}`;
  });
  await check("Jupiter Swap v2 /order (quote only, no taker)", async () => {
    const h: Record<string, string> = {};
    if (process.env.JUPITER_API_KEY) h["x-api-key"] = process.env.JUPITER_API_KEY;
    const d = await get(`https://api.jup.ag/swap/v2/order?inputMint=${WSOL_MINT}&outputMint=${BONK}&amount=10000000`, h);
    if (!d.outAmount) throw new Error(`no outAmount: ${JSON.stringify(d).slice(0, 200)}`);
    return `0.01 SOL → ${d.outAmount} BONK base units via ${d.router ?? "?"}`;
  });

  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(42)} ${r.detail}`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

void main();
