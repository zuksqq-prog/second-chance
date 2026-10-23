import { json, route } from "@/lib/server/http";
import { getPriorityFeeEstimate } from "@/lib/server/solana-rpc";

export const runtime = "nodejs";

/** Recent priority fees in micro-lamports per compute unit (low / medium / high percentiles). */
export const GET = route(async () => json({ microLamportsPerCu: await getPriorityFeeEstimate() }));
