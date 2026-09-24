export type ThemeMode = "light" | "dark" | "system";
const KEY = "theme";

type ReadStorage = Pick<Storage, "getItem">;
type WriteStorage = Pick<Storage, "setItem" | "removeItem">;

/** Storage giả khi trình duyệt chặn localStorage (Safari private, quyền site): mọi thao tác là no-op. */
const NOOP_STORAGE: ReadStorage & WriteStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

/** Truy cập `window.localStorage` có thể ném SecurityError → trả storage no-op thay vì làm hỏng render. */
export function safeLocalStorage(): ReadStorage & WriteStorage {
  try {
    return window.localStorage ?? NOOP_STORAGE;
  } catch {
    return NOOP_STORAGE;
  }
}

export function readTheme(storage: ReadStorage): ThemeMode {
  try {
    const v = storage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

/** system = gỡ attribute → tokens.css tự theo prefers-color-scheme. */
export function applyTheme(mode: ThemeMode, root: HTMLElement, storage: WriteStorage): void {
  // Attribute luôn được áp trước → lựa chọn có hiệu lực cho phiên dù storage bị chặn (chỉ mất phần ghi nhớ).
  if (mode === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", mode);
  try {
    if (mode === "system") storage.removeItem(KEY);
    else storage.setItem(KEY, mode);
  } catch {
    /* storage bị chặn: bỏ qua */
  }
}

/** Chèn inline vào <head> để áp theme trước khi paint (chống FOUC khi vào dark). */
export const NO_FOUC_SCRIPT = `(function(){try{var t=localStorage.getItem('${KEY}');if(t==='dark'||t==='light'){document.documentElement.setAttribute('data-theme',t)}}catch(e){}})();`;
