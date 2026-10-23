import type { Config } from "tailwindcss";

/*
 * Token system
 *  ink      graphite-blue grounds, layered from deepest (ink-0) to raised (ink-3)
 *  line     hairlines between panels
 *  fg/muted text
 *  signal   the single accent — amber, the caution light SECOND CHANCE is built around
 *  buy/sell semantic only, never decorative
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { 0: "#0c0f13", 1: "#11151b", 2: "#161b23", 3: "#1d232d" },
        line: { DEFAULT: "#242b36", strong: "#323b48" },
        fg: { DEFAULT: "#e3e7ed", soft: "#b9c1cc" },
        muted: "#7f8a99",
        signal: { DEFAULT: "#e9a23b", soft: "#e9a23b1f", deep: "#b97a1e" },
        buy: { DEFAULT: "#38c98b", soft: "#38c98b1a" },
        sell: { DEFAULT: "#ee5d66", soft: "#ee5d661a" },
      },
      fontFamily: {
        sans: ["var(--font-plex)", "ui-sans-serif", "system-ui", "sans-serif"],
        voice: ["var(--font-newsreader)", "ui-serif", "Georgia", "serif"],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
      },
      borderRadius: { sm: "3px", DEFAULT: "5px", md: "7px", lg: "10px" },
      keyframes: {
        "slide-in": { from: { transform: "translateY(6px)", opacity: "0" }, to: { transform: "none", opacity: "1" } },
        tick: { "0%": { backgroundColor: "var(--tick)" }, "100%": { backgroundColor: "transparent" } },
      },
      animation: {
        "slide-in": "slide-in 160ms ease-out",
        tick: "tick 900ms ease-out",
      },
    },
  },
  plugins: [],
};
export default config;
