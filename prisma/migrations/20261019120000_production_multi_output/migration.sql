ALTER TABLE production_orders ADD COLUMN "allocationBasis" TEXT NOT NULL DEFAULT 'WEIGHT';
ALTER TABLE production_materials ADD COLUMN "widthMm" DECIMAL(18,3);
ALTER TABLE cost_layers ADD COLUMN "costRefShare" DECIMAL(18,12) NOT NULL DEFAULT 1;
ALTER TABLE cost_layers ADD CONSTRAINT cost_layers_share_check CHECK ("costRefShare" > 0 AND "costRefShare" <= 1);
CREATE TABLE production_outputs (
 id SERIAL PRIMARY KEY,
 "orderId" INTEGER NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE ON UPDATE CASCADE,
 "productId" INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 qty DECIMAL(18,3) NOT NULL CHECK (qty > 0),
 "widthMm" DECIMAL(18,3),
 "stripCount" INTEGER NOT NULL DEFAULT 1 CHECK ("stripCount" > 0),
 "lengthM" DECIMAL(18,3),
 "allocationWeight" DECIMAL(18,3) NOT NULL CHECK ("allocationWeight" > 0),
 seq BIGINT,
 CONSTRAINT "production_outputs_orderId_productId_key" UNIQUE ("orderId", "productId")
);
CREATE INDEX "production_outputs_productId_idx" ON production_outputs("productId");
-- Backfill historical outputs without changing their ledger references or sequence.
INSERT INTO production_outputs ("orderId", "productId", qty, "allocationWeight", seq)
SELECT id, "productId", qty, 1, "outSeq" FROM production_orders;
