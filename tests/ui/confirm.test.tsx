// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { ConfirmHost } from "@/components/ui/ConfirmDialog";
import { confirm, useConfirmStore } from "@/lib/confirm-store";

afterEach(() => {
  cleanup();
  useConfirmStore.setState({ request: null });
});

describe("confirm()", () => {
  it("bấm Xác nhận → resolve true", async () => {
    render(<ConfirmHost />);
    let p!: Promise<boolean>;
    act(() => { p = confirm({ title: "Xóa dòng này?", description: "Không hoàn tác được.", confirmLabel: "Xóa", danger: true }); });
    expect(await screen.findByRole("dialog", { name: "Xóa dòng này?" })).toBeInTheDocument();
    expect(screen.getByText("Không hoàn tác được.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Xóa" }));
    await expect(p).resolves.toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
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

  it("danger → nút xác nhận màu danger; thường → accent", async () => {
    render(<ConfirmHost />);
    act(() => { void confirm({ title: "Xóa?", confirmLabel: "Xóa", danger: true }); });
    expect((await screen.findByRole("button", { name: "Xóa" })).className).toContain("bg-danger");
    act(() => { void confirm({ title: "Lưu?", confirmLabel: "Lưu" }); });
    const ok = await screen.findByRole("button", { name: "Lưu" });
    expect(ok.className).toContain("bg-accent");
    expect(ok.className).not.toContain("bg-danger");
  });

  it("focus vào trong dialog và bị khoá trong dialog khi Tab / Shift+Tab", async () => {
    render(<><button>ngoài</button><ConfirmHost /></>);
    act(() => { void confirm({ title: "Xóa?", confirmLabel: "Xóa", danger: true }); });
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    for (let i = 0; i < 5; i++) {
      await userEvent.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
    await userEvent.tab({ shift: true });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });

  it("mở yêu cầu mới khi yêu cầu cũ chưa đóng → yêu cầu cũ resolve false", async () => {
    render(<ConfirmHost />);
    let first!: Promise<boolean>;
    act(() => { first = confirm({ title: "Một" }); });
    await screen.findByRole("dialog", { name: "Một" });
    act(() => { void confirm({ title: "Hai" }); });
    await expect(first).resolves.toBe(false);
    expect(await screen.findByRole("dialog", { name: "Hai" })).toBeInTheDocument();
  });
});
