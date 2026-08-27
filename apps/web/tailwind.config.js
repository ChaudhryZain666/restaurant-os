/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}", "../../packages/ui/src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Phase 31 — `rgb(var(--color-x-rgb) / <alpha-value>)` (Tailwind's documented pattern for
        // opacity-modifier support on CSS-variable colors) rather than a bare `var(--color-x)`
        // hex string, so bg-primary/10, text-foreground/70, etc. actually work — see index.css's
        // own note on the -rgb variables this reads.
        primary: {
          DEFAULT: "rgb(var(--color-primary-rgb) / <alpha-value>)",
          foreground: "rgb(var(--color-primary-foreground-rgb) / <alpha-value>)",
        },
        secondary: {
          DEFAULT: "rgb(var(--color-secondary-rgb) / <alpha-value>)",
          foreground: "rgb(var(--color-secondary-foreground-rgb) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "rgb(var(--color-accent-rgb) / <alpha-value>)",
          foreground: "rgb(var(--color-accent-foreground-rgb) / <alpha-value>)",
        },
        background: "rgb(var(--color-background-rgb) / <alpha-value>)",
        surface: "rgb(var(--color-surface-rgb) / <alpha-value>)",
        "surface-elevated": "rgb(var(--color-surface-elevated-rgb) / <alpha-value>)",
        foreground: "rgb(var(--color-foreground-rgb) / <alpha-value>)",
        muted: "rgb(var(--color-muted-rgb) / <alpha-value>)",
        border: "rgb(var(--color-border-rgb) / <alpha-value>)",
        success: "rgb(var(--color-success-rgb) / <alpha-value>)",
        warning: "rgb(var(--color-warning-rgb) / <alpha-value>)",
        danger: "rgb(var(--color-danger-rgb) / <alpha-value>)",
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
        "pop": {
          "0%": { transform: "scale(1)" },
          "50%": { transform: "scale(1.18)" },
          "100%": { transform: "scale(1)" },
        },
        "slide-up": {
          "0%": { opacity: "0", transform: "translateY(24px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.5s cubic-bezier(0.16, 1, 0.3, 1) both",
        "scale-in": "scale-in 0.2s cubic-bezier(0.16, 1, 0.3, 1) both",
        pop: "pop 0.32s cubic-bezier(0.16, 1, 0.3, 1)",
        "slide-up": "slide-up 0.3s cubic-bezier(0.16, 1, 0.3, 1) both",
      },
    },
  },
  plugins: [],
};
