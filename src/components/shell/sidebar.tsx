"use client";

import { CandlestickChart, Compass, NotebookPen, PieChart, Settings, Star } from "lucide-react";
import { useApp, type View } from "@/lib/client/store";
import { cn } from "@/lib/utils";

const NAV: { view: View; label: string; icon: typeof Compass }[] = [
  { view: "discover", label: "Discover", icon: Compass },
  { view: "trade", label: "Trade", icon: CandlestickChart },
  { view: "portfolio", label: "Portfolio", icon: PieChart },
  { view: "theses", label: "Theses", icon: NotebookPen },
  { view: "watchlist", label: "Watchlist", icon: Star },
];

export function Sidebar() {
  const { view, setView } = useApp();
  return (
    <nav aria-label="Main" className="flex w-[64px] shrink-0 flex-col items-center border-r border-line bg-ink-1 py-2 max-md:hidden">
      <Mark />
      <div className="mt-4 flex flex-1 flex-col gap-1">
        {NAV.map((n) => (
          <NavItem key={n.view} active={view === n.view} onClick={() => setView(n.view)} label={n.label} Icon={n.icon} />
        ))}
      </div>
      <NavItem active={view === "settings"} onClick={() => setView("settings")} label="Settings" Icon={Settings} />
    </nav>
  );
}

function NavItem({ active, onClick, label, Icon }: { active: boolean; onClick: () => void; label: string; Icon: typeof Compass }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex w-[54px] flex-col items-center gap-1 rounded py-2 text-[10px] transition-colors",
        active ? "text-fg" : "text-muted hover:text-fg-soft",
      )}
    >
      {active && <span className="absolute left-[-5px] top-2 h-6 w-[2px] rounded-full bg-signal" />}
      <Icon size={17} strokeWidth={active ? 2 : 1.6} />
      <span>{label}</span>
    </button>
  );
}

/** The mark: a bar that falls short of a target tick, then a second, longer stroke that reaches it. */
function Mark() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-label="Second Chance" role="img">
      <rect x="1" y="1" width="26" height="26" rx="6" fill="#161b23" stroke="#323b48" />
      <path d="M8 19 L8 13" stroke="#7f8a99" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M14 19 L14 8" stroke="#e9a23b" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M18.5 8 L22 8" stroke="#e9a23b" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** Bottom tab bar for phones. */
export function MobileNav() {
  const { view, setView } = useApp();
  return (
    <nav aria-label="Main" className="flex border-t border-line bg-ink-1 md:hidden">
      {[...NAV, { view: "settings" as View, label: "Settings", icon: Settings }].map((n) => (
        <button
          key={n.view}
          type="button"
          onClick={() => setView(n.view)}
          className={cn("flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px]", view === n.view ? "text-signal" : "text-muted")}
        >
          <n.icon size={16} />
          {n.label}
        </button>
      ))}
    </nav>
  );
}
