import { normalizeEmail } from "@/lib/shopify/webhook";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ComplimentaryOrderInput = {
  idempotencyKey: string;
  purchaserEmail: string;
  purchaserName: string | null;
  sku: string;
  quantity: number;
  internalNote: string | null;
};

export function parseComplimentaryOrderForm(
  formData: FormData,
  eligibleSkus: ReadonlySet<string>
): ComplimentaryOrderInput {
  const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();
  const purchaserEmail = normalizeEmail(formData.get("purchaserEmail"));
  const purchaserNameValue = String(formData.get("purchaserName") ?? "").trim();
  const sku = String(formData.get("sku") ?? "").trim();
  const quantityValue = String(formData.get("quantity") ?? "").trim();
  const internalNoteValue = String(formData.get("internalNote") ?? "").trim();

  if (!UUID_PATTERN.test(idempotencyKey)) {
    throw new Error("Invalid complimentary-order request");
  }
  if (!purchaserEmail) {
    throw new Error("A valid friend email is required");
  }
  if (purchaserNameValue.length > 120) {
    throw new Error("Friend name must be 120 characters or fewer");
  }
  if (!eligibleSkus.has(sku)) {
    throw new Error("Choose an eligible Lumi SKU");
  }
  if (!/^\d+$/.test(quantityValue)) {
    throw new Error("Quantity must be between 1 and 20");
  }
  const quantity = Number(quantityValue);
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 20) {
    throw new Error("Quantity must be between 1 and 20");
  }
  if (internalNoteValue.length > 500) {
    throw new Error("Internal note must be 500 characters or fewer");
  }

  return {
    idempotencyKey,
    purchaserEmail,
    purchaserName: purchaserNameValue || null,
    sku,
    quantity,
    internalNote: internalNoteValue || null,
  };
}

export type ComplimentaryOrderCreationResult = {
  replayed: boolean;
  order_id: string;
  factory_reference: string;
  production_state: string;
};

export function parseComplimentaryOrderCreationResult(
  value: unknown
): ComplimentaryOrderCreationResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Complimentary order creation returned an invalid response");
  }
  const result = value as Record<string, unknown>;
  if (
    typeof result.replayed !== "boolean" ||
    typeof result.order_id !== "string" ||
    typeof result.factory_reference !== "string" ||
    typeof result.production_state !== "string"
  ) {
    throw new Error("Complimentary order creation returned an invalid response");
  }
  return result as ComplimentaryOrderCreationResult;
}
