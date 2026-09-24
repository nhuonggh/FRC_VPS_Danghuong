// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  DetailField, DetailPage, DetailSection, EditActions, EditButton, useDetailNav, useSectionForm,
  type DetailTab, type TabRenderCtx,
} from "@/components/ui/DetailPage";
import { useToastStore } from "@/lib/toast";

const nav = vi.hoisted(() => ({
  search: "",
  pathname: "/x/1",
  refresh: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: nav.refresh, push: nav.push, replace: nav.replace }),
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}));
const confirmMock = vi.fn();
vi.mock("@/lib/confirm-store", () => ({ confirm: (...a: unknown[]) => confirmMock(...a) }));

beforeEach(() => {
  nav.search = "";
  nav.refresh.mockClear();
  nav.push.mockClear();
  nav.replace.mockClear();
  confirmMock.mockReset();
  useToastStore.setState({ items: [] });
});
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
        <button onClick={() => ctx.cancelEdit()}>hủy-sửa</button>
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
  const utils = render(<DetailPage backHref="/system/users" backLabel="Quay lại người dùng" summary={summary} tabs={tabs} activeTab="info" onTabChange={onTabChange} {...over} />);
  return { onTabChange, ...utils };
}

const roleTab = () => screen.getAllByRole("button", { name: "Vai trò" })[0]!;

describe("DetailPage — khung & điều hướng", () => {
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

  it("đổi tab khi chưa sửa → gọi onTabChange, không hỏi", async () => {
    const { onTabChange } = setup();
    await userEvent.click(roleTab());
    expect(onTabChange).toHaveBeenCalledWith("roles");
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it("bấm lại tab đang mở → không làm gì", async () => {
    const { onTabChange } = setup();
    await userEvent.click(screen.getAllByRole("button", { name: "Thông tin (2)" })[0]!);
    expect(onTabChange).not.toHaveBeenCalled();
  });

  it("đang sửa + dirty → đổi tab phải xác nhận; từ chối thì ở lại", async () => {
    const { onTabChange } = setup();
    await userEvent.click(screen.getByText("sửa-basic"));
    await userEvent.click(screen.getByText("làm-bẩn"));
    confirmMock.mockResolvedValueOnce(false);
    await userEvent.click(roleTab());
    expect(confirmMock).toHaveBeenCalledOnce();
    expect(onTabChange).not.toHaveBeenCalled();
    confirmMock.mockResolvedValueOnce(true);
    await userEvent.click(roleTab());
    expect(onTabChange).toHaveBeenCalledWith("roles");
  });

  it("đang sửa nhưng CHƯA dirty → đổi tab không hỏi", async () => {
    const { onTabChange } = setup();
    await userEvent.click(screen.getByText("sửa-basic"));
    await userEvent.click(roleTab());
    expect(confirmMock).not.toHaveBeenCalled();
    expect(onTabChange).toHaveBeenCalledWith("roles");
  });

  it("back-link khi đang dirty → hỏi xác nhận; từ chối thì ở lại, đồng ý thì push(backHref)", async () => {
    setup();
    await userEvent.click(screen.getByText("sửa-basic"));
    await userEvent.click(screen.getByText("làm-bẩn"));
    confirmMock.mockResolvedValueOnce(false);
    await userEvent.click(screen.getByRole("link", { name: /Quay lại người dùng/ }));
    expect(confirmMock).toHaveBeenCalledOnce();
    expect(nav.push).not.toHaveBeenCalled();
    confirmMock.mockResolvedValueOnce(true);
    await userEvent.click(screen.getByRole("link", { name: /Quay lại người dùng/ }));
    expect(nav.push).toHaveBeenCalledWith("/system/users");
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

  it("Hủy khi dirty → hỏi; đồng ý thì thoát chế độ sửa", async () => {
    setup();
    await userEvent.click(screen.getByText("sửa-basic"));
    await userEvent.click(screen.getByText("làm-bẩn"));
    confirmMock.mockResolvedValueOnce(true);
    await userEvent.click(screen.getByText("hủy-sửa"));
    expect(confirmMock).toHaveBeenCalledOnce();
    expect(screen.getByTestId("editing")).toHaveTextContent("null");
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

  it("lưu xong → thoát edit + toast + router.refresh(); onSaved (nếu có) thay refresh", async () => {
    const { unmount } = setup();
    await userEvent.click(screen.getByText("sửa-basic"));
    await userEvent.click(screen.getByText("xong"));
    expect(screen.getByTestId("editing")).toHaveTextContent("null");
    expect(nav.refresh).toHaveBeenCalledOnce();
    expect(useToastStore.getState().items.map((i) => [i.kind, i.message])).toEqual([["success", "Đã lưu thay đổi."]]);
    unmount();
    const onSaved = vi.fn();
    setup({ onSaved });
    await userEvent.click(screen.getByText("xong"));
    expect(onSaved).toHaveBeenCalledOnce();
    expect(nav.refresh).toHaveBeenCalledOnce();
  });

  it("initialEditing (từ ?edit=) vào thẳng chế độ sửa", () => {
    setup({ initialEditing: "basic" });
    expect(screen.getByTestId("editing")).toHaveTextContent("basic");
  });

  it("hook trong render của tab không gãy khi đổi tab (mỗi tab là 1 component riêng)", () => {
    const HookTab: DetailTab = { key: "h", label: "H", render: () => { const [n] = useState(1); return <div>hook {n}</div>; } };
    const { rerender } = setup({ tabs: [...tabs, HookTab], activeTab: "info" });
    expect(() => rerender(<DetailPage backHref="/x" backLabel="Về" summary={summary} tabs={[...tabs, HookTab]} activeTab="h" onTabChange={() => {}} />)).not.toThrow();
    expect(screen.getByText("hook 1")).toBeInTheDocument();
    expect(() => rerender(<DetailPage backHref="/x" backLabel="Về" summary={summary} tabs={[...tabs, HookTab]} activeTab="roles" onTabChange={() => {}} />)).not.toThrow();
    expect(screen.getByText("NỘI DUNG VAI TRÒ")).toBeInTheDocument();
  });
});

describe("DetailPage — View mode & bố cục", () => {
  it("giá trị là text tĩnh (dd), KHÔNG có input disabled; giá trị rỗng hiện '—'", () => {
    setup();
    expect(document.querySelectorAll("input[disabled], select[disabled], textarea[disabled]")).toHaveLength(0);
    expect(screen.getByText("Nguyễn Văn A", { selector: "dd" })).toBeInTheDocument();
    expect(screen.getByText("—", { selector: "dd" })).toBeInTheDocument();
  });

  it("label và value khác nhau cả MÀU lẫn ĐỘ ĐẬM", () => {
    setup();
    const dt = screen.getByText("Tên", { selector: "dt" });
    const dd = screen.getByText("Nguyễn Văn A", { selector: "dd" });
    expect(dt.className).toContain("text-fg-muted");
    expect(dt.className).toContain("font-normal");
    expect(dd.className).toContain("text-fg");
    expect(dd.className).not.toContain("text-fg-muted");
    expect(dd.className).toContain("font-semibold");
    expect(dd.className).toContain("min-h-9"); // khớp chiều cao input → đổi mode không giật layout
  });

  it("số 0 là giá trị hợp lệ (không bị coi là rỗng)", () => {
    render(<dl><DetailField label="Số lượng">{0}</DetailField></dl>);
    expect(screen.getByText("0", { selector: "dd" })).toBeInTheDocument();
  });

  it("section đang sửa: header sticky để Lưu/Hủy luôn thấy; không sửa thì không sticky", () => {
    const { rerender } = render(<DetailSection title="Cơ bản" editing action={<span>act</span>}><p>nội dung</p></DetailSection>);
    expect(screen.getByRole("heading", { name: "Cơ bản" }).parentElement!.className).toContain("sticky");
    rerender(<DetailSection title="Cơ bản" action={<span>act</span>}><p>nội dung</p></DetailSection>);
    expect(screen.getByRole("heading", { name: "Cơ bản" }).parentElement!.className).not.toContain("sticky");
  });

  it("PC: nav tab dọc chỉ ≥1024; <1024: thanh tab ngang cuộn, mỗi tab ≥44px (min-h-12), aside không sticky", () => {
    const { container } = setup();
    const vertical = screen.getByRole("navigation", { name: "Các phần" });
    expect(vertical.className).toContain("hidden");
    expect(vertical.className).toContain("lg:block");
    const bar = container.querySelector(".overflow-x-auto")!;
    expect(bar.className).toContain("lg:hidden");
    const barTabs = Array.from(bar.querySelectorAll("button"));
    expect(barTabs).toHaveLength(2);
    for (const b of barTabs) {
      expect(b.className).toContain("min-h-12");
      expect(b.className).toContain("shrink-0");
    }
    const aside = container.querySelector("aside")!;
    expect(aside.className).toContain("lg:sticky");
    expect(aside.className.split(/\s+/)).not.toContain("sticky");
    expect(container.querySelector(".grid")!.className).toContain("lg:grid-cols-[248px_minmax(0,1fr)]");
  });

  it("tab đang mở có aria-current ở cả nav dọc lẫn thanh tab ngang", () => {
    setup();
    const active = screen.getAllByRole("button", { name: "Thông tin (2)" });
    expect(active).toHaveLength(2);
    active.forEach((b) => expect(b).toHaveAttribute("aria-current", "page"));
  });
});

describe("DetailPage — cảnh báo rời trang (beforeunload)", () => {
  const fire = () => {
    const ev = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(ev);
    return ev.defaultPrevented;
  };

  it("chỉ chặn khi ĐANG SỬA và DIRTY", async () => {
    setup();
    expect(fire()).toBe(false); // không sửa
    await userEvent.click(screen.getByText("sửa-basic"));
    expect(fire()).toBe(false); // sửa nhưng chưa dirty
    await userEvent.click(screen.getByText("làm-bẩn"));
    expect(fire()).toBe(true); // dirty
  });

  it("thoát chế độ sửa (hoặc lưu xong) → gỡ cảnh báo; unmount → gỡ luôn", async () => {
    const { unmount } = setup();
    await userEvent.click(screen.getByText("sửa-basic"));
    await userEvent.click(screen.getByText("làm-bẩn"));
    expect(fire()).toBe(true);
    await userEvent.click(screen.getByText("xong"));
    expect(fire()).toBe(false);
    await userEvent.click(screen.getByText("sửa-basic"));
    await userEvent.click(screen.getByText("làm-bẩn"));
    unmount();
    expect(fire()).toBe(false);
  });
});

describe("useDetailNav", () => {
  const KEYS = ["info", "roles"] as const;

  it("?tab= hợp lệ → dùng; sai/thiếu → tab đầu", () => {
    nav.search = "tab=roles";
    expect(renderHook(() => useDetailNav(KEYS)).result.current.activeTab).toBe("roles");
    nav.search = "tab=khong-co";
    expect(renderHook(() => useDetailNav(KEYS)).result.current.activeTab).toBe("info");
    nav.search = "";
    expect(renderHook(() => useDetailNav(KEYS)).result.current.activeTab).toBe("info");
  });

  it("onTabChange đẩy ?tab= (giữ back/forward)", () => {
    const { result } = renderHook(() => useDetailNav(KEYS));
    result.current.onTabChange("roles");
    expect(nav.push).toHaveBeenCalledWith("/x/1?tab=roles");
  });

  it("?edit= chỉ dùng 1 lần: gỡ khỏi URL (giữ tham số khác), không bật lại khi render lại / StrictMode", () => {
    nav.search = "tab=info&edit=basic&foo=1";
    const { result, rerender } = renderHook(() => useDetailNav(KEYS, { basic: "info" }), { wrapper: StrictMode });
    expect(result.current.initialEditing).toBe("basic");
    expect(nav.replace).toHaveBeenCalledTimes(1);
    expect(nav.replace).toHaveBeenCalledWith("/x/1?tab=info&foo=1");
    nav.search = "tab=info&foo=1"; // URL sau khi gỡ
    rerender();
    rerender();
    expect(nav.replace).toHaveBeenCalledTimes(1);
    expect(result.current.initialEditing).toBe("basic"); // giữ để trang không thoát edit giữa chừng
  });

  it("?edit= chỉ có tên section → nhảy tới tab chứa section, và GHI ?tab= khi gỡ edit để không rơi về tab đầu", () => {
    nav.search = "edit=contact";
    const { result } = renderHook(() => useDetailNav(KEYS, { basic: "info", contact: "roles" }));
    expect(result.current.activeTab).toBe("roles");
    expect(result.current.initialEditing).toBe("contact");
    expect(nav.replace).toHaveBeenCalledWith("/x/1?tab=roles");
  });

  it("?edit= không nằm trong danh sách section hợp lệ → bỏ qua (không vào edit), vẫn gỡ khỏi URL", () => {
    nav.search = "edit=zzz";
    const { result } = renderHook(() => useDetailNav(KEYS, { basic: "info" }));
    expect(result.current.initialEditing).toBeNull();
    expect(nav.replace).toHaveBeenCalledWith("/x/1");
  });

  it("không có ?edit= → không gọi replace", () => {
    nav.search = "tab=roles";
    const { result } = renderHook(() => useDetailNav(KEYS));
    expect(result.current.initialEditing).toBeNull();
    expect(nav.replace).not.toHaveBeenCalled();
  });
});

// ---- useSectionForm + EditActions/EditButton: form 1 section thật (RHF + zod) ----

const schema = z.object({ name: z.string().min(1, "Tên không được để trống") });
type V = z.infer<typeof schema>;

function NameSection({ ctx, save }: { ctx: TabRenderCtx; save: (v: V) => Promise<void> }) {
  const { form, editing, onSave, onCancel, saving } = useSectionForm<V>(ctx, "basic", { schema, defaults: { name: "Văn A" }, save });
  return (
    <DetailSection
      title="Cơ bản"
      editing={editing}
      action={editing ? <EditActions saving={saving} onSave={onSave} onCancel={onCancel} /> : <EditButton label="Chỉnh sửa Cơ bản" onClick={() => ctx.beginEdit("basic")} />}
    >
      {editing ? (
        <div>
          <input aria-label="Tên" {...form.register("name")} />
          {form.formState.errors.name && <p>{form.formState.errors.name.message}</p>}
        </div>
      ) : (
        <dl><DetailField label="Tên">Văn A</DetailField></dl>
      )}
    </DetailSection>
  );
}

function setupForm(save: (v: V) => Promise<void>) {
  const formTabs: DetailTab[] = [{ key: "info", label: "Thông tin", render: (ctx) => <NameSection ctx={ctx} save={save} /> }];
  return render(<DetailPage backHref="/x" backLabel="Về" summary={summary} tabs={formTabs} activeTab="info" onTabChange={() => {}} />);
}

describe("useSectionForm", () => {
  it("bút chì (aria-label) → vào sửa; Hủy khi chưa đổi gì → thoát, không hỏi", async () => {
    setupForm(vi.fn());
    expect(screen.queryByRole("textbox")).toBeNull(); // view = text tĩnh
    await userEvent.click(screen.getByRole("button", { name: "Chỉnh sửa Cơ bản" }));
    expect(screen.getByRole("textbox", { name: "Tên" })).toHaveValue("Văn A");
    await userEvent.click(screen.getByRole("button", { name: "Hủy chỉnh sửa" }));
    expect(confirmMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("gõ → dirty → Hủy phải xác nhận; và beforeunload được bật", async () => {
    setupForm(vi.fn());
    await userEvent.click(screen.getByRole("button", { name: "Chỉnh sửa Cơ bản" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Tên" }), "B");
    const ev = new Event("beforeunload", { cancelable: true });
    await waitFor(() => { window.dispatchEvent(ev); expect(ev.defaultPrevented).toBe(true); });
    confirmMock.mockResolvedValueOnce(false);
    await userEvent.click(screen.getByRole("button", { name: "Hủy chỉnh sửa" }));
    expect(confirmMock).toHaveBeenCalledOnce();
    expect(screen.getByRole("textbox", { name: "Tên" })).toHaveValue("Văn AB");
    confirmMock.mockResolvedValueOnce(true);
    await userEvent.click(screen.getByRole("button", { name: "Hủy chỉnh sửa" }));
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("vào sửa lần 2 → form nạp lại giá trị gốc (không giữ rác của lần Hủy trước)", async () => {
    setupForm(vi.fn());
    await userEvent.click(screen.getByRole("button", { name: "Chỉnh sửa Cơ bản" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Tên" }), "XYZ");
    confirmMock.mockResolvedValueOnce(true);
    await userEvent.click(screen.getByRole("button", { name: "Hủy chỉnh sửa" }));
    await userEvent.click(screen.getByRole("button", { name: "Chỉnh sửa Cơ bản" }));
    expect(screen.getByRole("textbox", { name: "Tên" })).toHaveValue("Văn A");
  });

  it("Lưu thành công → gọi save(values), thoát sửa, toast, refresh", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    setupForm(save);
    await userEvent.click(screen.getByRole("button", { name: "Chỉnh sửa Cơ bản" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Tên" }), "B");
    await userEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0]![0]).toEqual({ name: "Văn AB" });
    expect(nav.refresh).toHaveBeenCalledOnce();
    expect(useToastStore.getState().items[0]?.message).toBe("Đã lưu thay đổi.");
  });

  it("validation lỗi → không gọi save, hiện lỗi tại ô, vẫn ở chế độ sửa", async () => {
    const save = vi.fn();
    setupForm(save);
    await userEvent.click(screen.getByRole("button", { name: "Chỉnh sửa Cơ bản" }));
    await userEvent.clear(screen.getByRole("textbox", { name: "Tên" }));
    await userEvent.click(screen.getByRole("button", { name: "Lưu" }));
    expect(await screen.findByText("Tên không được để trống")).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Tên" })).toBeInTheDocument();
  });

  it("đang lưu: nút Lưu/Hủy disabled ('Đang lưu'), bấm đúp chỉ gọi save 1 lần", async () => {
    let release!: () => void;
    const save = vi.fn(() => new Promise<void>((res) => { release = res; }));
    setupForm(save);
    await userEvent.click(screen.getByRole("button", { name: "Chỉnh sửa Cơ bản" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Tên" }), "B");
    const saveBtn = screen.getByRole("button", { name: "Lưu" });
    fireEvent.click(saveBtn);
    fireEvent.click(saveBtn); // bấm đúp trước khi React kịp vô hiệu nút
    const pending = await screen.findByRole("button", { name: "Đang lưu" });
    expect(pending).toBeDisabled();
    expect(screen.getByRole("button", { name: "Hủy chỉnh sửa" })).toBeDisabled();
    fireEvent.click(pending);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    release();
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("lưu lỗi → banner giữ dữ liệu đã nhập, vẫn sửa được và bấm Lưu lại được", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("Tên đã tồn tại")).mockResolvedValueOnce(undefined);
    setupForm(save);
    await userEvent.click(screen.getByRole("button", { name: "Chỉnh sửa Cơ bản" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Tên" }), "B");
    await userEvent.click(screen.getByRole("button", { name: "Lưu" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Tên đã tồn tại");
    expect(screen.getByRole("textbox", { name: "Tên" })).toHaveValue("Văn AB");
    expect(screen.getByRole("button", { name: "Lưu" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
    expect(save).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull(); // banner cũ đã xoá sau khi lưu thành công
  });

  it("lỗi không phải Error → thông báo tiếng Việt mặc định", async () => {
    setupForm(vi.fn().mockRejectedValueOnce("boom"));
    await userEvent.click(screen.getByRole("button", { name: "Chỉnh sửa Cơ bản" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Tên" }), "B");
    await userEvent.click(screen.getByRole("button", { name: "Lưu" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Không lưu được, vui lòng thử lại.");
  });

  it("EditActions: Hủy đứng TRƯỚC Lưu (Hủy-trái/Lưu-phải)", () => {
    render(<EditActions saving={false} onSave={() => {}} onCancel={() => {}} />);
    const names = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent);
    expect(names).toEqual(["Hủy chỉnh sửa", "Lưu"]);
  });
});
