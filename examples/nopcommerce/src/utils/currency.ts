const US_DOLLAR_PATTERN = /^\$(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?$/;
const DISPLAYED_CURRENCY_PATTERN =
  /^([^\d\s.,+-]+)\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{2}))?$/u;

export function parseCurrencyToMinorUnits(value: string): number {
  const normalizedValue = value.trim();
  const match = DISPLAYED_CURRENCY_PATTERN.exec(normalizedValue);

  if (match === null) {
    throw new Error(
      `Invalid displayed currency value: "${value}". Expected a symbol and value such as "$1,200.00".`,
    );
  }

  const wholeUnitText = match[2];
  if (wholeUnitText === undefined) {
    throw new Error(`Unable to parse displayed currency value: "${value}".`);
  }

  const wholeUnits = Number(wholeUnitText.replaceAll(",", ""));
  const fractionalUnits = Number(match[3] ?? "00");
  const minorUnits = wholeUnits * 100 + fractionalUnits;

  if (!Number.isSafeInteger(minorUnits) || minorUnits < 0) {
    throw new Error(`Unable to parse displayed currency value: "${value}".`);
  }

  return minorUnits;
}

export function parseUsdCurrency(value: string): number {
  const normalizedValue = value.trim();

  if (!US_DOLLAR_PATTERN.test(normalizedValue)) {
    throw new Error(
      `Invalid US-dollar currency value: "${value}". Expected a value such as "$1,200.00".`,
    );
  }

  const numericValue = Number(normalizedValue.slice(1).replaceAll(",", ""));

  if (!Number.isFinite(numericValue)) {
    throw new Error(`Unable to parse US-dollar currency value: "${value}".`);
  }

  return numericValue;
}

export function calculateSubtotalInCents(
  unitPriceInCents: number,
  quantity: number,
): number {
  if (!Number.isSafeInteger(unitPriceInCents) || unitPriceInCents < 0) {
    throw new Error("Unit price in cents must be a non-negative safe integer.");
  }

  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new Error("Cart quantity must be a positive safe integer.");
  }

  const subtotalInCents = unitPriceInCents * quantity;
  if (!Number.isSafeInteger(subtotalInCents)) {
    throw new Error("Calculated cart subtotal exceeds safe integer precision.");
  }

  return subtotalInCents;
}
