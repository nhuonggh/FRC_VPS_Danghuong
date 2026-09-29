import type { ProductKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { BOM_MATERIAL_KINDS, BOM_TARGET_KINDS } from "@/server/bom/schemas";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { searchProducts } from "@/server/products/queries";

export const dynamic = "force-dynamic";

/** Tìm sản phẩm cho form BOM theo policy loại (role=target: thành phẩm; role=material: nguyên vật liệu). Chỉ cần `bom.manage`. */
export const GET = apiHandler(async (req) => {
  await requireActorApi("bom.manage");
  const sp = new URL(req.url).searchParams;
  const kinds = (sp.get("role") === "material" ? BOM_MATERIAL_KINDS : BOM_TARGET_KINDS) as readonly ProductKind[];
  return searchProducts(prisma, { q: sp.get("q") ?? "", kinds: [...kinds] });
});
