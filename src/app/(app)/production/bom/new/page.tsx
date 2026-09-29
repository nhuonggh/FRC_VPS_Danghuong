import { BomNewForm, type BomFormDefaults } from "@/components/bom/BomNewForm";
import { prisma } from "@/lib/prisma";
import { ictYmd } from "@/lib/time";
import { getBom } from "@/server/bom";
import { requireActor } from "@/server/auth/session";

/** `?from=<bomId>`: nạp sẵn thành phẩm, kiểu gia công và dòng của phiên bản hiện hành để tạo phiên bản kế tiếp. */
export default async function NewBomPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireActor("bom.manage");
  const now = new Date();
  const from = Number((await searchParams).from);
  const defaults: BomFormDefaults = { product: null, processingType: null, lines: [], hasVersions: false };

  if (Number.isInteger(from) && from > 0 && from <= 2_147_483_647) {
    const bom = await getBom(prisma, from, now).catch(() => null);
    if (bom) {
      const base = bom.versions.find((v) => v.isCurrent) ?? bom.versions.find((v) => v.status === "ACTIVE") ?? bom.versions[0];
      defaults.product = { value: bom.productId, label: `${bom.productCode} — ${bom.productName}` };
      defaults.processingType = { value: bom.processingTypeId, label: bom.processingType };
      defaults.hasVersions = bom.versions.length > 0;
      defaults.lines = (base?.lines ?? []).map((l) => ({
        material: { value: l.materialProductId, label: `${l.materialCode} — ${l.materialName}`, baseUnit: l.baseUnit },
        qtyPerUnit: Number(l.qtyPerUnit),
      }));
    }
  }
  return <BomNewForm today={ictYmd(now)} defaults={defaults} />;
}
