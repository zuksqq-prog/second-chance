export const SETTINGS_DEFAULTS = {
  buyPresetsSol: ["0.1", "0.25", "0.5", "1"],
  sellPresetsPct: [25, 50, 75, 100],
  slippageBps: 1000,
  priorityFeeLamports: "100000",
  defaultMode: "paper" as "paper" | "real",
  widget: { x: -1, y: -1, w: 340, h: 420, minimized: false, hidden: false, pinned: false },
};
export type Settings = typeof SETTINGS_DEFAULTS;
