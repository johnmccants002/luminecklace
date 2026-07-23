declare module "json-bigint" {
  type JsonBigIntOptions = {
    storeAsString?: boolean;
    strict?: boolean;
  };

  type JsonBigIntParser = {
    parse(text: string): unknown;
    stringify(value: unknown): string;
  };

  export default function JSONBigInt(options?: JsonBigIntOptions): JsonBigIntParser;
}
