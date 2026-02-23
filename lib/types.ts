export type Finish = "Gold" | "Silver";
export type ChainLength = "16\"" | "18\"";

export type VariantOptions = {
  finish: Finish;
  chainLength: ChainLength;
};

export type Product = {
  id: string;
  name: string;
  price: number;
  currency: string;
  description: string;
  benefits: string[];
  finishes: Finish[];
  chainLengths: ChainLength[];
  images: { src: string; alt: string }[];
};

export type CartItem = {
  id: string;
  productId: string;
  name: string;
  quantity: number;
  price: number;
  image: string;
  variants: VariantOptions;
};
