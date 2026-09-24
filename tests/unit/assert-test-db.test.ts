import { describe, expect, it } from "vitest";
import { assertTestDatabaseUrls } from "../helpers/assert-test-db";

const ok = {
  DATABASE_URL: "postgresql://u:p@localhost:5434/dh_test",
  MIGRATE_DATABASE_URL: "postgresql://u:p@localhost:5434/dh_test",
};

describe("assertTestDatabaseUrls", () => {
  it("chấp nhận 2 URL cùng host:port và DB kết thúc _test", () => {
    expect(() => assertTestDatabaseUrls(ok)).not.toThrow();
  });

  it("từ chối DATABASE_URL có DB không phải _test", () => {
    expect(() =>
      assertTestDatabaseUrls({ ...ok, DATABASE_URL: "postgresql://u:p@localhost:5434/dh_dev_b" }),
    ).toThrow(/DATABASE_URL.*_test/);
  });

  it("từ chối MIGRATE_DATABASE_URL có DB không phải _test", () => {
    expect(() =>
      assertTestDatabaseUrls({ ...ok, MIGRATE_DATABASE_URL: "postgresql://u:p@localhost:5434/dh_dev" }),
    ).toThrow(/MIGRATE_DATABASE_URL.*_test/);
  });

  it("từ chối khác port", () => {
    expect(() =>
      assertTestDatabaseUrls({ ...ok, DATABASE_URL: "postgresql://u:p@localhost:5432/dh_test" }),
    ).toThrow(/cùng host:port/);
  });

  it("từ chối khác host", () => {
    expect(() =>
      assertTestDatabaseUrls({ ...ok, DATABASE_URL: "postgresql://u:p@db.example.com:5434/dh_test" }),
    ).toThrow(/cùng host:port/);
  });

  it("từ chối khi thiếu biến hoặc URL sai", () => {
    expect(() => assertTestDatabaseUrls({ MIGRATE_DATABASE_URL: ok.MIGRATE_DATABASE_URL })).toThrow(/Thiếu DATABASE_URL/);
    expect(() => assertTestDatabaseUrls({ DATABASE_URL: ok.DATABASE_URL })).toThrow(/Thiếu MIGRATE_DATABASE_URL/);
    expect(() => assertTestDatabaseUrls({ ...ok, DATABASE_URL: "not a url" })).toThrow(/không phải URL/);
  });

  it("không bị lừa bởi tên DB chứa _test ở giữa", () => {
    expect(() =>
      assertTestDatabaseUrls({ ...ok, DATABASE_URL: "postgresql://u:p@localhost:5434/dh_test_backup" }),
    ).toThrow(/_test/);
  });
});
