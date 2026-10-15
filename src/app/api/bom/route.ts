import { prisma } from "@/lib/prisma";
import { createBomVersionIdempotent } from "@/server/bom";
import { createBomVersionSchema } from "@/server/bom/schemas";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { readIdempotencyKey, readJson } from "@/server/http/read-json";

/** Tạo phiên bản định mức mới (lần đầu cho một sản phẩm/kiểu gia công sẽ tạo luôn BOM). */
export const POST = apiHandler(async (req) =>
  createBomVersionIdempotent(prisma, await requireActorApi("bom.manage"), readIdempotencyKey(req), createBomVersionSchema.parse(await readJson(req))),
);
