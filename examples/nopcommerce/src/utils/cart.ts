export function parseHeaderCartQuantity(value: string): number {
  const normalizedValue = value.replace(/\s+/gu, " ").trim();
  const match = /\((\d+)\)$/u.exec(normalizedValue);

  if (match?.[1] === undefined) {
    throw new Error(
      `Invalid header cart quantity text: "${value}". Expected text ending in a quantity such as "Shopping cart (1)".`,
    );
  }

  const quantity = Number(match[1]);
  if (!Number.isSafeInteger(quantity)) {
    throw new Error(
      `Header cart quantity is outside safe integer range: "${value}".`,
    );
  }

  return quantity;
}

export function parseCartItemQuantity(value: string): number {
  const normalizedValue = value.trim();
  if (!/^\d+$/u.test(normalizedValue)) {
    throw new Error(
      `Invalid cart item quantity: "${value}". Expected a positive whole number.`,
    );
  }

  const quantity = Number(normalizedValue);
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new Error(
      `Invalid cart item quantity: "${value}". Expected a positive whole number.`,
    );
  }

  return quantity;
}
