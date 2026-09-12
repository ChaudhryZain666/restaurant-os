/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}", "../../packages/ui/src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Phase 66 — `primary`/`background`/`surface` gained extra keys (hover/soft/soft/elevated)
        // for the new GarnishTable tokens that have no pre-existing Tailwind class of their own
        // (`--gt-brand-hover`, `--gt-brand-soft`, `--gt-bg-soft`). Every key that already existed
        // keeps generating the EXACT same class name as before (`bg-primary`, `bg-background`,
        // `bg-surface-elevated`, ...) — this is additive, not a rename; see index.css's own
        // `--gt-*`/`--color-*` alias block for where the values actually live now.
        primary: {
          DEFAULT: "var(--color-primary)",
          hover: "var(--gt-brand-hover)",
          soft: "var(--gt-brand-soft)",
          foreground: "var(--color-primary-foreground)",
        },
        secondary: { DEFAULT: "var(--color-secondary)", foreground: "var(--color-secondary-foreground)" },
        accent: { DEFAULT: "var(--color-accent)", foreground: "var(--color-accent-foreground)" },
        background: { DEFAULT: "var(--color-background)", soft: "var(--gt-bg-soft)" },
        surface: { DEFAULT: "var(--color-surface)", elevated: "var(--color-surface-elevated)" },
        foreground: "var(--color-foreground)",
        muted: "var(--color-muted)",
        border: "var(--color-border)",
        success: "var(--color-success)",
        warning: "var(--color-warning)",
        danger: "var(--color-danger)",
        info: "var(--color-info)",
      },
      fontFamily: {
        heading: ["var(--font-heading)"],
        sans: ["var(--font-body)"],
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
        pill: "var(--radius-pill)",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        elevated: "var(--shadow-elevated)",
      },
      transitionDuration: {
        fast: "120ms",
        normal: "220ms",
        slow: "420ms",
      },
      transitionTimingFunction: {
        DEFAULT: "cubic-bezier(0.16, 1, 0.3, 1)",
        premium: "cubic-bezier(0.16, 1, 0.3, 1)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          "0%": { opacity: "0", transform: "scale(0.96)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        pop: {
          "0%": { transform: "scale(1)" },
          "50%": { transform: "scale(1.18)" },
          "100%": { transform: "scale(1)" },
        },
        "slide-up": {
          "0%": { opacity: "0", transform: "translateY(24px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-10px)" },
        },
        kenburns: {
          "0%": { transform: "scale(1)" },
          "100%": { transform: "scale(1.08)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.5s cubic-bezier(0.16, 1, 0.3, 1) both",
        "scale-in": "scale-in 0.2s cubic-bezier(0.16, 1, 0.3, 1) both",
        pop: "pop 0.32s cubic-bezier(0.16, 1, 0.3, 1)",
        "slide-up": "slide-up 0.3s cubic-bezier(0.16, 1, 0.3, 1) both",
        float: "float 6s ease-in-out infinite",
        // Home hero's decorative background layer only (see .theme-obsidian in index.css) — a slow,
        // continuous drift, neutralized like every other animation under prefers-reduced-motion.
        kenburns: "kenburns 20s ease-in-out infinite alternate",
      },
    },
  },
  plugins: [],
};
