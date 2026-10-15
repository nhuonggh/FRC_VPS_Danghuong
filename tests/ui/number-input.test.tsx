// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);
import { NumberInput } from "@/components/ui";

function Harness({ maxFrac = 0, onValue }: { maxFrac?: number; onValue?: (v: string) => void }) {
  const [v, setV] = useState("");
  return <NumberInput aria-label="so" maxFrac={maxFrac} value={v} onValueChange={(x) => { setV(x); onValue?.(x); }} />;
}

describe("NumberInput", () => {
  it("gõ 1000000 hiện 1.000.000 và trả số chuẩn", async () => {
    const spy = vi.fn();
    render(<Harness onValue={spy} />);
    const input = screen.getByLabelText("so") as HTMLInputElement;
    await userEvent.type(input, "1000000");
    expect(input.value).toBe("1.000.000");
    expect(spy).toHaveBeenLastCalledWith("1000000");
  });
  it("phím chấm trong ô số lẻ thành dấu phẩy thập phân", async () => {
    const spy = vi.fn();
    render(<Harness maxFrac={3} onValue={spy} />);
    const input = screen.getByLabelText("so") as HTMLInputElement;
    await userEvent.type(input, "1234.5");
    expect(input.value).toBe("1.234,5");
    expect(spy).toHaveBeenLastCalledWith("1234.5");
  });
  it("hiện giá trị ban đầu có ngăn nghìn và đồng bộ khi đổi từ ngoài", () => {
    const { rerender } = render(<NumberInput aria-label="so" value={1500000} onValueChange={() => {}} />);
    expect((screen.getByLabelText("so") as HTMLInputElement).value).toBe("1.500.000");
    rerender(<NumberInput aria-label="so" value="2000" onValueChange={() => {}} />);
    expect((screen.getByLabelText("so") as HTMLInputElement).value).toBe("2.000");
  });
});
