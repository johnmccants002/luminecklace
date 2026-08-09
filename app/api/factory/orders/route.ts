import { authorizeFactoryRequest } from "@/lib/factory/auth";
import { createFactoryOrdersListHandler } from "@/lib/factory/handlers";
import { listFactoryOrders } from "@/lib/factory/orders";

export const runtime = "nodejs";

export const GET = createFactoryOrdersListHandler({
  authorize: authorizeFactoryRequest,
  listOrders: listFactoryOrders,
});
