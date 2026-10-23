"use client";

import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { del, fetcher, post } from "@/lib/client/api";
import { useApp } from "@/lib/client/store";
import { useSession } from "@/lib/client/session";
import { usePortfolio } from "@/lib/client/hooks";
import type { ThesisContent, ThesisDTO } from "@/lib/client/types";
import { compactUsd } from "@/lib/domain/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Empty } from "@/components/portfolio/positions-table";
import { ThesisForm, draftFromContent, draftToContent, emptyDraft, type ThesisDraft } from "./thesis-form";
import { cn } from "@/lib/utils";

interface Revision {
  revisionNo: number;
  content: ThesisContent;
  changedFields: string[];
  changeReason: string;
  trigger: "edit" | "second_chance";
  marketCapAtChange: number | null;
  createdAt: string;
}

export function ThesesView() {
  const { mode } = useApp();
  const { status } = useSession();
  const { data, error } = useSWR<{ theses: ThesisDTO[] }>(status === "signed_in" ? `/api/theses?mode=${mode}` : null, fetcher);
  const { data: portfolio } = usePortfolio();
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState<{ mint: string; symbol: string; marketCap: number | null } | null>(null);

  if (status !== "signed_in") return <Empty text="Sign in with your wallet to see your theses." />;
  if (error) return <Empty text={(error as Error).message} tone="error" />;
  const theses = data?.theses ?? [];
  const active = theses.filter((t) => t.status === "active");
  const closed = theses.filter((t) => t.status === "closed");
  const withoutThesis = (portfolio?.rows ?? []).filter((r) => !r.thesis);
  const current = theses.find((t) => t.id === selected) ?? active[0] ?? closed[0] ?? null;

  return (
    <div className="grid h-full min-h-0 grid-cols-1 md:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="min-h-0 overflow-y-auto border-b border-line md:border-b-0 md:border-r">
        <Group title="Active" items={active} current={creating ? null : current} onSelect={(id) => { setCreating(null); setSelected(id); }} />
        {withoutThesis.length > 0 && (
          <div className="border-t border-line px-3 py-3">
            <p className="mb-2 text-2xs text-muted">Held without a thesis</p>
            <div className="flex flex-wrap gap-1.5">
              {withoutThesis.map((r) => (
                <button key={r.mint} type="button" onClick={() => setCreating({ mint: r.mint, symbol: r.symbol, marketCap: r.marketCap })} className="rounded-sm border border-dashed border-line px-2 py-1 text-xs text-fg-soft hover:border-signal/50 hover:text-signal">
                  + {r.symbol}
                </button>
              ))}
            </div>
          </div>
        )}
        <Group title="Closed" items={closed} current={creating ? null : current} onSelect={(id) => { setCreating(null); setSelected(id); }} />
        {theses.length === 0 && withoutThesis.length === 0 && <Empty text="No theses yet. Write one when you buy; it takes ten seconds." />}
      </aside>
      <section className="min-h-0 overflow-y-auto">
        {creating ? (
          <CreateThesis target={creating} onDone={() => setCreating(null)} />
        ) : current ? (
          <ThesisDetail key={current.id} thesis={current} />
        ) : null}
      </section>
    </div>
  );
}

function Group({ title, items, current, onSelect }: { title: string; items: ThesisDTO[]; current: ThesisDTO | null; onSelect: (id: string) => void }) {
  if (!items.length) return null;
  return (
    <div className="py-2">
      <p className="px-3 pb-1 text-2xs text-muted">{title}</p>
      {items.map((t) => (
        <button key={t.id} type="button" onClick={() => onSelect(t.id)} className={cn("block w-full px-3 py-2 text-left hover:bg-ink-1", current?.id === t.id && "bg-ink-2")}>
          <span className="flex items-baseline justify-between">
            <span className="font-medium">{t.tokenSymbol ?? t.mint.slice(0, 6)}</span>
            <span className="text-2xs text-muted num">→ {compactUsd(t.targetMarketCap)}</span>
          </span>
          <span className="mt-0.5 line-clamp-1 font-voice text-[13px] italic text-fg-soft">{t.original.reason}</span>
        </button>
      ))}
    </div>
  );
}

function ThesisDetail({ thesis }: { thesis: ThesisDTO }) {
  const { toast, selectToken } = useApp();
  const { mutate } = useSWRConfig();
  const { data } = useSWR<{ revisions: Revision[] }>(`/api/theses/${thesis.id}`, fetcher);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ThesisDraft>(() => draftFromContent(thesis));
  const [reason, setReason] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const refresh = () => mutate((k) => typeof k === "string" && k.startsWith("/api/theses"));

  const save = async () => {
    const r = draftToContent(draft);
    if (!r.ok) return toast({ tone: "error", title: "Can't save", body: r.error });
    setSaving(true);
    try {
      await post(`/api/theses/${thesis.id}`, { patch: r.content, reason }, "PATCH");
      toast({ tone: "ok", title: "Revision saved", body: "Your original thesis is unchanged." });
      setEditing(false);
      setReason("");
      void refresh();
    } catch (e) {
      toast({ tone: "error", title: "Couldn't save revision", body: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">
          <button type="button" className="hover:text-signal" onClick={() => selectToken(thesis.mint)}>{thesis.tokenSymbol ?? thesis.mint.slice(0, 8)}</button>
          <span className="ml-2 text-xs font-normal text-muted">{thesis.status === "active" ? "Active" : "Closed"} · written {new Date(thesis.createdAt).toLocaleDateString()}</span>
        </h2>
        {thesis.status === "active" && !editing && (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Revise</Button>
        )}
      </div>

      <div className="mt-5 rounded-md border border-signal/25 bg-signal-soft/30 p-5">
        <p className="text-2xs text-signal">Original thesis · can’t be edited</p>
        <blockquote className="mt-2 font-voice text-[19px] italic leading-relaxed">“{thesis.original.reason}”</blockquote>
        <dl className="mt-4 grid grid-cols-2 gap-y-1.5 text-xs sm:grid-cols-3">
          <Meta k="Entry" v={compactUsd(thesis.entryMarketCap)} />
          <Meta k="Target" v={compactUsd(thesis.original.targetMarketCap)} />
          <Meta k="Hold" v={thesis.original.holdingPeriod ?? "—"} />
        </dl>
        {thesis.original.invalidation && <p className="mt-3 text-xs text-fg-soft">Wrong if: <span className="font-voice text-[14px] italic">{thesis.original.invalidation}</span></p>}
        {thesis.original.plannedExits.length > 0 && (
          <p className="mt-2 text-xs text-fg-soft">Planned exits: {thesis.original.plannedExits.map((e) => `${e.sellPercent}% at ${compactUsd(e.atMarketCap)}`).join(", ")}</p>
        )}
      </div>

      {thesis.revisionCount > 0 && (
        <div className="mt-4 rounded-md border border-line p-4">
          <p className="text-2xs text-muted">Current plan</p>
          <p className="mt-1 text-sm">Target {compactUsd(thesis.targetMarketCap)}{thesis.holdingPeriod ? ` · hold ${thesis.holdingPeriod}` : ""}</p>
          {thesis.reason !== thesis.original.reason && <p className="mt-1 font-voice text-[15px] italic text-fg-soft">“{thesis.reason}”</p>}
        </div>
      )}

      {editing && (
        <div className="mt-4 rounded-md border border-line p-4">
          <ThesisForm draft={draft} onChange={setDraft} currentMarketCap={null} idPrefix="edit-thesis" />
          <div className="mt-3 flex flex-col gap-1">
            <label htmlFor="rev-reason" className="text-2xs text-muted">Why are you changing it? (required)</label>
            <Input id="rev-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="New information, changed conditions…" />
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => { setEditing(false); setDraft(draftFromContent(thesis)); }}>Cancel</Button>
            <Button variant="signal" size="sm" disabled={reason.trim().length < 3 || saving} onClick={save}>Save revision</Button>
          </div>
        </div>
      )}

      <h3 className="mt-8 text-xs font-medium text-fg-soft">Revision history</h3>
      <ol className="mt-2 border-l border-line">
        {(data?.revisions ?? []).map((r) => (
          <li key={r.revisionNo} className="relative pb-4 pl-4">
            <span className={cn("absolute -left-[4px] top-1.5 h-2 w-2 rounded-full", r.trigger === "second_chance" ? "bg-signal" : "bg-line-strong")} />
            <p className="text-2xs text-muted num">
              {new Date(r.createdAt).toLocaleString()} {r.marketCapAtChange != null && `· at ${compactUsd(r.marketCapAtChange)}`} {r.trigger === "second_chance" && "· from a SECOND CHANCE reminder"}
            </p>
            <p className="mt-0.5 text-xs">{r.revisionNo === 0 ? "Thesis written" : r.changeReason}</p>
            {r.revisionNo > 0 && r.changedFields.length > 0 && <p className="text-2xs text-muted">Changed: {r.changedFields.join(", ")}</p>}
          </li>
        ))}
      </ol>

      <div className="mt-8 border-t border-line pt-4">
        {confirmDelete ? (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-fg-soft">Permanently delete this thesis and its full history?</span>
            <Button size="xs" variant="ghost" onClick={() => setConfirmDelete(false)}>Keep it</Button>
            <Button
              size="xs"
              variant="sell"
              onClick={async () => {
                try {
                  await del(`/api/theses/${thesis.id}`);
                  toast({ tone: "ok", title: "Thesis deleted" });
                  void refresh();
                } catch (e) {
                  toast({ tone: "error", title: "Delete failed", body: (e as Error).message });
                }
              }}
            >
              Delete permanently
            </Button>
          </div>
        ) : (
          <Button size="xs" variant="quiet" onClick={() => setConfirmDelete(true)}>Delete this thesis</Button>
        )}
      </div>
    </div>
  );
}

function CreateThesis({ target, onDone }: { target: { mint: string; symbol: string; marketCap: number | null }; onDone: () => void }) {
  const { mode, toast } = useApp();
  const { mutate } = useSWRConfig();
  const [draft, setDraft] = useState<ThesisDraft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  return (
    <div className="mx-auto max-w-xl p-5">
      <h2 className="text-lg font-semibold">Thesis for {target.symbol}</h2>
      <p className="mt-1 text-xs text-muted">You already hold this. Entry market cap is set to the current value{target.marketCap ? ` (${compactUsd(target.marketCap)})` : ""}.</p>
      <div className="mt-4">
        <ThesisForm draft={draft} onChange={setDraft} currentMarketCap={target.marketCap} idPrefix="new-thesis" />
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onDone}>Cancel</Button>
        <Button
          variant="signal"
          size="sm"
          disabled={saving}
          onClick={async () => {
            const r = draftToContent(draft);
            if (!r.ok) return toast({ tone: "error", title: "Can't save", body: r.error });
            setSaving(true);
            try {
              await post("/api/theses", { mint: target.mint, mode, content: r.content });
              toast({ tone: "ok", title: "Thesis saved" });
              void mutate((k) => typeof k === "string" && (k.startsWith("/api/theses") || k.startsWith("/api/portfolio")));
              onDone();
            } catch (e) {
              toast({ tone: "error", title: "Couldn't save thesis", body: (e as Error).message });
            } finally {
              setSaving(false);
            }
          }}
        >
          Save thesis
        </Button>
      </div>
    </div>
  );
}

function Meta({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-2xs text-muted">{k}</dt>
      <dd className="num">{v}</dd>
    </div>
  );
}
