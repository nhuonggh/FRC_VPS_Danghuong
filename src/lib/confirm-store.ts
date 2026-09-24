import { create } from "zustand";

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  danger?: boolean;
}
interface Request extends ConfirmOptions { resolve: (ok: boolean) => void }
interface State { request: Request | null; open: (r: Request) => void; close: (ok: boolean) => void }

export const useConfirmStore = create<State>((set, get) => ({
  request: null,
  open: (r) => {
    get().request?.resolve(false); // yêu cầu cũ (nếu có) coi như bị hủy
    set({ request: r });
  },
  close: (ok) => {
    get().request?.resolve(ok);
    set({ request: null });
  },
}));

/** Hộp xác nhận theo promise: `if (await confirm({ title })) …`. Thay cho window.confirm. */
export function confirm(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => useConfirmStore.getState().open({ ...opts, resolve }));
}
