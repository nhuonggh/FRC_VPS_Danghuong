import { prisma } from "@/lib/prisma";
import { requireActor } from "@/server/auth/session";
import { NewUserForm } from "./NewUserForm";

export default async function NewUserPage() {
  await requireActor("user.manage");
  const roles = await prisma.role.findMany({ orderBy: { id: "asc" }, select: { id: true, name: true, description: true } });
  return <NewUserForm roles={roles} />;
}
