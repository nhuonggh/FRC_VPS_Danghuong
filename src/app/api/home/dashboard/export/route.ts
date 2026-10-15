import { requireActorApi } from "@/server/auth/session";
import { prisma } from "@/lib/prisma";
import { parseListParams } from "@/lib/query-params";
import { resolveAccountingSection } from "@/lib/accounting-dashboard";
import { formatDateTime } from "@/lib/format";
import { isDashTabKey, loadDashboard, visibleDashTabs } from "@/server/home/dashboard";
import { exportDashboard } from "@/server/home/dashboard/export";
import { dashRange } from "@/server/home/dashboard/common";
import { xlsxResponse } from "@/server/export/xlsx";
import { DomainError } from "@/server/http/errors";
import { toErrorResponse } from "@/server/http/handler";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    const actor = await requireActorApi();
    const url = new URL(req.url), tab = url.searchParams.get("tab") ?? "";
    if (!isDashTabKey(tab)) throw new DomainError("Không tìm thấy báo cáo.", 404);
    const def = visibleDashTabs(actor).find((t) => t.key === tab);
    if (!def) throw new DomainError("Bạn không có quyền xem báo cáo này.", 403);
    const query: Record<string, string[]> = {};
    for (const [k, v] of url.searchParams) (query[k] ??= []).push(v);
    const params = parseListParams(query, ["accountingSection", "bankAccount"]), now = new Date();
    const section = tab === "accounting" ? resolveAccountingSection(actor.perms, params.filters.accountingSection?.[0]) : undefined;
    const preset = params.timePreset ?? (tab === "accounting" ? "today" : "thisMonth");
    const range = dashRange(preset, { start: params.timeStart, end: params.timeEnd }, now);
    const data = await loadDashboard(prisma, actor, tab, { preset, start: params.timeStart, end: params.timeEnd, bankAccount: params.filters.bankAccount?.[0], accountingSection: section?.key }, now);
    return xlsxResponse(`tong-quan-${tab}.xlsx`, await exportDashboard(data, [
      { key: "Báo cáo", value: `${def.label}${section ? ` · ${section.label}` : ""}` },
      { key: "Xuất lúc (UTC+7)", value: formatDateTime(now) }, { key: "Tiền tệ", value: "VND" },
      { key: "Thời gian", value: def.snapshot || section?.snapshot ? "Số dư hiện tại trong kỳ đang mở, tại thời điểm xuất" : `${formatDateTime(range.start)} – ${formatDateTime(range.end)} (không gồm mốc kết thúc)` },
      { key: "Tài khoản được lọc", value: section?.key === "bank" ? params.filters.bankAccount?.[0] ?? "Tất cả" : "Không áp dụng" },
    ]));
  } catch (error) { return toErrorResponse(error); }
}
