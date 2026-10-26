"use client";

import { useApp } from "@/lib/client/store";
import { MobileNav, Sidebar } from "./shell/sidebar";
import { TopBar } from "./shell/topbar";
import { Toaster } from "./shell/toaster";
import { DiscoverView } from "./discover/discover-view";
import { TradeView } from "./trade/trade-view";
import { PortfolioView } from "./portfolio/portfolio-view";
import { ThesesView } from "./thesis/theses-view";
import { WatchlistView } from "./watchlist/watchlist-view";
import { SettingsView } from "./settings/settings-view";
import { ThesisWidget } from "./thesis/thesis-widget";
import { InstantTrade } from "./trade/instant-trade";
import { ModeBanner } from "./shell/mode-banner";

export function Terminal() {
  const { view } = useApp();
  return (
    <div className="flex h-full min-h-0">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <ModeBanner />
        <main className="min-h-0 flex-1 overflow-hidden">
          {view === "discover" && <DiscoverView />}
          {view === "trade" && <TradeView />}
          {view === "portfolio" && <PortfolioView />}
          {view === "theses" && <ThesesView />}
          {view === "watchlist" && <WatchlistView />}
          {view === "settings" && <SettingsView />}
        </main>
        <MobileNav />
      </div>
      <ThesisWidget />
      <InstantTrade />
      <Toaster />
    </div>
  );
}
