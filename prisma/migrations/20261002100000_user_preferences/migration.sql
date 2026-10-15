-- Cấu hình giao diện theo tài khoản (module tabs). Chỉ thêm bảng, không đụng dữ liệu cũ.
-- CreateTable
CREATE TABLE "user_preferences" (
    "userId" INTEGER NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
