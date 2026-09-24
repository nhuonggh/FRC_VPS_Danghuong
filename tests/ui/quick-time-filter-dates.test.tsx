// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuickTimeFilter } from "@/components/ui/QuickTimeFilter";
import { parseListParams, type ListParams } from "@/lib/query-params";

// Nhập ngày "Tùy chọn" thực tế: ô ngày giữ state cục bộ, chỉ đẩy URL khi cặp ngày đủ + hợp lệ, debounce 500ms.
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/x" }));

const NOW = new Date("2026-09-30T16:50:00Z");
const DEBOUNCE = 500; // = DATE_FILTER_DEBOUNCE_MS
const NAV_DELAY = 300; // độ trễ giả lập của điều hướng server (params chỉ cập nhật sau đó)
let onPush: (href: string) => void = () => {};

/** Giống trang thật: `params` chỉ đổi SAU khi điều hướng xong (NAV_DELAY); ô ngày không được tự nhận giá trị mới trước đó. */
function Harness({ initial }: { initial: Record<string, string> }) {
  const [params, setParams] = useState<ListParams>(() => parseListParams(initial));
  onPush = (href) => {
    setTimeout(() => setParams(parseListParams(Object.fromEntries(new URL(href, "http://h").searchParams))), NAV_DELAY);
  };
  return <QuickTimeFilter basePath="/x" params={params} now={NOW} />;
}

beforeEach(() => {
  vi.useFakeTimers();
  push.mockImplementation((href: string) => onPush(href));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  push.mockReset();
  onPush = () => {};
});

const from = () => screen.getByLabelText("Từ ngày");
const to = () => screen.getByLabelText("Đến ngày");
const typeDate = (el: HTMLElement, v: string) => fireEvent.change(el, { target: { value: v } });
const wait = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

describe("QuickTimeFilter — nhập ngày Tùy chọn (có độ trễ điều hướng)", () => {
  it("(a) nhập thiếu (chỉ 1 ngày) → KHÔNG đẩy URL dù chờ bao lâu; hiện nhắc 'Chọn đủ 2 ngày'", () => {
    render(<Harness initial={{ timePreset: "custom" }} />);
    typeDate(from(), "2026-09-01");
    wait(5000);
    expect(push).not.toHaveBeenCalled();
    expect(from()).toHaveValue("2026-09-01");
    expect(screen.getByRole("status")).toHaveTextContent("Chọn đủ 2 ngày");
  });

  it("(a) xoá dở 1 ô khi URL đang có khoảng → không đẩy, giữ khoảng đang áp dụng và nhắc", () => {
    render(<Harness initial={{ timePreset: "custom", timeStart: "2026-09-01", timeEnd: "2026-09-15" }} />);
    typeDate(from(), "");
    wait(5000);
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByTestId("time-range")).toHaveTextContent("01/09/2026 – 15/09/2026");
    expect(screen.getByRole("status")).toHaveTextContent("Chọn đủ 2 ngày để đổi khoảng lọc");
  });

  it("(b) cặp ngày đủ + hợp lệ → đẩy ĐÚNG 1 lần sau debounce, giữ filter khác, về trang 1", () => {
    render(<Harness initial={{ timePreset: "custom", q: "ton", page: "4" }} />);
    typeDate(from(), "2026-09-01");
    wait(100);
    typeDate(to(), "2026-09-15");
    wait(DEBOUNCE - 1);
    expect(push).not.toHaveBeenCalled();
    wait(1);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/x?q=ton&timePreset=custom&timeStart=2026-09-01&timeEnd=2026-09-15");
    wait(NAV_DELAY + 2000);
    expect(push).toHaveBeenCalledTimes(1); // URL về tới không kích hoạt thêm lần đẩy nào
    expect(screen.getByTestId("time-range")).toHaveTextContent("01/09/2026 – 15/09/2026");
  });

  it("(b) Chrome bắn change theo từng bước khi gõ năm (0002 → 0020 → 0202 → 2026): chỉ đẩy 1 lần với giá trị cuối", () => {
    render(<Harness initial={{ timePreset: "custom", timeEnd: "2026-12-31" }} />);
    for (const y of ["0002", "0020", "0202", "2026"]) {
      typeDate(from(), `${y}-09-15`);
      wait(120);
    }
    expect(push).not.toHaveBeenCalled();
    wait(DEBOUNCE);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/x?timePreset=custom&timeStart=2026-09-15&timeEnd=2026-12-31");
  });

  it("(c) trong lúc điều hướng còn treo, ô hiện đúng thứ người dùng gõ (không bị reset về giá trị cũ)", () => {
    render(<Harness initial={{ timePreset: "custom" }} />);
    typeDate(from(), "2026-09-01");
    typeDate(to(), "2026-09-15");
    wait(DEBOUNCE); // đẩy #1; params CHƯA đổi (điều hướng đang chạy)
    expect(push).toHaveBeenCalledTimes(1);
    expect(from()).toHaveValue("2026-09-01");
    typeDate(from(), "2026-09-02"); // gõ tiếp khi điều hướng #1 chưa về
    wait(NAV_DELAY); // điều hướng #1 về với timeStart=09-01 (cũ)
    expect(from()).toHaveValue("2026-09-02");
    expect(to()).toHaveValue("2026-09-15");
    wait(DEBOUNCE);
    expect(push).toHaveBeenCalledTimes(2);
    expect(push).toHaveBeenLastCalledWith("/x?timePreset=custom&timeStart=2026-09-02&timeEnd=2026-09-15");
    wait(NAV_DELAY + 2000);
    expect(from()).toHaveValue("2026-09-02");
    expect(push).toHaveBeenCalledTimes(2);
  });

  it("cặp đảo ngược (đủ, hợp lệ) → vẫn đẩy; server không lọc và UI báo rõ 'không sau ngày kết thúc'", () => {
    render(<Harness initial={{ timePreset: "custom" }} />);
    typeDate(from(), "2026-09-15");
    typeDate(to(), "2026-09-01");
    wait(DEBOUNCE);
    expect(push).toHaveBeenCalledWith("/x?timePreset=custom&timeStart=2026-09-15&timeEnd=2026-09-01");
    wait(NAV_DELAY);
    expect(screen.queryByTestId("time-range")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("không sau ngày kết thúc");
  });

  it("xoá cả 2 ô → đẩy 1 lần để bỏ khoảng (vẫn ở 'Tùy chọn')", () => {
    render(<Harness initial={{ timePreset: "custom", timeStart: "2026-09-01", timeEnd: "2026-09-15", page: "2" }} />);
    typeDate(from(), "");
    typeDate(to(), "");
    wait(DEBOUNCE);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/x?timePreset=custom");
  });

  it("gõ đổi rồi trả về đúng giá trị URL trong thời gian debounce → không đẩy thừa", () => {
    render(<Harness initial={{ timePreset: "custom", timeStart: "2026-09-01", timeEnd: "2026-09-15" }} />);
    typeDate(from(), "2026-09-02");
    wait(200);
    typeDate(from(), "2026-09-01");
    wait(5000);
    expect(push).not.toHaveBeenCalled();
  });
});

describe("QuickTimeFilter — (d) URL đổi từ bên ngoài thì ô ngày đồng bộ lại", () => {
  const p = (o: Record<string, string>) => parseListParams(o);

  it("Back/Forward và xoá bộ lọc: timeStart/timeEnd trên URL đổi", () => {
    const { rerender } = render(<QuickTimeFilter basePath="/x" params={p({ timePreset: "custom", timeStart: "2026-09-01", timeEnd: "2026-09-15" })} now={NOW} />);
    rerender(<QuickTimeFilter basePath="/x" params={p({ timePreset: "custom", timeStart: "2026-08-01", timeEnd: "2026-08-31" })} now={NOW} />);
    expect(from()).toHaveValue("2026-08-01");
    expect(to()).toHaveValue("2026-08-31");
    rerender(<QuickTimeFilter basePath="/x" params={p({ timePreset: "custom" })} now={NOW} />);
    expect(from()).toHaveValue("");
    expect(to()).toHaveValue("");
    wait(5000);
    expect(push).not.toHaveBeenCalled();
  });

  it("đang gõ dở rồi URL đổi từ ngoài → ô nhận giá trị URL, không đẩy giá trị dở", () => {
    const { rerender } = render(<QuickTimeFilter basePath="/x" params={p({ timePreset: "custom", timeStart: "2026-09-01", timeEnd: "2026-09-15" })} now={NOW} />);
    typeDate(from(), "2026-09-03");
    rerender(<QuickTimeFilter basePath="/x" params={p({ timePreset: "custom", timeStart: "2026-07-01", timeEnd: "2026-07-31" })} now={NOW} />);
    expect(from()).toHaveValue("2026-07-01");
    wait(5000);
    expect(push).not.toHaveBeenCalled();
  });

  it("chọn mốc khác rồi quay lại 'Tùy chọn' → ô ngày trống, không còn giá trị gõ dở cũ", () => {
    const { rerender } = render(<QuickTimeFilter basePath="/x" params={p({ timePreset: "custom" })} now={NOW} />);
    typeDate(from(), "2026-09-03"); // gõ dở (thiếu ngày kết thúc)
    rerender(<QuickTimeFilter basePath="/x" params={p({ timePreset: "thisMonth" })} now={NOW} />);
    rerender(<QuickTimeFilter basePath="/x" params={p({ timePreset: "custom" })} now={NOW} />);
    expect(from()).toHaveValue("");
    expect(to()).toHaveValue("");
  });
});
