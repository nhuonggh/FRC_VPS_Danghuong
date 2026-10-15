// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/shell/AppShell";
import { APP_NAV } from "@/config/app.config";
import { buildNav } from "@/lib/nav";
import { emptyPrefs } from "@/lib/workspace";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: vi.fn() }) }));
afterEach(cleanup);

describe("AppShell", () => {
  it("OfflineBanner nằm ngay dưới Header và trước <main>", () => {
    const nav = buildNav(APP_NAV, new Set(["user.view"]));
    render(<AppShell nav={nav} user={{ fullName: "An", username: "an" }} prefs={emptyPrefs()}><p>nội dung</p></AppShell>);
    const header = screen.getByRole("banner");
    const status = screen.getByRole("status");
    const main = screen.getByRole("main");
    expect(header.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(status.parentElement!.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(main).toHaveTextContent("nội dung");
  });
});
