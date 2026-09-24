import type { NextRequest } from "next/server";
import { z } from "zod";
import { ValidationError } from "./errors";
import "./zod-vi";

/** Đọc body JSON; body rỗng/sai cú pháp → 400 tiếng Việt (không để rơi thành 500). */
export async function readJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new ValidationError("Dữ liệu gửi lên không hợp lệ.");
  }
}

/** Mã trong URL (`/api/users/[id]`) → số nguyên dương; sai → 400. */
export const idParam = z.coerce
  .number({ invalid_type_error: "Mã không hợp lệ." })
  .int("Mã không hợp lệ.")
  .positive("Mã không hợp lệ.");
