export type FactoryStatus =
  | "needs_nfc"
  | "in_progress"
  | "ready"
  | "completed"
  | "manual_review";

export type FactoryOrderUnit = {
  id: string;
  unitOrdinal: number;
  allocationStatus: "unassigned" | "assigned";
};

export type FactoryOrderItem = {
  id: string;
  shopifyLineItemId: string | null;
  title: string | null;
  sku: string | null;
  quantity: number;
  isLumiEligible: true;
  units: FactoryOrderUnit[];
};

export type FactoryOrderCustomer = {
  name: string | null;
  email: string | null;
};

export type FactoryOrderSummary = {
  id: string;
  orderNumber: string;
  customer: FactoryOrderCustomer;
  shopifyCreatedAt: string | null;
  financialStatus: string;
  currency: string | null;
  totalPrice: string | null;
  lumiUnits: {
    total: number;
    assigned: number;
    unassigned: number;
  };
  factoryStatus: FactoryStatus;
};

export type FactoryOrderDetail = {
  id: string;
  orderNumber: string;
  customer: FactoryOrderCustomer & {
    authUserId: string | null;
  };
  financialStatus: string;
  shopifyCreatedAt: string | null;
  factoryStatus: FactoryStatus;
  items: FactoryOrderItem[];
};

export type FactoryOrderListResponse = {
  orders: FactoryOrderSummary[];
  nextPage: number | null;
};

export type FactoryOrderDetailResponse = {
  order: FactoryOrderDetail;
};
