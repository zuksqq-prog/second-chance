"use client";

import { useState } from "react";
import useSWR from "swr";
import { ChartLine, Gem, PieChart, Sparkles } from "lucide-react";
import { fetcher, post } from "@/lib/client/api";
import { useApp } from "@/lib/client/store";
import { useSession } from "@/lib/client/session";
import { shortAddr } from "@/lib/domain/format";
import { TX_TIERS, VOLUME_TIERS } from "@/lib/domain/rewards";
import { Empty } from "@/components/portfolio/positions-table";
import { cn } from "@/lib/utils";

interface Quest {
  progress: number;
  remaining: number;
  nextPoints: number;
  completedTiers: number;
  totalTiers: number;
  label: string;
}
interface RewardsDTO {
  program: { active: boolean; platformFeeBps: number; cashbackPct: number };
  earnedLamports: string;
  claimableLamports: string;
  paidLamports: string;
  minClaimLamports: string;
  series: { day: string; sol: number }[];
  claims: { id: string; amountLamports: string; payoutAddress: string; status: "pending" | "paid" | "rejected"; paidSignature: string | null; createdAt: string }[];
  payoutAddress: string;
  activity: { volumeSol: number; txCount: number };
  quests: { volume: Quest; tx: Quest; points: number };
}

const sol = (lamports: string | bigint) => Number(lamports) / 1e9;

export function RewardsView() {
  const { status } = useSession();
  const { toast } = useApp();
  const { data, error, mutate } = useSWR<RewardsDTO>(status === "signed_in" ? "/api/rewards" : null, fetcher, { refreshInterval: 30_000 });
  const [claiming, setClaiming] = useState(false);
  const [breakdown, setBreakdown] = useState(false);

  if (status !== "signed_in") return <Empty text="Connect and sign in with your wallet to see your rewards." />;
  if (error) return <Empty text={(error as Error).message} tone="error" />;
  if (!data) return <Empty text="Loading rewards…" />;

  const claimableSol = sol(data.claimableLamports);
  const canClaim = BigInt(data.claimableLamports) >= BigInt(data.minClaimLamports);
  const pending = data.claims.find((c) => c.status === "pending");

  const claim = async () => {
    setClaiming(true);
    try {
      await post("/api/rewards/claim", {});
      toast({ tone: "ok", title: "Claim submitted", body: `${fmtSol(claimableSol)} SOL will be sent to ${shortAddr(data.payoutAddress)}.` });
      await mutate();
    } catch (e) {
      toast({ tone: "error", title: "Couldn't claim", body: (e as Error).message });
    } finally {
      setClaiming(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-[radial-gradient(120%_60%_at_50%_-10%,#13233a_0%,transparent_60%)]">
      <div className="mx-auto max-w-[1400px] p-4 md:p-6">
        <h1 className="text-xl font-medium">Claim</h1>

        {!data.program.active && (
          <p className="mt-3 rounded-lg border border-signal/30 bg-signal-soft px-4 py-2.5 text-xs text-signal">
            Cashback isn't active on this server yet. It pays back {data.program.cashbackPct}% of the platform fee on real trades, and the platform fee is currently off, so there's nothing to pay back. Quests still track your real trading.
          </p>
        )}

        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          {/* SOL Rewards chart */}
          <section className="rounded-xl border border-line bg-ink-1 p-5">
            <CardTitle icon={<ChartLine size={15} />}>SOL Rewards</CardTitle>
            <RewardsChart series={data.series} />
          </section>

          {/* Claim */}
          <section className="flex flex-col rounded-xl border border-line bg-ink-1 p-5 [background-image:radial-gradient(#ffffff0a_1px,transparent_1px)] [background-size:14px_14px]">
            <CardTitle icon={<Gem size={15} />}>Claim</CardTitle>
            <div className="flex flex-1 flex-col items-center justify-center gap-3 py-6">
              <span className={cn("flex items-center gap-2 rounded-full border px-5 py-2.5 text-[28px] font-medium num", claimableSol > 0 ? "border-[#9945FF]/50 bg-[#9945FF]/10" : "border-line-strong bg-ink-2")}>
                <SolMark /> +{fmtSol(claimableSol)}
              </span>
              <p className="text-xs text-muted">
                Lifetime cashback {fmtSol(sol(data.earnedLamports))} SOL · paid {fmtSol(sol(data.paidLamports))} SOL
              </p>
            </div>
            <p className="mb-3 text-center text-xs text-muted">
              Pays to your wallet <span className="text-fg-soft">{shortAddr(data.payoutAddress, 5)}</span>
            </p>
            <button
              type="button"
              onClick={claim}
              disabled={!canClaim || claiming || !!pending}
              className="h-11 w-full rounded-full bg-buy text-[15px] font-semibold text-ink-0 transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {pending ? "Claim in progress" : claiming ? "Claiming…" : "Claim SOL"}
            </button>
            {!canClaim && !pending && <p className="mt-2 text-center text-2xs text-muted">Minimum claim is 0.001 SOL.</p>}
          </section>

          {/* Quests */}
          <section className="rounded-xl border border-line bg-ink-1 p-5">
            <div className="flex items-center justify-between">
              <CardTitle icon={<Sparkles size={15} />}>Quests</CardTitle>
              <button type="button" onClick={() => setBreakdown((b) => !b)} className="flex items-center gap-1.5 text-xs text-fg-soft hover:text-fg" aria-expanded={breakdown}>
                <PieChart size={13} /> Points Breakdown
              </button>
            </div>
            {breakdown ? (
              <Breakdown volume={data.activity.volumeSol} tx={data.activity.txCount} points={data.quests.points} />
            ) : (
              <div className="mt-4 grid grid-cols-2 gap-4">
                <QuestRing q={data.quests.volume} />
                <QuestRing q={data.quests.tx} />
              </div>
            )}
            <p className="mt-3 text-center text-2xs text-muted">
                {data.quests.points.toLocaleString()} points · {data.activity.volumeSol.toFixed(2)} SOL volume · {data.activity.txCount} trades (real only)
            </p>
          </section>
        </div>

        {/* history */}
        {data.claims.length > 0 && (
          <section className="mt-4 rounded-xl border border-line bg-ink-1 p-5">
            <h2 className="text-[14px] text-fg-soft">Claim history</h2>
            <table className="mt-3 w-full text-xs">
              <thead className="text-2xs text-muted">
                <tr>
                  <th className="py-1 text-left font-normal">Date</th>
                  <th className="text-right font-normal">Amount</th>
                  <th className="text-left font-normal pl-4">Paid to</th>
                  <th className="text-left font-normal">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.claims.map((c) => (
                  <tr key={c.id} className="border-t border-line/60">
                    <td className="py-2 text-fg-soft">{new Date(c.createdAt).toLocaleString()}</td>
                    <td className="text-right num">{fmtSol(sol(c.amountLamports))} SOL</td>
                    <td className="pl-4 text-fg-soft">{shortAddr(c.payoutAddress, 5)}</td>
                    <td>
                      {c.status === "paid" && c.paidSignature ? (
                        <a href={`https://solscan.io/tx/${c.paidSignature}`} target="_blank" rel="noreferrer" className="text-buy underline">
                          Paid
                        </a>
                      ) : (
                        <span className={c.status === "pending" ? "text-signal" : c.status === "rejected" ? "text-sell" : "text-buy"}>{c.status === "pending" ? "Processing" : c.status === "rejected" ? "Rejected" : "Paid"}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <p className="mt-4 text-2xs text-muted">
          How it works: on real trades with a platform fee, {data.program.cashbackPct}% of that fee is credited to you as SOL cashback. Claims are paid from the rewards wallet to the wallet you're signed in with. Paper trades don't earn cashback or quest progress.
        </p>
      </div>
    </div>
  );
}

function CardTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 text-[15px]">
      <span className="flex h-7 w-7 items-center justify-center rounded-md border border-line bg-ink-2 text-buy">{icon}</span>
      {children}
    </h2>
  );
}

/** Smooth area chart of cumulative SOL cashback, drawn to scale. */
function RewardsChart({ series }: { series: { day: string; sol: number }[] }) {
  const W = 520;
  const H = 230;
  const pad = { l: 64, r: 10, t: 14, b: 26 };
  const max = Math.max(...series.map((s) => s.sol), 0);
  const top = max > 0 ? niceMax(max) : 0.01;
  const x = (i: number) => pad.l + (i / Math.max(1, series.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / top) * (H - pad.t - pad.b);
  const pts = series.map((s, i) => [x(i), y(s.sol)] as const);
  const path = smooth(pts);
  const area = `${path} L ${x(series.length - 1)} ${H - pad.b} L ${x(0)} ${H - pad.b} Z`;
  const ticks = [0, top / 2, top];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-4 w-full" role="img" aria-label="Cumulative SOL cashback over the last 8 days">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#1d232d" />
          <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#7f8a99">
            {trimSol(t)} SOL
          </text>
        </g>
      ))}
      <path d={area} fill="#38c98b" fillOpacity="0.12" />
      <path d={path} fill="none" stroke="#38c98b" strokeWidth="2" />
      {series.map((s, i) => (
        <text key={s.day} x={x(i)} y={H - 6} textAnchor="middle" fontSize="11" fill="#7f8a99">
          {new Date(`${s.day}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })}
        </text>
      ))}
    </svg>
  );
}

function QuestRing({ q }: { q: Quest }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <svg width="132" height="132" viewBox="0 0 132 132" aria-hidden>
        <circle cx="66" cy="66" r={r} fill="none" stroke="#1d232d" strokeWidth="9" />
        <circle cx="66" cy="66" r={r} fill="none" stroke="#38c98b" strokeWidth="9" strokeLinecap="round" strokeDasharray={`${c * q.progress} ${c}`} transform="rotate(-90 66 66)" />
        <text x="66" y="71" textAnchor="middle" fontSize="15" fill="#b9c1cc">
          {q.nextPoints ? `+${q.nextPoints.toLocaleString()}` : "Done"}
        </text>
      </svg>
      <p className="text-[13px] text-fg-soft">{q.label}</p>
      <p className="text-2xs text-muted">
        Tier {Math.min(q.completedTiers + 1, q.totalTiers)} of {q.totalTiers}
      </p>
    </div>
  );
}

function Breakdown({ volume, tx, points }: { volume: number; tx: number; points: number }) {
  return (
    <div className="mt-4 grid grid-cols-2 gap-4 text-xs">
      <div>
        <p className="mb-1.5 text-fg-soft">Volume</p>
        {VOLUME_TIERS.map((t) => (
          <p key={t.sol} className={cn("flex justify-between py-0.5 num", volume >= t.sol ? "text-buy" : "text-muted")}>
            <span>{t.sol.toLocaleString()} SOL</span>
            <span>+{t.points.toLocaleString()}</span>
          </p>
        ))}
      </div>
      <div>
        <p className="mb-1.5 text-fg-soft">Transactions</p>
        {TX_TIERS.map((t) => (
          <p key={t.count} className={cn("flex justify-between py-0.5 num", tx >= t.count ? "text-buy" : "text-muted")}>
            <span>{t.count.toLocaleString()} trades</span>
            <span>+{t.points.toLocaleString()}</span>
          </p>
        ))}
      </div>
      <p className="col-span-2 border-t border-line pt-2 text-fg-soft">Total {points.toLocaleString()} points</p>
    </div>
  );
}

function SolMark() {
  return (
    <svg width="26" height="26" viewBox="0 0 16 16" aria-hidden>
      <defs>
        <linearGradient id="rsol" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#9945FF" />
          <stop offset="1" stopColor="#14F195" />
        </linearGradient>
      </defs>
      <path d="M3.5 3h10l-1.5 2h-10z M2 7h10l1.5 2h-10z M3.5 11h10l-1.5 2h-10z" fill="url(#rsol)" />
    </svg>
  );
}

function niceMax(v: number) {
  const p = 10 ** Math.floor(Math.log10(v));
  return Math.ceil((v * 1.15) / p) * p;
}

function smooth(pts: readonly (readonly [number, number])[]) {
  if (!pts.length) return "";
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const mx = (x0 + x1) / 2;
    d += ` C ${mx} ${y0}, ${mx} ${y1}, ${x1} ${y1}`;
  }
  return d;
}

function trimSol(n: number) {
  return n === 0 ? "0" : n < 0.01 ? n.toFixed(4).replace(/0+$/, "") : n.toFixed(2).replace(/\.?0+$/, "");
}

/** 0.0002 → "0.0₃2", compact notation for tiny SOL amounts. */
function fmtSol(n: number) {
  if (n === 0) return "0";
  if (n >= 0.01) return n.toFixed(3).replace(/\.?0+$/, "");
  const s = n.toFixed(9);
  const m = /^0\.(0+)(\d{1,3})/.exec(s);
  if (!m) return s;
  const sub = String(m[1].length).split("").map((d) => "₀₁₂₃₄₅₆₇₈₉"[Number(d)]).join("");
  return `0.0${sub}${m[2].replace(/0+$/, "")}`;
}
