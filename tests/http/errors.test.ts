import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ForbiddenError } from "@/lib/permissions/guard";
import { DomainError, UnauthorizedError, ValidationError } from "@/server/http/errors";
import { toErrorResponse } from "@/server/http/handler";

const body = async (r: Response) => r.json();

describe("toErrorResponse", () => {
  it("DomainError → status của nó, thông báo tiếng Việt", async () => {
    const r = toErrorResponse(new DomainError("Tên đăng nhập đã tồn tại."));
    expect(r.status).toBe(409);
    expect(await body(r)).toEqual({ error: "Tên đăng nhập đã tồn tại." });
  });

  it("DomainError 404 tuỳ biến", () => {
    expect(toErrorResponse(new DomainError("Không tìm thấy.", 404)).status).toBe(404);
  });

  it("ForbiddenError → 403; UnauthorizedError → 401", async () => {
    expect(toErrorResponse(new ForbiddenError("user.manage")).status).toBe(403);
    const r = toErrorResponse(new UnauthorizedError());
    expect(r.status).toBe(401);
    expect((await body(r)).error).toMatch(/hết hạn/);
  });

  it("ZodError → 400 kèm thông báo của lỗi đầu và bản đồ field", async () => {
    const parsed = z.object({ name: z.string().min(2, "Nhập họ tên") }).safeParse({ name: "" });
    const r = toErrorResponse(parsed.error);
    expect(r.status).toBe(400);
    expect(await body(r)).toEqual({ error: "Nhập họ tên", fields: { name: "Nhập họ tên" } });
  });

  it("ZodError không tự đặt thông báo → vẫn tiếng Việt (không lộ 'Expected ...' tiếng Anh)", async () => {
    const parsed = z.object({ locked: z.boolean(), ids: z.array(z.number()) }).safeParse({ locked: "x", ids: "y" });
    const r = toErrorResponse(parsed.error);
    const b = await body(r);
    expect(r.status).toBe(400);
    expect(JSON.stringify(b)).not.toMatch(/Expected|Required|Invalid/);
    expect(Object.keys(b.fields).sort()).toEqual(["ids", "locked"]);
  });

  it("ValidationError → 400", () => {
    expect(toErrorResponse(new ValidationError("Thiếu Idempotency-Key.")).status).toBe(400);
  });

  it("vi phạm UNIQUE của Prisma (P2002) → 409 thông báo chung", async () => {
    const e = new Prisma.PrismaClientKnownRequestError("x", { code: "P2002", clientVersion: "6" });
    const r = toErrorResponse(e);
    expect(r.status).toBe(409);
    expect((await body(r)).error).toMatch(/đã tồn tại/);
  });

  it("lỗi lạ → 500, KHÔNG lộ nội dung lỗi/stack, có ghi log", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = toErrorResponse(new Error("password=hunter2 ở dòng 42"));
    expect(r.status).toBe(500);
    const text = JSON.stringify(await body(r));
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("stack");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
