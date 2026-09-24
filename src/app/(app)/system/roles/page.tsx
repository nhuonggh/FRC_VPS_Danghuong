import { Plus } from "lucide-react";
import Link from "next/link";
import { EmptyState, ListPageLayout, PaginationFooter } from "@/components/ui";
import { buildListHref, parseListParams } from "@/lib/query-params";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/server/auth/session";
import { listRoles } from "@/server/roles/queries";
import { RolesTable } from "./RolesTable";

export default async function RolesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor("role.manage");
  const params = parseListParams(await searchParams);
  const all = await listRoles(prisma); // số nhóm quyền nhỏ (vài chục) → phân trang trong bộ nhớ
  const start = (params.page - 1) * params.pageSize;
  const rows = all.slice(start, start + params.pageSize);
  return (
    <ListPageLayout title="Nhóm quyền"
      actions={<Link href="/system/roles/new" className="flex h-11 items-center gap-2 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent md:h-10"><Plus size={16} aria-hidden /> Thêm mới</Link>}
      footer={<PaginationFooter total={all.length} page={params.page} pageSize={params.pageSize} buildHref={(p) => buildListHref("/system/roles", params, p)} />}>
      {all.length === 0
        ? <EmptyState kind="empty" title="Chưa có nhóm quyền" />
        // Liên kết sang danh sách người dùng chỉ khi người xem có user.view (nếu không sẽ dẫn tới trang 403)
        : <RolesTable rows={rows} canViewUsers={actor.perms.has("user.view")} />}
    </ListPageLayout>
  );
}
