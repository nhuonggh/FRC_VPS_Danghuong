import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { DomainError } from "@/server/http/errors";
import { apiHandler } from "@/server/http/handler";
import { readJson } from "@/server/http/read-json";

const req = (body?: string) =>
  new NextRequest("http://localhost/api/x", { method: "POST", body, headers: { "content-type": "application/json" } });

describe("apiHandler", () => {
  it("trả JSON của hàm; undefined → { ok: true }", async () => {
    expect(await (await apiHandler(async () => ({ id: 1 }))(req(), undefined)).json()).toEqual({ id: 1 });
    expect(await (await apiHandler(async () => undefined)(req(), undefined)).json()).toEqual({ ok: true });
  });

  it("lỗi ném ra được đổi thành phản hồi JSON (không văng lên Next)", async () => {
    const r = await apiHandler(async () => {
      throw new DomainError("Không tìm thấy.", 404);
    })(req(), undefined);
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "Không tìm thấy." });
  });

  it("body không phải JSON → 400 tiếng Việt (không phải 500)", async () => {
    const r = await apiHandler(async (rq) => readJson(rq))(req("{không phải json"), undefined);
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/không hợp lệ/);
  });

  it("body rỗng → 400, không ghi log lỗi hệ thống", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await apiHandler(async (rq) => readJson(rq))(req(""), undefined);
    expect(r.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("apiHandler { noStore }", () => {
  it("đặt Cache-Control: no-store cho phản hồi thành công và lỗi; mặc định thì không", async () => {
    expect((await apiHandler(async () => ({ a: 1 }), { noStore: true })(req(), undefined)).headers.get("cache-control")).toBe("no-store");
    const err = await apiHandler(async () => { throw new DomainError("x"); }, { noStore: true })(req(), undefined);
    expect(err.headers.get("cache-control")).toBe("no-store");
    expect((await apiHandler(async () => ({ a: 1 }))(req(), undefined)).headers.get("cache-control")).toBeNull();
  });
});
