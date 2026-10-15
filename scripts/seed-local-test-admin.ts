import { PrismaClient } from "@prisma/client";
import { generateTempPassword, hashPassword, tempPasswordExpiry, validatePasswordStrength } from "../src/server/auth/password";

process.loadEnvFile(".env");

async function main() {
  const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
  if (process.env.NODE_ENV === "production" || databaseUrl.hostname !== "localhost" || databaseUrl.port !== "5432" || databaseUrl.pathname !== "/dh_dev_b") {
    throw new Error("Refusing to seed outside localhost:5432/dh_dev_b.");
  }

  const prisma = new PrismaClient();
  try {
    const existing = await prisma.user.findUnique({ where: { username: "test" }, select: { id: true } });
    if (existing) throw new Error("Username 'test' already exists; refusing to modify it.");

    const role = await prisma.role.findUnique({ where: { name: "Giám đốc" }, select: { id: true } });
    if (!role) throw new Error("Role 'Giám đốc' is missing; run the normal local seed first.");

    let password = generateTempPassword();
    while (validatePasswordStrength(password, "test")) password = generateTempPassword();

    const user = await prisma.user.create({
      data: {
        username: "test",
        fullName: "Tài khoản kiểm thử",
        passwordHash: await hashPassword(password),
        mustChangePassword: true,
        tempPasswordExpiresAt: tempPasswordExpiry(),
        roles: { create: { roleId: role.id } },
      },
      select: { id: true, username: true, tempPasswordExpiresAt: true },
    });

    console.log(JSON.stringify({ ...user, temporaryPassword: password }));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Local test-user seed failed.");
  process.exitCode = 1;
});
