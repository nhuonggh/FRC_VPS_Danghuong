import { requireActor } from "@/server/auth/session";

// Trang tạm cho tới Task 14 (Trang chủ = Module Selector + lời chào). Vẫn tự kiểm đăng nhập (layout không đủ).
export default async function Home() {
  await requireActor();
  return <h1 className="text-xl font-semibold">Trang chủ</h1>;
}
