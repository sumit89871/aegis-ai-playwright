const US_DOLLAR_PATTERN = /^\$(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?$/;

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
