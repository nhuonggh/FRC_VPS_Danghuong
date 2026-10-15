import type { NextRequest } from "next/server";
import type { Actor } from "@/lib/permissions/scope";
import { prisma } from "@/lib/prisma";
import { xlsxResponse } from "@/server/export/xlsx";
import { DomainError, ValidationError } from "@/server/http/errors";
import { readIdempotencyKey } from "@/server/http/read-json";
import { buildRejectXlsx, buildTemplateXlsx, commitImport, previewImport } from "./framework";
import type { ImportSpec } from "./types";
import { MAX_IMPORT_BYTES } from "./xlsx-reader";
export async function readImportUpload(req: Request) { const form = await req.formData().catch(() => { throw new ValidationError("Không đọc được tệp gửi lên."); }); const file = form.get("file"); if (!(file instanceof File)) throw new ValidationError("Chưa chọn tệp."); if (file.size > MAX_IMPORT_BYTES) throw new DomainError("Tệp quá lớn (tối đa 2 MB). Hãy tách thành nhiều tệp.", 413); return { buffer: Buffer.from(await file.arrayBuffer()), overwrite: form.get("overwrite") === "true" }; }
export async function handleImportPost<T, C>(req: NextRequest, actor: Actor, spec: ImportSpec<T, C>): Promise<Response> { const mode = new URL(req.url).searchParams.get("mode"); if (mode !== "preview" && mode !== "commit" && mode !== "rejects") throw new ValidationError("Chế độ nhập không hợp lệ."); const key = mode === "commit" ? readIdempotencyKey(req) : ""; const { buffer, overwrite } = await readImportUpload(req); if (mode === "preview") return Response.json(await previewImport(prisma, spec, buffer, { overwrite })); if (mode === "rejects") return xlsxResponse(`dong-bi-loai-${spec.entity.toLowerCase()}.xlsx`, await buildRejectXlsx(prisma, spec, buffer, { overwrite })); return Response.json(await commitImport(prisma, actor, spec, buffer, { overwrite, idempotencyKey: key })); }
export async function handleTemplateGet<T, C>(spec: ImportSpec<T, C>): Promise<Response> { return xlsxResponse(`mau-nhap-${spec.entity.toLowerCase()}.xlsx`, await buildTemplateXlsx(spec)); }
