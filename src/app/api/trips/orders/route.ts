import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { searchTripOrders } from "@/server/trips/queries";

export const GET = apiHandler(async (req) => searchTripOrders(prisma, await requireActorApi("trip.manage"), (new URL(req.url).searchParams.get("q") ?? "").slice(0, 100)));
