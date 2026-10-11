import type { Prisma, PrismaClient } from "@prisma/client";
import type { CatalogKey } from "@/config/catalog-sections";
type Db = Prisma.TransactionClient | PrismaClient;
export type CatalogRow = { id: number; isActive: boolean } & Record<string, unknown>;
export interface Delegate { findMany(args?: object): Promise<CatalogRow[]>; findUnique(args: object): Promise<CatalogRow | null>; create(args: object): Promise<CatalogRow>; update(args: object): Promise<CatalogRow>; delete(args: object): Promise<unknown> }
const delegates: Record<CatalogKey, (db: Db) => unknown> = { "partner-groups": (db) => db.partnerGroup, "product-groups": (db) => db.productGroup, units: (db) => db.unit, warehouses: (db) => db.warehouse, vehicles: (db) => db.vehicle, drivers: (db) => db.driver, routes: (db) => db.route, "expense-types": (db) => db.expenseType, "cash-accounts": (db) => db.cashAccount, "processing-types": (db) => db.processingType };
export const delegate = (db: Db, key: CatalogKey): Delegate => delegates[key](db) as Delegate;
