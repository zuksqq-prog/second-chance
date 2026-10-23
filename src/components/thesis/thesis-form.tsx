"use client";

import { Plus, X } from "lucide-react";
import type { PlannedExit, ThesisContent } from "@/lib/client/types";
import { compactUsd, parseCompact } from "@/lib/domain/format";
import { Input, Textarea } from "@/components/ui/input";
import { cn, uuid } from "@/lib/utils";

/** Editable draft (strings) → validated ThesisContent. */
export interface ThesisDraft {
  reason: string;
  target: string;
  holdingPeriod: string;
  invalidation: string;
  exits: { id: string; at: string; pct: string }[];
  notes: string;
}

export const emptyDraft = (): ThesisDraft => ({ reason: "", target: "", holdingPeriod: "", invalidation: "", exits: [], notes: "" });

export function draftFromContent(c: ThesisContent): ThesisDraft {
  return {
    reason: c.reason,
    target: compactUsd(c.targetMarketCap).replace("$", ""),
    holdingPeriod: c.holdingPeriod ?? "",
    invalidation: c.invalidation ?? "",
    exits: c.plannedExits.map((e) => ({ id: e.id, at: compactUsd(e.atMarketCap).replace("$", ""), pct: String(e.sellPercent) })),
    notes: c.notes ?? "",
  };
}

export function isDraftEmpty(d: ThesisDraft) {
  return !d.reason.trim() && !d.target.trim() && !d.invalidation.trim() && d.exits.length === 0 && !d.notes.trim();
}

export function draftToContent(d: ThesisDraft): { ok: true; content: ThesisContent } | { ok: false; error: string } {
  if (d.reason.trim().length < 3) return { ok: false, error: "Say briefly why you're buying." };
  const target = parseCompact(d.target);
  if (!target) return { ok: false, error: "Set a target market cap, like 10M." };
  const exits: PlannedExit[] = [];
  let total = 0;
  for (const e of d.exits) {
    const at = parseCompact(e.at);
    const pct = Number(e.pct);
    if (!at || !(pct > 0) || pct > 100) return { ok: false, error: "Each planned exit needs a market cap and a percent between 1 and 100." };
    total += pct;
    exits.push({ id: e.id, atMarketCap: at, sellPercent: pct });
  }
  if (total > 100) return { ok: false, error: "Planned exits add up to more than 100%." };
  return {
    ok: true,
    content: {
      reason: d.reason.trim(),
      targetMarketCap: target,
      holdingPeriod: d.holdingPeriod.trim() || null,
      invalidation: d.invalidation.trim() || null,
      plannedExits: exits.sort((a, b) => a.atMarketCap - b.atMarketCap),
      notes: d.notes.trim() || null,
    },
  };
}

const HOLD_CHIPS = ["Hours", "A few days", "1–2 weeks", "A month+"];

export function ThesisForm({
  draft,
  onChange,
  currentMarketCap,
  idPrefix = "thesis",
  compact,
}: {
  draft: ThesisDraft;
  onChange: (d: ThesisDraft) => void;
  currentMarketCap: number | null;
  idPrefix?: string;
  compact?: boolean;
}) {
  const target = parseCompact(draft.target);
  const multiple = target && currentMarketCap ? target / currentMarketCap : null;
  const set = (patch: Partial<ThesisDraft>) => onChange({ ...draft, ...patch });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor={`${idPrefix}-reason`} className="text-2xs text-muted">Why are you buying?</label>
        <Textarea
          id={`${idPrefix}-reason`}
          rows={compact ? 2 : 3}
          value={draft.reason}
          onChange={(e) => set({ reason: e.target.value })}
          placeholder="The narrative, the catalyst, why now. Future you will read this."
          className="font-voice text-[15px] italic leading-snug"
          maxLength={2000}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-target`} className="flex justify-between text-2xs text-muted">
            <span>Target market cap</span>
            {multiple && <span className={cn("num", multiple < 1 ? "text-sell" : "text-signal")}>{multiple.toFixed(1)}×</span>}
          </label>
          <Input id={`${idPrefix}-target`} value={draft.target} onChange={(e) => set({ target: e.target.value })} placeholder="10M" inputMode="decimal" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-hold`} className="text-2xs text-muted">Holding period</label>
          <Input id={`${idPrefix}-hold`} value={draft.holdingPeriod} onChange={(e) => set({ holdingPeriod: e.target.value })} placeholder="2 weeks" maxLength={80} />
        </div>
      </div>
      <div className="-mt-1 flex flex-wrap gap-1">
        {HOLD_CHIPS.map((c) => (
          <button key={c} type="button" onClick={() => set({ holdingPeriod: c })} className={cn("rounded-sm border px-1.5 py-0.5 text-2xs", draft.holdingPeriod === c ? "border-signal/50 text-signal" : "border-line text-muted hover:text-fg")}>
            {c}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={`${idPrefix}-inval`} className="text-2xs text-muted">What would prove you wrong?</label>
        <Input id={`${idPrefix}-inval`} value={draft.invalidation} onChange={(e) => set({ invalidation: e.target.value })} placeholder="Dev sells, liquidity pulled, volume dies" maxLength={1000} />
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-2xs text-muted">
          <span>Planned partial exits</span>
          <button type="button" onClick={() => set({ exits: [...draft.exits, { id: uuid().slice(0, 8), at: "", pct: "25" }] })} className="flex items-center gap-0.5 text-signal hover:brightness-110" disabled={draft.exits.length >= 10}>
            <Plus size={11} /> Add exit
          </button>
        </div>
        {draft.exits.length === 0 && <p className="text-2xs text-muted/70">Selling a planned slice at its level won’t trigger a reminder.</p>}
        {draft.exits.map((e, i) => (
          <div key={e.id} className="flex items-center gap-1.5">
            <span className="text-2xs text-muted">Sell</span>
            <Input aria-label={`Exit ${i + 1} percent`} value={e.pct} onChange={(ev) => set({ exits: draft.exits.map((x) => (x.id === e.id ? { ...x, pct: ev.target.value } : x)) })} className="h-7 w-14 text-xs" inputMode="decimal" />
            <span className="text-2xs text-muted">% at</span>
            <Input aria-label={`Exit ${i + 1} market cap`} value={e.at} onChange={(ev) => set({ exits: draft.exits.map((x) => (x.id === e.id ? { ...x, at: ev.target.value } : x)) })} placeholder="5M" className="h-7 flex-1 text-xs" />
            <button type="button" aria-label="Remove exit" onClick={() => set({ exits: draft.exits.filter((x) => x.id !== e.id) })} className="text-muted hover:text-sell">
              <X size={13} />
            </button>
          </div>
        ))}
      </div>

      {!compact && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-notes`} className="text-2xs text-muted">Notes</label>
          <Textarea id={`${idPrefix}-notes`} rows={2} value={draft.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Anything else" maxLength={2000} />
        </div>
      )}
    </div>
  );
}
