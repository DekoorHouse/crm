export const PRODUCT_OPTIONS = [
  "Spiderman",
  "Rex",
  "Guerreras",
  "Muerto",
  "Especial",
] as const;

export type Product = (typeof PRODUCT_OPTIONS)[number];
