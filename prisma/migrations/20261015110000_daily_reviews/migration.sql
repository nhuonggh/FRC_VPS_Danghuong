CREATE TABLE "daily_reviews" (
  "userId" INTEGER NOT NULL,
  "day" DATE NOT NULL,
  "itemKey" TEXT NOT NULL,
  "seenAt" TIMESTAMP(3),
  "seenVersion" TEXT,
  "checkedAt" TIMESTAMP(3),
  "checkedVersion" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "daily_reviews_pkey" PRIMARY KEY ("userId", "day", "itemKey"),
  CONSTRAINT "daily_reviews_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "daily_reviews_item_key_chk" CHECK ("itemKey" IN ('return-order','return-product','return-supplier','undelivered','loss','debt','discount-orders','settlements','receipts','payments','purchases')),
  CONSTRAINT "daily_reviews_seen_pair_chk" CHECK (("seenAt" IS NULL) = ("seenVersion" IS NULL)),
  CONSTRAINT "daily_reviews_checked_pair_chk" CHECK (("checkedAt" IS NULL) = ("checkedVersion" IS NULL))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON "daily_reviews" TO app_rw;
