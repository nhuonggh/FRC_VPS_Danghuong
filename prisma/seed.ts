import { PrismaClient } from "@prisma/client";
import { seed } from "./seed-lib";
import { seedCustomerData } from "./seed-customer";
import { seedProductSync } from "./seed-products";

const prisma = new PrismaClient();

seed(prisma, {
  bootstrapAdminPassword: process.env.BOOTSTRAP_ADMIN_PASSWORD || undefined,
  bootstrapAdminEmail: process.env.BOOTSTRAP_ADMIN_EMAIL || undefined,
})
  .then(() => seedCustomerData(prisma, { log: console.log }))
  .then(() => seedProductSync(prisma, { log: console.log }))
  .then(() => console.log("Seed xong"))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
