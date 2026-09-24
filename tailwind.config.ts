import type { Config } from "tailwindcss";

const config: Config = {
  // Theo attribute; KHÔNG dùng dark: rời rạc — đổi theme chỉ đổi data-theme
  darkMode: ["selector", '[data-theme="dark"]'],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "var(--bg-canvas)",
        surface: "var(--bg-surface)",
        raised: "var(--bg-surface-raised)",
        hover: "var(--bg-hover)",
        active: "var(--bg-active)",
        border: "var(--border-default)",
        "border-strong": "var(--border-strong)",
        accent: { DEFAULT: "var(--accent-500)", 600: "var(--accent-600)", soft: "var(--accent-soft)" },
        success: { DEFAULT: "var(--success)", soft: "var(--success-soft)" },
        warning: { DEFAULT: "var(--warning)", soft: "var(--warning-soft)" },
        danger: { DEFAULT: "var(--danger)", soft: "var(--danger-soft)" },
        info: { DEFAULT: "var(--info)", soft: "var(--info-soft)" },
        tertiary: { DEFAULT: "var(--tertiary)", soft: "var(--tertiary-soft)" },
        fg: {
          DEFAULT: "var(--text-primary)",
          secondary: "var(--text-secondary)",
          muted: "var(--text-muted)",
          "on-accent": "var(--text-on-accent)",
        },
      },
      borderRadius: { sm: "var(--radius-sm)", md: "var(--radius-md)", lg: "var(--radius-lg)", full: "var(--radius-full)" },
      fontFamily: { sans: "var(--font-sans)", mono: "var(--font-mono)" },
      fontSize: {
        xs: "var(--text-xs)", sm: "var(--text-sm)", base: "var(--text-base)",
        lg: "var(--text-lg)", xl: "var(--text-xl)", "2xl": "var(--text-2xl)",
      },
      boxShadow: { sm: "var(--shadow-sm)", md: "var(--shadow-md)", lg: "var(--shadow-lg)" },
      zIndex: {
        header: "var(--z-sticky-header)", sidebar: "var(--z-sidebar)", dropdown: "var(--z-dropdown)",
        scrim: "var(--z-overlay-scrim)", sheet: "var(--z-slide-panel)", dialog: "var(--z-dialog)", toast: "var(--z-toast)",
      },
      transitionTimingFunction: { standard: "var(--ease-standard)" },
    },
  },
  plugins: [],
};

export default config;
