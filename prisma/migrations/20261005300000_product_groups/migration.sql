-- Nhóm hàng của sản phẩm (tuỳ chọn). Chỉ thêm bảng + cột nullable.
CREATE TABLE "product_groups" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "product_groups_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "product_groups_name_key" ON "product_groups"("name");

ALTER TABLE "products" ADD COLUMN "groupId" INTEGER;

CREATE INDEX "products_groupId_idx" ON "products"("groupId");

ALTER TABLE "products" ADD CONSTRAINT "products_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "product_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- app_rw: cùng quyền như các bảng danh mục khác (idempotent)
GRANT SELECT, INSERT, UPDATE, DELETE ON "product_groups" TO app_rw;
GRANT USAGE, SELECT ON SEQUENCE "product_groups_id_seq" TO app_rw;
