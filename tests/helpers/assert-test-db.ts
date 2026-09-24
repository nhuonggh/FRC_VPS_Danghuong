/**
 * Chốt an toàn cho mọi thao tác phá huỷ trên DB test (DROP SCHEMA, TRUNCATE ...).
 * Cả DATABASE_URL (app/test client) lẫn MIGRATE_DATABASE_URL (migrate) phải:
 *  - có tên DB kết thúc bằng "_test"
 *  - trỏ cùng host + port (không để một URL trỏ sang server khác)
 */
export function assertTestDatabaseUrls(
  env: Record<string, string | undefined> = process.env,
): void {
  const parse = (name: string) => {
    const raw = env[name];
    if (!raw) throw new Error(`Thiếu ${name} cho test`);
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      throw new Error(`${name} không phải URL hợp lệ`);
    }
    const dbName = decodeURIComponent(u.pathname.slice(1));
    if (!dbName.endsWith("_test")) {
      throw new Error(`Từ chối chạy test trên DB "${dbName}" của ${name} (tên phải kết thúc bằng _test)`);
    }
    return { host: u.hostname, port: u.port || "5432" };
  };

  const app = parse("DATABASE_URL");
  const migrate = parse("MIGRATE_DATABASE_URL");
  if (app.host !== migrate.host || app.port !== migrate.port) {
    throw new Error(
      `DATABASE_URL (${app.host}:${app.port}) và MIGRATE_DATABASE_URL (${migrate.host}:${migrate.port}) phải cùng host:port`,
    );
  }
}
