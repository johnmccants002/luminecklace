import { authorizeFactoryRequest } from "@/lib/factory/auth";
import { createFactoryOrderLookupHandler } from "@/lib/factory/handlers";
import { getFactoryOrderByNumber } from "@/lib/factory/orders";

export const runtime = "nodejs";

export const GET = createFactoryOrderLookupHandler({
  authorize: authorizeFactoryRequest,
  getOrder: getFactoryOrderByNumber,
});
