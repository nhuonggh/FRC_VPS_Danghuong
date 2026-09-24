import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAuditEntry, toAuditDetail } from "@/server/audit/queries";
import { requireActor } from "@/server/auth/session";
import { DomainError } from "@/server/http/errors";
import { AuditDetail } from "./AuditDetail";

const MAX_INT32 = 2_147_483_647;

export default async function AuditDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor("audit.view");
  const raw = (await params).id;
  const id = /^\d{1,10}$/.test(raw) ? Number(raw) : 0; // chỉ số nguyên dương thuần ("1e2", "0x10", "5abc" → 404)
  if (id <= 0 || id > MAX_INT32) notFound();
  const row = await getAuditEntry(prisma, id).catch((e) => { if (e instanceof DomainError && e.status === 404) notFound(); throw e; });
  const user = row.userId === null ? null : await prisma.user.findUnique({ where: { id: row.userId }, select: { fullName: true } });
  const by = row.userId === null ? "Hệ thống" : (user?.fullName ?? `#${row.userId}`);
  // toAuditDetail: redactDeep theo quyền NGƯỜI XEM rồi mới diff/định dạng — client không nhận JSON thô
  return <AuditDetail entry={toAuditDetail(row, by, actor.perms)} />;
}
