"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Download, RotateCcw, Search, Share2, Upload, X } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { useApp } from "@/lib/client/store";
import {
  countActive,
  emptyFilter,
  PROTOCOLS,
  QUOTES,
  sanitizeFilter,
  type AgeUnit,
  type PulseFilter,
  type Quote,
  type Range,
} from "@/lib/domain/pulse-filters";
import { cn } from "@/lib/utils";

export type ColKey = "newPairs" | "finalStretch" | "migrated";
export type PulseFilters = Record<ColKey, PulseFilter>;
export const COL_TITLES: Record<ColKey, string> = { newPairs: "New Pairs", finalStretch: "Final Stretch", migrated: "Migrated" };
const COL_ORDER: ColKey[] = ["newPairs", "finalStretch", "migrated"];

export const emptyFilters = (): PulseFilters => ({ newPairs: emptyFilter(), finalStretch: emptyFilter(), migrated: emptyFilter() });

type Section = "protocols" | "audit" | "metrics" | "socials";
const PRESET_KEY = (n: number) => `sc.pulsePreset.${n}`;

export function sanitizeFilters(x: unknown): PulseFilters | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const out = emptyFilters();
  for (const k of COL_ORDER) out[k] = sanitizeFilter(o[k]) ?? emptyFilter();
  return out;
}

/**
 * Pulse Filters: one panel for all three columns. Changes are a draft until
 * "Apply to all". Presets 1–3 remember full sets; the active preset is saved on apply.
 */
export function PulseFiltersPanel({
  open,
  onClose,
  initialCol,
  applied,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  initialCol: ColKey;
  applied: PulseFilters;
  onApply: (f: PulseFilters) => void;
}) {
  const { toast } = useApp();
  const [col, setCol] = useState<ColKey>(initialCol);
  const [section, setSection] = useState<Section>("protocols");
  const [draft, setDraft] = useState<PulseFilters>(applied);
  const [preset, setPreset] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const appliedRef = useRef(applied);
  appliedRef.current = applied;
  useEffect(() => {
    if (open) {
      setDraft(appliedRef.current);
      setCol(initialCol);
      try {
        const p = Number(localStorage.getItem("sc.pulsePreset.active"));
        setPreset(p >= 1 && p <= 3 ? p : null);
      } catch {
        /* ignore */
      }
    }
  }, [open, initialCol]);

  const f = draft[col];
  const set = (patch: Partial<PulseFilter>) => setDraft((d) => ({ ...d, [col]: { ...d[col], ...patch } }));
  const counts = countActive(f);

  const loadPreset = (n: number) => {
    setPreset(n);
    try {
      localStorage.setItem("sc.pulsePreset.active", String(n));
      const raw = localStorage.getItem(PRESET_KEY(n));
      const parsed = raw ? sanitizeFilters(JSON.parse(raw)) : null;
      setDraft(parsed ?? emptyFilters());
      toast({ tone: "info", title: parsed ? `Preset ${n} loaded` : `Preset ${n} is empty`, body: parsed ? undefined : "Set filters and press Apply to save them here." });
    } catch {
      /* ignore */
    }
  };

  const apply = () => {
    if (preset) {
      try {
        localStorage.setItem(PRESET_KEY(preset), JSON.stringify(draft));
      } catch {
        /* ignore */
      }
    }
    onApply(draft);
    onClose();
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ app: "second-chance", kind: "pulse-filters", v: 1, filters: draft }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "pulse-filters.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const importJson = async (file: File) => {
    try {
      const j = JSON.parse(await file.text());
      const parsed = sanitizeFilters(j?.filters ?? j);
      if (!parsed) throw new Error();
      setDraft(parsed);
      toast({ tone: "ok", title: "Filters imported", body: "Press Apply to use them." });
    } catch {
      toast({ tone: "error", title: "That file isn't a Pulse filter export" });
    }
  };
  const share = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(draft));
      toast({ tone: "ok", title: "Filters copied", body: "Paste them into a file and import, or send to a friend." });
    } catch {
      toast({ tone: "error", title: "Couldn't copy to clipboard" });
    }
  };

  return (
    <Dialog open={open} onClose={onClose} labelledBy="pf-title" className="flex max-h-[92vh] max-w-[560px] flex-col overflow-hidden rounded-2xl bg-ink-1">
      {/* header */}
      <div className="flex shrink-0 items-center gap-3 px-5 pt-5">
        <Search size={17} className="text-muted" />
        <h2 id="pf-title" className="text-lg font-medium">Pulse Filters</h2>
        <div className="ml-auto flex items-center gap-1">
          {[1, 2, 3].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => loadPreset(n)}
              aria-pressed={preset === n}
              title={`Preset ${n}`}
              className={cn("h-7 w-7 rounded-full border border-dashed text-xs", preset === n ? "border-buy text-buy" : "border-line-strong text-muted hover:text-fg")}
            >
              {n}
            </button>
          ))}
          <span className="mx-1 h-5 w-px bg-line" />
          <IconBtn label="Export filters" onClick={exportJson}><Download size={15} /></IconBtn>
          <IconBtn label="Import filters" onClick={() => fileRef.current?.click()}><Upload size={15} /></IconBtn>
          <IconBtn label="Copy filters" onClick={share}><Share2 size={15} /></IconBtn>
          <span className="mx-1 h-5 w-px bg-line" />
          <IconBtn label="Close" onClick={onClose}><X size={16} /></IconBtn>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => e.target.files?.[0] && void importJson(e.target.files[0])} />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4 pt-4">
        {/* column tabs */}
        <div className="flex items-center gap-1">
          {COL_ORDER.map((k) => {
            const n = countActive(draft[k]).total;
            return (
              <button key={k} type="button" onClick={() => setCol(k)} className={cn("flex items-center gap-1.5 rounded-full px-4 py-2 text-[14px]", col === k ? "bg-ink-3 text-fg" : "text-fg-soft/80 hover:text-fg")}>
                {COL_TITLES[k]}
                {n > 0 && <Badge n={n} />}
              </button>
            );
          })}
          <IconBtn label={`Reset ${COL_TITLES[col]} filters`} onClick={() => setDraft((d) => ({ ...d, [col]: emptyFilter() }))} className="ml-auto">
            <RotateCcw size={16} />
          </IconBtn>
        </div>

        {/* keywords */}
        <div className="mt-4 grid grid-cols-2 gap-4 rounded-2xl border border-line bg-ink-0/40 p-4 max-sm:grid-cols-1">
          <ChipInput id="pf-kw" label="Search Keywords" values={f.keywords} onChange={(keywords) => set({ keywords })} />
          <ChipInput id="pf-ex" label="Exclude Keywords" values={f.exclude} onChange={(exclude) => set({ exclude })} />
        </div>

        {/* section tabs */}
        <div className="mt-4 flex flex-wrap items-center gap-1">
          {(
            [
              ["protocols", "Protocols", counts.protocols],
              ["audit", "Audit", counts.audit],
              ["metrics", "$ Metrics", counts.metrics],
              ["socials", "Socials", counts.socials],
            ] as [Section, string, number][]
          ).map(([s, label, n]) => (
            <button key={s} type="button" onClick={() => setSection(s)} className={cn("flex items-center gap-1.5 rounded-full px-4 py-2 text-[14px]", section === s ? "bg-ink-3 text-fg" : "text-fg-soft/80 hover:text-fg")}>
              {label}
              {n > 0 && <Badge n={n} />}
            </button>
          ))}
        </div>

        <div className="mt-3">
          {section === "protocols" && <ProtocolsSection f={f} set={set} />}
          {section === "audit" && <AuditSection f={f} set={set} />}
          {section === "metrics" && <MetricsSection f={f} set={set} />}
          {section === "socials" && <SocialsSection f={f} set={set} />}
        </div>
      </div>

      <div className="flex shrink-0 justify-end border-t border-line px-5 py-4">
        <button type="button" onClick={apply} className="rounded-full bg-buy px-5 py-2 text-[14px] font-semibold text-ink-0 hover:brightness-110">
          Apply to all{preset ? ` · save to preset ${preset}` : ""}
        </button>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------- sections

type SetFn = (patch: Partial<PulseFilter>) => void;

function ProtocolsSection({ f, set }: { f: PulseFilter; set: SetFn }) {
  const [more, setMore] = useState(false);
  const all = PROTOCOLS.map((p) => p.id);
  const on = (id: string) => f.protocols.length === 0 || f.protocols.includes(id);
  const toggle = (id: string) => {
    const cur = f.protocols.length ? f.protocols : all;
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    set({ protocols: next.length === all.length ? [] : next.length === 0 ? [id === all[0] ? all[1] : all[0]] : next });
  };
  const shown = more ? PROTOCOLS : PROTOCOLS.slice(0, 12);
  const qOn = (q: Quote) => f.quotes.length === 0 || f.quotes.includes(q);
  const qToggle = (q: Quote) => {
    const cur = f.quotes.length ? f.quotes : [...QUOTES];
    const next = cur.includes(q) ? cur.filter((x) => x !== q) : [...cur, q];
    set({ quotes: next.length === QUOTES.length || next.length === 0 ? [] : next });
  };
  return (
    <div className="flex flex-col gap-4">
      <Card title="Protocols" action={<SmallBtn onClick={() => set({ protocols: [] })}>Select All</SmallBtn>}>
        <div className="grid grid-cols-3 gap-2 max-sm:grid-cols-2">
          {shown.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={on(p.id)}
              onClick={() => toggle(p.id)}
              className={cn("flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-[13px] transition-opacity", on(p.id) ? "opacity-100" : "opacity-35 hover:opacity-60")}
              style={{ borderColor: `${p.color}66`, color: p.color, background: on(p.id) ? `${p.color}14` : "transparent" }}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
              {p.label}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setMore((m) => !m)} className="mt-3 flex items-center gap-1 rounded-full bg-ink-2 px-3 py-1 text-xs text-fg-soft hover:text-fg">
          {more ? "Show less" : `Show more ${PROTOCOLS.length - 12}`} {more ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          {f.protocols.length > 0 && <Badge n={f.protocols.length} />}
        </button>
      </Card>
      <Card title="Quote Tokens" action={<SmallBtn onClick={() => set({ quotes: [] })}>Select All</SmallBtn>}>
        <div className="grid grid-cols-3 gap-2 max-sm:grid-cols-2">
          {QUOTES.map((q) => (
            <button
              key={q}
              type="button"
              aria-pressed={qOn(q)}
              onClick={() => qToggle(q)}
              className={cn("w-fit rounded-full border px-3 py-1 text-[13px]", qOn(q) ? "border-buy/60 bg-buy/10 text-buy" : "border-line text-muted hover:text-fg")}
            >
              {q}
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}

function AuditSection({ f, set }: { f: PulseFilter; set: SetFn }) {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <Label>Age</Label>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex gap-1.5">
            <NumInput id="pf-age-min" placeholder="Min" value={f.age.min} onChange={(v) => set({ age: { ...f.age, min: v } })} />
            <UnitSelect id="pf-age-minu" value={f.age.minUnit} onChange={(u) => set({ age: { ...f.age, minUnit: u } })} />
          </div>
          <div className="flex gap-1.5">
            <NumInput id="pf-age-max" placeholder="Max" value={f.age.max} onChange={(v) => set({ age: { ...f.age, max: v } })} />
            <UnitSelect id="pf-age-maxu" value={f.age.maxUnit} onChange={(u) => set({ age: { ...f.age, maxUnit: u } })} />
          </div>
        </div>
      </Card>
      <Unavailable
        fields={["Top 10 Holders %", "Dev Holding %", "Snipers %", "Insiders %", "Bundle %", "Holders", "Pro Traders", "Recent Visitors", "Image Reuse", "Dev Migrations", "Dev Pairs Created", "Dev Migrations %"]}
        reason="These need per-wallet holder analytics (snipers, bundles, dev history). They switch on once a holder-analytics provider such as Helius DAS or Birdeye is connected."
      />
    </div>
  );
}

function MetricsSection({ f, set }: { f: PulseFilter; set: SetFn }) {
  const rows: [keyof PulseFilter, string][] = [
    ["liquidity", "Liquidity ($)"],
    ["volume", "Volume 24h ($)"],
    ["marketCap", "Market Cap ($)"],
    ["bcurve", "B. curve %"],
    ["txns", "Txns 24h"],
    ["buys", "Num Buys 24h"],
    ["sells", "Num Sells 24h"],
    ["buyers1h", "Buyers 1h"],
  ];
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-col gap-4">
          {rows.map(([k, label]) => (
            <RangeRow key={k} id={`pf-${k}`} label={label} value={f[k] as Range} onChange={(r) => set({ [k]: r } as Partial<PulseFilter>)} />
          ))}
        </div>
        <p className="mt-3 text-2xs text-muted">Shorthand works: 6k, 1.5m. B. curve % is read on-chain for pump.fun tokens only.</p>
      </Card>
      <Unavailable fields={["Global Fees Paid (SOL)"]} reason="Fee totals per token aren't in the current data feeds." />
    </div>
  );
}

function SocialsSection({ f, set }: { f: PulseFilter; set: SetFn }) {
  const toggles: [keyof PulseFilter["socials"], string][] = [
    ["dexPaid", "Dex Paid"],
    ["twitter", "Twitter"],
    ["website", "Website"],
    ["telegram", "Telegram"],
    ["atLeastOne", "At Least One Social"],
  ];
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {toggles.map(([k, label]) => (
            <button
              key={k}
              type="button"
              aria-pressed={f.socials[k]}
              onClick={() => set({ socials: { ...f.socials, [k]: !f.socials[k] } })}
              className={cn("rounded-lg border px-3 py-2 text-[13px]", k === "atLeastOne" && "col-span-2", f.socials[k] ? "border-buy/60 bg-buy/10 text-buy" : "border-line text-fg-soft hover:text-fg")}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="mt-3 text-2xs text-muted">Links and Dex Paid come from DexScreener token profiles. Very new launches often have none yet.</p>
      </Card>
      <Unavailable
        fields={["TikTok", "Only Pump Live", "X profile only", "No X link", "Only X, no other links", "Twitter Followers", "Twitter Following", "X Reuses", "X Renames", "Tweet Age", "Community Members"]}
        reason="These need an X (Twitter) data source and pump.fun livestream status, which aren't connected."
      />
    </div>
  );
}

// ------------------------------------------------------------- bits

function Card({ title, action, children }: { title?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-ink-0/40 p-4">
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between">
          {title && <h3 className="text-[14px] text-fg-soft">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

function Unavailable({ fields, reason }: { fields: string[]; reason: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-line p-4">
      <p className="text-xs text-fg-soft">Not available yet</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {fields.map((x) => (
          <span key={x} className="rounded-full border border-line px-2 py-0.5 text-2xs text-muted/70" aria-disabled>
            {x}
          </span>
        ))}
      </div>
      <p className="mt-2 text-2xs text-muted">{reason}</p>
    </div>
  );
}

function RangeRow({ id, label, value, onChange }: { id: string; label: string; value: Range; onChange: (r: Range) => void }) {
  return (
    <div>
      <Label htmlFor={`${id}-min`}>{label}</Label>
      <div className="grid grid-cols-2 gap-3">
        <NumInput id={`${id}-min`} placeholder="Min" value={value.min} onChange={(v) => onChange({ ...value, min: v })} />
        <NumInput id={`${id}-max`} placeholder="Max" value={value.max} onChange={(v) => onChange({ ...value, max: v })} />
      </div>
    </div>
  );
}

function NumInput({ id, value, onChange, placeholder }: { id: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <input
      id={id}
      value={value}
      inputMode="decimal"
      placeholder={placeholder}
      aria-label={placeholder}
      onChange={(e) => onChange(e.target.value.replace(/[^\d.kmbKMB$,]/g, "").slice(0, 16))}
      className="h-9 w-full min-w-0 rounded-md border border-line bg-ink-1 px-3 text-[13px] num placeholder:text-muted/70 focus:border-signal/60 focus:outline-none"
    />
  );
}

function UnitSelect({ id, value, onChange }: { id: string; value: AgeUnit; onChange: (u: AgeUnit) => void }) {
  return (
    <select id={id} aria-label="Unit" value={value} onChange={(e) => onChange(e.target.value as AgeUnit)} className="h-9 rounded-md border border-line bg-ink-1 px-2 text-[13px] focus:border-signal/60 focus:outline-none">
      <option value="s">s</option>
      <option value="m">m</option>
      <option value="h">h</option>
      <option value="d">d</option>
    </select>
  );
}

function ChipInput({ id, label, values, onChange }: { id: string; label: string; values: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState("");
  const add = () => {
    const t = text.trim().slice(0, 40);
    if (t && !values.includes(t) && values.length < 20) onChange([...values, t]);
    setText("");
  };
  return (
    <div className="min-w-0">
      <Label htmlFor={id}>{label}</Label>
      <input
        id={id}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
        placeholder="Type a keyword, press Enter"
        className="h-9 w-full rounded-md border border-line bg-ink-1 px-3 text-[13px] placeholder:text-muted/70 focus:border-signal/60 focus:outline-none"
      />
      {values.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {values.map((v) => (
            <span key={v} className="flex items-center gap-1 rounded-full bg-ink-3 py-0.5 pl-2 pr-1 text-2xs">
              {v}
              <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))} className="text-muted hover:text-fg">
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Label({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-xs text-fg-soft">
      {children}
    </label>
  );
}

function Badge({ n }: { n: number }) {
  return <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-buy px-1 text-[11px] font-semibold text-ink-0">{n}</span>;
}

function SmallBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="rounded-full bg-ink-2 px-3 py-1 text-xs text-fg-soft hover:text-fg">
      {children}
    </button>
  );
}

function IconBtn({ children, label, onClick, className }: { children: React.ReactNode; label: string; onClick: () => void; className?: string }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className={cn("rounded-full p-1.5 text-fg-soft hover:bg-ink-3 hover:text-fg", className)}>
      {children}
    </button>
  );
}
