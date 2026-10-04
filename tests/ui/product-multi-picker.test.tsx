// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { addPickedLines, ProductMultiPicker } from "@/components/ui";
import type { ProductOption } from "@/server/products/queries";

afterEach(cleanup);

const P = (value: number, name: string): ProductOption => ({ value, label: `SP${value} — ${name}`, hint: "md", baseUnit: "md", units: [{ unit: "md", factor: "1" }] });
const ALL = [P(1, "Tôn xốp"), P(2, "Tôn lạnh"), P(3, "Xà gồ")];

describe("ProductMultiPicker", () => {
  it("tick nhiều sản phẩm → 'Thêm N sản phẩm' trả đúng danh sách theo thứ tự tick", async () => {
    const onPicked = vi.fn();
    render(<ProductMultiPicker load={async (q) => ALL.filter((p) => p.label.toLowerCase().includes(q.toLowerCase()))} onPicked={onPicked} />);
    await userEvent.click(screen.getByRole("button", { name: "Chọn nhiều sản phẩm" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(await within(dialog).findByRole("checkbox", { name: /SP3/ }));
    await userEvent.click(within(dialog).getByRole("checkbox", { name: /SP1/ }));
    expect(within(dialog).getByText("Đã chọn: 2")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Thêm 2 sản phẩm" }));
    expect(onPicked).toHaveBeenCalledWith([ALL[2], ALL[0]]);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("giữ mục đã tick khi đổi từ khoá tìm; chưa tick gì thì nút Thêm bị khoá; mã đã có hiện 'Đã có'", async () => {
    const onPicked = vi.fn();
    render(<ProductMultiPicker load={async (q) => ALL.filter((p) => p.label.toLowerCase().includes(q.toLowerCase()))} onPicked={onPicked} existingIds={[2]} />);
    await userEvent.click(screen.getByRole("button", { name: "Chọn nhiều sản phẩm" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Thêm" })).toBeDisabled();
    await userEvent.click(await within(dialog).findByRole("checkbox", { name: /SP1/ }));
    await userEvent.type(within(dialog).getByLabelText("Tìm sản phẩm"), "lạnh");
    await within(dialog).findByText("Đã có");
    await userEvent.click(await within(dialog).findByRole("checkbox", { name: /SP2/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Thêm 2 sản phẩm" }));
    expect(onPicked).toHaveBeenCalledWith([ALL[0], ALL[1]]);
  });

  it("đóng bằng nút Đóng → không gọi onPicked và xoá các tick", async () => {
    const onPicked = vi.fn();
    render(<ProductMultiPicker load={async () => ALL} onPicked={onPicked} />);
    await userEvent.click(screen.getByRole("button", { name: "Chọn nhiều sản phẩm" }));
    await userEvent.click(await screen.findByRole("checkbox", { name: /SP1/ }));
    await userEvent.click(screen.getByRole("button", { name: "Đóng" }));
    expect(onPicked).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Chọn nhiều sản phẩm" }));
    expect(await screen.findByText("Đã chọn: 0")).toBeInTheDocument();
  });
});

describe("addPickedLines", () => {
  const make = (p: ProductOption) => ({ productId: p.value });
  it("điền dòng trống trước, hết thì thêm dòng mới", () => {
    const update = vi.fn(), append = vi.fn();
    const n = addPickedLines(ALL, [{ productId: 9 }, { productId: undefined }], make, { update, append });
    expect(n).toBe(3);
    expect(update).toHaveBeenCalledWith(1, { productId: 1 });
    expect(append).toHaveBeenCalledWith([{ productId: 2 }, { productId: 3 }]);
  });
  it("chặn quá số dòng tối đa", () => {
    const update = vi.fn(), append = vi.fn();
    const n = addPickedLines(ALL, [{ productId: 9 }], make, { update, append }, 2);
    expect(n).toBe(1);
    expect(append).toHaveBeenCalledWith([{ productId: 1 }]);
  });
});
