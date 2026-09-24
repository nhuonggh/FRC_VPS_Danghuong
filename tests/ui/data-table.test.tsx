// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataTable, type Column } from "@/components/ui/DataTable";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/" }));

interface Row { id: number; code: string; name: string; qty: number | null }
const rows: Row[] = [
  { id: 1, code: "SP1", name: "Tôn lạnh 0.45", qty: 1250 },
  { id: 2, code: "SP2", name: "Tôn xốp 11 sóng", qty: 30.5 },
];
const columns: Column<Row>[] = [
  { key: "code", label: "Mã", sortable: true, render: (r) => r.code },
  { key: "name", label: "Tên", sortable: true, primaryOnMobile: true, render: (r) => r.name },
  { key: "qty", label: "Tồn", align: "right", render: (r) => r.qty },
];

beforeEach(() => {
  localStorage.clear();
  push.mockClear();
});
afterEach(cleanup);

describe("DataTable", () => {
  it("render header + dòng; header sortable là link sort đúng vòng", () => {
    render(
      <DataTable id="t1" columns={columns} rows={rows} rowKey={(r) => r.id} sort="name"
        buildSortHref={(s) => `/x?sort=${s ?? ""}`} />,
    );
    expect(screen.getAllByText("Tôn lạnh 0.45").length).toBeGreaterThan(0);
    const name = screen.getAllByRole("link", { name: /Tên/ })[0]!;
    expect(name).toHaveAttribute("href", "/x?sort=-name");
    expect(screen.getAllByRole("link", { name: /Mã/ })[0]).toHaveAttribute("href", "/x?sort=code");
    expect(screen.getAllByRole("columnheader", { name: /Tên/ })[0]).toHaveAttribute("aria-sort", "ascending");
  });

  it("vòng sort tăng → giảm → bỏ; aria-sort cập nhật theo từng trạng thái", () => {
    const table = (sort?: string) => (
      <DataTable id="t1b" columns={columns} rows={rows} rowKey={(r) => r.id} sort={sort}
        buildSortHref={(s) => `/x?sort=${s ?? ""}`} />
    );
    const { rerender } = render(table(undefined));
    const th = () => screen.getAllByRole("columnheader", { name: /Tên/ })[0]!;
    const link = () => within(th()).getByRole("link");
    expect(th()).toHaveAttribute("aria-sort", "none");
    expect(link()).toHaveAttribute("href", "/x?sort=name"); // → tăng dần
    rerender(table("name"));
    expect(th()).toHaveAttribute("aria-sort", "ascending");
    expect(link()).toHaveAttribute("href", "/x?sort=-name"); // → giảm dần
    rerender(table("-name"));
    expect(th()).toHaveAttribute("aria-sort", "descending");
    expect(link()).toHaveAttribute("href", "/x?sort="); // → bỏ sort
    // cột không sortable: không có link, không aria-sort
    const qty = screen.getAllByRole("columnheader", { name: /Tồn/ })[0]!;
    expect(qty).not.toHaveAttribute("aria-sort");
    expect(within(qty).queryByRole("link")).toBeNull();
  });

  it("số căn phải + tabular", () => {
    render(<DataTable id="t2" columns={columns} rows={rows} rowKey={(r) => r.id} />);
    const cell = screen.getAllByText("1250")[0]!.closest("td")!;
    expect(cell.className).toMatch(/text-right/);
    expect(cell.className).toMatch(/tabular/);
  });

  it("ô rỗng (null) hiện '—', còn số 0 vẫn là '0'", () => {
    render(
      <DataTable id="t2b" columns={columns} rowKey={(r) => r.id}
        rows={[{ id: 1, code: "A", name: "B", qty: null }, { id: 2, code: "C", name: "D", qty: 0 }]} />,
    );
    const [r1, r2] = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(within(r1!).getAllByRole("cell")[2]).toHaveTextContent("—");
    expect(within(r2!).getAllByRole("cell")[2]).toHaveTextContent("0");
  });

  it("ẩn/hiện cột và nhớ lựa chọn (localStorage)", async () => {
    const { unmount } = render(<DataTable id="t3" columns={columns} rows={rows} rowKey={(r) => r.id} />);
    await userEvent.click(screen.getByRole("button", { name: "Cột hiển thị" }));
    await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "Mã" }));
    await userEvent.keyboard("{Escape}"); // menu modal đang aria-hidden phần còn lại của trang
    expect(screen.getAllByRole("columnheader", { name: /Tên/ })).toHaveLength(1); // truy vấn có hiệu lực
    expect(screen.queryAllByRole("columnheader", { name: /^Mã/ })).toHaveLength(0);
    unmount();
    render(<DataTable id="t3" columns={columns} rows={rows} rowKey={(r) => r.id} />);
    expect(screen.queryAllByRole("columnheader", { name: /^Mã/ })).toHaveLength(0);
  });

  it("cột hiddenByDefault ẩn sẵn", () => {
    const cols = [...columns, { key: "x", label: "Ẩn sẵn", hiddenByDefault: true, render: () => "x" }];
    render(<DataTable id="t3b" columns={cols} rows={rows} rowKey={(r) => r.id} />);
    expect(screen.queryAllByRole("columnheader", { name: /Ẩn sẵn/ })).toHaveLength(0);
  });

  it("kéo cạnh header đổi độ rộng cột và nhớ lại (localStorage)", () => {
    render(<DataTable id="t7" columns={columns} rows={rows} rowKey={(r) => r.id} />);
    const th = screen.getAllByRole("columnheader", { name: /Mã/ })[0]!;
    fireEvent.pointerDown(within(th).getByRole("separator"), { clientX: 100 });
    fireEvent.pointerMove(window, { clientX: 220 });
    fireEvent.pointerUp(window);
    expect(th).toHaveStyle({ width: "120px" });
    expect(JSON.parse(localStorage.getItem("table:t7:widths")!)).toEqual({ code: 120 });
  });

  it("click dòng điều hướng bằng href (Link), không mở panel", () => {
    render(<DataTable id="t4" columns={columns} rows={rows} rowKey={(r) => r.id} rowHref={(r) => `/items/${r.id}`} />);
    expect(screen.getAllByRole("link", { name: "Tôn lạnh 0.45" })[0]).toHaveAttribute("href", "/items/1");
  });

  it("cột thao tác chỉ icon có aria-label; quá 3 action → kebab", async () => {
    render(
      <DataTable id="t5" columns={columns} rows={[rows[0]!]} rowKey={(r) => r.id}
        rowActions={() => [
          { key: "view", label: "Xem", icon: "eye", href: "/v" },
          { key: "edit", label: "Sửa", icon: "pencil", href: "/e" },
          { key: "del", label: "Xóa", icon: "trash", danger: true, onClick: () => {} },
          { key: "lock", label: "Khóa", icon: "lock", onClick: () => {} },
        ]} />,
    );
    const table = screen.getByRole("table");
    expect(within(table).getByRole("link", { name: "Xem" })).toHaveAttribute("href", "/v");
    expect(within(table).getByRole("link", { name: "Sửa" })).toHaveAttribute("href", "/e");
    expect(within(table).queryByRole("button", { name: "Khóa" })).toBeNull(); // nằm trong kebab
    await userEvent.click(within(table).getByRole("button", { name: "Thêm thao tác" }));
    expect(await screen.findByRole("menuitem", { name: "Khóa" })).toBeInTheDocument();
  });

  it("bấm action trong cột thao tác không kích hoạt điều hướng của dòng", async () => {
    const onDel = vi.fn();
    render(
      <DataTable id="t5b" columns={columns} rows={[rows[0]!]} rowKey={(r) => r.id} rowHref={(r) => `/items/${r.id}`}
        rowActions={() => [{ key: "del", label: "Xóa", icon: "trash", danger: true, onClick: onDel }]} />,
    );
    await userEvent.click(within(screen.getByRole("table")).getByRole("button", { name: "Xóa" }));
    expect(onDel).toHaveBeenCalledOnce();
    expect(push).not.toHaveBeenCalled();
  });

  it("mobile: cùng dữ liệu dưới dạng card list (tiêu đề = cột primaryOnMobile)", () => {
    render(<DataTable id="t8" columns={columns} rows={rows} rowKey={(r) => r.id} rowHref={(r) => `/items/${r.id}`} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByRole("link", { name: "Tôn lạnh 0.45" })).toHaveAttribute("href", "/items/1");
    expect(within(items[0]!).getByText("Tồn")).toBeInTheDocument();
  });

  it("không có dòng → không render bảng rỗng (để trang hiện EmptyState)", () => {
    const { container } = render(<DataTable id="t6" columns={columns} rows={[]} rowKey={(r) => r.id} />);
    expect(container.querySelector("tbody tr")).toBeNull();
  });

  describe("click dòng — chỉ điều hướng khi click thuần vào vùng không tương tác", () => {
    const cols: Column<Row>[] = [
      ...columns,
      { key: "act", label: "Liên hệ", render: () => (<><a href="#call">Gọi</a><button type="button">Nút</button></>) },
    ];
    const renderRows = () => render(<DataTable id="t9" columns={cols} rows={[rows[0]!]} rowKey={(r) => r.id} rowHref={(r) => `/items/${r.id}`} />);
    const cellOfCode = () => within(screen.getByRole("table")).getByText("SP1");

    it("click thường vào ô không tương tác → router.push(href)", async () => {
      renderRows();
      await userEvent.click(cellOfCode());
      expect(push).toHaveBeenCalledWith("/items/1");
    });
    it("click vào <a>/<button> do render() trả về → KHÔNG điều hướng dòng", async () => {
      renderRows();
      const table = within(screen.getByRole("table"));
      await userEvent.click(table.getByRole("link", { name: "Gọi" }));
      await userEvent.click(table.getByRole("button", { name: "Nút" }));
      expect(push).not.toHaveBeenCalled();
    });
    it("Ctrl/Cmd/Shift-click → KHÔNG điều hướng cùng tab", () => {
      renderRows();
      for (const mod of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) fireEvent.click(cellOfCode(), mod);
      expect(push).not.toHaveBeenCalled();
    });
    it("đang bôi đen văn bản → KHÔNG điều hướng", async () => {
      renderRows();
      const spy = vi.spyOn(window, "getSelection").mockReturnValue({ toString: () => "SP" } as unknown as Selection);
      await userEvent.click(cellOfCode());
      spy.mockRestore();
      expect(push).not.toHaveBeenCalled();
    });
  });

  describe("cột ẩn/hiện — luôn còn lối vào bằng bàn phím", () => {
    it("cột chính (primary) bị vô hiệu trong menu cột", async () => {
      render(<DataTable id="g1" columns={columns} rows={rows} rowKey={(r) => r.id} rowHref={(r) => `/items/${r.id}`} />);
      await userEvent.click(screen.getByRole("button", { name: "Cột hiển thị" }));
      expect(screen.getByRole("menuitemcheckbox", { name: "Tên" })).toHaveAttribute("aria-disabled", "true");
      expect(screen.getByRole("menuitemcheckbox", { name: "Mã" })).not.toHaveAttribute("aria-disabled", "true");
    });
    it("không cho ẩn cột hiển thị cuối cùng (cột chính là cột duy nhất còn lại)", async () => {
      render(<DataTable id="g2" columns={columns} rows={rows} rowKey={(r) => r.id} />);
      await userEvent.click(screen.getByRole("button", { name: "Cột hiển thị" }));
      await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "Mã" }));
      await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "Tồn" }));
      expect(screen.getByRole("menuitemcheckbox", { name: "Tên" })).toHaveAttribute("aria-disabled", "true");
      await userEvent.keyboard("{Escape}");
      expect(screen.getAllByRole("columnheader")).toHaveLength(1);
    });
    it("trạng thái ẩn lưu sẵn vi phạm (ẩn cột chính / ẩn tất cả) được làm sạch khi tải", () => {
      localStorage.setItem("table:g3:hidden", JSON.stringify({ code: true, name: true, qty: true }));
      render(<DataTable id="g3" columns={columns} rows={rows} rowKey={(r) => r.id} rowHref={(r) => `/items/${r.id}`} />);
      const heads = screen.getAllByRole("columnheader");
      expect(heads).toHaveLength(1);
      expect(heads[0]).toHaveTextContent("Tên");
      expect(within(screen.getByRole("table")).getByRole("link", { name: "Tôn lạnh 0.45" })).toHaveAttribute("href", "/items/1");
    });
    it("không có primaryOnMobile → cột đầu là cột chính không ẩn được", async () => {
      const cols = columns.map(({ primaryOnMobile: _p, ...c }) => c) as Column<Row>[];
      render(<DataTable id="g4" columns={cols} rows={rows} rowKey={(r) => r.id} />);
      await userEvent.click(screen.getByRole("button", { name: "Cột hiển thị" }));
      expect(screen.getByRole("menuitemcheckbox", { name: "Mã" })).toHaveAttribute("aria-disabled", "true");
    });
  });

  describe("PC ↔ mobile và cỡ chạm", () => {
    it("bảng chỉ hiện từ md (hidden md:table), card list chỉ dưới md (md:hidden)", () => {
      render(<DataTable id="r1" columns={columns} rows={rows} rowKey={(r) => r.id} />);
      expect(screen.getByRole("table").className).toMatch(/\bhidden\b/);
      expect(screen.getByRole("table").className).toMatch(/\bmd:table\b/);
      expect(screen.getByRole("list").className).toMatch(/\bmd:hidden\b/);
    });
    it("nút icon (cột hiển thị, thao tác) ≥44px dưới md, 32px từ md", async () => {
      render(
        <DataTable id="r2" columns={columns} rows={[rows[0]!]} rowKey={(r) => r.id}
          rowActions={() => [{ key: "del", label: "Xóa", icon: "trash", onClick: () => {} }]} />,
      );
      const btns = [screen.getByRole("button", { name: "Cột hiển thị" }), ...screen.getAllByRole("button", { name: "Xóa" })];
      for (const b of btns) {
        expect(b.className).toMatch(/\bh-11\b/);
        expect(b.className).toMatch(/\bw-11\b/);
        expect(b.className).toMatch(/\bmd:h-8\b/);
        expect(b.className).toMatch(/\bmd:w-8\b/);
      }
    });
    it("cột Thao tác đủ rộng cho 3 icon (≥ w-32)", () => {
      render(<DataTable id="r3" columns={columns} rows={rows} rowKey={(r) => r.id} rowActions={() => []} />);
      expect(screen.getByRole("columnheader", { name: "Thao tác" }).className).toMatch(/\bw-32\b/);
    });
  });
});
