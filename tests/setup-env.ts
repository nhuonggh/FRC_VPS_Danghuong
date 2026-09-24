import { config } from "dotenv";

// Không override biến đã có (CI truyền env trực tiếp).
// PHẢI chạy trước khi @prisma/client được import: client tự nạp ".env" (dev) và sẽ
// chiếm DATABASE_URL trước .env.test nếu để nó nạp trước.
config({ path: ".env.test", quiet: true });
