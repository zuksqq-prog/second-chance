"use client";

import { useEffect, useState } from "react";
import { useSettings } from "@/lib/client/hooks";
import { useSession } from "@/lib/client/session";
import { useApp } from "@/lib/client/store";
import { post } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Empty } from "@/components/portfolio/positions-table";

export function SettingsView() {
  const { status, realTrading } = useSession();
  const { settings, limits, mutate } = useSettings();
  const { toast } = useApp();
  const [buy, setBuy] = useState("");
  const [sell, setSell] = useState("");
  const [slip, setSlip] = useState("");
  const [prio, setPrio] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setBuy(settings.buyPresetsSol.join(", "));
    setSell(settings.sellPresetsPct.join(", "));
    setSlip(String(settings.slippageBps / 100));
    setPrio(String(Number(settings.priorityFeeLamports) / 1e9));
  }, [settings]);

  if (status !== "signed_in") return <Empty text="Sign in with your wallet to change settings." />;

  const save = async () => {
    const buyPresetsSol = buy.split(",").map((s) => s.trim()).filter(Boolean);
    const sellPresetsPct = sell.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
    if (!buyPresetsSol.every((p) => /^\d+(\.\d{1,9})?$/.test(p) && Number(p) > 0)) return toast({ tone: "error", title: "Buy presets must be SOL amounts like 0.25" });
    if (!sellPresetsPct.every((p) => p > 0 && p <= 100)) return toast({ tone: "error", title: "Sell presets must be percents from 1 to 100" });
    const slippageBps = Math.round(Number(slip) * 100);
    const priorityFeeLamports = String(Math.round(Number(prio) * 1e9));
    setSaving(true);
    try {
      await post("/api/settings", { buyPresetsSol, sellPresetsPct, slippageBps, priorityFeeLamports }, "PUT");
      await mutate();
      toast({ tone: "ok", title: "Settings saved" });
    } catch (e) {
      toast({ tone: "error", title: "Couldn't save settings", body: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl overflow-y-auto p-5">
      <h2 className="text-lg font-semibold">Settings</h2>

      <section className="mt-6 flex flex-col gap-3">
        <h3 className="text-xs font-medium text-fg-soft">Trading presets</h3>
        <Labeled id="buy-presets" label="Quick-buy amounts (SOL, comma separated)">
          <Input id="buy-presets" value={buy} onChange={(e) => setBuy(e.target.value)} />
        </Labeled>
        <Labeled id="sell-presets" label="Quick-sell percents">
          <Input id="sell-presets" value={sell} onChange={(e) => setSell(e.target.value)} />
        </Labeled>
        <div className="grid grid-cols-2 gap-3">
          <Labeled id="def-slip" label={`Default slippage % (max ${(limits?.maxSlippageBps ?? 2000) / 100})`}>
            <Input id="def-slip" value={slip} onChange={(e) => setSlip(e.target.value)} inputMode="decimal" />
          </Labeled>
          <Labeled id="def-prio" label="Default priority fee (SOL)">
            <Input id="def-prio" value={prio} onChange={(e) => setPrio(e.target.value)} inputMode="decimal" />
          </Labeled>
        </div>
        <div>
          <Button variant="signal" onClick={save} disabled={saving}>Save settings</Button>
        </div>
      </section>

      <section className="mt-10 flex flex-col gap-2 text-xs">
        <h3 className="font-medium text-fg-soft">Real-money trading</h3>
        <p className={realTrading.enabled ? "text-buy" : "text-fg-soft"}>
          {realTrading.enabled ? `Enabled for your wallet. Buys are capped at ${limits?.maxRealTradeSol ?? "?"} SOL during the beta.` : realTrading.reason}
        </p>
        <p className="text-muted">Real trading is controlled on the server by the operator. Every real trade still needs your approval in your wallet.</p>
      </section>

      <section className="mt-10 flex flex-col gap-2 text-xs">
        <h3 className="font-medium text-fg-soft">Thesis widget</h3>
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => {
            try {
              localStorage.removeItem("sc.thesisWidget");
            } catch {
              /* ignore */
            }
            void post("/api/settings", { widget: { x: -1, y: -1, w: 340, h: 400, minimized: false, hidden: false, pinned: false } }, "PUT").then(() => window.location.reload());
          }}
        >
          Reset widget position
        </Button>
      </section>
    </div>
  );
}

function Labeled({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-2xs text-muted">{label}</label>
      {children}
    </div>
  );
}
