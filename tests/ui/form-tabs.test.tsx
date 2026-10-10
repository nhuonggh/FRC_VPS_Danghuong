// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FileText, History, Wallet } from "lucide-react";
import { useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewPage, tabsWithErrors, type FormTab } from "@/components/ui";

const replace = vi.fn(); let search = "";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace, refresh: vi.fn() }), usePathname: () => "/customers/new", useSearchParams: () => new URLSearchParams(search) }));
vi.mock("@/lib/confirm-store", () => ({ confirm: async () => true }));
beforeEach(() => { replace.mockReset(); search = ""; });
afterEach(cleanup);

interface V { name: string; limit: string }
function Harness({ onSave }: { onSave: (v: V) => void }) {
  const form = useForm<V>({ defaultValues: { name: "", limit: "" } });
  const tabs: FormTab[] = [
    { key: "co-ban", label: "Thông tin cơ bản", icon: FileText, fields: ["name"], render: () => <input aria-label="Tên" aria-invalid={form.formState.errors.name ? true : undefined} {...form.register("name", { required: "Nhập tên." })} /> },
    { key: "cong-no", label: "Công nợ", icon: Wallet, fields: ["limit"], render: () => <input aria-label="Hạn mức" aria-invalid={form.formState.errors.limit ? true : undefined} {...form.register("limit", { required: "Nhập hạn mức." })} /> },
    { key: "lich-su", label: "Lịch sử mua hàng", icon: History, disabled: true, disabledHint: "Lưu trước để xem", readOnly: true, render: () => <p>Chưa có</p> },
  ];
  return <NewPage backHref="/customers" backLabel="Quay lại" title="Thêm khách hàng" isDirty={() => form.formState.isDirty} onSubmit={async () => { await form.handleSubmit(onSave)(); }} tabs={tabs} errorTabs={tabsWithErrors(form.formState.errors, tabs)} />;
}

describe("NewPage với tab dọc", () => {
  it("mọi nhóm hiện thành thẻ xếp dọc + mục lục; bấm mục lục KHÔNG mất dữ liệu", async () => {
    render(<Harness onSave={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Thêm khách hàng" })).toBeInTheDocument();
    expect(screen.getAllByRole("tab", { name: /Thông tin cơ bản/ }).length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Tên")).toBeVisible();
    expect(screen.getByLabelText("Hạn mức", { selector: "input" })).toBeVisible();
    await userEvent.type(screen.getByLabelText("Tên"), "Đạt");
    await userEvent.click(screen.getAllByRole("tab", { name: /Công nợ/ })[0]!);
    expect(screen.getByLabelText("Hạn mức")).toBeVisible();
    expect(screen.getByLabelText("Tên", { selector: "input" })).toBeVisible();
    await userEvent.click(screen.getAllByRole("tab", { name: /Thông tin cơ bản/ })[0]!);
    expect(screen.getByLabelText("Tên")).toHaveValue("Đạt");
  });

  it("lỗi ở tab khác ⇒ chấm đỏ, bấm Tạo nhảy tới tab lỗi đầu tiên và focus ô lỗi; đủ dữ liệu ⇒ gọi lưu MỘT lần", async () => {
    const onSave = vi.fn();
    render(<Harness onSave={onSave} />);
    await userEvent.type(screen.getByLabelText("Tên"), "Đạt"); // tab 1 hợp lệ, tab 2 thiếu
    await userEvent.click(screen.getByRole("button", { name: "Tạo" }));
    await waitFor(() => expect(screen.getByLabelText("Hạn mức")).toBeVisible());
    expect(screen.getAllByRole("img", { name: "Tab Công nợ có lỗi" }).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByLabelText("Hạn mức")).toHaveFocus());
    expect(onSave).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText("Hạn mức"), "1000");
    await userEvent.click(screen.getByRole("button", { name: "Tạo" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]![0]).toMatchObject({ name: "Đạt", limit: "1000" });
  });

  it("tab chỉ có dữ liệu sau khi lưu: vô hiệu + gợi ý 'Lưu trước để xem', bấm không chuyển", async () => {
    render(<Harness onSave={vi.fn()} />);
    const t = screen.getAllByRole("tab", { name: /Lịch sử mua hàng/ })[0]!;
    expect(t).toBeDisabled(); expect(t).toHaveAttribute("title", "Lưu trước để xem");
    await userEvent.click(t);
    expect(screen.getByLabelText("Tên")).toBeVisible();
  });

  it("đồng bộ ?tab=: mở ?tab=cong-no vào đúng tab; đổi tab ghi URL bằng replace; ?tab= tới tab vô hiệu bị bỏ qua", async () => {
    search = "tab=cong-no";
    const { unmount } = render(<Harness onSave={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText("Hạn mức")).toBeVisible());
    unmount(); search = "tab=lich-su";
    render(<Harness onSave={vi.fn()} />);
    expect(screen.getByLabelText("Tên")).toBeVisible();
    replace.mockReset();
    await userEvent.click(screen.getAllByRole("tab", { name: /Công nợ/ })[0]!);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/customers/new?tab=cong-no", { scroll: false }));
  });

  it("bàn phím: mũi tên chuyển tab; bỏ qua tab vô hiệu", async () => {
    render(<Harness onSave={vi.fn()} />);
    const first = screen.getAllByRole("tab", { name: /Thông tin cơ bản/ })[0]!;
    first.focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByLabelText("Hạn mức")).toBeVisible();
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByLabelText("Tên", { selector: "input" })).toBeVisible();
  });
});

describe("tabsWithErrors", () => {
  it("chỉ tính tab có field lỗi và không bị vô hiệu, đúng thứ tự tab", () => {
    const tabs: FormTab[] = [
      { key: "a", label: "A", icon: FileText, fields: ["x"], render: () => null },
      { key: "b", label: "B", icon: FileText, fields: ["lines"], render: () => null },
      { key: "c", label: "C", icon: FileText, fields: ["y"], disabled: true, render: () => null },
    ];
    expect(tabsWithErrors({ lines: [{}], y: {} }, tabs)).toEqual(["b"]);
    expect(tabsWithErrors({}, tabs)).toEqual([]);
  });
});
