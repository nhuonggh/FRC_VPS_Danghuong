# GĐ0c — Trang chi tiết, màn 1–5, deploy đầu tiên Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hoàn tất GĐ0: khung trang chi tiết Full-page (sửa từng section), đăng nhập/đổi mật khẩu, quản lý người dùng + nhóm quyền động + khoá/mở khoá, nhật ký thao tác, trang chủ — rồi deploy lên VPS và xác minh bằng người dùng thật.

**Architecture:** Chi tiết bản ghi = route riêng `/{module}/{id}?tab=` + `/new` (skill `crm-design`, KHÔNG panel). Nghiệp vụ nằm ở `src/server/{users,roles,audit}/` (hàm nhận `tx`, luôn chạy trong 1 transaction, ghi audit cùng transaction); route handler mỏng: xác thực → zod → service → JSON. Lỗi trả JSON tiếng Việt (`DomainError` → 409, `ForbiddenError` → 403, `UnauthorizedError` → 401).

**Tech Stack:** Next.js 15, next-auth 4, react-hook-form + zod, Radix Dialog, zustand, Vitest + Testing Library.

**Spec:** `docs/spec/MASTER_SPEC_TRIEN_KHAI_v2.md` (mã 1–5, 7-M1, Phần 13). Master plan (D-1, D-2, D-10). Plan 01a (`writeAudit`, `withIdempotency`, quyền), plan 01b (`SessionActor`, `requireActor`, khung bảng). Skill `crm-design`: `full-page-detail.md`, `overlay-components.md`, `states-and-feedback.md`, `auth-and-loading.md`.

## Global Constraints

Chép từ master plan / plan 01a–01b — áp cho mọi task ở đây:

- Chi tiết bản ghi = **route riêng**; sửa từng section bằng bút chì + Hủy/Lưu, **chỉ 1 section/lần**, dirty → confirm; View mode là **text tĩnh**, không `<input disabled>`; label/value khác cả màu lẫn độ đậm; deep-link `?tab=`; `?edit={section}` dùng 1 lần.
- Toast: success/info tự tắt 4 giây, **error không tự tắt**; tối đa 3 toast hiển thị.
- Không panel/slide panel cho bản ghi chính; ngoại lệ duy nhất "Dialog tạo nhanh" (≤3 field) không dùng ở GĐ0.
- Mọi ghi dữ liệu: transaction + `writeAudit` cùng transaction. **Audit tuyệt đối không chứa mật khẩu, hash mật khẩu, mật khẩu tạm.**
- Tạo bản ghi quan trọng: `Idempotency-Key` (1 khoá/lần mở form, không sinh lại khi retry).
- Không được để hệ thống hết người quản trị: luôn còn ≥ 1 tài khoản **đang hoạt động** có quyền `user.manage` (khoá/đổi vai trò/đổi quyền đều kiểm).
- Ẩn/hiện theo quyền: menu ẩn hẳn, nút ẩn (không xám), route guard 403; JWT không chứa quyền.
- Tiếng Việt cho mọi thông báo. Số/ngày dùng `@/lib/format`.
- Mỗi task kết thúc: `npm run lint && npm run typecheck && npm test` xanh rồi commit.

## Review Focus (phần thuộc plan này)

- Khoá tài khoản hoặc hạ quyền làm hệ thống hết quản trị viên → bị chặn, không ghi gì (Task 12).
- Phiên hết hạn khi đang nhập form dài: không tự chuyển trang, không mất dữ liệu (Task 12 — `apiFetch`).
- Bấm "Tạo người dùng" 2 lần/retry → 1 tài khoản, và mật khẩu tạm KHÔNG nằm trong bảng idempotency (Task 12).
- Nhật ký: lọc theo ngày theo giờ ICT; 50.000 dòng vẫn phân trang ≤ 3 giây (Task 13).
- Deploy xanh nhưng đăng nhập thật hỏng (`NO_SECRET`, thiếu `NEXTAUTH_URL`, `docker restart` không nạp `.env`) → chỉ báo xong sau `VERIFY.md` (Task 14).

---

## File Structure (plan này tạo)

| File | Trách nhiệm |
|---|---|
| `src/lib/{toast,confirm-store,use-idempotency-key,api-fetch}.ts(x)` | store toast, hộp xác nhận theo promise, khoá idempotency, fetch tiếng Việt |
| `src/components/ui/{Toast,ConfirmDialog,Combobox,DetailPage,NewPage,MultiSelectFilter,TempPasswordDialog}.tsx` | khung chi tiết & dialog |
| `src/server/http/{errors,handler}.ts` | lỗi nghiệp vụ, bọc route handler |
| `src/server/users/{schemas,service,queries}.ts`, `src/server/roles/{schemas,service,queries}.ts` | nghiệp vụ người dùng & nhóm quyền |
| `src/app/api/{users,roles,account}/**` | route handler mỏng |
| `src/app/(auth)/login/**`, `src/app/change-password/**` | đăng nhập, đổi mật khẩu |
| `src/app/(app)/system/{users,roles,audit-log}/**` | màn 2, 3, 4, 5 |
| `src/server/audit/queries.ts`, `src/lib/json-diff.ts` | truy vấn & so sánh nhật ký |
| `src/app/(app)/page.tsx`, `src/app/api/health/route.ts`, `src/app/(app)/{not-found,error}.tsx`, `src/components/shell/OfflineBanner.tsx` | trang chủ, health, trạng thái lỗi |

---

### Task 11: Khung trang chi tiết Full-page + Toast, ConfirmDialog, Combobox

**Files:**
- Create: `src/lib/toast.ts`, `src/lib/confirm-store.ts`, `src/lib/use-idempotency-key.ts`
- Create: `src/components/ui/{Toast,ConfirmDialog,Combobox,DetailPage,NewPage}.tsx`
- Modify: `src/components/providers.tsx`, `src/components/ui/index.ts`
- Test: `tests/ui/toast.test.tsx`, `tests/ui/confirm.test.tsx`, `tests/ui/combobox.test.tsx`, `tests/ui/detail-page.test.tsx`

**Interfaces:**
- Produces:
  - `toast.success|error|info|warning(message, action?)`, `useToastStore` (`@/lib/toast`); `<ToastHost />`
  - `confirm(opts: {title; description?; confirmLabel?; danger?}): Promise<boolean>` (`@/lib/confirm-store`); `<ConfirmHost />`
  - `useIdempotencyKey(): { key: string; reset(): void }`
  - `<Combobox label value onChange loadOptions />` với `interface ComboOption { value: string | number; label: string; hint?: string }`
  - `<DetailPage backHref backLabel headerActions? summary tabs activeTab onTabChange initialEditing? onSaved? />`, `interface TabRenderCtx { editing: string|null; saving: boolean; beginEdit(key): void; cancelEdit(): void; finishEdit(): void; setDirty(b: boolean): void; setSaving(b: boolean): void; setError(msg: string|null): void }`, `DetailSection`, `DetailField`, `EditButton`, `EditActions`, `useDetailNav(tabKeys, sectionTab?)`, `useSectionForm(ctx, key, { schema, defaults, save })`
  - `<NewPage backHref backLabel title submitLabel onSubmit isDirty>` — trang `/new`

- [ ] **Step 1: Test Toast (đỏ)**

`tests/ui/toast.test.tsx`:
```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastHost } from "@/components/ui/Toast";
import { toast, useToastStore } from "@/lib/toast";

beforeEach(() => {
  vi.useFakeTimers();
  useToastStore.setState({ items: [] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Toast", () => {
  it("success tự tắt sau 4 giây", () => {
    render(<ToastHost />);
    act(() => { toast.success("Đã lưu thay đổi."); });
    expect(screen.getByText("Đã lưu thay đổi.")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(3900); });
    expect(screen.getByText("Đã lưu thay đổi.")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.queryByText("Đã lưu thay đổi.")).toBeNull();
  });

  it("error KHÔNG tự tắt; đóng tay bằng nút X", () => {
    render(<ToastHost />);
    act(() => { toast.error("Không lưu được."); });
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(screen.getByText("Không lưu được.")).toBeInTheDocument();
    act(() => { screen.getByRole("button", { name: "Đóng thông báo" }).click(); });
    expect(screen.queryByText("Không lưu được.")).toBeNull();
  });

  it("tối đa 3 toast, phần còn lại gộp '+N thông báo khác'", () => {
    render(<ToastHost />);
    act(() => { ["a", "b", "c", "d", "e"].forEach((m) => toast.error(m)); });
    expect(screen.getAllByRole("status")).toHaveLength(3);
    expect(screen.getByText("+2 thông báo khác")).toBeInTheDocument();
  });

  it("toast kèm hành động (Hoàn tác) gọi callback", () => {
    render(<ToastHost />);
    const undo = vi.fn();
    act(() => { toast.success("Đã xóa", { label: "Hoàn tác", onClick: undo }); });
    act(() => { screen.getByRole("button", { name: "Hoàn tác" }).click(); });
    expect(undo).toHaveBeenCalledOnce();
  });
});
```
- [ ] **Step 2: Chạy → đỏ; cài toast**

`src/lib/toast.ts`:
```ts
import { create } from "zustand";

export type ToastKind = "success" | "error" | "info" | "warning";
export interface ToastAction { label: string; onClick: () => void }
export interface ToastItem { id: number; kind: ToastKind; message: string; action?: ToastAction }

interface ToastState {
  items: ToastItem[];
  push: (t: Omit<ToastItem, "id">) => number;
  dismiss: (id: number) => void;
}

let seq = 0;

export const useToastStore = create<ToastState>((set) => ({
  items: [],
  push: (t) => {
    const id = ++seq;
    set((s) => ({ items: [...s.items, { ...t, id }] }));
    return id;
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
}));

const make = (kind: ToastKind) => (message: string, action?: ToastAction) =>
  useToastStore.getState().push({ kind, message, action });

export const toast = {
  success: make("success"),
  error: make("error"),
  info: make("info"),
  warning: make("warning"),
};
```
`src/components/ui/Toast.tsx`:
```tsx
"use client";

import clsx from "clsx";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { useEffect } from "react";
import { useToastStore, type ToastItem } from "@/lib/toast";

const AUTO_DISMISS_MS = 4000;
const MAX_VISIBLE = 3;

const STYLE = {
  success: { Icon: CheckCircle2, bar: "border-success", icon: "text-success" },
  error: { Icon: XCircle, bar: "border-danger", icon: "text-danger" },
  warning: { Icon: AlertTriangle, bar: "border-warning", icon: "text-warning" },
  info: { Icon: Info, bar: "border-info", icon: "text-info" },
} as const;

function ToastView({ item }: { item: ToastItem }) {
  const dismiss = useToastStore((s) => s.dismiss);
  useEffect(() => {
    if (item.kind === "error") return; // lỗi cần đọc kỹ: không tự tắt
    const t = setTimeout(() => dismiss(item.id), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [item.id, item.kind, dismiss]);
  const { Icon, bar, icon } = STYLE[item.kind];
  return (
    <div role="status" className={clsx("flex items-start gap-3 rounded-md border-l-[3px] bg-raised p-3 shadow-md", bar)}>
      <Icon size={18} aria-hidden className={clsx("mt-0.5 shrink-0", icon)} />
      <p className="min-w-0 flex-1 text-sm">{item.message}</p>
      {item.action && (
        <button type="button" onClick={() => { item.action!.onClick(); dismiss(item.id); }} className="text-sm font-semibold text-accent">
          {item.action.label}
        </button>
      )}
      <button type="button" aria-label="Đóng thông báo" onClick={() => dismiss(item.id)} className="text-fg-muted hover:text-fg">
        <X size={16} aria-hidden />
      </button>
    </div>
  );
}

export function ToastHost() {
  const items = useToastStore((s) => s.items);
  const shown = items.slice(-MAX_VISIBLE);
  const hidden = items.length - shown.length;
  return (
    <div className="pointer-events-none fixed inset-x-3 bottom-16 z-toast flex flex-col items-end gap-2 md:inset-x-auto md:bottom-auto md:right-4 md:top-16">
      {shown.map((i) => (
        <div key={i.id} className="pointer-events-auto w-full max-w-sm"><ToastView item={i} /></div>
      ))}
      {hidden > 0 && <div className="pointer-events-auto text-xs text-fg-muted">+{hidden} thông báo khác</div>}
    </div>
  );
}
```
Run: `npm test -- tests/ui/toast.test.tsx` → PASS.

- [ ] **Step 3: Test + cài `confirm` (hộp xác nhận theo promise)**

`tests/ui/confirm.test.tsx`:
```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { ConfirmHost } from "@/components/ui/ConfirmDialog";
import { confirm } from "@/lib/confirm-store";

afterEach(cleanup);

describe("confirm()", () => {
  it("bấm Xác nhận → resolve true", async () => {
    render(<ConfirmHost />);
    let p!: Promise<boolean>;
    act(() => { p = confirm({ title: "Xóa dòng này?", description: "Không hoàn tác được.", confirmLabel: "Xóa", danger: true }); });
    expect(await screen.findByRole("dialog", { name: "Xóa dòng này?" })).toBeInTheDocument();
    expect(screen.getByText("Không hoàn tác được.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Xóa" }));
    await expect(p).resolves.toBe(true);
  });

  it("bấm Hủy hoặc Escape → resolve false, dialog đóng", async () => {
    render(<ConfirmHost />);
    let p!: Promise<boolean>;
    act(() => { p = confirm({ title: "Bỏ thay đổi chưa lưu?" }); });
    await screen.findByRole("dialog");
    await userEvent.keyboard("{Escape}");
    await expect(p).resolves.toBe(false);
    expect(screen.queryByRole("dialog")).toBeNull();

    act(() => { p = confirm({ title: "Lần hai" }); });
    await userEvent.click(await screen.findByRole("button", { name: "Hủy" }));
    await expect(p).resolves.toBe(false);
  });

  it("nút mặc định 'Xác nhận'", async () => {
    render(<ConfirmHost />);
    act(() => { void confirm({ title: "Ok?" }); });
    expect(await screen.findByRole("button", { name: "Xác nhận" })).toBeInTheDocument();
  });
});
```
`src/lib/confirm-store.ts`:
```ts
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
```
`src/components/ui/ConfirmDialog.tsx`:
```tsx
"use client";

import * as Dialog from "@radix-ui/react-dialog";
import clsx from "clsx";
import { useConfirmStore } from "@/lib/confirm-store";

export function ConfirmHost() {
  const request = useConfirmStore((s) => s.request);
  const close = useConfirmStore((s) => s.close);
  return (
    <Dialog.Root open={!!request} onOpenChange={(o) => { if (!o) close(false); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-scrim bg-[var(--overlay-scrim)]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-dialog w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-raised p-5 shadow-lg">
          <Dialog.Title className="text-base font-semibold">{request?.title}</Dialog.Title>
          <Dialog.Description className={clsx("mt-2 text-sm text-fg-secondary", !request?.description && "sr-only")}>
            {request?.description ?? request?.title}
          </Dialog.Description>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={() => close(false)} className="h-10 rounded-sm border border-border px-4 text-sm font-medium hover:bg-hover">
              Hủy
            </button>
            <button type="button" onClick={() => close(true)}
              className={clsx("h-10 rounded-sm px-4 text-sm font-medium text-fg-on-accent", request?.danger ? "bg-danger" : "bg-accent")}>
              {request?.confirmLabel ?? "Xác nhận"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```
Sửa `src/components/providers.tsx` để gắn host:
```tsx
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { ConfirmHost } from "@/components/ui/ConfirmDialog";
import { ToastHost } from "@/components/ui/Toast";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } } }),
  );
  return (
    <QueryClientProvider client={client}>
      {children}
      <ToastHost />
      <ConfirmHost />
    </QueryClientProvider>
  );
}
```
Run: `npm test -- tests/ui/confirm.test.tsx` → PASS.

- [ ] **Step 4: Test + cài `Combobox` (FK luôn là combobox có search)**

`tests/ui/combobox.test.tsx`:
```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Combobox, type ComboOption } from "@/components/ui/Combobox";

afterEach(cleanup);

const ALL: ComboOption[] = [
  { value: 1, label: "Khách A", hint: "KH001" },
  { value: 2, label: "Khách B", hint: "KH002" },
  { value: 3, label: "Thợ C", hint: "T003" },
];

function Harness({ load, onPick }: { load: (q: string) => Promise<ComboOption[]>; onPick?: (o: ComboOption | null) => void }) {
  const [v, setV] = useState<ComboOption | null>(null);
  return <Combobox label="Khách hàng" value={v} onChange={(o) => { setV(o); onPick?.(o); }} loadOptions={load} debounceMs={0} />;
}

describe("Combobox", () => {
  it("gõ → gọi loadOptions(q) → hiện danh sách; chọn bằng chuột", async () => {
    const load = vi.fn(async (q: string) => ALL.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())));
    const onPick = vi.fn();
    render(<Harness load={load} onPick={onPick} />);
    await userEvent.type(screen.getByRole("combobox", { name: "Khách hàng" }), "khách");
    const opts = await screen.findAllByRole("option");
    expect(opts.map((o) => o.textContent)).toEqual(["Khách AKH001", "Khách BKH002"]);
    await userEvent.click(opts[1]!);
    expect(onPick).toHaveBeenCalledWith(ALL[1]);
    expect(screen.getByRole("combobox")).toHaveValue("Khách B");
  });

  it("bàn phím: ArrowDown + Enter chọn; Escape đóng và trả lại nhãn đã chọn", async () => {
    const onPick = vi.fn();
    render(<Harness load={async () => ALL} onPick={onPick} />);
    const input = screen.getByRole("combobox");
    await userEvent.click(input);
    await screen.findAllByRole("option");
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(onPick).toHaveBeenCalledWith(ALL[1]);
    await userEvent.clear(input);
    await userEvent.type(input, "zzz");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(input).toHaveValue("Khách B");
  });

  it("kết quả chậm của lần gõ CŨ không ghi đè kết quả lần gõ MỚI", async () => {
    let releaseSlow!: () => void;
    const load = vi.fn((q: string) =>
      q === "a"
        ? new Promise<ComboOption[]>((res) => { releaseSlow = () => res([{ value: 9, label: "CŨ" }]); })
        : Promise.resolve([{ value: 1, label: "MỚI" }]),
    );
    render(<Harness load={load} />);
    const input = screen.getByRole("combobox");
    await userEvent.type(input, "a");
    await userEvent.type(input, "b"); // q = "ab" trả về ngay
    expect(await screen.findByRole("option", { name: "MỚI" })).toBeInTheDocument();
    releaseSlow();
    await waitFor(() => expect(screen.queryByRole("option", { name: "CŨ" })).toBeNull());
  });

  it("không có kết quả → thông báo; nút xóa lựa chọn có aria-label", async () => {
    render(<Harness load={async () => []} />);
    await userEvent.type(screen.getByRole("combobox"), "xyz");
    expect(await screen.findByText("Không tìm thấy kết quả")).toBeInTheDocument();
  });
});
```
`src/components/ui/Combobox.tsx`:
```tsx
"use client";

import clsx from "clsx";
import { ChevronDown, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

export interface ComboOption {
  value: string | number;
  label: string;
  hint?: string;
}

interface Props {
  label: string;
  value: ComboOption | null;
  onChange: (o: ComboOption | null) => void;
  /** Gọi phía server/DB, không lọc ở client. q rỗng = gợi ý mặc định. */
  loadOptions: (q: string) => Promise<ComboOption[]>;
  placeholder?: string;
  disabled?: boolean;
  error?: string;
  debounceMs?: number;
}

export function Combobox({ label, value, onChange, loadOptions, placeholder = "Tìm…", disabled, error, debounceMs = 300 }: Props) {
  const uid = useId();
  const listId = `${uid}-list`;
  const [q, setQ] = useState(value?.label ?? "");
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<ComboOption[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const req = useRef(0);

  useEffect(() => setQ(value?.label ?? ""), [value]);

  useEffect(() => {
    if (!open) return;
    const id = ++req.current; // bỏ kết quả của lần gõ cũ
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await loadOptions(q === value?.label ? "" : q);
        if (id === req.current) { setOptions(res); setActive(0); }
      } finally {
        if (id === req.current) setLoading(false);
      }
    }, debounceMs);
    return () => clearTimeout(t);
  }, [q, open]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (o: ComboOption) => { onChange(o); setQ(o.label); setOpen(false); };

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, options.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter" && open && options[active]) { e.preventDefault(); pick(options[active]!); }
    else if (e.key === "Escape") { setOpen(false); setQ(value?.label ?? ""); }
  }

  return (
    <div className="relative">
      <label htmlFor={uid} className="mb-1 block text-xs text-fg-muted">{label}</label>
      <div className="relative">
        <input
          id={uid} role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
          aria-activedescendant={open && options[active] ? `${uid}-o${active}` : undefined}
          aria-invalid={!!error} disabled={disabled} value={q} placeholder={placeholder} autoComplete="off"
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => { setOpen(false); setQ(value?.label ?? ""); }, 120)}
          onKeyDown={onKeyDown}
          className={clsx("h-9 w-full rounded-sm border bg-canvas pl-3 pr-14 text-sm hover:border-border-strong", error ? "border-danger" : "border-border")}
        />
        <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center">
          {value && !disabled && (
            <button type="button" aria-label="Xóa lựa chọn" onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange(null); setQ(""); }} className="flex h-7 w-7 items-center justify-center text-fg-muted hover:text-fg">
              <X size={14} aria-hidden />
            </button>
          )}
          <ChevronDown size={16} aria-hidden className="mr-2 text-fg-muted" />
        </div>
      </div>
      {open && (
        <ul id={listId} role="listbox" className="absolute z-dropdown mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-raised p-1 shadow-md">
          {options.map((o, i) => (
            <li key={o.value} id={`${uid}-o${i}`} role="option" aria-selected={value?.value === o.value}
              onMouseDown={(e) => e.preventDefault()} onClick={() => pick(o)} onMouseEnter={() => setActive(i)}
              className={clsx("flex cursor-pointer items-center justify-between gap-2 rounded-sm px-3 py-2 text-sm", i === active && "bg-hover")}>
              <span className="truncate">{o.label}</span>
              {o.hint && <span className="shrink-0 text-xs text-fg-muted">{o.hint}</span>}
            </li>
          ))}
          {!loading && options.length === 0 && <li className="px-3 py-2 text-sm text-fg-muted">Không tìm thấy kết quả</li>}
          {loading && options.length === 0 && <li className="px-3 py-2 text-sm text-fg-muted">Đang tìm…</li>}
        </ul>
      )}
      {error && <p role="alert" className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
```
Run: `npm test -- tests/ui/combobox.test.tsx` → PASS. (Nếu test "Escape … trả lại nhãn" đỏ do `onBlur` hẹn giờ 120ms trong lúc test — dùng `await waitFor(...)`; KHÔNG bỏ hành vi.)

- [ ] **Step 5: `useIdempotencyKey`**

`src/lib/use-idempotency-key.ts`:
```ts
"use client";

import { useRef } from "react";

/**
 * 1 khoá cho MỖI lần mở form: bấm 2 lần / retry mạng gửi CÙNG khoá → server chỉ thực thi 1 lần.
 * Gọi reset() sau khi tạo thành công (nếu form còn dùng tiếp để tạo bản ghi khác).
 */
export function useIdempotencyKey() {
  const ref = useRef<string | null>(null);
  if (ref.current === null) ref.current = crypto.randomUUID();
  return { key: ref.current, reset: () => { ref.current = crypto.randomUUID(); } };
}
```

- [ ] **Step 6: Test `DetailPage` (đỏ)**

`tests/ui/detail-page.test.tsx`:
```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DetailField, DetailPage, DetailSection, type DetailTab } from "@/components/ui/DetailPage";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/x/1",
  useSearchParams: () => new URLSearchParams(),
}));
const confirmMock = vi.fn();
vi.mock("@/lib/confirm-store", () => ({ confirm: (...a: unknown[]) => confirmMock(...a) }));

beforeEach(() => { refresh.mockClear(); confirmMock.mockReset(); });
afterEach(cleanup);

const tabs: DetailTab[] = [
  {
    key: "info", label: "Thông tin", count: 2,
    render: (ctx) => (
      <div>
        <div data-testid="editing">{String(ctx.editing)}</div>
        <DetailSection title="Cơ bản" editing={ctx.editing === "basic"} action={null}>
          <dl><DetailField label="Tên">Nguyễn Văn A</DetailField><DetailField label="Ghi chú">{null}</DetailField></dl>
        </DetailSection>
        <button onClick={() => ctx.beginEdit("basic")}>sửa-basic</button>
        <button onClick={() => ctx.beginEdit("contact")}>sửa-contact</button>
        <button onClick={() => ctx.setDirty(true)}>làm-bẩn</button>
        <button onClick={() => ctx.setError("Tên đã tồn tại")}>lỗi</button>
        <button onClick={() => ctx.finishEdit()}>xong</button>
      </div>
    ),
  },
  { key: "roles", label: "Vai trò", render: () => <div>NỘI DUNG VAI TRÒ</div> },
];

const summary = { title: "Nguyễn Văn A", code: "nva", badges: [{ label: "Hoạt động", tone: "success" as const }], facts: [{ label: "Tạo lúc", value: "24/09/2026" }] };

function setup(over: Partial<React.ComponentProps<typeof DetailPage>> = {}) {
  const onTabChange = vi.fn();
  render(<DetailPage backHref="/system/users" backLabel="Quay lại người dùng" summary={summary} tabs={tabs} activeTab="info" onTabChange={onTabChange} {...over} />);
  return { onTabChange };
}

describe("DetailPage", () => {
  it("tab không hợp lệ → rơi về tab đầu", () => {
    setup({ activeTab: "khong-co" });
    expect(screen.getAllByText("Nguyễn Văn A").length).toBeGreaterThan(0);
    expect(screen.queryByText("NỘI DUNG VAI TRÒ")).toBeNull();
  });

  it("aside hiện tóm tắt + nav tab có số đếm; back-link là <a href>", () => {
    setup();
    expect(screen.getByRole("link", { name: /Quay lại người dùng/ })).toHaveAttribute("href", "/system/users");
    expect(screen.getAllByRole("button", { name: "Thông tin (2)" }).length).toBeGreaterThan(0);
    expect(screen.getByText("24/09/2026")).toBeInTheDocument();
  });

  it("View mode: giá trị là text tĩnh (dd), KHÔNG có input disabled; giá trị rỗng hiện '—'", () => {
    setup();
    expect(document.querySelectorAll("input[disabled], select[disabled], textarea[disabled]")).toHaveLength(0);
    expect(screen.getByText("Nguyễn Văn A", { selector: "dd" })).toBeInTheDocument();
    expect(screen.getByText("—", { selector: "dd" })).toBeInTheDocument();
  });

  it("đổi tab khi chưa sửa → gọi onTabChange, không hỏi", async () => {
    const { onTabChange } = setup();
    await userEvent.click(screen.getAllByRole("button", { name: "Vai trò" })[0]!);
    expect(onTabChange).toHaveBeenCalledWith("roles");
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it("đang sửa + dirty → đổi tab phải xác nhận; từ chối thì ở lại", async () => {
    const { onTabChange } = setup();
    await userEvent.click(screen.getByText("sửa-basic"));
    await userEvent.click(screen.getByText("làm-bẩn"));
    confirmMock.mockResolvedValueOnce(false);
    await userEvent.click(screen.getAllByRole("button", { name: "Vai trò" })[0]!);
    expect(confirmMock).toHaveBeenCalledOnce();
    expect(onTabChange).not.toHaveBeenCalled();
    confirmMock.mockResolvedValueOnce(true);
    await userEvent.click(screen.getAllByRole("button", { name: "Vai trò" })[0]!);
    expect(onTabChange).toHaveBeenCalledWith("roles");
  });

  it("chỉ 1 section sửa mỗi lần: mở section khác khi đang dirty phải xác nhận", async () => {
    setup();
    await userEvent.click(screen.getByText("sửa-basic"));
    expect(screen.getByTestId("editing")).toHaveTextContent("basic");
    await userEvent.click(screen.getByText("làm-bẩn"));
    confirmMock.mockResolvedValueOnce(false);
    await userEvent.click(screen.getByText("sửa-contact"));
    expect(screen.getByTestId("editing")).toHaveTextContent("basic");
    confirmMock.mockResolvedValueOnce(true);
    await userEvent.click(screen.getByText("sửa-contact"));
    expect(screen.getByTestId("editing")).toHaveTextContent("contact");
  });

  it("sửa nhưng CHƯA dirty → chuyển section không hỏi", async () => {
    setup();
    await userEvent.click(screen.getByText("sửa-basic"));
    await userEvent.click(screen.getByText("sửa-contact"));
    expect(confirmMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("editing")).toHaveTextContent("contact");
  });

  it("lỗi lưu → banner đóng được, GIỮ NGUYÊN chế độ sửa", async () => {
    setup();
    await userEvent.click(screen.getByText("sửa-basic"));
    await userEvent.click(screen.getByText("lỗi"));
    expect(screen.getByRole("alert")).toHaveTextContent("Tên đã tồn tại");
    expect(screen.getByTestId("editing")).toHaveTextContent("basic");
    await userEvent.click(screen.getByRole("button", { name: "Đóng thông báo lỗi" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("lưu xong → thoát edit + router.refresh()", async () => {
    setup();
    await userEvent.click(screen.getByText("sửa-basic"));
    await userEvent.click(screen.getByText("xong"));
    expect(screen.getByTestId("editing")).toHaveTextContent("null");
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("initialEditing (từ ?edit=) vào thẳng chế độ sửa", () => {
    setup({ initialEditing: "basic" });
    expect(screen.getByTestId("editing")).toHaveTextContent("basic");
  });
});
```
- [ ] **Step 7: Cài `DetailPage`**

`src/components/ui/DetailPage.tsx`:
```tsx
"use client";

import clsx from "clsx";
import { ArrowLeft, Pencil, Save, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type DefaultValues, type FieldValues, type UseFormReturn } from "react-hook-form";
import type { ZodType } from "zod";
import { confirm } from "@/lib/confirm-store";
import { NULL_TEXT } from "@/lib/format";
import { toast } from "@/lib/toast";
import { Badge, type BadgeTone } from "./Badge";

export interface TabRenderCtx {
  /** Section đang sửa (chỉ 1 tại 1 thời điểm). */
  editing: string | null;
  saving: boolean;
  beginEdit: (key: string) => void;
  cancelEdit: () => void;
  /** Gọi sau khi lưu THÀNH CÔNG: thoát chế độ sửa + toast + refresh dữ liệu. */
  finishEdit: () => void;
  setDirty: (dirty: boolean) => void;
  setSaving: (saving: boolean) => void;
  setError: (message: string | null) => void;
}

export interface DetailTab {
  key: string;
  label: string;
  count?: number;
  render: (ctx: TabRenderCtx) => React.ReactNode;
}

export interface DetailSummary {
  imageUrl?: string;
  title: string;
  code?: string;
  badges: { label: string; tone?: BadgeTone }[];
  facts: { label: string; value: React.ReactNode }[];
}

// ---- Thành phần dùng chung: MỖI module dùng lại, không tự viết ----

export function DetailSection({ title, action, editing, children }: {
  title: string; action: React.ReactNode; editing?: boolean; children: React.ReactNode;
}) {
  return (
    <section className="border-b border-border pb-6 last:border-b-0">
      {/* Đang sửa → header sticky dưới thanh tab để Lưu/Hủy luôn thấy khi cuộn form dài */}
      <div className={clsx("mb-3 flex items-center justify-between gap-3", editing && "sticky top-0 z-header border-b border-border bg-surface py-2")}>
        <h2 className="text-base font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** View mode = TEXT TĨNH (không <input disabled>). Label nhạt & mảnh, value đậm & rõ. */
export function DetailField({ label, children }: { label: string; children?: React.ReactNode }) {
  const empty = children === null || children === undefined || children === "";
  return (
    <div className="flex items-center justify-between gap-3 border-b border-dashed border-border pb-2">
      <dt className="text-xs font-normal text-fg-muted">{label}</dt>
      <dd className="flex min-h-9 items-center text-right text-sm font-semibold text-fg">{empty ? NULL_TEXT : children}</dd>
    </div>
  );
}

export function EditButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label}
      className="flex h-8 w-8 items-center justify-center rounded-sm text-fg-muted hover:bg-hover hover:text-accent">
      <Pencil size={15} aria-hidden />
    </button>
  );
}

export function EditActions({ saving, onSave, onCancel }: { saving: boolean; onSave: () => void; onCancel: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={onCancel} disabled={saving} aria-label="Hủy chỉnh sửa" title="Hủy chỉnh sửa"
        className="flex h-9 w-9 items-center justify-center rounded-sm border border-border text-fg-secondary hover:bg-hover disabled:opacity-50">
        <X size={16} aria-hidden />
      </button>
      <button type="button" onClick={onSave} disabled={saving}
        className="flex h-9 items-center gap-1.5 rounded-sm bg-accent px-3 text-sm font-medium text-fg-on-accent disabled:opacity-60">
        <Save size={15} aria-hidden />{saving ? "Đang lưu" : "Lưu"}
      </button>
    </div>
  );
}

// ---- Điều hướng: ?tab= (sai → tab đầu) và ?edit= (dùng 1 lần) ----

export function useDetailNav(tabKeys: readonly string[], sectionTab: Record<string, string> = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const editParam = sp.get("edit");
  const rawTab = sp.get("tab");
  const wanted = rawTab ?? (editParam ? sectionTab[editParam] : null);
  const activeTab = wanted && tabKeys.includes(wanted) ? wanted : tabKeys[0]!;
  const [initialEditing] = useState<string | null>(editParam);

  useEffect(() => {
    // ?edit= là tham số 1 lần dùng: gỡ khỏi URL để refresh không tự bật lại chế độ sửa
    if (!editParam) return;
    const next = new URLSearchParams(sp.toString());
    next.delete("edit");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { activeTab, initialEditing, onTabChange: (key: string) => router.push(`${pathname}?tab=${key}`) };
}

// ---- Form của 1 section: nạp lại giá trị khi vào sửa, báo dirty, lưu qua callback ----

export function useSectionForm<T extends FieldValues>(
  ctx: TabRenderCtx,
  key: string,
  opts: { schema: ZodType<T>; defaults: DefaultValues<T>; save: (values: T) => Promise<void> },
): { form: UseFormReturn<T>; editing: boolean; onSave: () => void; onCancel: () => void; saving: boolean } {
  const form = useForm<T>({ resolver: zodResolver(opts.schema as never), defaultValues: opts.defaults });
  const editing = ctx.editing === key;
  useEffect(() => { if (editing) form.reset(opts.defaults); }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = form.formState.isDirty;
  useEffect(() => { if (editing) ctx.setDirty(dirty); }, [editing, dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSave = form.handleSubmit(async (values) => {
    ctx.setSaving(true);
    try {
      await opts.save(values);
      ctx.finishEdit();
    } catch (e) {
      ctx.setError(e instanceof Error ? e.message : "Không lưu được, vui lòng thử lại.");
    } finally {
      ctx.setSaving(false);
    }
  });
  return { form, editing, onSave: () => void onSave(), onCancel: ctx.cancelEdit, saving: ctx.saving };
}

// ---- Trang ----

interface Props {
  backHref: string;
  backLabel: string;
  headerActions?: React.ReactNode;
  summary: DetailSummary;
  tabs: DetailTab[];
  activeTab: string;
  onTabChange: (key: string) => void;
  initialEditing?: string | null;
  /** Mặc định router.refresh(). */
  onSaved?: () => void;
}

export function DetailPage({
  backHref, backLabel, headerActions, summary, tabs, activeTab, onTabChange, initialEditing = null, onSaved,
}: Props) {
  const router = useRouter();
  const selected = tabs.some((t) => t.key === activeTab) ? activeTab : tabs[0]!.key;
  const [editing, setEditing] = useState<string | null>(initialEditing);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirtyState, setDirtyState] = useState(false);
  const dirty = useRef(false);

  const setDirty = (d: boolean) => { dirty.current = d; setDirtyState(d); };

  // Rời trang (đóng tab, F5, gõ URL khác) khi còn thay đổi chưa lưu → cảnh báo của trình duyệt
  useEffect(() => {
    if (!editing || !dirtyState) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [editing, dirtyState]);

  const guard = async () =>
    !editing || !dirty.current ||
    (await confirm({ title: "Bỏ thay đổi chưa lưu?", description: "Các thay đổi trong phần đang sửa sẽ bị mất.", confirmLabel: "Bỏ thay đổi", danger: true }));

  const reset = (next: string | null) => { setDirty(false); setError(null); setEditing(next); };

  const ctx: TabRenderCtx = {
    editing, saving,
    beginEdit: async (key) => { if (key !== editing && (await guard())) reset(key); },
    cancelEdit: async () => { if (await guard()) reset(null); },
    finishEdit: () => {
      reset(null);
      toast.success("Đã lưu thay đổi.");
      (onSaved ?? (() => router.refresh()))();
    },
    setDirty, setSaving, setError,
  };

  async function changeTab(key: string) {
    if (key === selected) return;
    if (await guard()) { reset(null); onTabChange(key); }
  }

  const current = tabs.find((t) => t.key === selected)!;
  const label = (t: DetailTab) => `${t.label}${t.count != null ? ` (${t.count})` : ""}`;

  return (
    <div className="w-full">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link href={backHref} className="inline-flex min-h-10 items-center gap-2 rounded-sm border border-border bg-surface px-3 text-sm font-medium text-fg-secondary hover:bg-hover hover:text-fg">
          <ArrowLeft size={16} aria-hidden /> {backLabel}
        </Link>
        <div className="flex items-center gap-2">{headerActions}</div>
      </div>

      {error && (
        <div role="alert" className="mb-4 flex items-start justify-between gap-3 rounded-sm border border-danger bg-danger-soft p-3 text-sm text-danger">
          <span>{error}</span>
          <button type="button" aria-label="Đóng thông báo lỗi" onClick={() => setError(null)}><X size={16} aria-hidden /></button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[248px_minmax(0,1fr)]">
        <aside className="h-fit rounded-sm border border-border bg-surface lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto">
          {summary.imageUrl && (
            <div className="aspect-video overflow-hidden rounded-t-sm bg-hover">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={summary.imageUrl} alt="" className="h-full w-full object-cover" />
            </div>
          )}
          <div className="space-y-3 p-4">
            <div>
              <h1 className="text-lg font-semibold leading-snug">{summary.title}</h1>
              {summary.code && <p className="mt-1 break-all font-mono text-xs text-fg-muted">{summary.code}</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              {summary.badges.map((b) => <Badge key={b.label} tone={b.tone}>{b.label}</Badge>)}
            </div>
            <dl className="space-y-2 border-t border-border pt-3 text-sm">
              {summary.facts.map((f) => (
                <div key={f.label} className="flex items-center justify-between gap-3">
                  <dt className="text-fg-muted">{f.label}</dt>
                  <dd className="tabular text-right">{f.value}</dd>
                </div>
              ))}
            </dl>
          </div>
          {/* Nav tab dọc — chỉ ≥ 1024. < 1024 dùng thanh tab ngang trong <main>. */}
          <nav className="hidden border-t border-border p-2 lg:block" aria-label="Các phần">
            {tabs.map((t) => (
              <button key={t.key} type="button" onClick={() => changeTab(t.key)} aria-current={selected === t.key ? "page" : undefined}
                className={clsx("flex min-h-10 w-full items-center rounded-sm px-3 text-left text-sm", selected === t.key ? "bg-accent-soft font-medium text-accent" : "text-fg-secondary hover:bg-hover hover:text-fg")}>
                {label(t)}
              </button>
            ))}
          </nav>
        </aside>

        <div className="min-w-0 rounded-sm border border-border bg-surface">
          <div className="flex overflow-x-auto border-b border-border px-2 lg:hidden">
            {tabs.map((t) => (
              <button key={t.key} type="button" onClick={() => changeTab(t.key)}
                className={clsx("min-h-12 shrink-0 border-b-2 px-3 text-sm font-medium", selected === t.key ? "border-accent text-accent" : "border-transparent text-fg-secondary")}>
                {label(t)}
              </button>
            ))}
          </div>
          <div className="space-y-6 p-4 sm:p-6">{current.render(ctx)}</div>
        </div>
      </div>
    </div>
  );
}
```
Run: `npm test -- tests/ui/detail-page.test.tsx`
Expected: PASS. Nếu test "View mode… '—'" đỏ vì `getByText("—", {selector:"dd"})` thấy nhiều phần tử → chỉ có 1 `DetailField` rỗng trong fixture nên phải duy nhất; kiểm lại fixture.

- [ ] **Step 8: `NewPage` — trang `/{module}/new` (cùng bố cục, mọi section ở chế độ sửa, footer sticky Hủy/Tạo)**

`src/components/ui/NewPage.tsx`:
```tsx
"use client";

import { ArrowLeft, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { confirm } from "@/lib/confirm-store";

interface Props {
  backHref: string;
  backLabel: string;
  /** "Tạo mới người dùng" — hiện ở aside. */
  title: string;
  submitLabel?: string;
  /** Trả về true nếu form đang có thay đổi chưa lưu. */
  isDirty: () => boolean;
  /** Ném Error(message tiếng Việt) khi lỗi — trang hiện banner và GIỮ dữ liệu đã nhập. */
  onSubmit: () => Promise<void>;
  children: React.ReactNode;
}

export function NewPage({ backHref, backLabel, title, submitLabel = "Tạo", isDirty, onSubmit, children }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (isDirty()) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [isDirty]);

  async function cancel() {
    if (isDirty() && !(await confirm({ title: "Bỏ thay đổi chưa lưu?", confirmLabel: "Bỏ thay đổi", danger: true }))) return;
    router.push(backHref);
  }

  async function submit() {
    if (pending) return; // disable nút + chặn bấm đúp
    setPending(true);
    setError(null);
    try {
      await onSubmit();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tạo được, vui lòng thử lại.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="mb-4">
        <Link href={backHref} className="inline-flex min-h-10 items-center gap-2 rounded-sm border border-border bg-surface px-3 text-sm font-medium text-fg-secondary hover:bg-hover hover:text-fg">
          <ArrowLeft size={16} aria-hidden /> {backLabel}
        </Link>
      </div>
      {error && (
        <div role="alert" className="mb-4 flex items-start justify-between gap-3 rounded-sm border border-danger bg-danger-soft p-3 text-sm text-danger">
          <span>{error}</span>
          <button type="button" aria-label="Đóng thông báo lỗi" onClick={() => setError(null)}><X size={16} aria-hidden /></button>
        </div>
      )}
      <div className="grid flex-1 gap-4 lg:grid-cols-[248px_minmax(0,1fr)]">
        <aside className="h-fit rounded-sm border border-border bg-surface p-4 lg:sticky lg:top-20">
          <h1 className="text-lg font-semibold">{title}</h1>
        </aside>
        <div className="min-w-0 rounded-sm border border-border bg-surface p-4 sm:p-6">{children}</div>
      </div>
      {/* Footer sticky đáy vùng cuộn (không absolute/fixed che nội dung) */}
      <div className="sticky bottom-0 z-header mt-4 flex justify-end gap-2 border-t border-border bg-surface px-4 py-3">
        <button type="button" onClick={cancel} disabled={pending} className="h-10 rounded-sm border border-border px-4 text-sm font-medium hover:bg-hover disabled:opacity-50">Hủy</button>
        <button type="button" onClick={submit} disabled={pending} className="h-10 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent disabled:opacity-60">
          {pending ? "Đang lưu" : submitLabel}
        </button>
      </div>
    </div>
  );
}
```
Thêm vào barrel `src/components/ui/index.ts`:
```ts
export { Combobox, type ComboOption } from "./Combobox";
export { ConfirmHost } from "./ConfirmDialog";
export { DetailPage, DetailSection, DetailField, EditButton, EditActions, useDetailNav, useSectionForm, type DetailTab, type TabRenderCtx } from "./DetailPage";
export { NewPage } from "./NewPage";
export { ToastHost } from "./Toast";
```
Trên mobile, footer sticky của `/new` phải cách Bottom Nav đúng chiều cao Bottom Nav: `.app-shell-main` đã có `pb-20` ở `<md` nên footer sticky nằm trong vùng cuộn, không đè Bottom Nav (fixed, ngoài vùng cuộn).

- [ ] **Step 9: Chạy toàn bộ và commit**

Run: `npm run lint && npm run typecheck && npm test`
```bash
git add -A
git commit -m "feat(ui): khung trang chi tiết Full-page, NewPage, Toast, ConfirmDialog, Combobox, idempotency key"
```

---

### Task 12: Màn 1–4 — đăng nhập, đổi mật khẩu, người dùng, nhóm quyền, khoá/mở khoá

**Files:**
- Create: `src/server/http/errors.ts`, `src/server/http/handler.ts`, `src/lib/api-fetch.ts`
- Modify: `src/server/auth/session.ts` (thêm `requireActorApi`)
- Create: `src/server/users/{schemas,service,queries}.ts`, `src/server/roles/{schemas,service,queries}.ts`
- Create: `src/app/api/users/route.ts`, `src/app/api/users/[id]/{section-update,lock,reset-password}/route.ts`, `src/app/api/roles/route.ts`, `src/app/api/roles/[id]/{route.ts,section-update/route.ts}`, `src/app/api/account/change-password/route.ts`
- Create: `src/components/ui/{MultiSelectFilter,TempPasswordDialog}.tsx`
- Create: `src/app/(auth)/login/{page.tsx,LoginForm.tsx}`, `src/lib/safe-callback.ts`, `src/app/change-password/{page.tsx,ChangePasswordForm.tsx}`
- Create: `src/app/(app)/system/users/{page.tsx,UsersTable.tsx,new/page.tsx,new/NewUserForm.tsx,[id]/page.tsx,[id]/UserDetail.tsx}`
- Create: `src/app/(app)/system/roles/{page.tsx,RolesTable.tsx,new/page.tsx,new/NewRoleForm.tsx,[id]/page.tsx,[id]/RoleDetail.tsx}`
- Test: `tests/http/errors.test.ts`, `tests/lib/api-fetch.test.ts`, `tests/lib/safe-callback.test.ts`, `tests/users/service.test.ts`, `tests/users/queries.test.ts`, `tests/roles/service.test.ts`, `tests/ui/login-form.test.tsx`, `tests/ui/multi-select-filter.test.tsx`

**Interfaces:**
- Consumes: `writeAudit`, `withIdempotency`, `Actor`, `assertCan`, `ForbiddenError`, `ALL_PERMISSION_CODES`, `PERMISSIONS` (plan 01a); `generateTempPassword`, `hashPassword`, `verifyPassword`, `validatePasswordStrength`, `verifyCredentials` (Task 6); khung UI (Task 9–11).
- Produces:
  - `class DomainError(message, status=409, code?)`, `ValidationError`, `UnauthorizedError` (`@/server/http/errors`); `apiHandler(fn)`, `toErrorResponse(e)` (`@/server/http/handler`); `requireActorApi(perm?)` (`@/server/auth/session`)
  - `apiFetch<T>(url, init & {json?; idempotencyKey?}): Promise<T>`, `class ApiError`, `class SessionExpiredError` (`@/lib/api-fetch`)
  - Users: `createUser(db, actor, input) → {id, username, tempPassword}`, `updateProfile`, `setUserRoles`, `setLocked`, `resetPassword → {tempPassword}`, `changeOwnPassword(db, actor, {current, next})`; `listUsers(db, params) → {rows, total, stats:{all,active,locked}}`, `getUser(db, id)`
  - Roles: `createRole`, `updateRoleInfo`, `updateRolePermissions`, `deleteRole`; `listRoles`, `getRole`
  - Quy ước: **mọi service nhận `db: Prisma.TransactionClient` và PHẢI được gọi bên trong `prisma.$transaction`** (rollback khi kiểm tra "còn quản trị viên" thất bại).

- [ ] **Step 1: Lỗi nghiệp vụ + bọc route handler (test đỏ trước)**

`tests/http/errors.test.ts`:
```ts
import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ForbiddenError } from "@/lib/permissions/guard";
import { DomainError, UnauthorizedError, ValidationError } from "@/server/http/errors";
import { toErrorResponse } from "@/server/http/handler";

const body = async (r: Response) => r.json();

describe("toErrorResponse", () => {
  it("DomainError → status của nó, thông báo tiếng Việt", async () => {
    const r = toErrorResponse(new DomainError("Tên đăng nhập đã tồn tại."));
    expect(r.status).toBe(409);
    expect(await body(r)).toEqual({ error: "Tên đăng nhập đã tồn tại." });
  });

  it("DomainError 404 tuỳ biến", () => {
    expect(toErrorResponse(new DomainError("Không tìm thấy.", 404)).status).toBe(404);
  });

  it("ForbiddenError → 403; UnauthorizedError → 401", async () => {
    expect(toErrorResponse(new ForbiddenError("user.manage")).status).toBe(403);
    const r = toErrorResponse(new UnauthorizedError());
    expect(r.status).toBe(401);
    expect((await body(r)).error).toMatch(/hết hạn/);
  });

  it("ZodError → 400 kèm thông báo của lỗi đầu và bản đồ field", async () => {
    const parsed = z.object({ name: z.string().min(2, "Nhập họ tên") }).safeParse({ name: "" });
    const r = toErrorResponse(parsed.error);
    expect(r.status).toBe(400);
    expect(await body(r)).toEqual({ error: "Nhập họ tên", fields: { name: "Nhập họ tên" } });
  });

  it("ValidationError → 400", () => {
    expect(toErrorResponse(new ValidationError("Thiếu Idempotency-Key.")).status).toBe(400);
  });

  it("vi phạm UNIQUE của Prisma (P2002) → 409 thông báo chung", async () => {
    const e = new Prisma.PrismaClientKnownRequestError("x", { code: "P2002", clientVersion: "6" });
    const r = toErrorResponse(e);
    expect(r.status).toBe(409);
    expect((await body(r)).error).toMatch(/đã tồn tại/);
  });

  it("lỗi lạ → 500, KHÔNG lộ nội dung lỗi, có ghi log", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = toErrorResponse(new Error("password=hunter2 ở dòng 42"));
    expect(r.status).toBe(500);
    expect(JSON.stringify(await body(r))).not.toContain("hunter2");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
```
`src/server/http/errors.ts`:
```ts
export class DomainError extends Error {
  constructor(message: string, public readonly status = 409, public readonly code?: string) {
    super(message);
    this.name = "DomainError";
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, public readonly fields?: Record<string, string>) {
    super(message, 400, "VALIDATION");
    this.name = "ValidationError";
  }
}

export class UnauthorizedError extends DomainError {
  constructor() {
    super("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.", 401, "UNAUTHORIZED");
    this.name = "UnauthorizedError";
  }
}
```
`src/server/http/handler.ts`:
```ts
import { Prisma } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { ForbiddenError } from "@/lib/permissions/guard";
import { DomainError, ValidationError } from "./errors";

export function toErrorResponse(e: unknown): NextResponse {
  if (e instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const i of e.issues) fields[i.path.join(".") || "_"] ??= i.message;
    return NextResponse.json({ error: e.issues[0]?.message ?? "Dữ liệu không hợp lệ.", fields }, { status: 400 });
  }
  if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
  if (e instanceof ValidationError) return NextResponse.json({ error: e.message, fields: e.fields }, { status: 400 });
  if (e instanceof DomainError) return NextResponse.json({ error: e.message }, { status: e.status });
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    return NextResponse.json({ error: "Dữ liệu đã tồn tại, vui lòng kiểm tra lại." }, { status: 409 });
  }
  console.error(e);
  return NextResponse.json({ error: "Có lỗi hệ thống, vui lòng thử lại.", code: "INTERNAL" }, { status: 500 });
}

/** Bọc route handler: trả JSON, lỗi được chuyển thành phản hồi tiếng Việt. */
export function apiHandler<C = unknown>(fn: (req: NextRequest, ctx: C) => Promise<unknown>) {
  return async (req: NextRequest, ctx: C) => {
    try {
      return NextResponse.json((await fn(req, ctx)) ?? { ok: true });
    } catch (e) {
      return toErrorResponse(e);
    }
  };
}
```
Thêm vào `src/server/auth/session.ts`:
```ts
import { ForbiddenError } from "@/lib/permissions/guard";
import { UnauthorizedError } from "@/server/http/errors";

/** Dùng trong route handler: trả 401/403 dạng JSON thay vì redirect. */
export async function requireActorApi(perm?: PermissionCode): Promise<SessionActor> {
  const actor = await getActor();
  if (!actor) throw new UnauthorizedError();
  if (perm && !actor.perms.has(perm)) throw new ForbiddenError(perm);
  return actor;
}
```
Run: `npm test -- tests/http` → PASS.

- [ ] **Step 2: `apiFetch` — phiên hết hạn KHÔNG tự chuyển trang, KHÔNG mất dữ liệu form (Review Focus)**

`tests/lib/api-fetch.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch, SessionExpiredError } from "@/lib/api-fetch";
import { useToastStore } from "@/lib/toast";

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  useToastStore.setState({ items: [] });
  fetchMock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

const res = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("apiFetch", () => {
  it("gửi JSON + Idempotency-Key và trả body", async () => {
    fetchMock.mockResolvedValueOnce(res(200, { id: 5 }));
    const r = await apiFetch<{ id: number }>("/api/users", { method: "POST", json: { a: 1 }, idempotencyKey: "k1" });
    expect(r).toEqual({ id: 5 });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
    expect(new Headers(init.headers).get("idempotency-key")).toBe("k1");
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
  });

  it("lỗi 4xx/5xx → ApiError mang thông báo tiếng Việt của server", async () => {
    fetchMock.mockResolvedValueOnce(res(409, { error: "Tên đăng nhập đã tồn tại." }));
    await expect(apiFetch("/api/users")).rejects.toMatchObject({ status: 409, message: "Tên đăng nhập đã tồn tại." });
    fetchMock.mockResolvedValueOnce(new Response("<html>", { status: 502 }));
    await expect(apiFetch("/api/users")).rejects.toBeInstanceOf(ApiError);
  });

  it("401 → SessionExpiredError + toast lỗi KHÔNG tự tắt, KHÔNG chuyển trang", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { assign, href: "/x" });
    fetchMock.mockResolvedValueOnce(res(401, { error: "hết hạn" }));
    await expect(apiFetch("/api/users")).rejects.toBeInstanceOf(SessionExpiredError);
    const items = useToastStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0]!.kind).toBe("error");
    expect(items[0]!.message).toMatch(/dữ liệu đang nhập vẫn được giữ/);
    expect(assign).not.toHaveBeenCalled();
  });

  it("mất mạng (fetch ném lỗi) → ApiError tiếng Việt", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(apiFetch("/api/users")).rejects.toMatchObject({ message: expect.stringMatching(/kết nối/) });
  });
});
```
`src/lib/api-fetch.ts`:
```ts
import { toast } from "./toast";

export class ApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly code?: string) {
    super(message);
    this.name = "ApiError";
  }
}
export class SessionExpiredError extends ApiError {
  constructor() {
    super(401, "Phiên đăng nhập đã hết hạn.");
    this.name = "SessionExpiredError";
  }
}

type Init = Omit<RequestInit, "body"> & { json?: unknown; idempotencyKey?: string; body?: BodyInit | null };

/**
 * fetch cho client: JSON hai chiều, thông báo lỗi tiếng Việt, gắn Idempotency-Key.
 * 401 KHÔNG redirect: hiện toast lỗi (không tự tắt) và ném SessionExpiredError → form giữ nguyên dữ liệu đang nhập;
 * người dùng đăng nhập lại ở tab khác rồi bấm Lưu lại.
 */
export async function apiFetch<T = unknown>(url: string, init: Init = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.json !== undefined) headers.set("content-type", "application/json");
  if (init.idempotencyKey) headers.set("idempotency-key", init.idempotencyKey);

  let res: Response;
  try {
    res = await fetch(url, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body });
  } catch {
    throw new ApiError(0, "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại — dữ liệu đang nhập vẫn được giữ.");
  }

  if (res.status === 401) {
    toast.error("Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại ở tab mới — dữ liệu đang nhập vẫn được giữ trên màn hình này.");
    throw new SessionExpiredError();
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    throw new ApiError(res.status, data.error ?? "Có lỗi xảy ra, vui lòng thử lại.", data.code);
  }
  return (await res.json().catch(() => ({}))) as T;
}
```
Run: `npm test -- tests/lib/api-fetch.test.ts` → PASS.

- [ ] **Step 3: Test service người dùng (đỏ)**

`tests/users/service.test.ts`:
```ts
import type { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it } from "vitest";
import { ForbiddenError } from "@/lib/permissions/guard";
import type { Actor } from "@/lib/permissions/scope";
import { verifyCredentials } from "@/server/auth/credentials";
import { hashPassword } from "@/server/auth/password";
import { DomainError } from "@/server/http/errors";
import {
  changeOwnPassword, createUser, resetPassword, setLocked, setUserRoles, updateProfile,
} from "@/server/users/service";
import { seed } from "../../prisma/seed-lib";
import { prisma, resetDb } from "../helpers/db";

const tx = <T,>(fn: (db: Prisma.TransactionClient) => Promise<T>) => prisma.$transaction(fn);

let admin: { id: number; actor: Actor };
let roleId: Record<string, number>;

async function makeAdmin() {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: "Giám đốc" } });
  const u = await prisma.user.create({
    data: { username: "admin", fullName: "Admin", passwordHash: await hashPassword("Admin12345"), roles: { create: { roleId: role.id } } },
  });
  const perms = new Set((await prisma.rolePermission.findMany({ where: { roleId: role.id }, include: { permission: true } })).map((r) => r.permission.code));
  return { id: u.id, actor: { userId: u.id, perms } as Actor };
}

beforeEach(async () => {
  await resetDb();
  await seed(prisma);
  roleId = Object.fromEntries((await prisma.role.findMany()).map((r) => [r.name, r.id]));
  admin = await makeAdmin();
});

const input = (over = {}) => ({ username: "Nam", fullName: "Nguyễn Nam", roleIds: [roleId["Bán hàng"]!], ...over });

describe("createUser", () => {
  it("tạo user: username chữ thường, mật khẩu tạm dùng được, bắt đổi mật khẩu, gán vai trò", async () => {
    const r = await tx((db) => createUser(db, admin.actor, input()));
    expect(r.username).toBe("nam");
    const u = await prisma.user.findUniqueOrThrow({ where: { id: r.id }, include: { roles: true } });
    expect(u.mustChangePassword).toBe(true);
    expect(u.roles.map((x) => x.roleId)).toEqual([roleId["Bán hàng"]]);
    expect(await bcrypt.compare(r.tempPassword, u.passwordHash)).toBe(true);
    expect((await verifyCredentials(prisma, "NAM", r.tempPassword)).ok).toBe(true);
  });

  it("ghi audit user.create — KHÔNG chứa mật khẩu tạm hay hash", async () => {
    const r = await tx((db) => createUser(db, admin.actor, input()));
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "user.create" } });
    const text = JSON.stringify(log);
    expect(text).not.toContain(r.tempPassword);
    expect(text).not.toMatch(/\$2[aby]\$/); // hash bcrypt
    expect(text).not.toContain("passwordHash");
    expect(log.afterJson).toMatchObject({ username: "nam", fullName: "Nguyễn Nam", roles: ["Bán hàng"] });
    expect(log.userId).toBe(admin.id);
  });

  it("trùng tên đăng nhập (không phân biệt hoa thường) → lỗi tiếng Việt", async () => {
    await tx((db) => createUser(db, admin.actor, input()));
    await expect(tx((db) => createUser(db, admin.actor, input({ username: "NAM" })))).rejects.toThrow("Tên đăng nhập đã tồn tại.");
  });

  it("thiếu quyền user.manage → ForbiddenError, không ghi gì", async () => {
    const weak: Actor = { userId: admin.id, perms: new Set(["user.view"]) };
    await expect(tx((db) => createUser(db, weak, input()))).rejects.toBeInstanceOf(ForbiddenError);
    expect(await prisma.user.count()).toBe(1);
  });

  it("vai trò không tồn tại → lỗi", async () => {
    await expect(tx((db) => createUser(db, admin.actor, input({ roleIds: [99999] })))).rejects.toBeInstanceOf(DomainError);
  });
});

describe("khoá / mở khoá (mã 4)", () => {
  it("khoá → không đăng nhập được (LOCKED); mở khoá → đăng nhập lại được; có audit", async () => {
    const r = await tx((db) => createUser(db, admin.actor, input()));
    await tx((db) => setLocked(db, admin.actor, r.id, true));
    expect(await verifyCredentials(prisma, "nam", r.tempPassword)).toEqual({ ok: false, reason: "LOCKED" });
    await tx((db) => setLocked(db, admin.actor, r.id, false));
    expect((await verifyCredentials(prisma, "nam", r.tempPassword)).ok).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: { in: ["user.lock", "user.unlock"] } } })).toBe(2);
  });

  it("không tự khoá chính mình", async () => {
    await expect(tx((db) => setLocked(db, admin.actor, admin.id, true))).rejects.toThrow("Bạn không thể tự khóa tài khoản của mình.");
  });

  it("khoá quản trị viên CUỐI CÙNG bị chặn và ROLLBACK", async () => {
    const other = await tx((db) => createUser(db, admin.actor, input({ username: "ketoan", roleIds: [roleId["Kế toán"]!] })));
    const actorB: Actor = { userId: other.id, perms: new Set(["user.manage"]) }; // người thực hiện khác, không phải admin
    await expect(tx((db) => setLocked(db, actorB, admin.id, true))).rejects.toThrow(/ít nhất một tài khoản/);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).isLocked).toBe(false); // đã rollback
  });

  it("khoá khi còn quản trị viên khác → được", async () => {
    const second = await tx((db) => createUser(db, admin.actor, input({ username: "admin2", roleIds: [roleId["Giám đốc"]!] })));
    await tx((db) => setLocked(db, admin.actor, second.id, true));
    expect((await prisma.user.findUniqueOrThrow({ where: { id: second.id } })).isLocked).toBe(true);
  });
});

describe("vai trò & hồ sơ", () => {
  it("đổi vai trò: ghi audit số cũ/số mới", async () => {
    const r = await tx((db) => createUser(db, admin.actor, input()));
    await tx((db) => setUserRoles(db, admin.actor, r.id, [roleId["Thủ kho"]!, roleId["Thủ quỹ"]!]));
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "user.set_roles" } });
    expect(log.beforeJson).toEqual({ roles: ["Bán hàng"] });
    expect((log.afterJson as { roles: string[] }).roles.sort()).toEqual(["Thủ kho", "Thủ quỹ"]);
  });

  it("gỡ vai trò quản trị của người quản trị CUỐI CÙNG bị chặn", async () => {
    await expect(tx((db) => setUserRoles(db, admin.actor, admin.id, [roleId["Bán hàng"]!]))).rejects.toThrow(/ít nhất một tài khoản/);
    const roles = await prisma.userRole.findMany({ where: { userId: admin.id } });
    expect(roles.map((x) => x.roleId)).toEqual([roleId["Giám đốc"]]);
  });

  it("phải chọn ít nhất 1 vai trò", async () => {
    const r = await tx((db) => createUser(db, admin.actor, input()));
    await expect(tx((db) => setUserRoles(db, admin.actor, r.id, []))).rejects.toThrow(/ít nhất 1 nhóm quyền/);
  });

  it("sửa họ tên: audit trước/sau", async () => {
    const r = await tx((db) => createUser(db, admin.actor, input()));
    await tx((db) => updateProfile(db, admin.actor, r.id, { fullName: "Nam Nguyễn" }));
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "user.update_profile" } });
    expect(log.beforeJson).toEqual({ fullName: "Nguyễn Nam" });
    expect(log.afterJson).toEqual({ fullName: "Nam Nguyễn" });
  });
});

describe("cấp lại / đổi mật khẩu (mã 1)", () => {
  it("cấp lại: mật khẩu cũ hết tác dụng, mật khẩu mới dùng được, bắt đổi lại; audit không chứa mật khẩu", async () => {
    const created = await tx((db) => createUser(db, admin.actor, input()));
    await prisma.user.update({ where: { id: created.id }, data: { mustChangePassword: false } });
    const r = await tx((db) => resetPassword(db, admin.actor, created.id));
    expect((await verifyCredentials(prisma, "nam", created.tempPassword)).ok).toBe(false);
    expect((await verifyCredentials(prisma, "nam", r.tempPassword)).ok).toBe(true);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: created.id } })).mustChangePassword).toBe(true);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "user.reset_password" } });
    expect(JSON.stringify(log)).not.toContain(r.tempPassword);
  });

  it("tự đổi mật khẩu: sai mật khẩu hiện tại → lỗi; mật khẩu yếu → lỗi; đúng → mustChange=false", async () => {
    const created = await tx((db) => createUser(db, admin.actor, input()));
    const self: Actor = { userId: created.id, perms: new Set() };
    await expect(tx((db) => changeOwnPassword(db, self, { current: "sai", next: "Xuong2026" }))).rejects.toThrow("Mật khẩu hiện tại không đúng.");
    await expect(tx((db) => changeOwnPassword(db, self, { current: created.tempPassword, next: "abc" }))).rejects.toThrow("Mật khẩu tối thiểu 8 ký tự.");
    await expect(tx((db) => changeOwnPassword(db, self, { current: created.tempPassword, next: created.tempPassword }))).rejects.toThrow(/khác mật khẩu hiện tại/);
    await tx((db) => changeOwnPassword(db, self, { current: created.tempPassword, next: "Xuong2026" }));
    const u = await prisma.user.findUniqueOrThrow({ where: { id: created.id } });
    expect(u.mustChangePassword).toBe(false);
    expect((await verifyCredentials(prisma, "nam", "Xuong2026")).ok).toBe(true);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "user.change_password" } });
    expect(JSON.stringify(log)).not.toContain("Xuong2026");
  });
});
```
- [ ] **Step 4: Chạy → đỏ; cài schemas + service người dùng**

`src/server/users/schemas.ts`:
```ts
import { z } from "zod";

export const usernameSchema = z
  .string({ required_error: "Nhập tên đăng nhập." })
  .trim()
  .min(3, "Tên đăng nhập tối thiểu 3 ký tự.")
  .max(30, "Tên đăng nhập tối đa 30 ký tự.")
  .regex(/^[a-zA-Z0-9._-]+$/, "Tên đăng nhập chỉ gồm chữ không dấu, số và . _ -");

export const fullNameSchema = z.string({ required_error: "Nhập họ tên." }).trim().min(2, "Nhập họ tên.").max(80, "Họ tên tối đa 80 ký tự.");

export const createUserSchema = z.object({
  username: usernameSchema,
  fullName: fullNameSchema,
  roleIds: z.array(z.number().int()).min(1, "Chọn ít nhất 1 nhóm quyền."),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const profileSectionSchema = z.object({ fullName: fullNameSchema });
export const rolesSectionSchema = z.object({ roleIds: z.array(z.number().int()).min(1, "Chọn ít nhất 1 nhóm quyền.") });

export const changePasswordSchema = z
  .object({
    current: z.string().min(1, "Nhập mật khẩu hiện tại."),
    next: z.string().min(1, "Nhập mật khẩu mới."),
    confirm: z.string().min(1, "Nhập lại mật khẩu mới."),
  })
  .refine((v) => v.next === v.confirm, { path: ["confirm"], message: "Mật khẩu nhập lại không khớp." });
```
`src/server/users/service.ts`:
```ts
import type { Prisma } from "@prisma/client";
import { assertCan } from "@/lib/permissions/guard";
import type { Actor } from "@/lib/permissions/scope";
import { writeAudit } from "@/server/audit/write";
import {
  generateTempPassword, hashPassword, validatePasswordStrength, verifyPassword,
} from "@/server/auth/password";
import { DomainError } from "@/server/http/errors";
import type { CreateUserInput } from "./schemas";

/** MỌI hàm nhận `db` là transaction client và PHẢI chạy trong prisma.$transaction (rollback khi vi phạm bất biến). */
type Db = Prisma.TransactionClient;

async function getUserOrThrow(db: Db, id: number) {
  const u = await db.user.findUnique({ where: { id }, include: { roles: { include: { role: true } } } });
  if (!u) throw new DomainError("Không tìm thấy người dùng.", 404);
  return u;
}

/** Bất biến: luôn còn ≥ 1 tài khoản đang hoạt động có quyền user.manage. Gọi SAU khi thay đổi, trong transaction. */
export async function assertAdminRemains(db: Db): Promise<void> {
  const n = await db.user.count({
    where: {
      isLocked: false,
      roles: { some: { role: { permissions: { some: { permission: { code: "user.manage" } } } } } },
    },
  });
  if (n < 1) {
    throw new DomainError("Hệ thống phải còn ít nhất một tài khoản đang hoạt động có quyền quản lý người dùng.");
  }
}

async function loadRoles(db: Db, roleIds: number[]) {
  const ids = [...new Set(roleIds)];
  if (ids.length === 0) throw new DomainError("Chọn ít nhất 1 nhóm quyền.", 400);
  const roles = await db.role.findMany({ where: { id: { in: ids } } });
  if (roles.length !== ids.length) throw new DomainError("Nhóm quyền không hợp lệ.", 400);
  return roles;
}

export async function createUser(db: Db, actor: Actor, input: CreateUserInput) {
  assertCan(actor.perms, "user.manage");
  const username = input.username.trim().toLowerCase();
  if (await db.user.findUnique({ where: { username } })) throw new DomainError("Tên đăng nhập đã tồn tại.");
  const roles = await loadRoles(db, input.roleIds);
  const tempPassword = generateTempPassword();
  const user = await db.user.create({
    data: {
      username,
      fullName: input.fullName.trim(),
      passwordHash: await hashPassword(tempPassword),
      mustChangePassword: true,
      roles: { create: roles.map((r) => ({ roleId: r.id })) },
    },
  });
  await writeAudit(db, {
    userId: actor.userId, action: "user.create", entity: "User", entityId: user.id,
    after: { username, fullName: user.fullName, roles: roles.map((r) => r.name) }, // KHÔNG mật khẩu/hash
  });
  return { id: user.id, username, tempPassword };
}

export async function updateProfile(db: Db, actor: Actor, userId: number, input: { fullName: string }) {
  assertCan(actor.perms, "user.manage");
  const u = await getUserOrThrow(db, userId);
  const fullName = input.fullName.trim();
  if (fullName === u.fullName) return;
  await db.user.update({ where: { id: userId }, data: { fullName } });
  await writeAudit(db, {
    userId: actor.userId, action: "user.update_profile", entity: "User", entityId: userId,
    before: { fullName: u.fullName }, after: { fullName },
  });
}

export async function setUserRoles(db: Db, actor: Actor, userId: number, roleIds: number[]) {
  assertCan(actor.perms, "user.manage");
  const u = await getUserOrThrow(db, userId);
  const roles = await loadRoles(db, roleIds);
  await db.userRole.deleteMany({ where: { userId } });
  await db.userRole.createMany({ data: roles.map((r) => ({ userId, roleId: r.id })) });
  await assertAdminRemains(db);
  await writeAudit(db, {
    userId: actor.userId, action: "user.set_roles", entity: "User", entityId: userId,
    before: { roles: u.roles.map((r) => r.role.name) }, after: { roles: roles.map((r) => r.name) },
  });
}

export async function setLocked(db: Db, actor: Actor, userId: number, locked: boolean) {
  assertCan(actor.perms, "user.manage");
  if (locked && userId === actor.userId) throw new DomainError("Bạn không thể tự khóa tài khoản của mình.");
  const u = await getUserOrThrow(db, userId);
  if (u.isLocked === locked) return;
  await db.user.update({ where: { id: userId }, data: { isLocked: locked } });
  if (locked) await assertAdminRemains(db);
  await writeAudit(db, {
    userId: actor.userId, action: locked ? "user.lock" : "user.unlock", entity: "User", entityId: userId,
    before: { isLocked: u.isLocked }, after: { isLocked: locked },
  });
}

export async function resetPassword(db: Db, actor: Actor, userId: number) {
  assertCan(actor.perms, "user.manage");
  await getUserOrThrow(db, userId);
  const tempPassword = generateTempPassword();
  await db.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(tempPassword), mustChangePassword: true } });
  await writeAudit(db, { userId: actor.userId, action: "user.reset_password", entity: "User", entityId: userId });
  return { tempPassword };
}

/** Tự đổi mật khẩu — không cần quyền đặc biệt. */
export async function changeOwnPassword(db: Db, actor: Actor, input: { current: string; next: string }) {
  const u = await getUserOrThrow(db, actor.userId);
  if (!(await verifyPassword(input.current, u.passwordHash))) throw new DomainError("Mật khẩu hiện tại không đúng.");
  if (input.next === input.current) throw new DomainError("Mật khẩu mới phải khác mật khẩu hiện tại.", 400);
  const weak = validatePasswordStrength(input.next, u.username);
  if (weak) throw new DomainError(weak, 400);
  await db.user.update({ where: { id: u.id }, data: { passwordHash: await hashPassword(input.next), mustChangePassword: false } });
  await writeAudit(db, { userId: actor.userId, action: "user.change_password", entity: "User", entityId: u.id });
}
```
Run: `npm test -- tests/users/service.test.ts`
Expected: PASS. Nếu test "khoá quản trị viên CUỐI CÙNG" đỏ vì `actorB` không phải quản trị nhưng service không kiểm tra người thực hiện → đúng thiết kế (quyền do `perms` của actor); test tạo `actorB` cố ý mang `user.manage` để gọi được.

- [ ] **Step 5: Truy vấn danh sách người dùng + test**

`tests/users/queries.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { parseListParams } from "@/lib/query-params";
import { listUsers } from "@/server/users/queries";
import { seed } from "../../prisma/seed-lib";
import { prisma, resetDb } from "../helpers/db";
import { makeUser } from "../helpers/factories";

beforeEach(async () => {
  await resetDb();
  await seed(prisma);
});

async function addUser(username: string, fullName: string, role: string, isLocked = false) {
  const r = await prisma.role.findUniqueOrThrow({ where: { name: role } });
  return makeUser({ username, fullName, isLocked, roles: { create: { roleId: r.id } } } as never);
}

describe("listUsers", () => {
  it("tìm không dấu theo họ tên/tên đăng nhập", async () => {
    await addUser("nam", "Nguyễn Văn Nam", "Bán hàng");
    await addUser("huong", "Đặng Hương", "Kế toán");
    expect((await listUsers(prisma, parseListParams({ q: "nguyen" }))).rows.map((r) => r.username)).toEqual(["nam"]);
    expect((await listUsers(prisma, parseListParams({ q: "DANG HUONG" }))).rows.map((r) => r.username)).toEqual(["huong"]);
  });

  it("lọc trạng thái + vai trò; stat KHÔNG phụ thuộc bộ lọc trạng thái đang chọn", async () => {
    await addUser("a", "A", "Bán hàng");
    await addUser("b", "B", "Bán hàng", true);
    await addUser("c", "C", "Kế toán");
    const locked = await listUsers(prisma, parseListParams({ status: "locked" }, ["status", "role"]));
    expect(locked.rows.map((r) => r.username)).toEqual(["b"]);
    expect(locked.total).toBe(1);
    expect(locked.stats).toEqual({ all: 3, active: 2, locked: 1 }); // đếm trên toàn bộ, không theo status
    const role = await prisma.role.findUniqueOrThrow({ where: { name: "Kế toán" } });
    const acc = await listUsers(prisma, parseListParams({ role: String(role.id) }, ["status", "role"]));
    expect(acc.rows.map((r) => r.username)).toEqual(["c"]);
  });

  it("phân trang + sắp xếp chỉ theo cột cho phép; không lộ passwordHash", async () => {
    for (let i = 0; i < 25; i++) await addUser(`u${String(i).padStart(2, "0")}`, `Người ${i}`, "Bán hàng");
    const p1 = await listUsers(prisma, parseListParams({ sort: "username" }));
    expect(p1.rows).toHaveLength(20);
    expect(p1.total).toBe(25);
    const p2 = await listUsers(prisma, parseListParams({ sort: "username", page: "2" }));
    expect(p2.rows).toHaveLength(5);
    expect(JSON.stringify(p1.rows)).not.toContain("passwordHash");
    const evil = await listUsers(prisma, parseListParams({ sort: "passwordHash" }));
    expect(evil.rows).toHaveLength(20); // rơi về sort mặc định, không lỗi
  });
});
```
`src/server/users/queries.ts` — bảng người dùng nhỏ (vài chục dòng) nên lọc/sắp xếp/phân trang trong bộ nhớ để dùng `normalizeSearch` cho tên có dấu (không cần cột `searchText` cho `users`):
```ts
import type { PrismaClient } from "@prisma/client";
import type { ListParams } from "@/lib/query-params";
import { normalizeSearch } from "@/lib/search";
import { DomainError } from "@/server/http/errors";

export interface UserRow {
  id: number;
  username: string;
  fullName: string;
  isLocked: boolean;
  mustChangePassword: boolean;
  createdAt: Date;
  roles: { id: number; name: string }[];
}

const SORTABLE = ["fullName", "username", "createdAt"] as const;

export async function listUsers(db: PrismaClient, params: ListParams) {
  const all = await db.user.findMany({
    select: { id: true, username: true, fullName: true, isLocked: true, mustChangePassword: true, createdAt: true, roles: { select: { role: { select: { id: true, name: true } } } } },
  });
  const users: UserRow[] = all.map((u) => ({ ...u, roles: u.roles.map((r) => r.role) }));

  const needle = normalizeSearch(params.q ?? "");
  const roleFilter = (params.filters.role ?? []).map(Number);
  const scoped = users.filter(
    (u) =>
      (!needle || normalizeSearch(`${u.username} ${u.fullName}`).includes(needle)) &&
      (roleFilter.length === 0 || u.roles.some((r) => roleFilter.includes(r.id))),
  );
  const stats = { all: scoped.length, active: scoped.filter((u) => !u.isLocked).length, locked: scoped.filter((u) => u.isLocked).length };

  const status = params.filters.status ?? [];
  const filtered = scoped.filter((u) => status.length === 0 || status.includes(u.isLocked ? "locked" : "active"));

  const desc = params.sort?.startsWith("-");
  const key = (params.sort?.replace(/^-/, "") ?? "createdAt") as (typeof SORTABLE)[number];
  const sortKey = (SORTABLE as readonly string[]).includes(key) ? key : "createdAt";
  const dir = params.sort ? (desc ? -1 : 1) : -1;
  filtered.sort((a, b) => {
    const x = a[sortKey], y = b[sortKey];
    return (x instanceof Date && y instanceof Date ? x.getTime() - y.getTime() : String(x).localeCompare(String(y), "vi")) * dir;
  });

  const start = (params.page - 1) * params.pageSize;
  return { rows: filtered.slice(start, start + params.pageSize), total: filtered.length, stats };
}

export async function getUser(db: PrismaClient, id: number) {
  const u = await db.user.findUnique({
    where: { id },
    select: { id: true, username: true, fullName: true, isLocked: true, mustChangePassword: true, createdAt: true, roles: { select: { role: { select: { id: true, name: true } } } } },
  });
  if (!u) throw new DomainError("Không tìm thấy người dùng.", 404);
  return { ...u, roles: u.roles.map((r) => r.role) };
}
```
Run: `npm test -- tests/users/queries.test.ts` → PASS.

- [ ] **Step 6: Nhóm quyền — test + service (mã 3)**

`tests/roles/service.test.ts`:
```ts
import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { ALL_PERMISSION_CODES } from "@/lib/permissions/catalog";
import type { Actor } from "@/lib/permissions/scope";
import { hashPassword } from "@/server/auth/password";
import { createRole, deleteRole, updateRoleInfo, updateRolePermissions } from "@/server/roles/service";
import { seed } from "../../prisma/seed-lib";
import { prisma, resetDb } from "../helpers/db";

const tx = <T,>(fn: (db: Prisma.TransactionClient) => Promise<T>) => prisma.$transaction(fn);
let actor: Actor;
let directorId: number;

beforeEach(async () => {
  await resetDb();
  await seed(prisma);
  const role = await prisma.role.findUniqueOrThrow({ where: { name: "Giám đốc" } });
  directorId = role.id;
  const u = await prisma.user.create({ data: { username: "admin", fullName: "Admin", passwordHash: await hashPassword("Admin12345"), roles: { create: { roleId: role.id } } } });
  actor = { userId: u.id, perms: new Set(ALL_PERMISSION_CODES) };
});

const codesOf = async (roleId: number) =>
  (await prisma.rolePermission.findMany({ where: { roleId }, include: { permission: true } })).map((r) => r.permission.code).sort();

describe("nhóm quyền động", () => {
  it("tạo nhóm mới rỗng; tên trùng bị chặn", async () => {
    const r = await tx((db) => createRole(db, actor, { name: "Trợ lý", description: "Hỗ trợ" }));
    expect(await codesOf(r.id)).toEqual([]);
    await expect(tx((db) => createRole(db, actor, { name: "Trợ lý" }))).rejects.toThrow("Tên nhóm quyền đã tồn tại.");
  });

  it("cập nhật quyền: thay thế toàn bộ; audit có danh sách quyền trước/sau", async () => {
    const r = await tx((db) => createRole(db, actor, { name: "Trợ lý" }));
    await tx((db) => updateRolePermissions(db, actor, r.id, ["order.view", "product.view"]));
    expect(await codesOf(r.id)).toEqual(["order.view", "product.view"]);
    await tx((db) => updateRolePermissions(db, actor, r.id, ["order.view", "cost.view"]));
    const logs = await prisma.auditLog.findMany({ where: { action: "role.set_permissions" }, orderBy: { id: "asc" } });
    expect(logs[1]!.beforeJson).toEqual({ permissions: ["order.view", "product.view"] });
    expect(logs[1]!.afterJson).toEqual({ permissions: ["cost.view", "order.view"] });
  });

  it("mã quyền lạ bị từ chối", async () => {
    const r = await tx((db) => createRole(db, actor, { name: "Trợ lý" }));
    await expect(tx((db) => updateRolePermissions(db, actor, r.id, ["khong.co"]))).rejects.toThrow(/không hợp lệ/);
  });

  it("gỡ user.manage khỏi nhóm của quản trị viên CUỐI CÙNG bị chặn và rollback", async () => {
    const wanted = ALL_PERMISSION_CODES.filter((c) => c !== "user.manage");
    await expect(tx((db) => updateRolePermissions(db, actor, directorId, wanted))).rejects.toThrow(/ít nhất một tài khoản/);
    expect(await codesOf(directorId)).toContain("user.manage");
  });

  it("nhóm hệ thống: không xóa, không đổi tên; nhóm tự tạo: đổi tên được", async () => {
    await expect(tx((db) => deleteRole(db, actor, directorId))).rejects.toThrow(/nhóm hệ thống/);
    await expect(tx((db) => updateRoleInfo(db, actor, directorId, { name: "Sếp" }))).rejects.toThrow(/nhóm hệ thống/);
    const r = await tx((db) => createRole(db, actor, { name: "Trợ lý" }));
    await tx((db) => updateRoleInfo(db, actor, r.id, { name: "Trợ lý kho", description: "x" }));
    expect((await prisma.role.findUniqueOrThrow({ where: { id: r.id } })).name).toBe("Trợ lý kho");
  });

  it("xóa nhóm đang có người dùng bị chặn, nêu số người; nhóm trống xóa được", async () => {
    const r = await tx((db) => createRole(db, actor, { name: "Trợ lý" }));
    const u = await prisma.user.create({ data: { username: "tl", fullName: "TL", passwordHash: "x", roles: { create: { roleId: r.id } } } });
    await expect(tx((db) => deleteRole(db, actor, r.id))).rejects.toThrow("Nhóm quyền đang có 1 người dùng — hãy chuyển họ sang nhóm khác trước.");
    await prisma.userRole.deleteMany({ where: { userId: u.id } });
    await tx((db) => deleteRole(db, actor, r.id));
    expect(await prisma.role.count({ where: { id: r.id } })).toBe(0);
  });

  it("thiếu quyền role.manage → bị từ chối", async () => {
    const weak: Actor = { userId: actor.userId, perms: new Set(["user.manage"]) };
    await expect(tx((db) => createRole(db, weak, { name: "X" }))).rejects.toThrow(/không có quyền/);
  });
});
```
`src/server/roles/schemas.ts`:
```ts
import { z } from "zod";

export const roleInfoSchema = z.object({
  name: z.string({ required_error: "Nhập tên nhóm quyền." }).trim().min(2, "Tên nhóm quyền tối thiểu 2 ký tự.").max(40, "Tên nhóm quyền tối đa 40 ký tự."),
  description: z.string().trim().max(200, "Mô tả tối đa 200 ký tự.").optional(),
});
export type RoleInfoInput = z.infer<typeof roleInfoSchema>;

export const rolePermissionsSchema = z.object({ codes: z.array(z.string()) });
```
`src/server/roles/service.ts`:
```ts
import type { Prisma } from "@prisma/client";
import { ALL_PERMISSION_CODES } from "@/lib/permissions/catalog";
import { assertCan } from "@/lib/permissions/guard";
import type { Actor } from "@/lib/permissions/scope";
import { writeAudit } from "@/server/audit/write";
import { DomainError } from "@/server/http/errors";
import { assertAdminRemains } from "@/server/users/service";
import type { RoleInfoInput } from "./schemas";

type Db = Prisma.TransactionClient;

async function getRoleOrThrow(db: Db, id: number) {
  const r = await db.role.findUnique({ where: { id }, include: { permissions: { include: { permission: true } }, _count: { select: { users: true } } } });
  if (!r) throw new DomainError("Không tìm thấy nhóm quyền.", 404);
  return r;
}

const sortedCodes = (r: { permissions: { permission: { code: string } }[] }) => r.permissions.map((p) => p.permission.code).sort();

export async function createRole(db: Db, actor: Actor, input: RoleInfoInput) {
  assertCan(actor.perms, "role.manage");
  const name = input.name.trim();
  if (await db.role.findUnique({ where: { name } })) throw new DomainError("Tên nhóm quyền đã tồn tại.");
  const role = await db.role.create({ data: { name, description: input.description?.trim() || null } });
  await writeAudit(db, { userId: actor.userId, action: "role.create", entity: "Role", entityId: role.id, after: { name, description: role.description } });
  return { id: role.id };
}

export async function updateRoleInfo(db: Db, actor: Actor, roleId: number, input: RoleInfoInput) {
  assertCan(actor.perms, "role.manage");
  const role = await getRoleOrThrow(db, roleId);
  const name = input.name.trim();
  if (role.isSystem && name !== role.name) throw new DomainError("Không đổi tên được nhóm hệ thống.");
  if (name !== role.name && (await db.role.findUnique({ where: { name } }))) throw new DomainError("Tên nhóm quyền đã tồn tại.");
  const description = input.description?.trim() || null;
  await db.role.update({ where: { id: roleId }, data: { name, description } });
  await writeAudit(db, {
    userId: actor.userId, action: "role.update_info", entity: "Role", entityId: roleId,
    before: { name: role.name, description: role.description }, after: { name, description },
  });
}

export async function updateRolePermissions(db: Db, actor: Actor, roleId: number, codes: string[]) {
  assertCan(actor.perms, "role.manage");
  const role = await getRoleOrThrow(db, roleId);
  const wanted = [...new Set(codes)];
  const known = new Set<string>(ALL_PERMISSION_CODES);
  const bad = wanted.filter((c) => !known.has(c));
  if (bad.length) throw new DomainError(`Mã quyền không hợp lệ: ${bad.join(", ")}.`, 400);

  const perms = await db.permission.findMany({ where: { code: { in: wanted } } });
  await db.rolePermission.deleteMany({ where: { roleId } });
  await db.rolePermission.createMany({ data: perms.map((p) => ({ roleId, permissionId: p.id })) });
  await assertAdminRemains(db);
  await writeAudit(db, {
    userId: actor.userId, action: "role.set_permissions", entity: "Role", entityId: roleId,
    before: { permissions: sortedCodes(role) }, after: { permissions: perms.map((p) => p.code).sort() },
  });
}

export async function deleteRole(db: Db, actor: Actor, roleId: number) {
  assertCan(actor.perms, "role.manage");
  const role = await getRoleOrThrow(db, roleId);
  if (role.isSystem) throw new DomainError("Không xóa được nhóm hệ thống.");
  if (role._count.users > 0) {
    throw new DomainError(`Nhóm quyền đang có ${role._count.users} người dùng — hãy chuyển họ sang nhóm khác trước.`);
  }
  await db.role.delete({ where: { id: roleId } });
  await writeAudit(db, { userId: actor.userId, action: "role.delete", entity: "Role", entityId: roleId, before: { name: role.name, permissions: sortedCodes(role) } });
}
```
`src/server/roles/queries.ts`:
```ts
import type { PrismaClient } from "@prisma/client";
import { DomainError } from "@/server/http/errors";

export async function listRoles(db: PrismaClient) {
  const roles = await db.role.findMany({ orderBy: { id: "asc" }, include: { _count: { select: { users: true, permissions: true } } } });
  return roles.map((r) => ({ id: r.id, name: r.name, description: r.description, isSystem: r.isSystem, userCount: r._count.users, permissionCount: r._count.permissions }));
}

export async function getRole(db: PrismaClient, id: number) {
  const r = await db.role.findUnique({
    where: { id },
    include: {
      permissions: { include: { permission: true } },
      users: { include: { user: { select: { id: true, username: true, fullName: true, isLocked: true } } } },
    },
  });
  if (!r) throw new DomainError("Không tìm thấy nhóm quyền.", 404);
  return {
    id: r.id, name: r.name, description: r.description, isSystem: r.isSystem,
    permissionCodes: r.permissions.map((p) => p.permission.code),
    users: r.users.map((u) => u.user),
  };
}
```
Run: `npm test -- tests/roles` → PASS.

- [ ] **Step 7: Route handler mỏng**

`src/app/api/users/route.ts` — mật khẩu tạm KHÔNG đi qua bảng idempotency (Review Focus):
```ts
import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { ValidationError } from "@/server/http/errors";
import { apiHandler } from "@/server/http/handler";
import { withIdempotency } from "@/server/idempotency/with-idempotency";
import { createUserSchema } from "@/server/users/schemas";
import { createUser } from "@/server/users/service";

export const POST = apiHandler(async (req) => {
  const actor = await requireActorApi("user.manage");
  const key = req.headers.get("idempotency-key");
  if (!key) throw new ValidationError("Thiếu Idempotency-Key.");
  const input = createUserSchema.parse(await req.json());

  let tempPassword: string | null = null;
  const { id } = await withIdempotency(prisma, { userId: actor.userId, scope: "user.create", key }, async (tx) => {
    const r = await createUser(tx, actor, input);
    tempPassword = r.tempPassword; // chỉ giữ trong bộ nhớ request — KHÔNG lưu vào idempotency_keys
    return { id: r.id };
  });
  // Lặp lại cùng khoá: work không chạy → tempPassword = null (UI nhắc dùng "Cấp lại mật khẩu")
  return { id, tempPassword };
});
```
`src/app/api/users/[id]/section-update/route.ts`:
```ts
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { ValidationError } from "@/server/http/errors";
import { apiHandler } from "@/server/http/handler";
import { profileSectionSchema, rolesSectionSchema } from "@/server/users/schemas";
import { setUserRoles, updateProfile } from "@/server/users/service";

export const PATCH = apiHandler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireActorApi("user.manage");
  const id = z.coerce.number().int().positive().parse((await ctx.params).id);
  const body = (await req.json()) as { section?: string };
  // Chỉ ghi các field thuộc đúng `section` (full-page-detail.md mục 4)
  switch (body.section) {
    case "profile": {
      const v = profileSectionSchema.parse(body);
      await prisma.$transaction((tx) => updateProfile(tx, actor, id, v));
      return { ok: true };
    }
    case "roles": {
      const v = rolesSectionSchema.parse(body);
      await prisma.$transaction((tx) => setUserRoles(tx, actor, id, v.roleIds));
      return { ok: true };
    }
    default:
      throw new ValidationError("Phần dữ liệu không hợp lệ.");
  }
});
```
`src/app/api/users/[id]/lock/route.ts`:
```ts
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { setLocked } from "@/server/users/service";

const body = z.object({ locked: z.boolean() });

export const POST = apiHandler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireActorApi("user.manage");
  const id = z.coerce.number().int().positive().parse((await ctx.params).id);
  const { locked } = body.parse(await req.json());
  await prisma.$transaction((tx) => setLocked(tx, actor, id, locked));
  return { ok: true };
});
```
`src/app/api/users/[id]/reset-password/route.ts`:
```ts
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { resetPassword } from "@/server/users/service";

export const POST = apiHandler(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireActorApi("user.manage");
  const id = z.coerce.number().int().positive().parse((await ctx.params).id);
  return prisma.$transaction((tx) => resetPassword(tx, actor, id)); // { tempPassword } — hiện 1 lần
});
```
`src/app/api/account/change-password/route.ts`:
```ts
import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { changePasswordSchema } from "@/server/users/schemas";
import { changeOwnPassword } from "@/server/users/service";

export const POST = apiHandler(async (req) => {
  const actor = await requireActorApi(); // chỉ cần đã đăng nhập
  const v = changePasswordSchema.parse(await req.json());
  await prisma.$transaction((tx) => changeOwnPassword(tx, actor, { current: v.current, next: v.next }));
  return { ok: true };
});
```
`src/app/api/roles/route.ts`:
```ts
import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { roleInfoSchema } from "@/server/roles/schemas";
import { createRole } from "@/server/roles/service";

export const POST = apiHandler(async (req) => {
  const actor = await requireActorApi("role.manage");
  const input = roleInfoSchema.parse(await req.json());
  return prisma.$transaction((tx) => createRole(tx, actor, input));
});
```
`src/app/api/roles/[id]/route.ts` (xóa) và `src/app/api/roles/[id]/section-update/route.ts`:
```ts
// route.ts
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { deleteRole } from "@/server/roles/service";

export const DELETE = apiHandler(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireActorApi("role.manage");
  const id = z.coerce.number().int().positive().parse((await ctx.params).id);
  await prisma.$transaction((tx) => deleteRole(tx, actor, id));
  return { ok: true };
});
```
```ts
// section-update/route.ts
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { ValidationError } from "@/server/http/errors";
import { apiHandler } from "@/server/http/handler";
import { roleInfoSchema, rolePermissionsSchema } from "@/server/roles/schemas";
import { updateRoleInfo, updateRolePermissions } from "@/server/roles/service";

export const PATCH = apiHandler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireActorApi("role.manage");
  const id = z.coerce.number().int().positive().parse((await ctx.params).id);
  const body = (await req.json()) as { section?: string };
  if (body.section === "info") {
    const v = roleInfoSchema.parse(body);
    await prisma.$transaction((tx) => updateRoleInfo(tx, actor, id, v));
    return { ok: true };
  }
  if (body.section === "permissions") {
    const v = rolePermissionsSchema.parse(body);
    await prisma.$transaction((tx) => updateRolePermissions(tx, actor, id, v.codes));
    return { ok: true };
  }
  throw new ValidationError("Phần dữ liệu không hợp lệ.");
});
```

- [ ] **Step 8: Đăng nhập (mã 1) — test + trang**

`tests/lib/safe-callback.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { safeCallbackUrl } from "@/lib/safe-callback";

describe("safeCallbackUrl — chống open redirect sau đăng nhập", () => {
  it.each([
    ["/sales/orders?page=2", "/sales/orders?page=2"],
    ["/", "/"],
    [undefined, "/"],
    ["", "/"],
    ["https://evil.com", "/"],
    ["//evil.com/x", "/"],
    ["/\\evil.com", "/"],
    ["javascript:alert(1)", "/"],
    ["/login", "/"], // không quay về chính trang đăng nhập
  ])("%j → %j", (input, out) => {
    expect(safeCallbackUrl(input)).toBe(out);
  });
});
```
`src/lib/safe-callback.ts`:
```ts
/** Chỉ nhận đường dẫn nội bộ tương đối; mọi thứ khác về "/". */
export function safeCallbackUrl(raw: string | undefined | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  if (raw === "/login" || raw.startsWith("/login?")) return "/";
  return raw;
}
```
`tests/ui/login-form.test.tsx`:
```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "@/app/(auth)/login/LoginForm";

const signIn = vi.fn();
const replace = vi.fn();
const refresh = vi.fn();
vi.mock("next-auth/react", () => ({ signIn: (...a: unknown[]) => signIn(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh }) }));

beforeEach(() => { signIn.mockReset(); replace.mockReset(); refresh.mockReset(); });
afterEach(cleanup);

async function submit(u = "nam", p = "Xuong2026") {
  await userEvent.type(screen.getByLabelText("Tên đăng nhập"), u);
  await userEvent.type(screen.getByLabelText("Mật khẩu"), p);
  await userEvent.click(screen.getByRole("button", { name: "Đăng nhập" }));
}

describe("LoginForm", () => {
  it("thành công → chuyển tới callbackUrl an toàn", async () => {
    signIn.mockResolvedValueOnce({ ok: true, error: null });
    render(<LoginForm callbackUrl="/sales/orders" />);
    await submit();
    expect(signIn).toHaveBeenCalledWith("credentials", { username: "nam", password: "Xuong2026", redirect: false });
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/sales/orders"));
    expect(refresh).toHaveBeenCalled();
  });

  it("sai mật khẩu → thông báo trung lập, KHÔNG nói rõ sai cái nào", async () => {
    signIn.mockResolvedValueOnce({ ok: false, error: "CredentialsSignin" });
    render(<LoginForm />);
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Tên đăng nhập hoặc mật khẩu không đúng.");
    expect(replace).not.toHaveBeenCalled();
  });

  it("tài khoản bị khoá → thông báo riêng", async () => {
    signIn.mockResolvedValueOnce({ ok: false, error: "LOCKED" });
    render(<LoginForm />);
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Tài khoản đã bị khóa. Liên hệ giám đốc để mở khóa.");
  });

  it("nút bị vô hiệu trong lúc chờ (chặn bấm đúp)", async () => {
    let done!: (v: unknown) => void;
    signIn.mockReturnValueOnce(new Promise((r) => { done = r; }));
    render(<LoginForm />);
    await submit();
    expect(screen.getByRole("button", { name: "Đang đăng nhập" })).toBeDisabled();
    done({ ok: true, error: null });
  });

  it("bắt buộc nhập đủ 2 ô; nút hiện/ẩn mật khẩu", async () => {
    render(<LoginForm />);
    await userEvent.click(screen.getByRole("button", { name: "Đăng nhập" }));
    expect(signIn).not.toHaveBeenCalled();
    expect(screen.getByText("Nhập tên đăng nhập.")).toBeInTheDocument();
    const pw = screen.getByLabelText("Mật khẩu");
    expect(pw).toHaveAttribute("type", "password");
    await userEvent.click(screen.getByRole("button", { name: "Hiện mật khẩu" }));
    expect(pw).toHaveAttribute("type", "text");
  });
});
```
`src/app/(auth)/login/LoginForm.tsx`:
```tsx
"use client";

import { Eye, EyeOff } from "lucide-react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { safeCallbackUrl } from "@/lib/safe-callback";

const MESSAGES: Record<string, string> = {
  CredentialsSignin: "Tên đăng nhập hoặc mật khẩu không đúng.",
  LOCKED: "Tài khoản đã bị khóa. Liên hệ giám đốc để mở khóa.",
};

export function LoginForm({ callbackUrl }: { callbackUrl?: string }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<{ username?: string; password?: string; form?: string }>({});

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    const next = {
      username: username.trim() ? undefined : "Nhập tên đăng nhập.",
      password: password ? undefined : "Nhập mật khẩu.",
    };
    setErrors(next);
    if (next.username || next.password) return;

    setPending(true);
    try {
      const res = await signIn("credentials", { username: username.trim(), password, redirect: false });
      if (res?.error) {
        setErrors({ form: MESSAGES[res.error] ?? "Không đăng nhập được, vui lòng thử lại." });
        return;
      }
      router.replace(safeCallbackUrl(callbackUrl));
      router.refresh();
    } catch {
      setErrors({ form: "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại." });
    } finally {
      setPending(false);
    }
  }

  const field = "h-11 w-full rounded-sm border bg-canvas px-3 text-sm hover:border-border-strong";
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {errors.form && <div role="alert" className="rounded-sm border border-danger bg-danger-soft p-3 text-sm text-danger">{errors.form}</div>}
      <div>
        <label htmlFor="username" className="mb-1 block text-sm font-medium">Tên đăng nhập</label>
        <input id="username" autoComplete="username" autoFocus value={username} onChange={(e) => setUsername(e.target.value)}
          aria-invalid={!!errors.username} className={`${field} ${errors.username ? "border-danger" : "border-border"}`} />
        {errors.username && <p className="mt-1 text-xs text-danger">{errors.username}</p>}
      </div>
      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium">Mật khẩu</label>
        <div className="relative">
          <input id="password" type={show ? "text" : "password"} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)}
            aria-invalid={!!errors.password} className={`${field} pr-11 ${errors.password ? "border-danger" : "border-border"}`} />
          <button type="button" aria-label={show ? "Ẩn mật khẩu" : "Hiện mật khẩu"} onClick={() => setShow((s) => !s)}
            className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center text-fg-muted hover:text-fg">
            {show ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
          </button>
        </div>
        {errors.password && <p className="mt-1 text-xs text-danger">{errors.password}</p>}
      </div>
      <button type="submit" disabled={pending} className="h-11 w-full rounded-sm bg-accent text-sm font-medium text-fg-on-accent disabled:opacity-60">
        {pending ? "Đang đăng nhập" : "Đăng nhập"}
      </button>
    </form>
  );
}
```
`src/app/(auth)/login/page.tsx` (bố cục 2 phần: form + khung thương hiệu ≥ lg; đã đăng nhập thì về trang chủ):
```tsx
import { redirect } from "next/navigation";
import { APP_NAME } from "@/lib/version";
import { getActor } from "@/server/auth/session";
import { LoginForm } from "./LoginForm";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string }> }) {
  if (await getActor()) redirect("/");
  const { callbackUrl } = await searchParams;
  return (
    <main className="grid min-h-dvh bg-canvas lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <h1 className="mb-1 text-2xl font-semibold">{APP_NAME}</h1>
          <p className="mb-6 text-sm text-fg-secondary">Đăng nhập để tiếp tục.</p>
          <LoginForm callbackUrl={callbackUrl} />
        </div>
      </section>
      <aside aria-hidden className="hidden items-end bg-accent p-10 lg:flex">
        <p className="max-w-md text-2xl font-semibold text-fg-on-accent">Đơn hàng — kho — giao hàng — kế toán trên một hệ thống.</p>
      </aside>
    </main>
  );
}
```
Đổi mật khẩu — `src/app/change-password/page.tsx` (ngoài nhóm `(app)` nên không bị vòng lặp redirect) + `ChangePasswordForm.tsx`:
```tsx
// page.tsx
import { requireActor } from "@/server/auth/session";
import { ChangePasswordForm } from "./ChangePasswordForm";

export default async function ChangePasswordPage() {
  const actor = await requireActor();
  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-sm rounded-md border border-border bg-surface p-6">
        <h1 className="mb-1 text-xl font-semibold">Đổi mật khẩu</h1>
        {actor.mustChangePassword && (
          <p className="mb-4 text-sm text-warning">Bạn cần đổi mật khẩu trước khi sử dụng hệ thống.</p>
        )}
        <ChangePasswordForm forced={actor.mustChangePassword} />
      </div>
    </main>
  );
}
```
```tsx
// ChangePasswordForm.tsx
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { ApiError, apiFetch } from "@/lib/api-fetch";
import { toast } from "@/lib/toast";
import { changePasswordSchema } from "@/server/users/schemas";

type Values = z.infer<typeof changePasswordSchema>;

export function ChangePasswordForm({ forced }: { forced: boolean }) {
  const router = useRouter();
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<Values>({ resolver: zodResolver(changePasswordSchema) });

  const onSubmit = handleSubmit(async (v) => {
    try {
      await apiFetch("/api/account/change-password", { method: "POST", json: v });
      toast.success("Đã đổi mật khẩu.");
      router.replace("/");
      router.refresh();
    } catch (e) {
      if (e instanceof ApiError) setError("root", { message: e.message });
    }
  });

  const field = (name: keyof Values, label: string, autoComplete: string) => (
    <div>
      <label htmlFor={name} className="mb-1 block text-sm font-medium">{label}</label>
      <input id={name} type="password" autoComplete={autoComplete} {...register(name)} aria-invalid={!!errors[name]}
        className={`h-11 w-full rounded-sm border bg-canvas px-3 text-sm ${errors[name] ? "border-danger" : "border-border"}`} />
      {errors[name] && <p className="mt-1 text-xs text-danger">{errors[name]!.message}</p>}
    </div>
  );

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {errors.root && <div role="alert" className="rounded-sm border border-danger bg-danger-soft p-3 text-sm text-danger">{errors.root.message}</div>}
      {field("current", forced ? "Mật khẩu tạm (được cấp)" : "Mật khẩu hiện tại", "current-password")}
      {field("next", "Mật khẩu mới", "new-password")}
      {field("confirm", "Nhập lại mật khẩu mới", "new-password")}
      <button type="submit" disabled={isSubmitting} className="h-11 w-full rounded-sm bg-accent text-sm font-medium text-fg-on-accent disabled:opacity-60">
        {isSubmitting ? "Đang lưu" : "Đổi mật khẩu"}
      </button>
    </form>
  );
}
```
Run: `npm test -- tests/lib/safe-callback.test.ts tests/ui/login-form.test.tsx` → PASS.

- [ ] **Step 9: `MultiSelectFilter` + `TempPasswordDialog` (test rồi cài)**

`tests/ui/multi-select-filter.test.tsx`:
```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MultiSelectFilter } from "@/components/ui/MultiSelectFilter";
import { parseListParams } from "@/lib/query-params";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
afterEach(() => { cleanup(); push.mockClear(); });

const options = [{ value: "1", label: "Giám đốc" }, { value: "2", label: "Kế toán" }];

describe("MultiSelectFilter", () => {
  it("hiện số đã chọn; chọn thêm → URL nối bằng dấu phẩy, về trang 1", async () => {
    render(<MultiSelectFilter label="Nhóm quyền" paramKey="role" options={options} basePath="/system/users" params={parseListParams({ role: "1", page: "3" }, ["role"])} />);
    expect(screen.getByRole("button", { name: /Nhóm quyền/ })).toHaveTextContent("1");
    await userEvent.click(screen.getByRole("button", { name: /Nhóm quyền/ }));
    await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "Kế toán" }));
    expect(push).toHaveBeenCalledWith("/system/users?role=1%2C2");
  });

  it("bỏ chọn giá trị cuối → gỡ khoá khỏi URL", async () => {
    render(<MultiSelectFilter label="Nhóm quyền" paramKey="role" options={options} basePath="/system/users" params={parseListParams({ role: "1" }, ["role"])} />);
    await userEvent.click(screen.getByRole("button", { name: /Nhóm quyền/ }));
    await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "Giám đốc" }));
    expect(push).toHaveBeenCalledWith("/system/users");
  });
});
```
`src/components/ui/MultiSelectFilter.tsx`:
```tsx
"use client";

import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { buildListHref, type ListParams } from "@/lib/query-params";

export function MultiSelectFilter({
  label, paramKey, options, basePath, params,
}: {
  label: string;
  paramKey: string;
  options: { value: string; label: string }[];
  basePath: string;
  params: ListParams;
}) {
  const router = useRouter();
  const selected = params.filters[paramKey] ?? [];
  const toggle = (value: string) => {
    const next = selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value];
    router.push(buildListHref(basePath, params, { filters: { [paramKey]: next } }));
  };
  return (
    <Dropdown.Root>
      <Dropdown.Trigger className="flex h-10 items-center gap-2 rounded-sm border border-border bg-canvas px-3 text-sm hover:bg-hover">
        {label}
        {selected.length > 0 && <span className="tabular rounded-full bg-accent-soft px-1.5 text-xs font-semibold text-accent">{selected.length}</span>}
        <ChevronDown size={14} aria-hidden className="text-fg-muted" />
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content align="start" sideOffset={6} className="z-dropdown max-h-72 min-w-48 overflow-auto rounded-md border border-border bg-raised p-1 shadow-md">
          {options.map((o) => (
            <Dropdown.CheckboxItem key={o.value} checked={selected.includes(o.value)} onCheckedChange={() => toggle(o.value)} onSelect={(e) => e.preventDefault()}
              className="flex h-9 cursor-pointer items-center gap-2 rounded-sm px-3 text-sm outline-none data-[highlighted]:bg-hover">
              <span aria-hidden className="flex h-4 w-4 items-center justify-center rounded-sm border border-border-strong">{selected.includes(o.value) && <Check size={12} />}</span>
              {o.label}
            </Dropdown.CheckboxItem>
          ))}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
```
`src/components/ui/TempPasswordDialog.tsx` — hiện mật khẩu tạm ĐÚNG 1 lần (sau tạo user / cấp lại mật khẩu):
```tsx
"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Copy } from "lucide-react";
import { toast } from "@/lib/toast";

export function TempPasswordDialog({
  open, username, password, onClose,
}: { open: boolean; username: string; password: string | null; onClose: () => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-scrim bg-[var(--overlay-scrim)]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-dialog w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-raised p-5 shadow-lg">
          <Dialog.Title className="text-base font-semibold">Mật khẩu tạm của {username}</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-fg-secondary">
            {password
              ? "Chỉ hiển thị MỘT lần. Gửi cho nhân viên qua kênh riêng; họ sẽ phải đổi mật khẩu ở lần đăng nhập đầu."
              : "Yêu cầu này đã được xử lý trước đó nên không hiển thị lại mật khẩu. Dùng “Cấp lại mật khẩu” nếu cần mật khẩu mới."}
          </Dialog.Description>
          {password && (
            <div className="mt-4 flex items-center justify-between gap-2 rounded-sm border border-border bg-canvas p-3">
              <code className="select-all font-mono text-base tracking-wide">{password}</code>
              <button type="button" aria-label="Sao chép mật khẩu" onClick={async () => { await navigator.clipboard.writeText(password); toast.success("Đã sao chép mật khẩu."); }}
                className="flex h-9 w-9 items-center justify-center rounded-sm hover:bg-hover"><Copy size={16} aria-hidden /></button>
            </div>
          )}
          <div className="mt-5 flex justify-end">
            <button type="button" onClick={onClose} className="h-10 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent">Đã ghi lại</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```
Thêm cả hai vào barrel `src/components/ui/index.ts`. Run: `npm test -- tests/ui/multi-select-filter.test.tsx` → PASS.

- [ ] **Step 10: Trang danh sách người dùng (mã 2, 4)**

`src/app/(app)/system/users/page.tsx`:
```tsx
import { Plus } from "lucide-react";
import Link from "next/link";
import { EmptyState, ListPageLayout, MultiSelectFilter, PaginationFooter, SearchBox, StatCard } from "@/components/ui";
import { buildListHref, parseListParams } from "@/lib/query-params";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/server/auth/session";
import { listUsers } from "@/server/users/queries";
import { UsersTable } from "./UsersTable";

const BASE = "/system/users";

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor("user.view");
  const params = parseListParams(await searchParams, ["status", "role"]);
  const [{ rows, total, stats }, roles] = await Promise.all([listUsers(prisma, params), prisma.role.findMany({ orderBy: { id: "asc" } })]);
  const href = (patch: Parameters<typeof buildListHref>[2]) => buildListHref(BASE, params, patch);
  const status = params.filters.status?.[0];
  const canManage = actor.perms.has("user.manage");
  const filtered = !!(params.q || params.filters.status || params.filters.role);

  return (
    <ListPageLayout
      title="Người dùng"
      actions={canManage && (
        <Link href={`${BASE}/new`} className="flex h-10 items-center gap-2 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent">
          <Plus size={16} aria-hidden /> Thêm mới
        </Link>
      )}
      stats={<>
        <StatCard label="Tổng" value={stats.all} href={href({ filters: { status: [] } })} active={!status} />
        <StatCard label="Đang hoạt động" value={stats.active} tone="success" href={href({ filters: { status: ["active"] } })} active={status === "active"} />
        <StatCard label="Đã khóa" value={stats.locked} tone="danger" href={href({ filters: { status: ["locked"] } })} active={status === "locked"} />
      </>}
      filters={
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox basePath={BASE} params={params} placeholder="Tìm họ tên, tên đăng nhập…" />
          <MultiSelectFilter label="Nhóm quyền" paramKey="role" basePath={BASE} params={params} options={roles.map((r) => ({ value: String(r.id), label: r.name }))} />
        </div>
      }
      footer={<PaginationFooter total={total} page={params.page} pageSize={params.pageSize} buildHref={(p) => href(p)} />}
    >
      {total === 0 ? (
        filtered
          ? <EmptyState kind="no-result" title="Không tìm thấy người dùng phù hợp" description="Thử đổi từ khóa hoặc xóa bộ lọc." action={<Link href={BASE} className="text-sm font-medium text-accent">Xóa bộ lọc</Link>} />
          : <EmptyState kind="empty" title="Chưa có người dùng nào" action={canManage ? <Link href={`${BASE}/new`} className="text-sm font-medium text-accent">Tạo người dùng đầu tiên</Link> : undefined} />
      ) : (
        <UsersTable rows={rows} sort={params.sort} sortBase={href({ sort: undefined })} canManage={canManage} params={params} />
      )}
    </ListPageLayout>
  );
}
```
Ghi chú: danh mục cấu hình (người dùng) không có cột ngày nghiệp vụ nên KHÔNG có `QuickTimeFilter` (`crm-design` DoD mục 7: không áp cho bảng danh mục/master data). Danh sách người dùng cũng chưa có Import/Export (D-6: import chỉ cho KH/NCC/SP; export người dùng không có mã phạm vi) — không thêm.

`src/app/(app)/system/users/UsersTable.tsx`:
```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, DataTable, type Column, type RowAction } from "@/components/ui";
import { TempPasswordDialog } from "@/components/ui/TempPasswordDialog";
import { apiFetch, ApiError } from "@/lib/api-fetch";
import { confirm } from "@/lib/confirm-store";
import { formatDate } from "@/lib/format";
import { buildListHref, type ListParams } from "@/lib/query-params";
import { toast } from "@/lib/toast";
import type { UserRow } from "@/server/users/queries";

export function UsersTable({
  rows, sort, canManage, params,
}: { rows: UserRow[]; sort?: string; sortBase: string; canManage: boolean; params: ListParams }) {
  const router = useRouter();
  const [temp, setTemp] = useState<{ username: string; password: string } | null>(null);

  const columns: Column<UserRow>[] = [
    { key: "fullName", label: "Họ tên", sortable: true, primaryOnMobile: true, render: (u) => u.fullName },
    { key: "username", label: "Tên đăng nhập", sortable: true, render: (u) => <span className="font-mono text-xs">{u.username}</span> },
    { key: "roles", label: "Nhóm quyền", render: (u) => <div className="flex flex-wrap gap-1">{u.roles.map((r) => <Badge key={r.id} tone="info">{r.name}</Badge>)}</div> },
    { key: "status", label: "Trạng thái", render: (u) => (u.isLocked ? <Badge tone="danger">Đã khóa</Badge> : <Badge tone="success">Hoạt động</Badge>) },
    { key: "createdAt", label: "Tạo lúc", sortable: true, render: (u) => formatDate(u.createdAt) },
  ];

  async function toggleLock(u: UserRow) {
    const lock = !u.isLocked;
    const ok = await confirm({
      title: lock ? `Khóa tài khoản ${u.username}?` : `Mở khóa tài khoản ${u.username}?`,
      description: lock ? "Người này sẽ bị đăng xuất ở thao tác kế tiếp và không đăng nhập được." : "Người này có thể đăng nhập lại.",
      confirmLabel: lock ? "Khóa" : "Mở khóa", danger: lock,
    });
    if (!ok) return;
    try {
      await apiFetch(`/api/users/${u.id}/lock`, { method: "POST", json: { locked: lock } });
      toast.success(lock ? "Đã khóa tài khoản." : "Đã mở khóa tài khoản.");
      router.refresh();
    } catch (e) {
      if (e instanceof ApiError) toast.error(e.message);
    }
  }

  async function reset(u: UserRow) {
    if (!(await confirm({ title: `Cấp lại mật khẩu cho ${u.username}?`, description: "Mật khẩu cũ mất hiệu lực ngay.", confirmLabel: "Cấp lại", danger: true }))) return;
    try {
      const r = await apiFetch<{ tempPassword: string }>(`/api/users/${u.id}/reset-password`, { method: "POST" });
      setTemp({ username: u.username, password: r.tempPassword });
    } catch (e) {
      if (e instanceof ApiError) toast.error(e.message);
    }
  }

  const actions = (u: UserRow): RowAction[] => [
    { key: "view", label: "Xem", icon: "eye", href: `/system/users/${u.id}` },
    ...(canManage ? [
      { key: "edit", label: "Sửa", icon: "pencil" as const, href: `/system/users/${u.id}?edit=profile` },
      { key: "lock", label: u.isLocked ? "Mở khóa" : "Khóa", icon: "lock" as const, danger: !u.isLocked, onClick: () => toggleLock(u) },
      { key: "reset", label: "Cấp lại mật khẩu", icon: "pencil" as const, onClick: () => reset(u) },
    ] : []),
  ];

  return (
    <>
      <DataTable id="users" columns={columns} rows={rows} rowKey={(u) => u.id} rowHref={(u) => `/system/users/${u.id}`}
        rowActions={actions} sort={sort} buildSortHref={(s) => buildListHref("/system/users", params, { sort: s })} />
      <TempPasswordDialog open={!!temp} username={temp?.username ?? ""} password={temp?.password ?? null} onClose={() => setTemp(null)} />
    </>
  );
}
```
(Thứ tự action cố định "Xem → Sửa → Khóa/Mở khóa → Cấp lại mật khẩu"; 3 đầu hiện icon, mục thứ 4 vào kebab theo `DataTable`.)

- [ ] **Step 11: Thêm người dùng (`/new`) và chi tiết người dùng (`/[id]`)**

`src/app/(app)/system/users/new/page.tsx`:
```tsx
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/server/auth/session";
import { NewUserForm } from "./NewUserForm";

export default async function NewUserPage() {
  await requireActor("user.manage");
  const roles = await prisma.role.findMany({ orderBy: { id: "asc" }, select: { id: true, name: true, description: true } });
  return <NewUserForm roles={roles} />;
}
```
`src/app/(app)/system/users/new/NewUserForm.tsx`:
```tsx
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import type { z } from "zod";
import { NewPage } from "@/components/ui/NewPage";
import { TempPasswordDialog } from "@/components/ui/TempPasswordDialog";
import { apiFetch } from "@/lib/api-fetch";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";
import { createUserSchema } from "@/server/users/schemas";

type Values = z.infer<typeof createUserSchema>;

export function NewUserForm({ roles }: { roles: { id: number; name: string; description: string | null }[] }) {
  const router = useRouter();
  const idem = useIdempotencyKey();
  const [created, setCreated] = useState<{ id: number; username: string; password: string | null } | null>(null);
  const { register, control, handleSubmit, formState: { errors, isDirty } } = useForm<Values>({
    resolver: zodResolver(createUserSchema), defaultValues: { username: "", fullName: "", roleIds: [] },
  });

  const submit = handleSubmit(async (v) => {
    const r = await apiFetch<{ id: number; tempPassword: string | null }>("/api/users", { method: "POST", json: v, idempotencyKey: idem.key });
    setCreated({ id: r.id, username: v.username.toLowerCase(), password: r.tempPassword });
  });

  return (
    <>
      <NewPage backHref="/system/users" backLabel="Quay lại người dùng" title="Tạo mới người dùng" submitLabel="Tạo người dùng"
        isDirty={() => isDirty && !created} onSubmit={async () => { await submit(); }}>
        <div className="space-y-5">
          <h2 className="text-base font-semibold">Thông tin đăng nhập</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="username" className="mb-1 block text-xs text-fg-muted">Tên đăng nhập</label>
              <input id="username" autoComplete="off" {...register("username")} aria-invalid={!!errors.username}
                className={`h-9 w-full rounded-sm border bg-canvas px-3 text-sm ${errors.username ? "border-danger" : "border-border"}`} />
              {errors.username && <p className="mt-1 text-xs text-danger">{errors.username.message}</p>}
            </div>
            <div>
              <label htmlFor="fullName" className="mb-1 block text-xs text-fg-muted">Họ tên</label>
              <input id="fullName" {...register("fullName")} aria-invalid={!!errors.fullName}
                className={`h-9 w-full rounded-sm border bg-canvas px-3 text-sm ${errors.fullName ? "border-danger" : "border-border"}`} />
              {errors.fullName && <p className="mt-1 text-xs text-danger">{errors.fullName.message}</p>}
            </div>
          </div>
          <h2 className="pt-2 text-base font-semibold">Nhóm quyền</h2>
          <Controller control={control} name="roleIds" render={({ field }) => (
            <fieldset className="space-y-2">
              <legend className="sr-only">Nhóm quyền</legend>
              {roles.map((r) => (
                <label key={r.id} className="flex min-h-10 items-start gap-3 rounded-sm border border-border p-3 text-sm">
                  <input type="checkbox" checked={field.value.includes(r.id)}
                    onChange={(e) => field.onChange(e.target.checked ? [...field.value, r.id] : field.value.filter((x) => x !== r.id))} />
                  <span><span className="font-medium">{r.name}</span>{r.description && <span className="block text-xs text-fg-muted">{r.description}</span>}</span>
                </label>
              ))}
              {errors.roleIds && <p className="text-xs text-danger">{errors.roleIds.message}</p>}
            </fieldset>
          )} />
          <p className="text-xs text-fg-muted">Hệ thống tự sinh mật khẩu tạm; người dùng phải đổi ở lần đăng nhập đầu.</p>
        </div>
      </NewPage>
      <TempPasswordDialog open={!!created} username={created?.username ?? ""} password={created?.password ?? null}
        onClose={() => { const id = created!.id; setCreated(null); router.replace(`/system/users/${id}`); }} />
    </>
  );
}
```
`src/app/(app)/system/users/[id]/page.tsx`:
```tsx
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/server/auth/session";
import { DomainError } from "@/server/http/errors";
import { getUser } from "@/server/users/queries";
import { UserDetail } from "./UserDetail";

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor("user.view");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const user = await getUser(prisma, id).catch((e) => { if (e instanceof DomainError && e.status === 404) notFound(); throw e; });
  const [roles, history] = await Promise.all([
    prisma.role.findMany({ orderBy: { id: "asc" }, select: { id: true, name: true } }),
    prisma.auditLog.findMany({ where: { entity: "User", entityId: String(id) }, orderBy: { id: "desc" }, take: 50, select: { id: true, action: true, at: true, userId: true } }),
  ]);
  const actorIds = [...new Set(history.map((h) => h.userId).filter((x): x is number => x !== null))];
  const names = new Map((await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
  return (
    <UserDetail
      user={{ ...user, createdAt: user.createdAt.toISOString() }}
      roles={roles}
      history={history.map((h) => ({ id: h.id, action: h.action, at: h.at.toISOString(), by: h.userId ? names.get(h.userId) ?? `#${h.userId}` : "Hệ thống" }))}
      canManage={actor.perms.has("user.manage")}
      isSelf={actor.userId === id}
    />
  );
}
```
`src/app/(app)/system/users/[id]/UserDetail.tsx`:
```tsx
"use client";

import { KeyRound, Lock, Unlock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  DetailField, DetailPage, DetailSection, EditActions, EditButton, useDetailNav, useSectionForm, type TabRenderCtx,
} from "@/components/ui/DetailPage";
import { TempPasswordDialog } from "@/components/ui/TempPasswordDialog";
import { apiFetch } from "@/lib/api-fetch";
import { confirm } from "@/lib/confirm-store";
import { formatDateTime } from "@/lib/format";
import { toast } from "@/lib/toast";
import { profileSectionSchema, rolesSectionSchema } from "@/server/users/schemas";

interface Props {
  user: { id: number; username: string; fullName: string; isLocked: boolean; mustChangePassword: boolean; createdAt: string; roles: { id: number; name: string }[] };
  roles: { id: number; name: string }[];
  history: { id: number; action: string; at: string; by: string }[];
  canManage: boolean;
  isSelf: boolean;
}

const ACTION_LABEL: Record<string, string> = {
  "user.create": "Tạo tài khoản", "user.update_profile": "Sửa họ tên", "user.set_roles": "Đổi nhóm quyền",
  "user.lock": "Khóa tài khoản", "user.unlock": "Mở khóa tài khoản", "user.reset_password": "Cấp lại mật khẩu", "user.change_password": "Đổi mật khẩu",
};

function ProfileSection({ ctx, p }: { ctx: TabRenderCtx; p: Props }) {
  const s = useSectionForm(ctx, "profile", {
    schema: profileSectionSchema, defaults: { fullName: p.user.fullName },
    save: (v) => apiFetch(`/api/users/${p.user.id}/section-update`, { method: "PATCH", json: { section: "profile", ...v } }).then(() => {}),
  });
  return (
    <DetailSection title="Thông tin cơ bản" editing={s.editing}
      action={!p.canManage ? null : s.editing
        ? <EditActions saving={s.saving} onSave={s.onSave} onCancel={s.onCancel} />
        : <EditButton label="Chỉnh sửa thông tin cơ bản" onClick={() => ctx.beginEdit("profile")} />}>
      {s.editing ? (
        <div>
          <label htmlFor="fullName" className="mb-1 block text-xs text-fg-muted">Họ tên</label>
          <input id="fullName" {...s.form.register("fullName")} className="h-9 w-full rounded-sm border border-border bg-canvas px-3 text-sm" />
          {s.form.formState.errors.fullName && <p className="mt-1 text-xs text-danger">{s.form.formState.errors.fullName.message}</p>}
        </div>
      ) : (
        <dl className="space-y-2">
          <DetailField label="Họ tên">{p.user.fullName}</DetailField>
          <DetailField label="Tên đăng nhập">{p.user.username}</DetailField>
          <DetailField label="Tạo lúc">{formatDateTime(p.user.createdAt)}</DetailField>
        </dl>
      )}
    </DetailSection>
  );
}

function RolesSection({ ctx, p }: { ctx: TabRenderCtx; p: Props }) {
  const current = p.user.roles.map((r) => r.id);
  const s = useSectionForm(ctx, "roles", {
    schema: rolesSectionSchema, defaults: { roleIds: current },
    save: (v) => apiFetch(`/api/users/${p.user.id}/section-update`, { method: "PATCH", json: { section: "roles", ...v } }).then(() => {}),
  });
  const selected = s.form.watch("roleIds");
  return (
    <DetailSection title="Nhóm quyền" editing={s.editing}
      action={!p.canManage ? null : s.editing
        ? <EditActions saving={s.saving} onSave={s.onSave} onCancel={s.onCancel} />
        : <EditButton label="Chỉnh sửa nhóm quyền" onClick={() => ctx.beginEdit("roles")} />}>
      {s.editing ? (
        <fieldset className="space-y-2">
          <legend className="sr-only">Nhóm quyền</legend>
          {p.roles.map((r) => (
            <label key={r.id} className="flex min-h-10 items-center gap-3 rounded-sm border border-border p-3 text-sm">
              <input type="checkbox" checked={selected.includes(r.id)}
                onChange={(e) => s.form.setValue("roleIds", e.target.checked ? [...selected, r.id] : selected.filter((x) => x !== r.id), { shouldDirty: true, shouldValidate: true })} />
              {r.name}
            </label>
          ))}
          {s.form.formState.errors.roleIds && <p className="text-xs text-danger">{s.form.formState.errors.roleIds.message}</p>}
        </fieldset>
      ) : (
        <dl><DetailField label="Đang thuộc">{p.user.roles.map((r) => r.name).join(", ")}</DetailField></dl>
      )}
    </DetailSection>
  );
}

export function UserDetail(p: Props) {
  const router = useRouter();
  const nav = useDetailNav(["info", "roles", "history"], { profile: "info", roles: "roles" });
  const [temp, setTemp] = useState<string | null>(null);

  async function toggleLock() {
    const lock = !p.user.isLocked;
    if (!(await confirm({ title: lock ? `Khóa tài khoản ${p.user.username}?` : `Mở khóa tài khoản ${p.user.username}?`, confirmLabel: lock ? "Khóa" : "Mở khóa", danger: lock }))) return;
    try {
      await apiFetch(`/api/users/${p.user.id}/lock`, { method: "POST", json: { locked: lock } });
      toast.success(lock ? "Đã khóa tài khoản." : "Đã mở khóa tài khoản.");
      router.refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Không thực hiện được."); }
  }
  async function reset() {
    if (!(await confirm({ title: `Cấp lại mật khẩu cho ${p.user.username}?`, description: "Mật khẩu cũ mất hiệu lực ngay.", confirmLabel: "Cấp lại", danger: true }))) return;
    try {
      const r = await apiFetch<{ tempPassword: string }>(`/api/users/${p.user.id}/reset-password`, { method: "POST" });
      setTemp(r.tempPassword);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Không thực hiện được."); }
  }

  const actionBtn = "flex h-10 items-center gap-2 rounded-sm border border-border bg-surface px-3 text-sm font-medium hover:bg-hover";
  return (
    <>
      <DetailPage
        backHref="/system/users" backLabel="Quay lại người dùng"
        headerActions={p.canManage && (
          <>
            {!p.isSelf && (
              <button type="button" onClick={toggleLock} className={actionBtn}>
                {p.user.isLocked ? <Unlock size={16} aria-hidden /> : <Lock size={16} aria-hidden />}
                {p.user.isLocked ? "Mở khóa" : "Khóa"}
              </button>
            )}
            <button type="button" onClick={reset} className={actionBtn}><KeyRound size={16} aria-hidden /> Cấp lại mật khẩu</button>
          </>
        )}
        summary={{
          title: p.user.fullName, code: p.user.username,
          badges: [p.user.isLocked ? { label: "Đã khóa", tone: "danger" } : { label: "Hoạt động", tone: "success" },
                   ...(p.user.mustChangePassword ? [{ label: "Chờ đổi mật khẩu", tone: "warning" as const }] : [])],
          facts: [{ label: "Nhóm quyền", value: p.user.roles.length }, { label: "Tạo lúc", value: formatDateTime(p.user.createdAt) }],
        }}
        tabs={[
          { key: "info", label: "Thông tin", render: (ctx) => <ProfileSection ctx={ctx} p={p} /> },
          { key: "roles", label: "Nhóm quyền", count: p.user.roles.length, render: (ctx) => <RolesSection ctx={ctx} p={p} /> },
          {
            key: "history", label: "Nhật ký", count: p.history.length,
            render: () => p.history.length === 0
              ? <p className="rounded-sm border border-dashed border-border p-6 text-center text-sm text-fg-muted">Chưa có thao tác nào ghi nhận.</p>
              : <ul className="divide-y divide-[var(--border-default)]">
                  {p.history.map((h) => (
                    <li key={h.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span>{ACTION_LABEL[h.action] ?? h.action} <span className="text-fg-muted">— {h.by}</span></span>
                      <span className="tabular text-xs text-fg-muted">{formatDateTime(h.at)}</span>
                    </li>
                  ))}
                </ul>,
          },
        ]}
        {...nav}
      />
      <TempPasswordDialog open={temp !== null} username={p.user.username} password={temp} onClose={() => setTemp(null)} />
    </>
  );
}
```

- [ ] **Step 12: Nhóm quyền — danh sách, tạo mới, chi tiết với ma trận quyền (mã 3)**

`src/app/(app)/system/roles/page.tsx`:
```tsx
import { Plus } from "lucide-react";
import Link from "next/link";
import { EmptyState, ListPageLayout, PaginationFooter } from "@/components/ui";
import { buildListHref, parseListParams } from "@/lib/query-params";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/server/auth/session";
import { listRoles } from "@/server/roles/queries";
import { RolesTable } from "./RolesTable";

export default async function RolesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireActor("role.manage");
  const params = parseListParams(await searchParams);
  const all = await listRoles(prisma);
  const start = (params.page - 1) * params.pageSize;
  const rows = all.slice(start, start + params.pageSize);
  return (
    <ListPageLayout title="Nhóm quyền"
      actions={<Link href="/system/roles/new" className="flex h-10 items-center gap-2 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent"><Plus size={16} aria-hidden /> Thêm mới</Link>}
      footer={<PaginationFooter total={all.length} page={params.page} pageSize={params.pageSize} buildHref={(p) => buildListHref("/system/roles", params, p)} />}>
      {all.length === 0 ? <EmptyState kind="empty" title="Chưa có nhóm quyền" /> : <RolesTable rows={rows} />}
    </ListPageLayout>
  );
}
```
`src/app/(app)/system/roles/RolesTable.tsx`:
```tsx
"use client";

import { Badge, DataTable, type Column } from "@/components/ui";
import { formatNumber } from "@/lib/format";

interface Row { id: number; name: string; description: string | null; isSystem: boolean; userCount: number; permissionCount: number }

const columns: Column<Row>[] = [
  { key: "name", label: "Tên nhóm", primaryOnMobile: true, render: (r) => r.name },
  { key: "description", label: "Mô tả", render: (r) => r.description ?? "—" },
  { key: "userCount", label: "Người dùng", align: "right", render: (r) => formatNumber(r.userCount) },
  { key: "permissionCount", label: "Số quyền", align: "right", render: (r) => formatNumber(r.permissionCount) },
  { key: "type", label: "Loại", render: (r) => (r.isSystem ? <Badge tone="info">Mặc định</Badge> : <Badge>Tự tạo</Badge>) },
];

export function RolesTable({ rows }: { rows: Row[] }) {
  return (
    <DataTable id="roles" columns={columns} rows={rows} rowKey={(r) => r.id} rowHref={(r) => `/system/roles/${r.id}`}
      rowActions={(r) => [
        { key: "view", label: "Xem", icon: "eye", href: `/system/roles/${r.id}` },
        { key: "edit", label: "Sửa quyền", icon: "pencil", href: `/system/roles/${r.id}?edit=permissions` },
      ]} />
  );
}
```
`src/app/(app)/system/roles/new/{page.tsx,NewRoleForm.tsx}`:
```tsx
// page.tsx
import { requireActor } from "@/server/auth/session";
import { NewRoleForm } from "./NewRoleForm";

export default async function NewRolePage() {
  await requireActor("role.manage");
  return <NewRoleForm />;
}
```
```tsx
// NewRoleForm.tsx
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { NewPage } from "@/components/ui/NewPage";
import { apiFetch } from "@/lib/api-fetch";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";
import { roleInfoSchema } from "@/server/roles/schemas";

type Values = z.infer<typeof roleInfoSchema>;

export function NewRoleForm() {
  const router = useRouter();
  const idem = useIdempotencyKey();
  const { register, handleSubmit, formState: { errors, isDirty } } = useForm<Values>({ resolver: zodResolver(roleInfoSchema), defaultValues: { name: "", description: "" } });
  const submit = handleSubmit(async (v) => {
    const r = await apiFetch<{ id: number }>("/api/roles", { method: "POST", json: v, idempotencyKey: idem.key });
    router.replace(`/system/roles/${r.id}?edit=permissions`); // tạo xong: vào thẳng phần cấu hình quyền
  });
  return (
    <NewPage backHref="/system/roles" backLabel="Quay lại nhóm quyền" title="Tạo mới nhóm quyền" submitLabel="Tạo nhóm quyền" isDirty={() => isDirty} onSubmit={async () => { await submit(); }}>
      <div className="space-y-4">
        <h2 className="text-base font-semibold">Thông tin nhóm</h2>
        <div>
          <label htmlFor="name" className="mb-1 block text-xs text-fg-muted">Tên nhóm quyền</label>
          <input id="name" {...register("name")} aria-invalid={!!errors.name} className={`h-9 w-full rounded-sm border bg-canvas px-3 text-sm ${errors.name ? "border-danger" : "border-border"}`} />
          {errors.name && <p className="mt-1 text-xs text-danger">{errors.name.message}</p>}
        </div>
        <div>
          <label htmlFor="description" className="mb-1 block text-xs text-fg-muted">Mô tả</label>
          <textarea id="description" rows={3} {...register("description")} className="w-full rounded-sm border border-border bg-canvas px-3 py-2 text-sm" />
        </div>
        <p className="text-xs text-fg-muted">Sau khi tạo, hệ thống mở phần cấu hình quyền cho nhóm này.</p>
      </div>
    </NewPage>
  );
}
```
`src/app/(app)/system/roles/[id]/page.tsx`:
```tsx
import { notFound } from "next/navigation";
import { PERMISSIONS } from "@/lib/permissions/catalog";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/server/auth/session";
import { DomainError } from "@/server/http/errors";
import { getRole } from "@/server/roles/queries";
import { RoleDetail } from "./RoleDetail";

export default async function RoleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireActor("role.manage");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const role = await getRole(prisma, id).catch((e) => { if (e instanceof DomainError && e.status === 404) notFound(); throw e; });
  const catalog = PERMISSIONS.map((p) => ({ code: p.code, label: p.label, group: p.group }));
  return <RoleDetail role={role} catalog={catalog} />;
}
```
`src/app/(app)/system/roles/[id]/RoleDetail.tsx`:
```tsx
"use client";

import { Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DetailField, DetailPage, DetailSection, EditActions, EditButton, useDetailNav, useSectionForm, type TabRenderCtx,
} from "@/components/ui/DetailPage";
import { apiFetch } from "@/lib/api-fetch";
import { confirm } from "@/lib/confirm-store";
import { toast } from "@/lib/toast";
import { roleInfoSchema, rolePermissionsSchema } from "@/server/roles/schemas";

interface Props {
  role: { id: number; name: string; description: string | null; isSystem: boolean; permissionCodes: string[]; users: { id: number; username: string; fullName: string; isLocked: boolean }[] };
  catalog: { code: string; label: string; group: string }[];
}

const groups = (catalog: Props["catalog"]) => [...new Set(catalog.map((c) => c.group))].map((g) => ({ group: g, items: catalog.filter((c) => c.group === g) }));

function InfoSection({ ctx, p }: { ctx: TabRenderCtx; p: Props }) {
  const s = useSectionForm(ctx, "info", {
    schema: roleInfoSchema, defaults: { name: p.role.name, description: p.role.description ?? "" },
    save: (v) => apiFetch(`/api/roles/${p.role.id}/section-update`, { method: "PATCH", json: { section: "info", ...v } }).then(() => {}),
  });
  return (
    <DetailSection title="Thông tin nhóm" editing={s.editing}
      action={s.editing ? <EditActions saving={s.saving} onSave={s.onSave} onCancel={s.onCancel} /> : <EditButton label="Chỉnh sửa thông tin nhóm" onClick={() => ctx.beginEdit("info")} />}>
      {s.editing ? (
        <div className="space-y-3">
          <div>
            <label htmlFor="name" className="mb-1 block text-xs text-fg-muted">Tên nhóm quyền</label>
            <input id="name" disabled={p.role.isSystem} {...s.form.register("name")} className="h-9 w-full rounded-sm border border-border bg-canvas px-3 text-sm disabled:bg-hover" />
            {p.role.isSystem && <p className="mt-1 text-xs text-fg-muted">Nhóm mặc định của hệ thống không đổi tên.</p>}
            {s.form.formState.errors.name && <p className="mt-1 text-xs text-danger">{s.form.formState.errors.name.message}</p>}
          </div>
          <div>
            <label htmlFor="description" className="mb-1 block text-xs text-fg-muted">Mô tả</label>
            <textarea id="description" rows={3} {...s.form.register("description")} className="w-full rounded-sm border border-border bg-canvas px-3 py-2 text-sm" />
          </div>
        </div>
      ) : (
        <dl className="space-y-2"><DetailField label="Tên nhóm">{p.role.name}</DetailField><DetailField label="Mô tả">{p.role.description}</DetailField></dl>
      )}
    </DetailSection>
  );
}

function PermissionsSection({ ctx, p }: { ctx: TabRenderCtx; p: Props }) {
  const s = useSectionForm(ctx, "permissions", {
    schema: rolePermissionsSchema, defaults: { codes: p.role.permissionCodes },
    save: (v) => apiFetch(`/api/roles/${p.role.id}/section-update`, { method: "PATCH", json: { section: "permissions", ...v } }).then(() => {}),
  });
  const selected = s.form.watch("codes");
  const set = (codes: string[]) => s.form.setValue("codes", codes, { shouldDirty: true });
  return (
    <DetailSection title="Quyền theo chức năng" editing={s.editing}
      action={s.editing ? <EditActions saving={s.saving} onSave={s.onSave} onCancel={s.onCancel} /> : <EditButton label="Chỉnh sửa quyền" onClick={() => ctx.beginEdit("permissions")} />}>
      <div className="space-y-5">
        {groups(p.catalog).map(({ group, items }) => {
          const granted = items.filter((i) => (s.editing ? selected : p.role.permissionCodes).includes(i.code));
          const allOn = granted.length === items.length;
          return (
            <div key={group}>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-[0.04em] text-fg-secondary">{group} <span className="tabular text-fg-muted">({granted.length}/{items.length})</span></h3>
                {s.editing && (
                  <button type="button" className="text-xs font-medium text-accent"
                    onClick={() => set(allOn ? selected.filter((c) => !items.some((i) => i.code === c)) : [...new Set([...selected, ...items.map((i) => i.code)])])}>
                    {allOn ? "Bỏ chọn nhóm" : "Chọn cả nhóm"}
                  </button>
                )}
              </div>
              {s.editing ? (
                <div className="grid gap-1 sm:grid-cols-2">
                  {items.map((i) => (
                    <label key={i.code} className="flex min-h-9 items-center gap-2 rounded-sm px-2 text-sm hover:bg-hover">
                      <input type="checkbox" checked={selected.includes(i.code)} onChange={(e) => set(e.target.checked ? [...selected, i.code] : selected.filter((c) => c !== i.code))} />
                      {i.label}
                    </label>
                  ))}
                </div>
              ) : (
                <ul className="grid gap-1 sm:grid-cols-2">
                  {granted.length === 0
                    ? <li className="text-sm text-fg-muted">Không có quyền nào.</li>
                    : granted.map((i) => <li key={i.code} className="text-sm">{i.label}</li>)}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </DetailSection>
  );
}

export function RoleDetail(p: Props) {
  const router = useRouter();
  const nav = useDetailNav(["info", "permissions", "users"], { info: "info", permissions: "permissions" });

  async function remove() {
    if (!(await confirm({ title: `Xóa nhóm quyền “${p.role.name}”?`, description: "Không thể hoàn tác.", confirmLabel: "Xóa", danger: true }))) return;
    try {
      await apiFetch(`/api/roles/${p.role.id}`, { method: "DELETE" });
      toast.success("Đã xóa nhóm quyền.");
      router.replace("/system/roles");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Không xóa được."); }
  }

  return (
    <DetailPage
      backHref="/system/roles" backLabel="Quay lại nhóm quyền"
      headerActions={!p.role.isSystem && (
        <button type="button" onClick={remove} className="flex h-10 items-center gap-2 rounded-sm border border-danger px-3 text-sm font-medium text-danger hover:bg-danger-soft">
          <Trash2 size={16} aria-hidden /> Xóa nhóm
        </button>
      )}
      summary={{
        title: p.role.name,
        badges: [p.role.isSystem ? { label: "Mặc định", tone: "info" } : { label: "Tự tạo" }],
        facts: [{ label: "Số quyền", value: p.role.permissionCodes.length }, { label: "Người dùng", value: p.role.users.length }],
      }}
      tabs={[
        { key: "info", label: "Thông tin", render: (ctx) => <InfoSection ctx={ctx} p={p} /> },
        { key: "permissions", label: "Quyền", count: p.role.permissionCodes.length, render: (ctx) => <PermissionsSection ctx={ctx} p={p} /> },
        {
          key: "users", label: "Người dùng", count: p.role.users.length,
          render: () => p.role.users.length === 0
            ? <p className="rounded-sm border border-dashed border-border p-6 text-center text-sm text-fg-muted">Chưa có người dùng nào thuộc nhóm này.</p>
            : <ul className="divide-y divide-[var(--border-default)]">
                {p.role.users.map((u) => (
                  <li key={u.id} className="py-2 text-sm">
                    <Link href={`/system/users/${u.id}`} className="font-medium hover:text-accent">{u.fullName}</Link>
                    <span className="ml-2 font-mono text-xs text-fg-muted">{u.username}</span>
                    {u.isLocked && <span className="ml-2 text-xs text-danger">Đã khóa</span>}
                  </li>
                ))}
              </ul>,
        },
      ]}
      {...nav}
    />
  );
}
```
Trang này dùng `disabled` trên input tên nhóm ở **chế độ sửa** cho nhóm hệ thống (đó là control thật ở Edit mode có lý do nghiệp vụ, khác với lỗi "View mode = input disabled").

- [ ] **Step 13: Chạy toàn bộ, kiểm tay bằng trình duyệt, commit**

Run: `npm run lint && npm run typecheck && npm test`
Expected: xanh.
Chạy tay (dev): `npm run db:seed` (đặt `BOOTSTRAP_ADMIN_PASSWORD=Admin12345` trong `.env` dev trước), `npm run dev`, mở `http://localhost:3000`:
1. Chưa đăng nhập → tự về `/login`. Đăng nhập `admin` / `Admin12345` → bị đưa tới `/change-password` → đổi mật khẩu → vào trang chủ.
2. Sidebar có nhóm **Hệ thống** với Người dùng / Nhóm quyền (chưa có Nhật ký cho tới Task 13).
3. Thêm mới người dùng → hộp mật khẩu tạm hiện 1 lần → mở chi tiết; sửa họ tên, đổi nhóm quyền, khoá/mở khoá, cấp lại mật khẩu; thử tự khoá mình (nút không hiện).
4. Nhóm quyền: tạo nhóm, bật/tắt quyền, xóa nhóm trống; thử xóa nhóm "Giám đốc" (không có nút).
5. Đăng nhập bằng tài khoản nhóm "Bán hàng" → menu Hệ thống biến mất; gõ tay `/system/users` → trang 403.
6. Bấm nút Sáng/Tối/Hệ thống; F5 ở chế độ tối không nháy sáng.
```bash
git add -A
git commit -m "feat(system): đăng nhập, đổi mật khẩu, người dùng, nhóm quyền động, khoá/mở khoá (mã 1–4)"
```

---

### Task 13: Nhật ký thao tác (mã 5)

**Files:**
- Create: `src/lib/json-diff.ts`, `src/server/audit/queries.ts`
- Create: `src/app/(app)/system/audit-log/{page.tsx,AuditTable.tsx,[id]/page.tsx,[id]/AuditDetail.tsx}`, `src/app/api/audit-log/export/route.ts`
- Test: `tests/lib/json-diff.test.ts`, `tests/audit/queries.test.ts`

**Interfaces:**
- Consumes: `parseListParams`, `resolveTimeRange`, `timeRangeWhere`, `buildXlsx`, `ListPageLayout`… (plan 01b), `requireActor`.
- Produces: `diffJson(before, after): {path; before; after}[]`; `listAudit(db, params, now?) → {rows, total}`, `getAuditEntry(db, id)`, `auditWhere(params, now)`.

- [ ] **Step 1: Test `diffJson` (đỏ)**

`tests/lib/json-diff.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { diffJson } from "@/lib/json-diff";

describe("diffJson — số cũ / số mới", () => {
  it("field đổi, thêm, bỏ; sắp theo đường dẫn", () => {
    expect(diffJson({ a: 1, b: "x", c: true }, { a: 2, b: "x", d: 5 })).toEqual([
      { path: "a", before: 1, after: 2 },
      { path: "c", before: true, after: undefined },
      { path: "d", before: undefined, after: 5 },
    ]);
  });

  it("object lồng nhau: đường dẫn chấm; giá trị bằng nhau không xuất hiện", () => {
    expect(diffJson({ p: { q: 1, r: 2 } }, { p: { q: 1, r: 3 } })).toEqual([{ path: "p.r", before: 2, after: 3 }]);
  });

  it("mảng so như MỘT giá trị", () => {
    expect(diffJson({ roles: ["A", "B"] }, { roles: ["A", "C"] })).toEqual([{ path: "roles", before: ["A", "B"], after: ["A", "C"] }]);
    expect(diffJson({ roles: ["A"] }, { roles: ["A"] })).toEqual([]);
  });

  it("before null (tạo mới) → mọi field là 'thêm'; after null (xóa) → mọi field là 'bỏ'", () => {
    expect(diffJson(null, { a: 1 })).toEqual([{ path: "a", before: undefined, after: 1 }]);
    expect(diffJson({ a: 1 }, null)).toEqual([{ path: "a", before: 1, after: undefined }]);
    expect(diffJson(null, null)).toEqual([]);
  });

  it("phân biệt 0 / '' / null / undefined", () => {
    expect(diffJson({ a: 0 }, { a: null })).toEqual([{ path: "a", before: 0, after: null }]);
    expect(diffJson({ a: "" }, { a: 0 })).toEqual([{ path: "a", before: "", after: 0 }]);
  });
});
```
`src/lib/json-diff.ts`:
```ts
export interface DiffEntry {
  path: string;
  before: unknown;
  after: unknown;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function flatten(v: unknown, prefix: string, out: Map<string, unknown>) {
  if (isObj(v)) {
    for (const [k, x] of Object.entries(v)) flatten(x, prefix ? `${prefix}.${k}` : k, out);
  } else if (prefix) {
    out.set(prefix, v);
  }
}

/** So sánh 2 JSON thành danh sách (đường dẫn, số cũ, số mới). Mảng được so như một giá trị. */
export function diffJson(before: unknown, after: unknown): DiffEntry[] {
  const a = new Map<string, unknown>();
  const b = new Map<string, unknown>();
  flatten(before, "", a);
  flatten(after, "", b);
  const paths = [...new Set([...a.keys(), ...b.keys()])].sort();
  const out: DiffEntry[] = [];
  for (const path of paths) {
    const x = a.get(path);
    const y = b.get(path);
    if (JSON.stringify(x) !== JSON.stringify(y)) out.push({ path, before: x, after: y });
  }
  return out;
}
```
Run: `npm test -- tests/lib/json-diff.test.ts` → PASS.

- [ ] **Step 2: Test truy vấn nhật ký (đỏ)**

`tests/audit/queries.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { parseListParams } from "@/lib/query-params";
import { getAuditEntry, listAudit } from "@/server/audit/queries";
import { prisma, resetDb } from "../helpers/db";

beforeEach(resetDb);

async function log(over: Partial<{ userId: number; action: string; entity: string; entityId: string; at: Date }> = {}) {
  return prisma.auditLog.create({ data: { userId: 1, action: "order.update", entity: "SaleOrder", entityId: "1", ...over } });
}
const params = (sp: Record<string, string> = {}) => parseListParams(sp, ["user", "entity"]);

describe("listAudit", () => {
  it("mới nhất trước; phân trang", async () => {
    for (let i = 0; i < 25; i++) await log({ entityId: String(i), at: new Date(Date.UTC(2026, 8, 1, 0, i)) });
    const p1 = await listAudit(prisma, params(), new Date("2026-09-30T00:00:00Z"));
    expect(p1.total).toBe(25);
    expect(p1.rows).toHaveLength(20);
    expect(p1.rows[0]!.entityId).toBe("24");
    expect((await listAudit(prisma, params({ page: "2" }), new Date())).rows).toHaveLength(5);
  });

  it("lọc theo người thao tác, đối tượng, từ khóa hành động", async () => {
    await log({ userId: 1, entity: "User", action: "user.lock" });
    await log({ userId: 2, entity: "User", action: "user.create" });
    await log({ userId: 2, entity: "Role", action: "role.create" });
    expect((await listAudit(prisma, params({ user: "2" }), new Date())).total).toBe(2);
    expect((await listAudit(prisma, params({ entity: "Role" }), new Date())).total).toBe(1);
    expect((await listAudit(prisma, params({ q: "create" }), new Date())).total).toBe(2);
    expect((await listAudit(prisma, params({ user: "2", entity: "User" }), new Date())).total).toBe(1);
  });

  it("lọc thời gian theo ICT: 23:50 ICT 30/09 thuộc 'Hôm nay' của 30/09 và 'Tháng này', KHÔNG thuộc 'Hôm nay' của 01/10", async () => {
    const at = new Date("2026-09-30T16:50:00Z"); // 23:50 ICT 30/09
    await log({ at });
    const sameDay = new Date("2026-09-30T16:55:00Z"); // 23:55 ICT 30/09
    const nextDay = new Date("2026-09-30T17:05:00Z"); // 00:05 ICT 01/10
    expect((await listAudit(prisma, params({ timePreset: "today" }), sameDay)).total).toBe(1);
    expect((await listAudit(prisma, params({ timePreset: "thisMonth" }), sameDay)).total).toBe(1);
    expect((await listAudit(prisma, params({ timePreset: "today" }), nextDay)).total).toBe(0);
    expect((await listAudit(prisma, params({ timePreset: "thisMonth" }), nextDay)).total).toBe(0);
    expect((await listAudit(prisma, params({ timePreset: "lastMonth" }), nextDay)).total).toBe(1);
  });

  it("khoảng tùy chọn gồm cả ngày kết thúc", async () => {
    await log({ at: new Date("2026-09-15T16:59:00Z") }); // 23:59 ICT 15/09
    const r = await listAudit(prisma, params({ timePreset: "custom", timeStart: "2026-09-01", timeEnd: "2026-09-15" }), new Date());
    expect(r.total).toBe(1);
  });

  it("50.000 dòng: trang đầu và trang xa đều ≤ 3 giây (hợp đồng hiệu năng)", async () => {
    await prisma.$executeRawUnsafe(`
      INSERT INTO audit_log ("userId", action, entity, "entityId", "at")
      SELECT 1 + (g % 5), 'order.update', 'SaleOrder', g::text, now() - (g || ' seconds')::interval
      FROM generate_series(1, 50000) g`);
    for (const page of ["1", "2000"]) {
      const t = performance.now();
      const r = await listAudit(prisma, params({ page }), new Date());
      expect(r.total).toBe(50000);
      expect(performance.now() - t).toBeLessThan(3000);
    }
  }, 60_000);
});

describe("getAuditEntry", () => {
  it("trả bản ghi kèm before/after; không có → lỗi 404", async () => {
    const row = await prisma.auditLog.create({ data: { action: "a", entity: "E", beforeJson: { x: 1 }, afterJson: { x: 2 } } });
    expect((await getAuditEntry(prisma, row.id)).afterJson).toEqual({ x: 2 });
    await expect(getAuditEntry(prisma, 99999)).rejects.toMatchObject({ status: 404 });
  });
});
```
- [ ] **Step 3: Cài `src/server/audit/queries.ts`**

```ts
import type { Prisma, PrismaClient } from "@prisma/client";
import type { ListParams } from "@/lib/query-params";
import { resolveTimeRange, timeRangeWhere } from "@/lib/time-presets";
import { DomainError } from "@/server/http/errors";

export function auditWhere(params: ListParams, now: Date): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {};
  const users = (params.filters.user ?? []).map(Number).filter(Number.isInteger);
  if (users.length) where.userId = { in: users };
  const entities = params.filters.entity ?? [];
  if (entities.length) where.entity = { in: entities };
  if (params.q) {
    where.OR = [
      { action: { contains: params.q, mode: "insensitive" } },
      { entity: { contains: params.q, mode: "insensitive" } },
      { entityId: { contains: params.q } },
    ];
  }
  if (params.timePreset) {
    const range = resolveTimeRange(params.timePreset, now, { start: params.timeStart, end: params.timeEnd });
    if (range) where.at = timeRangeWhere(range);
  }
  return where;
}

export async function listAudit(db: PrismaClient, params: ListParams, now: Date = new Date()) {
  const where = auditWhere(params, now);
  // Nhật ký luôn theo thời gian giảm dần (id làm tie-break, có index (at))
  const [rows, total] = await Promise.all([
    db.auditLog.findMany({ where, orderBy: [{ at: "desc" }, { id: "desc" }], skip: (params.page - 1) * params.pageSize, take: params.pageSize }),
    db.auditLog.count({ where }),
  ]);
  return { rows, total };
}

export async function getAuditEntry(db: PrismaClient, id: number) {
  const row = await db.auditLog.findUnique({ where: { id } });
  if (!row) throw new DomainError("Không tìm thấy dòng nhật ký.", 404);
  return row;
}
```
Run: `npm test -- tests/audit/queries.test.ts`
Expected: PASS. Nếu test 50.000 dòng > 3 giây: kiểm `EXPLAIN` — cần index `(at)` (đã có trong schema Task 3); với offset lớn (`page=2000`) có thể chậm hơn — nếu vượt, chuyển sang phân trang keyset và ghi vào master plan mục rủi ro; KHÔNG nới ngưỡng 3 giây.

- [ ] **Step 4: Trang danh sách + chi tiết + xuất Excel**

`src/app/(app)/system/audit-log/page.tsx`:
```tsx
import { EmptyState, ExportButton, ListPageLayout, MultiSelectFilter, PaginationFooter, SearchBox } from "@/components/ui";
import { QuickTimeFilter } from "@/components/ui/QuickTimeFilter";
import { buildListHref, parseListParams } from "@/lib/query-params";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/server/auth/session";
import { listAudit } from "@/server/audit/queries";
import { AuditTable } from "./AuditTable";

const BASE = "/system/audit-log";

export default async function AuditLogPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireActor("audit.view");
  const sp = await searchParams;
  const params = parseListParams(sp, ["user", "entity"]);
  const [{ rows, total }, users, entities] = await Promise.all([
    listAudit(prisma, params),
    prisma.user.findMany({ select: { id: true, fullName: true }, orderBy: { fullName: "asc" } }),
    prisma.auditLog.findMany({ distinct: ["entity"], select: { entity: true }, orderBy: { entity: "asc" } }),
  ]);
  const names = new Map(users.map((u) => [u.id, u.fullName]));
  const exportQs = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (v === undefined ? [] : [[k, Array.isArray(v) ? v.join(",") : v]] as [string, string][])));

  return (
    <ListPageLayout
      title="Nhật ký thao tác"
      // Chỉ Export: nhật ký KHÔNG có Thêm mới/Sửa/Xóa (append-only)
      actions={<ExportButton href={`/api/audit-log/export?${exportQs.toString()}`} />}
      filters={
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox basePath={BASE} params={params} placeholder="Tìm hành động, đối tượng, mã…" />
          <QuickTimeFilter basePath={BASE} params={params} />
          <MultiSelectFilter label="Người thao tác" paramKey="user" basePath={BASE} params={params} options={users.map((u) => ({ value: String(u.id), label: u.fullName }))} />
          <MultiSelectFilter label="Đối tượng" paramKey="entity" basePath={BASE} params={params} options={entities.map((e) => ({ value: e.entity, label: e.entity }))} />
        </div>
      }
      footer={<PaginationFooter total={total} page={params.page} pageSize={params.pageSize} buildHref={(p) => buildListHref(BASE, params, p)} />}
    >
      {total === 0
        ? <EmptyState kind={params.q || params.timePreset || params.filters.user || params.filters.entity ? "no-result" : "empty"} title="Chưa có nhật ký phù hợp" description="Mọi thao tác ghi dữ liệu sẽ xuất hiện ở đây." />
        : <AuditTable rows={rows.map((r) => ({ id: r.id, at: r.at.toISOString(), by: r.userId ? names.get(r.userId) ?? `#${r.userId}` : "Hệ thống", action: r.action, entity: r.entity, entityId: r.entityId }))} />}
    </ListPageLayout>
  );
}
```
`src/app/(app)/system/audit-log/AuditTable.tsx`:
```tsx
"use client";

import { DataTable, type Column } from "@/components/ui";
import { formatDateTime } from "@/lib/format";

interface Row { id: number; at: string; by: string; action: string; entity: string; entityId: string | null }

const columns: Column<Row>[] = [
  { key: "at", label: "Thời gian", render: (r) => <span className="tabular">{formatDateTime(r.at)}</span> },
  { key: "by", label: "Người thao tác", primaryOnMobile: true, render: (r) => r.by },
  { key: "action", label: "Hành động", render: (r) => <span className="font-mono text-xs">{r.action}</span> },
  { key: "entity", label: "Đối tượng", render: (r) => r.entity },
  { key: "entityId", label: "Mã", render: (r) => r.entityId ?? "—" },
];

export function AuditTable({ rows }: { rows: Row[] }) {
  return (
    <DataTable id="audit" columns={columns} rows={rows} rowKey={(r) => r.id} rowHref={(r) => `/system/audit-log/${r.id}`}
      rowActions={(r) => [{ key: "view", label: "Xem", icon: "eye", href: `/system/audit-log/${r.id}` }]} />
  );
}
```
`src/app/(app)/system/audit-log/[id]/page.tsx`:
```tsx
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/server/auth/session";
import { getAuditEntry } from "@/server/audit/queries";
import { DomainError } from "@/server/http/errors";
import { AuditDetail } from "./AuditDetail";

export default async function AuditDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireActor("audit.view");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const row = await getAuditEntry(prisma, id).catch((e) => { if (e instanceof DomainError && e.status === 404) notFound(); throw e; });
  const user = row.userId ? await prisma.user.findUnique({ where: { id: row.userId }, select: { fullName: true } }) : null;
  return <AuditDetail entry={{ id: row.id, at: row.at.toISOString(), by: user?.fullName ?? (row.userId ? `#${row.userId}` : "Hệ thống"), action: row.action, entity: row.entity, entityId: row.entityId, ip: row.ip, before: row.beforeJson, after: row.afterJson }} />;
}
```
`src/app/(app)/system/audit-log/[id]/AuditDetail.tsx` (chỉ xem — không có nút bút chì, không có section sửa):
```tsx
"use client";

import { DetailField, DetailPage, DetailSection, useDetailNav } from "@/components/ui/DetailPage";
import { formatDateTime } from "@/lib/format";
import { diffJson } from "@/lib/json-diff";

interface Entry { id: number; at: string; by: string; action: string; entity: string; entityId: string | null; ip: string | null; before: unknown; after: unknown }

const show = (v: unknown) => (v === undefined ? "—" : typeof v === "string" ? v : JSON.stringify(v));

export function AuditDetail({ entry }: { entry: Entry }) {
  const nav = useDetailNav(["info", "changes"]);
  const changes = diffJson(entry.before, entry.after);
  return (
    <DetailPage
      backHref="/system/audit-log" backLabel="Quay lại nhật ký"
      summary={{ title: entry.action, code: `#${entry.id}`, badges: [{ label: entry.entity }], facts: [{ label: "Thời gian", value: formatDateTime(entry.at) }, { label: "Người thao tác", value: entry.by }] }}
      tabs={[
        {
          key: "info", label: "Thông tin",
          render: () => (
            <DetailSection title="Thao tác" action={null}>
              <dl className="space-y-2">
                <DetailField label="Hành động">{entry.action}</DetailField>
                <DetailField label="Đối tượng">{entry.entity}</DetailField>
                <DetailField label="Mã đối tượng">{entry.entityId}</DetailField>
                <DetailField label="Người thao tác">{entry.by}</DetailField>
                <DetailField label="Thời gian">{formatDateTime(entry.at)}</DetailField>
                <DetailField label="Địa chỉ IP">{entry.ip}</DetailField>
              </dl>
            </DetailSection>
          ),
        },
        {
          key: "changes", label: "Số cũ / số mới", count: changes.length,
          render: () => (
            <DetailSection title="Thay đổi" action={null}>
              {changes.length === 0 ? (
                <p className="rounded-sm border border-dashed border-border p-6 text-center text-sm text-fg-muted">Thao tác này không ghi số liệu trước/sau.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-border text-left text-xs uppercase tracking-[0.04em] text-fg-secondary"><th className="py-2 pr-3">Trường</th><th className="py-2 pr-3">Số cũ</th><th className="py-2">Số mới</th></tr></thead>
                    <tbody>
                      {changes.map((c) => (
                        <tr key={c.path} className="border-b border-border last:border-b-0">
                          <td className="py-2 pr-3 font-mono text-xs">{c.path}</td>
                          <td className="py-2 pr-3 text-danger">{show(c.before)}</td>
                          <td className="py-2 text-success">{show(c.after)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </DetailSection>
          ),
        },
      ]}
      {...nav}
    />
  );
}
```
`src/app/api/audit-log/export/route.ts` — giữ nguyên bộ lọc, tối đa 50.000 dòng:
```ts
import { formatDateTime } from "@/lib/format";
import { parseListParams } from "@/lib/query-params";
import { prisma } from "@/lib/prisma";
import { auditWhere } from "@/server/audit/queries";
import { requireActorApi } from "@/server/auth/session";
import { buildXlsx, xlsxResponse } from "@/server/export/xlsx";
import { toErrorResponse } from "@/server/http/handler";

const MAX_ROWS = 50_000;

export async function GET(req: Request) {
  try {
    await requireActorApi("audit.view");
    const sp = Object.fromEntries(new URL(req.url).searchParams);
    const params = parseListParams(sp, ["user", "entity"]);
    const rows = await prisma.auditLog.findMany({ where: auditWhere(params, new Date()), orderBy: [{ at: "desc" }, { id: "desc" }], take: MAX_ROWS });
    const users = new Map((await prisma.user.findMany({ select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
    const buf = await buildXlsx("Nhật ký", [
      { header: "Thời gian", key: "at", width: 20 }, { header: "Người thao tác", key: "by", width: 24 },
      { header: "Hành động", key: "action", width: 26 }, { header: "Đối tượng", key: "entity", width: 18 },
      { header: "Mã", key: "entityId", width: 12, text: true }, { header: "Số cũ", key: "before", width: 40 }, { header: "Số mới", key: "after", width: 40 },
    ], rows.map((r) => ({
      at: formatDateTime(r.at), by: r.userId ? users.get(r.userId) ?? `#${r.userId}` : "Hệ thống", action: r.action, entity: r.entity, entityId: r.entityId,
      before: r.beforeJson ? JSON.stringify(r.beforeJson) : null, after: r.afterJson ? JSON.stringify(r.afterJson) : null,
    })));
    return xlsxResponse("nhat-ky-thao-tac.xlsx", buf);
  } catch (e) {
    return toErrorResponse(e);
  }
}
```

- [ ] **Step 5: Chạy toàn bộ, kiểm tay, commit**

Run: `npm run lint && npm run typecheck && npm test`
Chạy tay: thực hiện vài thao tác ở màn Người dùng/Nhóm quyền → mở **Hệ thống → Nhật ký thao tác**: dòng mới nhất ở trên, mở chi tiết thấy tab "Số cũ / số mới", lọc "Hôm nay", "Xuất Excel" tải file; thử thẳng `psql`/pgAdmin `UPDATE audit_log …` phải bị từ chối.
```bash
git add -A
git commit -m "feat(system): nhật ký thao tác — số cũ/số mới, lọc theo ICT, xuất Excel (mã 5)"
```

---

### Task 14: Trang chủ, health, trạng thái lỗi, deploy đầu tiên và xác minh

**Files:**
- Create: `src/lib/greeting.ts`, `src/app/api/health/route.ts`, `src/components/shell/OfflineBanner.tsx`, `src/app/(app)/not-found.tsx`, `src/app/(app)/error.tsx`
- Modify: `src/app/(app)/page.tsx`, `src/components/shell/AppShell.tsx`
- Modify: `docs/infra/VERIFY.md` (tick kết quả), tag git `gd0`
- Test: `tests/lib/greeting.test.ts`, `tests/api/health.test.ts`, `tests/shell/offline-banner.test.tsx`

**Interfaces:**
- Produces: `greeting(now: Date): "Chào buổi sáng" | "Chào buổi trưa" | "Chào buổi chiều" | "Chào buổi tối"` (theo giờ ICT); `GET /api/health → {status:"ok", db:true, time}` hoặc 503; `<OfflineBanner />`.

- [ ] **Step 1: Test lời chào theo giờ Việt Nam (đỏ) rồi cài**

`tests/lib/greeting.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { greeting } from "@/lib/greeting";

const at = (utc: string) => greeting(new Date(utc));

describe("greeting — theo giờ ICT, không phải giờ máy chủ", () => {
  it.each([
    ["2026-09-24T22:00:00Z", "Chào buổi sáng"], // 05:00 ICT
    ["2026-09-24T03:59:00Z", "Chào buổi sáng"], // 10:59 ICT
    ["2026-09-24T04:00:00Z", "Chào buổi trưa"], // 11:00 ICT
    ["2026-09-24T05:59:00Z", "Chào buổi trưa"], // 12:59 ICT
    ["2026-09-24T06:00:00Z", "Chào buổi chiều"], // 13:00 ICT
    ["2026-09-24T10:59:00Z", "Chào buổi chiều"], // 17:59 ICT
    ["2026-09-24T11:00:00Z", "Chào buổi tối"], // 18:00 ICT
    ["2026-09-24T16:50:00Z", "Chào buổi tối"], // 23:50 ICT
    ["2026-09-24T19:00:00Z", "Chào buổi tối"], // 02:00 ICT sáng hôm sau
  ])("%s → %s", (utc, out) => {
    expect(at(utc)).toBe(out);
  });
});
```
Ghi chú: 02:00 ICT vẫn "buổi tối" (ca đêm) — giờ 0–4 thuộc "tối", 5–10 "sáng".
`src/lib/greeting.ts`:
```ts
import { toIct } from "./time";

export function greeting(now: Date): string {
  const h = toIct(now).hh;
  if (h >= 5 && h < 11) return "Chào buổi sáng";
  if (h >= 11 && h < 13) return "Chào buổi trưa";
  if (h >= 13 && h < 18) return "Chào buổi chiều";
  return "Chào buổi tối";
}
```
Run: `npm test -- tests/lib/greeting.test.ts` → PASS.

- [ ] **Step 2: Trang chủ Level 0 (module selector) — số liệu trong ngày (mã 7) do plan 03-B7 bổ sung**

`src/app/(app)/page.tsx`:
```tsx
import Link from "next/link";
import { Icon } from "@/components/shell/icons";
import { APP_NAV } from "@/config/app.config";
import { greeting } from "@/lib/greeting";
import { buildNav } from "@/lib/nav";
import { requireActor } from "@/server/auth/session";

export const dynamic = "force-dynamic"; // lời chào phụ thuộc giờ hiện tại

export default async function HomePage() {
  const actor = await requireActor();
  const modules = buildNav(APP_NAV, actor.perms).filter((m) => m.type === "accordion");
  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold">{greeting(new Date())}, {actor.fullName} 👋</h1>
      {modules.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-8 text-center text-sm text-fg-muted">
          Tài khoản của bạn chưa được cấp quyền vào chức năng nào. Liên hệ giám đốc để được cấp quyền.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {modules.map((m) => (
            <Link key={m.key} href={`/m/${m.key}`} className="flex min-h-28 items-center gap-4 rounded-md border border-border bg-surface p-5 transition-shadow hover:shadow-md">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent"><Icon name={m.icon} size={24} /></span>
              <span>
                <span className="block text-base font-semibold">{m.label}</span>
                <span className="text-sm text-fg-secondary">{m.categories.flatMap((c) => c.functions).length} chức năng</span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: `/api/health` (test đỏ → xanh)**

`tests/api/health.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/health/route";

describe("GET /api/health", () => {
  it("DB sống → 200 {status:'ok', db:true}, không lộ thông tin nhạy cảm", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: "ok", db: true });
    expect(Object.keys(body).sort()).toEqual(["db", "status", "time"]);
  });
});
```
`src/app/api/health/route.ts` (đã được `middleware.ts` loại khỏi bắt buộc đăng nhập):
```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", db: true, time: new Date().toISOString() });
  } catch {
    return NextResponse.json({ status: "error", db: false, time: new Date().toISOString() }, { status: 503 });
  }
}
```
Run: `npm test -- tests/api/health.test.ts` → PASS.

- [ ] **Step 4: Trạng thái lỗi trong khung chính + banner mất mạng**

`src/app/(app)/not-found.tsx` (404 nằm TRONG layout chính — giữ Sidebar/Header):
```tsx
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center gap-3 py-24 text-center">
      <h1 className="text-2xl font-semibold">Không tìm thấy trang hoặc bản ghi</h1>
      <p className="max-w-md text-fg-secondary">Đường dẫn có thể đã sai hoặc bản ghi đã bị xóa.</p>
      <Link href="/" className="rounded-sm bg-accent px-4 py-2 text-sm font-medium text-fg-on-accent">Về trang chủ</Link>
    </div>
  );
}
```
`src/app/(app)/error.tsx`:
```tsx
"use client";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 py-24 text-center">
      <h1 className="text-2xl font-semibold">Có lỗi xảy ra</h1>
      <p className="max-w-md text-fg-secondary">Hệ thống chưa xử lý được yêu cầu. Bạn hãy thử lại; nếu vẫn lỗi, báo mã bên dưới cho người hỗ trợ.</p>
      <button type="button" onClick={reset} className="rounded-sm bg-accent px-4 py-2 text-sm font-medium text-fg-on-accent">Thử lại</button>
      {error.digest && <p className="text-xs text-fg-muted">Mã lỗi: {error.digest}</p>}
    </div>
  );
}
```
`tests/shell/offline-banner.test.tsx`:
```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { OfflineBanner } from "@/components/shell/OfflineBanner";

afterEach(cleanup);

describe("OfflineBanner", () => {
  it("mất mạng → banner cố định (không tự tắt); có mạng lại → ẩn", () => {
    render(<OfflineBanner />);
    expect(screen.queryByRole("status")).toBeNull();
    act(() => { window.dispatchEvent(new Event("offline")); });
    expect(screen.getByRole("status")).toHaveTextContent("Mất kết nối mạng — đang thử kết nối lại…");
    act(() => { window.dispatchEvent(new Event("online")); });
    expect(screen.queryByRole("status")).toBeNull();
  });
});
```
`src/components/shell/OfflineBanner.tsx`:
```tsx
"use client";

import { WifiOff } from "lucide-react";
import { useEffect, useState } from "react";

export function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    setOffline(!navigator.onLine);
    const off = () => setOffline(true);
    const on = () => setOffline(false);
    window.addEventListener("offline", off);
    window.addEventListener("online", on);
    return () => { window.removeEventListener("offline", off); window.removeEventListener("online", on); };
  }, []);
  if (!offline) return null;
  return (
    <div role="status" className="flex items-center justify-center gap-2 bg-warning-soft px-3 py-2 text-sm text-warning">
      <WifiOff size={16} aria-hidden /> Mất kết nối mạng — đang thử kết nối lại…
    </div>
  );
}
```
Trong `AppShell.tsx`, đặt `<OfflineBanner />` ngay dưới `<Header … />` và trước `<main>` (import từ `./OfflineBanner`).
Run: `npm test -- tests/shell` → PASS.

- [ ] **Step 5: Chạy toàn bộ + build + kiểm image lần cuối trước khi deploy**

Run: `npm run lint && npm run typecheck && npm test && npm run build`
Expected: tất cả xanh.
Run: `docker build -q -t dh-app-test --target runner . && docker inspect --format '{{json .Config.Cmd}}' dh-app-test`
Expected: `["node","server.js"]`.
Run: `grep -rEn "GOCSPX|BEGIN (RSA|OPENSSH) PRIVATE|password=|AUTH_SECRET=[A-Za-z0-9+/]{20,}" --include="*" -I . --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git --exclude=".env*" | head`
Expected: không có kết quả (không secret thật trong file versioned).
```bash
git add -A
git commit -m "feat: trang chủ, health check, trạng thái lỗi, banner mất mạng"
```

- [ ] **Step 6: DEPLOY LẦN ĐẦU — người dùng làm các bước hạ tầng; executor HỎI TRƯỚC khi push `main`**

Điều kiện: `docs/infra/INPUTS.md` đã điền; DNS `<DOMAIN>` đã trỏ về VPS. Đưa cho người dùng **từng bước, mỗi lần 1–2 lệnh trần** (quy tắc `setup-project`), chờ kết quả rồi mới sang bước sau:
1. `docs/infra/RUNBOOK.md` Bước 1 (DB + role `app_rw`), Bước 2 (user deploy + SSH key), Bước 3 (quyền reload Caddy), Bước 4 (`.env` với `DATABASE_URL`=`app_rw`, `MIGRATE_DATABASE_URL`=owner, `AUTH_SECRET`, `NEXTAUTH_URL`, `BOOTSTRAP_ADMIN_PASSWORD`), Bước 5 (Caddy).
2. Kiểm đúng tên biến code đọc:
```
grep -E "^(AUTH_SECRET|NEXTAUTH_URL|DATABASE_URL|MIGRATE_DATABASE_URL|BOOTSTRAP_ADMIN_PASSWORD)=" /home/deploy_<SLUG>/app/.env
```
3. Người dùng tạo repo GitHub `<OWNER/REPO>` và nạp GitHub Secrets (Bước 8: `VPS_SSH_KEY`, `VPS_HOST`, `VPS_USER`, `APP_PORT`, `REGISTRY_URL`, `REGISTRY_USER`, `REGISTRY_PASS`).
4. **Hỏi người dùng xác nhận rồi mới chạy** (push `main` = deploy):
```bash
git remote add origin git@github.com:<OWNER/REPO>.git
git push -u origin main
```
5. Theo dõi tab Actions: job `test` → `build-and-deploy` xanh. Nếu đỏ ở bước SSH/migrate: lấy log thật (`docker logs --tail 50 <SLUG>_app`) trước khi sửa; đối chiếu `pitfalls.md`.

- [ ] **Step 7: Xác minh thật theo `docs/infra/VERIFY.md` — CHỈ báo "GĐ0 xong" khi mọi mục ✅**

Thực hiện và tick từng mục trong `VERIFY.md`:
- Hạ tầng: `docker ps`, `docker logs --tail 50 <SLUG>_app` (không `NO_SECRET`/`ECONNREFUSED`/`P1001`), `https://<DOMAIN>` không lỗi cert, `curl https://<DOMAIN>/api/health` → `{"status":"ok","db":true,…}`.
- DB: `\dt` đủ bảng; `permissions`/`roles` có dữ liệu; đúng 1 dòng `periods.isOpen = true`; đăng nhập psql bằng `app_rw` rồi `UPDATE audit_log SET action='x';` → `permission denied`.
- Auth: mở trình duyệt THẬT → đăng nhập `admin` bằng `BOOTSTRAP_ADMIN_PASSWORD` → bị bắt đổi mật khẩu → đổi → vào được; đăng xuất/đăng nhập lại; khoá 1 tài khoản thử → tài khoản đó không đăng nhập được.
- CRUD: tạo 1 người dùng qua UI, reload còn nguyên, sửa, khoá/mở khoá; mỗi thao tác xuất hiện trong Nhật ký với số cũ/số mới.
- CI/CD: push 1 thay đổi nhỏ (vd sửa chữ ở footer) → Actions xanh; app vẫn phản hồi.
- Bảo mật: `git log --all -- .env` rỗng.

- [ ] **Step 8: Dọn mật khẩu khởi tạo trên VPS (nhớ: `docker restart` KHÔNG nạp `.env` — pitfalls mục 3)**

Xoá dòng `BOOTSTRAP_ADMIN_PASSWORD=` khỏi `/home/deploy_<SLUG>/app/.env` (sửa bằng editor trên VPS), rồi tạo lại container bằng đúng lệnh `docker run` trong `deploy.yml`:
```
docker stop <SLUG>_app
docker rm <SLUG>_app
```
(rồi chạy lại lệnh `docker run -d --name <SLUG>_app …` y hệt bước "Swap app container" của workflow, hoặc đẩy 1 commit rỗng lên `main` để pipeline tự dựng lại.) Tick mục cuối của `VERIFY.md`.

- [ ] **Step 9: Đóng GĐ0**

```bash
git add docs/infra/VERIFY.md
git commit -m "docs: VERIFY GĐ0 đã chạy trên production"
git tag gd0
```
Báo người dùng: GĐ0 hoàn tất và đã xác minh thật; bước tiếp theo là plan `02-gd1a-fifo-engine`.

---

## Self-Review (GĐ0c — Task 11–14)

**Spec coverage:** mã 1 (đăng nhập, đổi/cấp lại mật khẩu — Task 12), 2 (quản lý người dùng), 3 (cấu hình nhóm quyền động tới từng chức năng + phạm vi dữ liệu `partner.view_all`), 4 (khoá/mở khoá), 5 (nhật ký số cũ/số mới, không xóa được — Task 13 + DB ở plan 01a), 7 (trang chủ — khung Level 0; số liệu trong ngày ở plan 03-B7), T1/T5 (HTTPS, cài máy chủ — Task 14 deploy), T2 (field nhạy cảm — service trả DTO không có hash; `redactDeep` áp ở module có field nhạy cảm).
**Placeholder scan:** `<SLUG>`, `<DOMAIN>`, `<OWNER/REPO>` ở Task 14 là giá trị hạ tầng thật lấy từ `INPUTS.md`. Dòng "xoá `import { z }` nếu ESLint báo" (Task 12 Step 11) là dọn import thừa, không thiếu nội dung.
**Type consistency:** `TabRenderCtx` (Task 11) được `useSectionForm`, `DetailPage`, `UserDetail`, `RoleDetail` dùng cùng tên field (`editing`, `beginEdit`, `cancelEdit`, `finishEdit`, `setDirty`, `setSaving`, `setError`); `Actor` (`perms: ReadonlySet<string>`) dùng cho mọi service; `ListParams` khớp plan 01b; `assertAdminRemains` export từ `users/service` và dùng lại ở `roles/service`.
**Review Focus:** hết quản trị viên (Task 12 test khoá/đổi vai trò/đổi quyền + rollback) ✔; phiên hết hạn không mất form (Task 12 `apiFetch` test) ✔; tạo 2 lần + mật khẩu tạm không vào bảng idempotency (Task 12 route + dialog) ✔; nhật ký ICT + 50.000 dòng (Task 13) ✔; deploy xanh nhưng login hỏng → chỉ báo xong sau VERIFY (Task 14) ✔.
