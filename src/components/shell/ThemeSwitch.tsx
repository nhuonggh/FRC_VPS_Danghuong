"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import clsx from "clsx";
import { applyTheme, readTheme, safeLocalStorage, type ThemeMode } from "@/lib/theme";

const OPTIONS: { mode: ThemeMode; label: string; Icon: typeof Sun }[] = [
  { mode: "light", label: "Giao diện sáng", Icon: Sun },
  { mode: "dark", label: "Giao diện tối", Icon: Moon },
  { mode: "system", label: "Theo hệ thống", Icon: Monitor },
];

export function ThemeSwitch() {
  const [mode, setMode] = useState<ThemeMode>("system");
  useEffect(() => setMode(readTheme(safeLocalStorage())), []);

  return (
    <div role="radiogroup" aria-label="Giao diện" className="flex items-center rounded-full border border-border p-0.5">
      {OPTIONS.map(({ mode: m, label, Icon }) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={mode === m}
          aria-label={label}
          title={label}
          onClick={() => {
            setMode(m);
            applyTheme(m, document.documentElement, safeLocalStorage());
          }}
          className={clsx(
            "flex h-7 w-7 items-center justify-center rounded-full text-fg-secondary transition-colors hover:bg-hover",
            mode === m && "bg-accent-soft text-accent",
          )}
        >
          <Icon size={15} aria-hidden />
        </button>
      ))}
    </div>
  );
}
