
import { prisma } from "@/lib/prisma";

import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { searchProducts } from "@/server/products/queries";

export const dynamic = "force-dynamic";

/** Tìm sản phẩm cho form BOM theo policy loại (role=target: thành phẩm; role=material: nguyên vật liệu). Chỉ cần `bom.manage`. */
export const GET = apiHandler(async (req) => {
  await requireActorApi("bom.manage");
  const sp = new URL(req.url).searchParams;
  const capability = sp.get("role") === "material" ? "canUseAsMaterial" : "canProduce";
  return searchProducts(prisma, { q: sp.get("q") ?? "", capability });
});
