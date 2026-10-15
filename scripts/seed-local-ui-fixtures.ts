import { PrismaClient } from "@prisma/client";
import { normalizeSearch } from "../src/lib/search";
import { toIct } from "../src/lib/time";
import { createDeliveryNoteIdempotent } from "../src/server/delivery/service";
import { deliveryNoteSchema } from "../src/server/delivery/schemas";
import { getOnHand } from "../src/server/inventory";
import { createPurchaseIdempotent } from "../src/server/purchase/service";
import { purchaseInputSchema } from "../src/server/purchase/schemas";
import { createQuoteIdempotent } from "../src/server/quotes/service";
import { quoteSchema } from "../src/server/quotes/schemas";
import { createReturnByOrderIdempotent } from "../src/server/returns/service";
import { returnByOrderSchema } from "../src/server/returns/schemas";
import { createSaleOrderIdempotent } from "../src/server/sales/service";
import { saleOrderSchema } from "../src/server/sales/schemas";

process.loadEnvFile(".env");

const DATABASE_HOST = "localhost";
const DATABASE_PORT = "5432";
const DATABASE_NAME = "dh_dev_b";
const CUSTOMER_CODE = "U6-CUS-001";
const SUPPLIER_CODE = "U6-SUP-001";
const PRODUCT_CODE = "U6-TON-001";
const FIXTURE_GROUP = "Nhóm khách mẫu giao diện";

function ictDate(date: Date): string {
  const time = toIct(date);
  return `${time.y}-${String(time.m + 1).padStart(2, "0")}-${String(time.d).padStart(2, "0")}`;
}

async function main() {
  const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
  if (
    process.env.NODE_ENV === "production" ||
    databaseUrl.hostname !== DATABASE_HOST ||
    databaseUrl.port !== DATABASE_PORT ||
    databaseUrl.pathname !== `/${DATABASE_NAME}`
  ) {
    throw new Error(`Refusing to seed outside ${DATABASE_HOST}:${DATABASE_PORT}/${DATABASE_NAME}.`);
  }

  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { username: "test" }, select: { id: true } });
    if (!user) throw new Error("Local user 'test' is missing; run the local test-admin seed first.");
    const period = await prisma.period.findFirst({ where: { isOpen: true }, select: { id: true } });
    if (!period) throw new Error("No open period found; run the normal local seed first.");

    const group = await prisma.partnerGroup.upsert({
      where: { name: FIXTURE_GROUP },
      update: { isActive: true },
      create: { name: FIXTURE_GROUP },
    });
    const customerName = "Công ty Cơ khí An Nhiên";
    const supplierName = "Công ty Tôn thép Bình Minh";
    const customer = await prisma.partner.upsert({
      where: { code: CUSTOMER_CODE },
      update: { name: customerName, searchText: normalizeSearch(customerName), groupId: group.id, isCustomer: true, isSupplier: false, isActive: true },
      create: { code: CUSTOMER_CODE, name: customerName, searchText: normalizeSearch(customerName), groupId: group.id, isCustomer: true },
    });
    const supplier = await prisma.partner.upsert({
      where: { code: SUPPLIER_CODE },
      update: { name: supplierName, searchText: normalizeSearch(supplierName), groupId: group.id, isCustomer: false, isSupplier: true, isActive: true },
      create: { code: SUPPLIER_CODE, name: supplierName, searchText: normalizeSearch(supplierName), groupId: group.id, isCustomer: false, isSupplier: true },
    });
    const productName = "Tôn mạ kẽm 0,45 mm";
    const product = await prisma.product.upsert({
      where: { code: PRODUCT_CODE },
      update: { name: productName, searchText: normalizeSearch(productName), kind: "HANG", baseUnit: "md", minStock: 1, isActive: true },
      create: { code: PRODUCT_CODE, name: productName, searchText: normalizeSearch(productName), kind: "HANG", baseUnit: "md", minStock: 1 },
    });

    const today = ictDate(new Date());
    const actor = {
      userId: user.id,
      perms: new Set([
        "partner.view_all", "purchase.create", "purchase_price.view", "order.create", "order.edit", "order.edit_price",
        "sale_price.view", "quote.manage", "return.manage", "cost.view", "stock.view",
      ]),
    };

    const purchase = await createPurchaseIdempotent(prisma, actor, "u6-local-purchase-v1", purchaseInputSchema.parse({
      partnerId: supplier.id, date: today, freightCost: 0, note: "Fixture local U6", lines: [
        { productId: product.id, qty: 12, unit: product.baseUnit, factor: 1, purchasePrice: 58_000, rollInfo: "" },
      ],
    }));
    const quote = await createQuoteIdempotent(prisma, actor, "u6-local-quote-v1", quoteSchema.parse({
      partnerId: customer.id, date: today, note: "Báo giá mẫu phục vụ kiểm thử giao diện.", lines: [
        { productId: product.id, qty: 2, unit: product.baseUnit, salePrice: 89_000, note: "" },
      ],
    }));
    const order = await createSaleOrderIdempotent(prisma, actor, "u6-local-sale-v1", saleOrderSchema.parse({
      partnerId: customer.id, date: today, expectedDeliveryDate: today, note: "Đơn mẫu phục vụ kiểm thử giao diện.", lines: [
        { productId: product.id, qty: 2, unit: product.baseUnit, salePrice: 89_000, discountNow: 0, discountAccum: 0, processingTypeId: null },
      ],
    }));
    const orderLine = await prisma.saleOrderLine.findFirstOrThrow({ where: { orderId: order.id }, select: { id: true } });
    const delivery = await createDeliveryNoteIdempotent(prisma, actor, "u6-local-delivery-v1", deliveryNoteSchema.parse({
      orderId: order.id, date: today, note: "Giao mẫu kiểm thử.", lines: [{ orderLineId: orderLine.id, qty: 2 }],
    }));
    const returned = await createReturnByOrderIdempotent(prisma, actor, "u6-local-return-v1", returnByOrderSchema.parse({
      orderId: order.id, date: today, note: "Trả mẫu kiểm thử.", lines: [{ orderLineId: orderLine.id, qty: 1 }],
    }));

    const [purchaseRecord, quoteRecord, orderRecord, deliveryRecord, returnRecord, onHand] = await Promise.all([
      prisma.purchase.findUniqueOrThrow({ where: { id: purchase.id }, include: { lines: true } }),
      prisma.quote.findUniqueOrThrow({ where: { id: quote.id }, include: { lines: true } }),
      prisma.saleOrder.findUniqueOrThrow({ where: { id: order.id }, include: { lines: true, deliveries: true, goodsReturns: true } }),
      prisma.deliveryNote.findUniqueOrThrow({ where: { id: delivery.id }, include: { lines: true } }),
      prisma.goodsReturn.findUniqueOrThrow({ where: { id: returned.id }, include: { lines: true } }),
      getOnHand(prisma, period.id, product.id),
    ]);
    if (purchaseRecord.lines.length !== 1 || quoteRecord.lines.length !== 1 || orderRecord.lines.length !== 1) {
      throw new Error("Fixture validation failed: purchase, quote, and sale order must each have one line.");
    }
    if (deliveryRecord.lines.length !== 1 || returnRecord.lines.length !== 1 || returnRecord.orderId !== orderRecord.id) {
      throw new Error("Fixture validation failed: delivery/return lines or order relation are missing.");
    }
    if (orderRecord.deliveryStatus !== "DELIVERED" || !onHand.eq(11)) {
      throw new Error(`Fixture validation failed: delivery=${orderRecord.deliveryStatus}, onHand=${onHand.toString()} (expected 11).`);
    }

    console.log(JSON.stringify({
      customer: { code: customer.code, name: customer.name },
      supplier: { code: supplier.code, name: supplier.name },
      product: { code: product.code, name: product.name },
      purchase: { id: purchaseRecord.id, code: purchaseRecord.code, lines: purchaseRecord.lines.length },
      quote: { id: quoteRecord.id, code: quoteRecord.code, lines: quoteRecord.lines.length },
      order: { id: orderRecord.id, code: orderRecord.code, status: orderRecord.deliveryStatus },
      delivery: { id: deliveryRecord.id, code: deliveryRecord.code, lines: deliveryRecord.lines.length },
      returned: { id: returnRecord.id, code: returnRecord.code, orderId: returnRecord.orderId, lines: returnRecord.lines.length },
      onHand: onHand.toString(),
      pages: {
        order: `/sales/orders/${order.id}`,
        quote: `/sales/quotes/${quote.id}`,
        return: `/returns/${returned.id}`,
      },
    }));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Local UI fixture seed failed.");
  process.exitCode = 1;
});
