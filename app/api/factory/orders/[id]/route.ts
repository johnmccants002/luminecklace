import { authorizeFactoryRequest } from "@/lib/factory/auth";
import { createFactoryOrderDetailHandler } from "@/lib/factory/handlers";
import { getFactoryOrderById } from "@/lib/factory/orders";

export const runtime = "nodejs";

export const GET = createFactoryOrderDetailHandler({
  authorize: authorizeFactoryRequest,
  getOrder: getFactoryOrderById,
});
