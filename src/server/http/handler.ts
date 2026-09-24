import { Prisma } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { ForbiddenError } from "@/lib/permissions/guard";
import { DomainError, ValidationError } from "./errors";
import "./zod-vi";

export function toErrorResponse(e: unknown): NextResponse {
  if (e instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const i of e.issues) fields[i.path.join(".") || "_"] ??= i.message;
    return NextResponse.json({ error: e.issues[0]?.message ?? "Dữ liệu không hợp lệ.", fields }, { status: 400 });
  }
  if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
  if (e instanceof ValidationError) return NextResponse.json({ error: e.message, fields: e.fields }, { status: 400 });
  if (e instanceof DomainError) return NextResponse.json({ error: e.message }, { status: e.status });
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    return NextResponse.json({ error: "Dữ liệu đã tồn tại, vui lòng kiểm tra lại." }, { status: 409 });
  }
  console.error(e);
  return NextResponse.json({ error: "Có lỗi hệ thống, vui lòng thử lại.", code: "INTERNAL" }, { status: 500 });
}

/**
 * Bọc route handler: trả JSON, lỗi được chuyển thành phản hồi tiếng Việt.
 * `noStore`: thêm Cache-Control: no-store (route trả mật khẩu tạm — không để proxy/trình duyệt lưu bản sao).
 */
export function apiHandler<C = unknown>(fn: (req: NextRequest, ctx: C) => Promise<unknown>, opts: { noStore?: boolean } = {}) {
  const finish = (res: NextResponse) => {
    if (opts.noStore) res.headers.set("Cache-Control", "no-store");
    return res;
  };
  return async (req: NextRequest, ctx: C) => {
    try {
      return finish(NextResponse.json((await fn(req, ctx)) ?? { ok: true }));
    } catch (e) {
      return finish(toErrorResponse(e));
    }
  };
}
