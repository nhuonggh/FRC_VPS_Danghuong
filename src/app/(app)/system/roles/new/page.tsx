import { requireActor } from "@/server/auth/session";
import { NewRoleForm } from "./NewRoleForm";

export default async function NewRolePage() {
  await requireActor("role.manage");
  return <NewRoleForm />;
}
