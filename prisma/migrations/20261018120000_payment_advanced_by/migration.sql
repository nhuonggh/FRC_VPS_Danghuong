ALTER TABLE "payments" ADD COLUMN "advancedById" INTEGER;
ALTER TABLE "payments" ADD CONSTRAINT "payments_advancedById_fkey"
  FOREIGN KEY ("advancedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
