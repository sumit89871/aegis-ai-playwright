const REDACTED_VALUE = "[REDACTED]";

const SENSITIVE_HEADER_NAMES = new Set([
  "api-key",
  "authorization",
  "cookie",
  "proxy-authorization",
  "set-cookie",
  "x-api-key",
]);

const SENSITIVE_PARAMETER_TERMS = [
  "access_token",
  "refresh_token",
  "authorization",
  "password",
  "session",
  "apikey",
  "api_key",
  "passwd",
  "secret",
  "token",
  "auth",
  "code",
  "key",
  "pwd",
] as const;

export const DEFAULT_MAX_URL_LENGTH = 2_048;
export const DEFAULT_MAX_TEXT_LENGTH = 2_000;

export type DiagnosticHeaderValue = string | readonly string[];
export type DiagnosticHeaders = Readonly<
  Record<string, DiagnosticHeaderValue | undefined>
>;

export function truncateText(value: string, maximumLength: number): string {
  if (!Number.isInteger(maximumLength) || maximumLength < 1) {
    throw new Error("maximumLength must be a positive integer.");
  }

  if (value.length <= maximumLength) {
    return value;
  }

  const suffix = "...[truncated]";
  if (maximumLength <= suffix.length) {
    return value.slice(0, maximumLength);
  }

  return `${value.slice(0, maximumLength - suffix.length)}${suffix}`;
}

function isSensitiveParameterName(name: string): boolean {
  const normalizedName = name.toLowerCase().replaceAll("-", "_");
  return SENSITIVE_PARAMETER_TERMS.some((term) =>
    normalizedName.includes(term),
  );
}

function decodeParameterName(value: string): string {
  try {
    return decodeURIComponent(value.replaceAll("+", " "));
  } catch {
    return value;
  }
}

function redactParameterList(value: string): string {
  return value
    .split("&")
    .map((parameter) => {
      const equalsIndex = parameter.indexOf("=");
      const rawName =
        equalsIndex === -1 ? parameter : parameter.slice(0, equalsIndex);

      if (!isSensitiveParameterName(decodeParameterName(rawName))) {
        return parameter;
      }

      return `${rawName}=${encodeURIComponent(REDACTED_VALUE)}`;
    })
    .join("&");
}

export function redactSensitiveText(
  value: string,
  maximumLength = DEFAULT_MAX_TEXT_LENGTH,
): string {
  const withoutUrlCredentials = value.replace(
    /([a-z][a-z\d+.-]*:\/\/)[^/@\s]+@/giu,
    "$1",
  );
  const withoutSensitiveHeaders = withoutUrlCredentials.replace(
    /\b(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key)\s*[:=]\s*[^\r\n]+/giu,
    `$1=${REDACTED_VALUE}`,
  );
  const withoutSensitiveValues = withoutSensitiveHeaders.replace(
    /\b([\w.-]*(?:access_token|refresh_token|authorization|password|session|apikey|api_key|passwd|secret|token|auth|code|key|pwd)[\w.-]*)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s&,;]+)/giu,
    `$1=${REDACTED_VALUE}`,
  );

  return truncateText(withoutSensitiveValues, maximumLength);
}

function sanitizeMalformedUrl(value: string): string {
  const withoutCredentials = value.replace(
    /^([a-z][a-z\d+.-]*:\/\/)[^/@\s]+@/iu,
    "$1",
  );
  const queryIndex = withoutCredentials.indexOf("?");

  if (queryIndex === -1) {
    return redactSensitiveText(withoutCredentials, Number.MAX_SAFE_INTEGER);
  }

  const prefix = withoutCredentials.slice(0, queryIndex + 1);
  const queryAndFragment = withoutCredentials.slice(queryIndex + 1);
  const fragmentIndex = queryAndFragment.indexOf("#");
  const query =
    fragmentIndex === -1
      ? queryAndFragment
      : queryAndFragment.slice(0, fragmentIndex);
  const fragment =
    fragmentIndex === -1 ? "" : queryAndFragment.slice(fragmentIndex + 1);
  const sanitizedFragment =
    fragment.length === 0 ? "" : `#${redactParameterList(fragment)}`;

  return `${prefix}${redactParameterList(query)}${sanitizedFragment}`;
}

export function sanitizeUrl(
  value: string,
  maximumLength = DEFAULT_MAX_URL_LENGTH,
): string {
  try {
    const parsedUrl = new URL(value);
    parsedUrl.username = "";
    parsedUrl.password = "";

    const queryEntries = [...parsedUrl.searchParams.entries()];
    parsedUrl.search = "";
    for (const [name, parameterValue] of queryEntries) {
      parsedUrl.searchParams.append(
        name,
        isSensitiveParameterName(name) ? REDACTED_VALUE : parameterValue,
      );
    }

    if (parsedUrl.hash.length > 1) {
      parsedUrl.hash = redactParameterList(parsedUrl.hash.slice(1));
    }

    return truncateText(parsedUrl.toString(), maximumLength);
  } catch {
    return truncateText(sanitizeMalformedUrl(value), maximumLength);
  }
}

export function redactHeaders(
  headers: DiagnosticHeaders,
): Readonly<Record<string, DiagnosticHeaderValue>> {
  const redactedHeaders: Record<string, DiagnosticHeaderValue> = {};

  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }

    if (SENSITIVE_HEADER_NAMES.has(name.toLowerCase())) {
      redactedHeaders[name] =
        typeof value === "string"
          ? REDACTED_VALUE
          : value.map(() => REDACTED_VALUE);
      continue;
    }

    redactedHeaders[name] = typeof value === "string" ? value : [...value];
  }

  return redactedHeaders;
}
