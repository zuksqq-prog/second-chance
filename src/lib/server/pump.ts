import "server-only";
import { PublicKey } from "@solana/web3.js";
import { parseBondingCurve, PUMP_PROGRAM_ID, type BondingCurve } from "@/lib/domain/pump-curve";
import { isSolanaAddress } from "@/lib/domain/sanitize";
import { sharedCache } from "./cache";
import { rpc } from "./solana-rpc";

const PROGRAM = new PublicKey(PUMP_PROGRAM_ID);
const SEED = new TextEncoder().encode("bonding-curve");

/** Bonding-curve PDA for a mint (cached forever: it never changes). */
export function bondingCurveAddress(mint: string): string {
  return sharedCache.peek<string>(`pda:${mint}`) ?? (() => {
    const [pda] = PublicKey.findProgramAddressSync([SEED, new PublicKey(mint).toBytes()], PROGRAM);
    const s = pda.toBase58();
    sharedCache.set(`pda:${mint}`, s, 365 * 86400_000);
    return s;
  })();
}

function b64(s: string): Uint8Array {
  return Uint8Array.from(Buffer.from(s, "base64"));
}

/**
 * Read pump.fun bonding curves for many mints in one RPC call (100 max).
 * Mints without a curve (other launchpads, migrated before tracking) map to null.
 */
export async function getBondingCurves(mints: string[]): Promise<Map<string, BondingCurve | null>> {
  const valid = [...new Set(mints.filter(isSolanaAddress))].slice(0, 100);
  const out = new Map<string, BondingCurve | null>();
  if (!valid.length) return out;
  const key = `curves:${valid.slice().sort().join(",")}`;
  const raw = await sharedCache.get(key, 6_000, async () => {
    const pdas = valid.map(bondingCurveAddress);
    const r = await rpc<{ value: ({ owner: string; data: [string, string] } | null)[] }>("getMultipleAccounts", [
      pdas,
      { encoding: "base64", commitment: "confirmed" },
    ]);
    return r.value.map((acc) => (acc && acc.owner === PUMP_PROGRAM_ID ? acc.data[0] : null));
  });
  valid.forEach((m, i) => {
    const d = raw[i];
    out.set(m, d ? parseBondingCurve(b64(d)) : null);
  });
  return out;
}

export async function getBondingCurve(mint: string): Promise<BondingCurve | null> {
  return (await getBondingCurves([mint])).get(mint) ?? null;
}
