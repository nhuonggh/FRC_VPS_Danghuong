/** Phần tử tương tác bên trong dòng: click vào đó là việc của chính nó, không phải "mở dòng". */
export const ROW_IGNORE_SELECTOR = "a,button,input,label,select,textarea,[role=menuitem],[data-row-ignore]";

export interface RowClickEvent {
  defaultPrevented: boolean;
  button: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  target: EventTarget | null;
  /** Dòng đang xử lý sự kiện; phần tử tương tác nằm NGOÀI dòng không được chặn. */
  currentTarget?: EventTarget | null;
}

/** Click vào dòng có nên điều hướng sang trang chi tiết không (thuần, dễ test). */
export function shouldNavigateOnRowClick(e: RowClickEvent, selectionText = ""): boolean {
  if (e.defaultPrevented) return false;
  if (e.button !== 0) return false;
  if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return false;
  if (selectionText !== "") return false; // vừa kéo bôi đen văn bản
  const target = e.target as Element | null;
  const hit = target?.closest?.(ROW_IGNORE_SELECTOR);
  if (hit && (!e.currentTarget || (e.currentTarget as Node).contains(hit))) return false;
  return true;
}
