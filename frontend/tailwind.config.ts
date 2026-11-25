import type { Config } from "tailwindcss";

const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: v("bg"),
        surface: v("surface"),
        subtle: v("subtle"),
        muted: v("muted"),
        ink: v("ink"),
        "ink-2": v("ink-2"),
        "ink-3": v("ink-3"),
        line: v("line"),
        "line-strong": v("line-strong"),
        primary: { DEFAULT: v("primary"), hover: v("primary-hover"), soft: v("primary-soft") },
        night: { DEFAULT: "#111827", 2: "#1F2937", 3: "#374151" },
        progress: "#2563EB",
        review: "#8B5CF6",
        done: "#12B76A",
        risk: "#F79009",
        blocked: "#F04438",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-manrope)", "var(--font-inter)", "ui-sans-serif", "sans-serif"],
      },
      borderRadius: { md: "8px", lg: "10px", xl: "12px" },
      boxShadow: {
        xs: "0 1px 2px rgb(16 24 40 / 0.04)",
        sm: "0 1px 3px rgb(16 24 40 / 0.06), 0 1px 2px rgb(16 24 40 / 0.03)",
        md: "0 4px 12px -2px rgb(16 24 40 / 0.08), 0 2px 4px -2px rgb(16 24 40 / 0.04)",
        lg: "0 16px 32px -8px rgb(16 24 40 / 0.14), 0 4px 8px -4px rgb(16 24 40 / 0.05)",
      },
      fontSize: { "2xs": ["11px", "16px"] },
      keyframes: {
        "slide-in": { from: { transform: "translateX(16px)", opacity: "0" }, to: { transform: "none", opacity: "1" } },
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "pop-in": { from: { transform: "scale(.98) translateY(4px)", opacity: "0" }, to: { transform: "none", opacity: "1" } },
      },
      animation: {
        "slide-in": "slide-in 180ms cubic-bezier(.2,.8,.2,1)",
        "fade-in": "fade-in 150ms ease-out",
        "pop-in": "pop-in 160ms cubic-bezier(.2,.8,.2,1)",
      },
    },
  },
  plugins: [],
} satisfies Config;
