import type {
  FactoryOrderDetail,
  FactoryOrderListResponse,
} from "@/lib/factory/types";
import {
  FactoryApiError,
  parseFactoryOrderId,
  parseFactoryOrderListInput,
  parseFactoryOrderNumber,
  type FactoryOrderListInput,
} from "@/lib/factory/validation";

type Authorize = (req: Request) => Promise<unknown>;

function factoryErrorResponse(error: unknown, operation: string) {
  if (error instanceof FactoryApiError) {
    return Response.json({ error: error.message }, { status: error.status });
  }

  console.error("Factory API request failed", {
    operation,
    errorType: error instanceof Error ? error.name : "unknown",
  });
  return Response.json({ error: "Internal server error" }, { status: 500 });
}

export function createFactoryOrdersListHandler(deps: {
  authorize: Authorize;
  listOrders: (input: FactoryOrderListInput) => Promise<FactoryOrderListResponse>;
}) {
  return async function GET(req: Request) {
    try {
      await deps.authorize(req);
      const input = parseFactoryOrderListInput(new URL(req.url));
      return Response.json(await deps.listOrders(input));
    } catch (error) {
      return factoryErrorResponse(error, "list_orders");
    }
  };
}
export function createFactoryOrderDetailHandler(deps: {
  authorize: Authorize;
  getOrder: (id: string) => Promise<FactoryOrderDetail | null>;
}) {
  return async function GET(
    req: Request,
    context: { params: Promise<{ id: string }> }
  ) {
    try {
      await deps.authorize(req);
      const id = parseFactoryOrderId((await context.params).id);
      const order = await deps.getOrder(id);
      if (!order) throw new FactoryApiError("Order not found", 404);
      return Response.json({ order });
    } catch (error) {
      return factoryErrorResponse(error, "get_order");
    }
  };
}

export function createFactoryOrderLookupHandler(deps: {
  authorize: Authorize;
  getOrder: (orderNumber: string) => Promise<FactoryOrderDetail | null>;
}) {
  return async function GET(req: Request) {
    try {
      await deps.authorize(req);
      const orderNumber = parseFactoryOrderNumber(
        new URL(req.url).searchParams.get("orderNumber")
      );
      const order = await deps.getOrder(orderNumber);
      if (!order) throw new FactoryApiError("Order not found", 404);
      return Response.json({ order });
    } catch (error) {
      return factoryErrorResponse(error, "lookup_order");
    }
  };
}
