import Link from "next/link";
import { Badge } from "@/components/ui";
import { formatNumber } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/server/auth/session";
import { migrationStatus } from "@/server/opening/migration-status";

export const dynamic = "force-dynamic";

export default async function DataMigrationPage() {
  await requireActor("data.import");
  const { steps, periodName, hasDocs } = await migrationStatus(prisma);
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-xl font-semibold">Chuyển dữ liệu từ phần mềm cũ</h1>
      <p className="text-sm text-fg-secondary">Làm lần lượt từ trên xuống. Mỗi bước có <strong>xem trước</strong> (số dòng hợp lệ / lỗi / trùng), tải tệp dòng bị loại, rồi mới ghi khi bạn bấm xác nhận. Chạy lại cùng tệp không tạo bản ghi trùng. Kỳ hiện tại: <strong>{periodName}</strong>.</p>
      {hasDocs && <div role="status" className="rounded-sm border border-warning bg-warning-soft p-3 text-sm">Kỳ này đã có chứng từ nên các bước số đầu kỳ (6–10) bị chặn với người không phải giám đốc.</div>}
      <ol className="divide-y divide-border rounded-md border border-border bg-surface">
        {steps.map((s) => (
          <li key={s.key} className="flex flex-wrap items-center justify-between gap-3 p-3">
            <div className="min-w-0 flex-1"><p className="font-medium"><span className="mr-2 text-fg-muted">{s.order}.</span>{s.title}</p><p className="text-sm text-fg-secondary">{s.hint}</p></div>
            <div className="flex items-center gap-3"><Badge tone={s.count > 0 ? "success" : "neutral"}>{formatNumber(s.count)} {s.unit}</Badge><Link href={s.href} className="flex h-11 items-center rounded-sm border border-border px-3 text-sm font-medium hover:bg-hover md:h-10">Mở</Link></div>
          </li>
        ))}
      </ol>
    </div>
  );
}
