import { prisma } from "@/lib/prisma";
import { requireActor } from "@/server/auth/session";
import { listRoles } from "@/server/roles/queries";
import { NewRoleForm } from "./NewRoleForm";

export default async function NewRolePage() {
  await requireActor("role.manage");
  const roles = await listRoles(prisma);
  return <NewRoleForm sourceRoles={roles.map((r) => ({ id: r.id, name: r.name, permissionCount: r.permissionCount }))} />;
}
