import { prisma } from "@/lib/prisma";
import { parseListParams } from "@/lib/query-params";
import { exportAuditXlsx } from "@/server/audit/export";
import { AUDIT_FILTER_KEYS } from "@/server/audit/queries";
import { requireActorApi } from "@/server/auth/session";
import { xlsxResponse } from "@/server/export/xlsx";
import { toErrorResponse } from "@/server/http/handler";

export const dynamic = "force-dynamic";

/**
 * Xuất nhật ký (xlsx): cùng bộ lọc với trang, cùng redaction theo quyền người xuất, tối đa MAX_EXPORT_ROWS dòng mới nhất.
 * Header `X-Export-Truncated: 1` khi bị cắt (file cũng có dòng ghi chú ở cuối).
 */
export async function GET(req: Request) {
  try {
    const actor = await requireActorApi("audit.view");
    // Gom cả khoá lặp (?user=1&user=2) — parseListParams nhận string | string[]
    const sp: Record<string, string[]> = Object.create(null);
    for (const [k, v] of new URL(req.url).searchParams) (sp[k] ??= []).push(v);
    const params = parseListParams(sp, AUDIT_FILTER_KEYS);
    const { buffer, rowCount, truncated } = await exportAuditXlsx(prisma, params, actor.perms);
    const res = xlsxResponse("nhat-ky-thao-tac.xlsx", buffer);
    res.headers.set("x-export-rows", String(rowCount));
    res.headers.set("x-export-truncated", truncated ? "1" : "0");
    return res;
  } catch (e) {
    return toErrorResponse(e);
  }
}
