import { requireActor } from "@/server/auth/session";
import { ChangePasswordForm } from "./ChangePasswordForm";
import { SignOutButton } from "./SignOutButton";

// NGOÀI nhóm (app): layout (app) chuyển tài khoản mustChangePassword sang đây — đặt trong (app) sẽ redirect vòng lặp.
export default async function ChangePasswordPage() {
  const actor = await requireActor();
  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-sm rounded-md border border-border bg-surface p-6">
        <h1 className="mb-1 text-xl font-semibold">Đổi mật khẩu</h1>
        {actor.mustChangePassword && (
          <p className="mb-4 text-sm text-warning">Bạn cần đổi mật khẩu trước khi sử dụng hệ thống.</p>
        )}
        <ChangePasswordForm forced={actor.mustChangePassword} />
        <SignOutButton />
      </div>
    </main>
  );
}
