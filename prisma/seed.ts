import { PrismaClient } from "@prisma/client";
import { seed } from "./seed-lib";

const prisma = new PrismaClient();

seed(prisma, { bootstrapAdminPassword: process.env.BOOTSTRAP_ADMIN_PASSWORD || undefined })
  .then(() => console.log("Seed xong"))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
