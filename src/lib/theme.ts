export type ThemeMode = "light" | "dark" | "system";
const KEY = "theme";

export function readTheme(storage: Pick<Storage, "getItem">): ThemeMode {
  const v = storage.getItem(KEY);
  return v === "light" || v === "dark" ? v : "system";
}

/** system = gỡ attribute → tokens.css tự theo prefers-color-scheme. */
export function applyTheme(
  mode: ThemeMode,
  root: HTMLElement,
  storage: Pick<Storage, "setItem" | "removeItem">,
): void {
  if (mode === "system") {
    root.removeAttribute("data-theme");
    storage.removeItem(KEY);
  } else {
    root.setAttribute("data-theme", mode);
    storage.setItem(KEY, mode);
  }
}

/** Chèn inline vào <head> để áp theme trước khi paint (chống FOUC khi vào dark). */
export const NO_FOUC_SCRIPT = `(function(){try{var t=localStorage.getItem('${KEY}');if(t==='dark'||t==='light'){document.documentElement.setAttribute('data-theme',t)}}catch(e){}})();`;
