// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Combobox, filterComboOptions, type ComboOption } from "@/components/ui/Combobox";

afterEach(cleanup);

const ALL: ComboOption[] = [
  { value: 1, label: "Khách A", hint: "KH001" },
  { value: 2, label: "Khách B", hint: "KH002" },
  { value: 3, label: "Thợ C", hint: "T003" },
];

function Harness({ load, onPick, initial = null, disabled }: {
  load: (q: string) => Promise<ComboOption[]>;
  onPick?: (o: ComboOption | null) => void;
  initial?: ComboOption | null;
  disabled?: boolean;
}) {
  const [v, setV] = useState<ComboOption | null>(initial);
  return <Combobox label="Khách hàng" value={v} onChange={(o) => { setV(o); onPick?.(o); }} loadOptions={load} debounceMs={0} disabled={disabled} />;
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

  it("ARIA: combobox ↔ listbox, aria-activedescendant theo ArrowDown/ArrowUp, aria-selected", async () => {
    render(<Harness load={async () => ALL} initial={ALL[0]!} />);
    const input = screen.getByRole("combobox");
    expect(input).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(input);
    const list = await screen.findByRole("listbox");
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(input).toHaveAttribute("aria-controls", list.id);
    const opts = await screen.findAllByRole("option");
    expect(opts[0]).toHaveAttribute("aria-selected", "true");
    expect(opts[1]).toHaveAttribute("aria-selected", "false");
    expect(input).toHaveAttribute("aria-activedescendant", opts[0]!.id);
    await userEvent.keyboard("{ArrowDown}");
    expect(input).toHaveAttribute("aria-activedescendant", opts[1]!.id);
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}");
    expect(input).toHaveAttribute("aria-activedescendant", opts[2]!.id); // không vượt cuối
    await userEvent.keyboard("{ArrowUp}");
    expect(input).toHaveAttribute("aria-activedescendant", opts[1]!.id);
    await userEvent.keyboard("{ArrowUp}{ArrowUp}{ArrowUp}");
    expect(input).toHaveAttribute("aria-activedescendant", opts[0]!.id); // không vượt đầu
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

  it("không có kết quả → thông báo", async () => {
    render(<Harness load={async () => []} />);
    await userEvent.type(screen.getByRole("combobox"), "xyz");
    expect(await screen.findByText("Không tìm thấy kết quả")).toBeInTheDocument();
  });

  it("loadOptions lỗi → báo lỗi trong danh sách, không văng lỗi chưa bắt", async () => {
    render(<Harness load={async () => { throw new Error("mạng"); }} />);
    await userEvent.click(screen.getByRole("combobox"));
    expect(await screen.findByText("Không tải được danh sách")).toBeInTheDocument();
  });

  it("clearable: nút 'Xóa lựa chọn' đưa giá trị về null và xóa ô nhập; ẩn khi chưa chọn", async () => {
    const onPick = vi.fn();
    render(<Harness load={async () => ALL} initial={ALL[0]!} onPick={onPick} />);
    expect(screen.getByRole("combobox")).toHaveValue("Khách A");
    await userEvent.click(screen.getByRole("button", { name: "Xóa lựa chọn" }));
    expect(onPick).toHaveBeenCalledWith(null);
    expect(screen.getByRole("combobox")).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Xóa lựa chọn" })).toBeNull();
  });

  it("disabled: không có nút xóa, ô nhập bị khoá", () => {
    render(<Harness load={async () => ALL} initial={ALL[0]!} disabled />);
    expect(screen.queryByRole("button", { name: "Xóa lựa chọn" })).toBeNull();
    expect(screen.getByRole("combobox")).toBeDisabled();
  });

  it("mở lại khi đã chọn: q rỗng (gợi ý mặc định) chứ không tìm theo nhãn cũ", async () => {
    const load = vi.fn(async (q: string) => { void q; return ALL; });
    render(<Harness load={load} initial={ALL[1]!} />);
    await userEvent.click(screen.getByRole("combobox"));
    await screen.findAllByRole("option");
    expect(load).toHaveBeenLastCalledWith("");
  });

  it("hiện lỗi dưới ô khi có error", () => {
    render(<Combobox label="Khách" value={null} onChange={() => {}} loadOptions={async () => []} error="Bắt buộc chọn khách" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Bắt buộc chọn khách");
    expect(screen.getByRole("combobox")).toHaveAttribute("aria-invalid", "true");
  });
});

describe("filterComboOptions (danh sách tĩnh, cùng chuẩn tìm không dấu với server)", () => {
  const opts: ComboOption[] = [
    { value: 1, label: "Nguyễn Văn Đạt", hint: "KH001" },
    { value: 2, label: "Trần Thị Bích" },
  ];
  it("không phân biệt dấu/hoa thường, khớp cả hint, nhiều từ theo AND", () => {
    expect(filterComboOptions(opts, "nguyen dat").map((o) => o.value)).toEqual([1]);
    expect(filterComboOptions(opts, "ĐẠT").map((o) => o.value)).toEqual([1]);
    expect(filterComboOptions(opts, "kh001").map((o) => o.value)).toEqual([1]);
    expect(filterComboOptions(opts, "").map((o) => o.value)).toEqual([1, 2]);
    expect(filterComboOptions(opts, "zzz")).toEqual([]);
  });
});
