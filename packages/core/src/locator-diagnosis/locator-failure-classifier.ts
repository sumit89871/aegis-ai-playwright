import { redactSensitiveText } from "../diagnostics/redaction.ts";

export const LOCATOR_FAILURE_CLASSIFICATIONS = [
  "selector-no-match",
  "selector-multiple-match",
  "strict-mode-violation",
  "element-not-visible",
  "element-not-enabled",
  "element-not-editable",
  "element-detached",
  "element-not-stable",
  "action-obstructed",
  "page-not-ready",
  "page-closed",
  "action-timeout",
  "assertion-locator-failure",
  "unknown-locator-failure",
  "not-a-locator-failure",
] as const;

export type LocatorFailureClassification =
  (typeof LOCATOR_FAILURE_CLASSIFICATIONS)[number];
export type LocatorOperation =
  "click" | "fill" | "check" | "select" | "hover" | "assert" | "unknown";
export type LocatorIntentStrategy =
  "role" | "label" | "placeholder" | "test-id" | "text" | "css" | "unknown";

export interface LocatorTargetIntent {
  readonly operation: LocatorOperation;
  readonly strategy: LocatorIntentStrategy;
  readonly role?: string;
  readonly name?: string;
  readonly value?: string;
  readonly locatorDescription?: string;
}

export interface LocatorFailureClassificationResult {
  readonly classification: LocatorFailureClassification;
  readonly confidence: "high" | "medium" | "low";
  readonly locatorRelated: boolean;
  readonly collectCandidates: boolean;
  readonly intent: LocatorTargetIntent;
  readonly rationale: string;
}

const LOCATOR_MARKERS = [
  "locator",
  "getbyrole",
  "getbylabel",
  "getbyplaceholder",
  "getbytestid",
  "getbytext",
  "getbyalttext",
  "getbytitle",
] as const;

function includesAny(value: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => value.includes(pattern));
}

function quotedArgument(message: string, method: string): string | undefined {
  const pattern = new RegExp(`${method}\\((?:'([^']*)'|"([^"]*)")`, "iu");
  const match = pattern.exec(message);
  return match?.[1] ?? match?.[2];
}

function inferOperation(message: string): LocatorOperation {
  const lower = message.toLowerCase();
  if (/\bclick(?:ing)?\b|\.click\(/u.test(lower)) return "click";
  if (/\bfill(?:ing)?\b|\.fill\(/u.test(lower)) return "fill";
  if (/\bcheck(?:ing)?\b|\.check\(/u.test(lower)) return "check";
  if (/\bselect(?:ing)?\b|selectoption/u.test(lower)) return "select";
  if (/\bhover(?:ing)?\b|\.hover\(/u.test(lower)) return "hover";
  if (/expect\(|tobe|tohave/u.test(lower)) return "assert";
  return "unknown";
}

export function inferLocatorTargetIntent(
  messageInput: string,
): LocatorTargetIntent {
  const message = redactSensitiveText(messageInput, 1_500);
  const operation = inferOperation(message);
  const roleMatch =
    /getByRole\((?:'([^']+)'|"([^"]+)")(?:,\s*\{[^}]*name:\s*(?:'([^']*)'|"([^"]*)"))?/iu.exec(
      message,
    );
  if (roleMatch !== null) {
    const role = roleMatch[1] ?? roleMatch[2];
    const name = roleMatch[3] ?? roleMatch[4];
    return Object.freeze({
      operation,
      strategy: "role",
      ...(role === undefined ? {} : { role: redactSensitiveText(role, 80) }),
      ...(name === undefined ? {} : { name: redactSensitiveText(name, 120) }),
      locatorDescription:
        name === undefined
          ? `getByRole(${JSON.stringify(role ?? "")})`
          : `getByRole(${JSON.stringify(role ?? "")}, { name: ${JSON.stringify(name)} })`,
    });
  }
  for (const [method, strategy] of [
    ["getByLabel", "label"],
    ["getByPlaceholder", "placeholder"],
    ["getByTestId", "test-id"],
    ["getByText", "text"],
  ] as const) {
    const value = quotedArgument(message, method);
    if (value !== undefined) {
      return Object.freeze({
        operation,
        strategy,
        value: redactSensitiveText(value, 120),
        locatorDescription: `${method}(...)`,
      });
    }
  }
  const css = quotedArgument(message, "locator");
  if (css !== undefined) {
    return Object.freeze({
      operation,
      strategy: "css",
      value: redactSensitiveText(css, 200),
      locatorDescription: "locator(...)",
    });
  }
  return Object.freeze({ operation, strategy: "unknown" });
}

function result(
  classification: LocatorFailureClassification,
  confidence: "high" | "medium" | "low",
  locatorRelated: boolean,
  collectCandidates: boolean,
  intent: LocatorTargetIntent,
  rationale: string,
): LocatorFailureClassificationResult {
  return Object.freeze({
    classification,
    confidence,
    locatorRelated,
    collectCandidates,
    intent,
    rationale,
  });
}

export function classifyLocatorFailure(
  messageInput: string | undefined,
): LocatorFailureClassificationResult {
  const message = redactSensitiveText(messageInput ?? "", 2_000);
  const lower = message.toLowerCase();
  const intent = inferLocatorTargetIntent(message);
  const locatorMarker = includesAny(lower, LOCATOR_MARKERS);

  if (lower.length === 0) {
    return result(
      "not-a-locator-failure",
      "low",
      false,
      false,
      intent,
      "No failure message was available.",
    );
  }
  if (
    includesAny(lower, [
      "accessibility",
      "color-contrast",
      "axe violation",
      "http 500",
      "request failed",
      "expected value",
      "received:",
    ])
  ) {
    return result(
      "not-a-locator-failure",
      "high",
      false,
      false,
      intent,
      "The evidence identifies a non-locator failure.",
    );
  }
  if (
    includesAny(lower, [
      "page readiness failed",
      "page-readiness",
      "business readiness",
    ])
  ) {
    return result(
      "page-not-ready",
      "high",
      true,
      false,
      intent,
      "The page readiness contract failed before locator repair could be justified.",
    );
  }
  if (
    includesAny(lower, [
      "target page, context or browser has been closed",
      "page has been closed",
      "context closed",
      "browser closed",
      "page crashed",
    ])
  ) {
    return result(
      "page-closed",
      "high",
      true,
      false,
      intent,
      "The page or browser lifecycle ended.",
    );
  }
  if (lower.includes("strict mode violation")) {
    return result(
      "strict-mode-violation",
      "high",
      true,
      true,
      intent,
      "The locator resolved to multiple elements under strict mode.",
    );
  }
  if (
    includesAny(lower, [
      "resolved to multiple elements",
      "resolved to 2 elements",
      "matched multiple elements",
    ])
  ) {
    return result(
      "selector-multiple-match",
      "high",
      true,
      true,
      intent,
      "The locator matched more than one element.",
    );
  }
  if (
    includesAny(lower, [
      "resolved to no elements",
      "did not resolve to any element",
      "no element found",
    ])
  ) {
    return result(
      "selector-no-match",
      "high",
      true,
      true,
      intent,
      "The locator matched no element.",
    );
  }
  if (
    includesAny(lower, [
      "element is not visible",
      "element was not visible",
      "hidden element",
    ])
  ) {
    return result(
      "element-not-visible",
      "high",
      true,
      false,
      intent,
      "The located element was hidden; application state should be investigated.",
    );
  }
  if (
    includesAny(lower, [
      "element is not enabled",
      "element was not enabled",
      "element is disabled",
    ])
  ) {
    return result(
      "element-not-enabled",
      "high",
      true,
      false,
      intent,
      "The located element was disabled; replacing the locator is not indicated.",
    );
  }
  if (
    includesAny(lower, ["element is not editable", "element was not editable"])
  ) {
    return result(
      "element-not-editable",
      "high",
      true,
      false,
      intent,
      "The located element was not editable.",
    );
  }
  if (
    includesAny(lower, [
      "element was detached",
      "detached from the dom",
      "element is detached",
    ])
  ) {
    return result(
      "element-detached",
      "high",
      true,
      false,
      intent,
      "The located element detached from the document.",
    );
  }
  if (includesAny(lower, ["element is not stable", "element was not stable"])) {
    return result(
      "element-not-stable",
      "high",
      true,
      false,
      intent,
      "The located element did not become stable.",
    );
  }
  if (
    includesAny(lower, [
      "intercepts pointer events",
      "another element would receive the click",
      "element is obscured",
      "overlay",
    ])
  ) {
    return result(
      "action-obstructed",
      "high",
      true,
      false,
      intent,
      "Another element obstructed the intended action.",
    );
  }
  if (locatorMarker && lower.includes("timeout")) {
    const noMatch = includesAny(lower, [
      "waiting for",
      "exceeded while waiting",
      "while waiting",
    ]);
    if (noMatch) {
      return result(
        "selector-no-match",
        "medium",
        true,
        true,
        intent,
        "A locator operation exceeded its bounded timeout while waiting for a match.",
      );
    }
  }
  if (
    locatorMarker &&
    includesAny(lower, [
      "expect(locator)",
      "locator assertion",
      "tobevisible",
      "tohavetext",
    ])
  ) {
    return result(
      "assertion-locator-failure",
      "medium",
      true,
      true,
      intent,
      "A locator-backed assertion failed.",
    );
  }
  if (locatorMarker && lower.includes("timeout")) {
    return result(
      "action-timeout",
      "medium",
      true,
      false,
      intent,
      "A locator operation exceeded its bounded timeout.",
    );
  }
  if (locatorMarker) {
    return result(
      "unknown-locator-failure",
      "low",
      true,
      false,
      intent,
      "Locator evidence exists, but no controlled classification matched.",
    );
  }
  return result(
    "not-a-locator-failure",
    "high",
    false,
    false,
    intent,
    "The failure contains no reliable locator evidence.",
  );
}
