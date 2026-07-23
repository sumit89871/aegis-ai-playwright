import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import {
  redactSensitiveText,
  sanitizeUrl,
  truncateText,
} from "../diagnostics/redaction.ts";

export const ACCESSIBILITY_IMPACTS = [
  "critical",
  "serious",
  "moderate",
  "minor",
] as const;
export type AccessibilityImpact = (typeof ACCESSIBILITY_IMPACTS)[number];
export type AccessibilityPolicyAction = "fail" | "warn" | "info";

export const DEFAULT_ACCESSIBILITY_POLICY: Readonly<
  Record<AccessibilityImpact, AccessibilityPolicyAction>
> = Object.freeze({
  critical: "fail",
  serious: "fail",
  moderate: "warn",
  minor: "info",
});

export interface AccessibilityRuleExclusion {
  readonly ruleId: string;
  readonly reason: string;
  readonly scope: string;
  readonly issueReference?: string;
}

export interface AccessibilityEvidenceLimits {
  readonly maximumViolations: number;
  readonly maximumNodesPerViolation: number;
  readonly maximumSelectorLength: number;
  readonly maximumMessageLength: number;
}

export interface AccessibilityScanOptions {
  readonly includedTags?: readonly string[];
  readonly includedRules?: readonly string[];
  readonly includeRegions?: readonly string[];
  readonly excludeRegions?: readonly string[];
  readonly includedImpacts?: readonly AccessibilityImpact[];
  readonly ruleExclusions?: readonly AccessibilityRuleExclusion[];
  readonly policy?: Partial<
    Readonly<Record<AccessibilityImpact, AccessibilityPolicyAction>>
  >;
  readonly limits?: Partial<AccessibilityEvidenceLimits>;
  readonly now?: () => number;
}

export interface AccessibilityViolationNode {
  readonly target: string;
  readonly failureSummary: string;
}

export interface AccessibilityViolationEvidence {
  readonly ruleId: string;
  readonly impact: AccessibilityImpact | "unknown";
  readonly action: AccessibilityPolicyAction;
  readonly help: string;
  readonly helpUrl: string;
  readonly affectedNodeCount: number;
  readonly retainedNodeCount: number;
  readonly droppedNodeCount: number;
  readonly nodes: readonly AccessibilityViolationNode[];
}

export interface AccessibilityScanSummary {
  readonly status: "pass" | "fail";
  readonly totalViolationCount: number;
  readonly retainedViolationCount: number;
  readonly droppedViolationCount: number;
  readonly excludedViolationCount: number;
  readonly failingViolationCount: number;
  readonly warningViolationCount: number;
  readonly informationalViolationCount: number;
  readonly violationsByImpact: Readonly<Record<AccessibilityImpact, number>>;
  readonly retainedNodeCount: number;
  readonly droppedNodeCount: number;
  readonly durationMs: number;
}

export interface AccessibilityScanResult {
  readonly status: "pass" | "fail";
  readonly targetUrl: string;
  readonly policy: Readonly<
    Record<AccessibilityImpact, AccessibilityPolicyAction>
  >;
  readonly exclusionsApplied: readonly AccessibilityRuleExclusion[];
  readonly summary: AccessibilityScanSummary;
  readonly violations: readonly AccessibilityViolationEvidence[];
}

export interface RawAccessibilityNode {
  readonly target?: unknown;
  readonly failureSummary?: unknown;
  readonly html?: unknown;
  readonly any?: unknown;
  readonly all?: unknown;
  readonly none?: unknown;
}

export interface RawAccessibilityViolation {
  readonly id?: unknown;
  readonly impact?: unknown;
  readonly help?: unknown;
  readonly helpUrl?: unknown;
  readonly nodes?: unknown;
}

export interface ProcessAccessibilityOptions extends Omit<
  AccessibilityScanOptions,
  "now"
> {
  readonly targetUrl?: string;
  readonly durationMs?: number;
}

export class AccessibilityPolicyError extends Error {
  public readonly result: AccessibilityScanResult;

  public constructor(result: AccessibilityScanResult) {
    const failingRules = result.violations
      .filter((violation) => violation.action === "fail")
      .map((violation) => violation.ruleId)
      .join(", ");
    super(
      `Accessibility policy failed with ${String(result.summary.failingViolationCount)} policy-failing violation(s): ${failingRules}.`,
    );
    this.name = "AccessibilityPolicyError";
    this.result = result;
  }
}

const DEFAULT_LIMITS: AccessibilityEvidenceLimits = Object.freeze({
  maximumViolations: 50,
  maximumNodesPerViolation: 10,
  maximumSelectorLength: 300,
  maximumMessageLength: 500,
});
const RULE_ID_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/u;
const MAXIMUM_CONFIGURATION_TEXT = 500;
const INPUT_VALUE_PATTERN =
  /\b(value|password|passwd|pwd|secret|token|api[_-]?key)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu;

function assertPlainObject(
  value: unknown,
  fieldName: string,
): asserts value is Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new Error(`${fieldName} must be a plain serializable object.`);
  }
}

function requiredText(value: unknown, fieldName: string): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value !== value.trim()
  ) {
    throw new Error(`${fieldName} must be a non-empty trimmed string.`);
  }
  if (value.length > MAXIMUM_CONFIGURATION_TEXT) {
    throw new Error(
      `${fieldName} must not exceed ${String(MAXIMUM_CONFIGURATION_TEXT)} characters.`,
    );
  }
  const redacted = redactSensitiveText(value, MAXIMUM_CONFIGURATION_TEXT);
  if (redacted !== value) {
    throw new Error(`${fieldName} must not contain credential-like data.`);
  }
  return value;
}

function validateUniqueStrings(
  value: unknown,
  fieldName: string,
): readonly string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array.`);
  }
  const values = value.map((entry, index) =>
    requiredText(entry, `${fieldName}[${String(index)}]`),
  );
  if (new Set(values).size !== values.length) {
    throw new Error(`${fieldName} must contain unique values.`);
  }
  return Object.freeze([...values].sort());
}

function validateExclusions(
  value: unknown,
): readonly AccessibilityRuleExclusion[] {
  if (value === undefined) {
    return Object.freeze([]);
  }
  if (!Array.isArray(value)) {
    throw new Error("ruleExclusions must be an array.");
  }
  const exclusions = value.map((entry, index) => {
    assertPlainObject(entry, `ruleExclusions[${String(index)}]`);
    const ruleId = requiredText(
      entry.ruleId,
      `ruleExclusions[${String(index)}].ruleId`,
    );
    if (!RULE_ID_PATTERN.test(ruleId)) {
      throw new Error(
        `ruleExclusions[${String(index)}].ruleId must use a normalized axe rule ID.`,
      );
    }
    const reason = requiredText(
      entry.reason,
      `ruleExclusions[${String(index)}].reason`,
    );
    const scope = requiredText(
      entry.scope,
      `ruleExclusions[${String(index)}].scope`,
    );
    const issueReference =
      entry.issueReference === undefined
        ? undefined
        : requiredText(
            entry.issueReference,
            `ruleExclusions[${String(index)}].issueReference`,
          );
    return Object.freeze({
      ruleId,
      reason,
      scope,
      ...(issueReference === undefined ? {} : { issueReference }),
    });
  });
  if (
    new Set(exclusions.map((entry) => entry.ruleId)).size !== exclusions.length
  ) {
    throw new Error("ruleExclusions must contain unique rule IDs.");
  }
  return Object.freeze(
    exclusions.sort((left, right) => left.ruleId.localeCompare(right.ruleId)),
  );
}

function validateLimits(value: unknown): AccessibilityEvidenceLimits {
  if (value === undefined) {
    return DEFAULT_LIMITS;
  }
  assertPlainObject(value, "limits");
  const limits = { ...DEFAULT_LIMITS };
  for (const key of Object.keys(
    limits,
  ) as (keyof AccessibilityEvidenceLimits)[]) {
    const configured = value[key];
    if (configured === undefined) {
      continue;
    }
    if (
      typeof configured !== "number" ||
      !Number.isInteger(configured) ||
      configured < 1 ||
      configured > 10_000
    ) {
      throw new Error(`limits.${key} must be an integer between 1 and 10000.`);
    }
    limits[key] = configured;
  }
  return Object.freeze(limits);
}

function validatePolicy(
  value: unknown,
): Readonly<Record<AccessibilityImpact, AccessibilityPolicyAction>> {
  if (value === undefined) {
    return DEFAULT_ACCESSIBILITY_POLICY;
  }
  assertPlainObject(value, "policy");
  const policy = { ...DEFAULT_ACCESSIBILITY_POLICY };
  for (const impact of ACCESSIBILITY_IMPACTS) {
    const action = value[impact];
    if (action === undefined) {
      continue;
    }
    if (
      !(["fail", "warn", "info"] as const).includes(
        action as AccessibilityPolicyAction,
      )
    ) {
      throw new Error(`policy.${impact} must be fail, warn, or info.`);
    }
    policy[impact] = action as AccessibilityPolicyAction;
  }
  return Object.freeze(policy);
}

function validateImpacts(
  value: unknown,
): readonly AccessibilityImpact[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("includedImpacts must be a non-empty array when supplied.");
  }
  const impacts = value.map((impact) => {
    if (
      typeof impact !== "string" ||
      !ACCESSIBILITY_IMPACTS.includes(impact as AccessibilityImpact)
    ) {
      throw new Error(
        `includedImpacts must contain only: ${ACCESSIBILITY_IMPACTS.join(", ")}.`,
      );
    }
    return impact as AccessibilityImpact;
  });
  if (new Set(impacts).size !== impacts.length) {
    throw new Error("includedImpacts must contain unique values.");
  }
  return Object.freeze([...impacts]);
}

function validatedOptions(options: ProcessAccessibilityOptions): {
  readonly includedTags?: readonly string[];
  readonly includedRules?: readonly string[];
  readonly includeRegions?: readonly string[];
  readonly excludeRegions?: readonly string[];
  readonly includedImpacts?: readonly AccessibilityImpact[];
  readonly exclusions: readonly AccessibilityRuleExclusion[];
  readonly policy: Readonly<
    Record<AccessibilityImpact, AccessibilityPolicyAction>
  >;
  readonly limits: AccessibilityEvidenceLimits;
} {
  const includedTags = validateUniqueStrings(
    options.includedTags,
    "includedTags",
  );
  const includedRules = validateUniqueStrings(
    options.includedRules,
    "includedRules",
  );
  const includeRegions = validateUniqueStrings(
    options.includeRegions,
    "includeRegions",
  );
  const excludeRegions = validateUniqueStrings(
    options.excludeRegions,
    "excludeRegions",
  );
  const includedImpacts = validateImpacts(options.includedImpacts);
  if (includedTags !== undefined && includedRules !== undefined) {
    throw new Error("Use includedTags or includedRules, not both.");
  }
  return Object.freeze({
    ...(includedTags === undefined ? {} : { includedTags }),
    ...(includedRules === undefined ? {} : { includedRules }),
    ...(includeRegions === undefined ? {} : { includeRegions }),
    ...(excludeRegions === undefined ? {} : { excludeRegions }),
    ...(includedImpacts === undefined ? {} : { includedImpacts }),
    exclusions: validateExclusions(options.ruleExclusions),
    policy: validatePolicy(options.policy),
    limits: validateLimits(options.limits),
  });
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNodes(value: unknown): readonly RawAccessibilityNode[] {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is RawAccessibilityNode =>
          typeof entry === "object" && entry !== null,
      )
    : [];
}

function sanitizeEvidenceText(value: string, maximumLength: number): string {
  return truncateText(
    redactSensitiveText(
      value.replace(INPUT_VALUE_PATTERN, "$1=[REDACTED]"),
      maximumLength,
    ),
    maximumLength,
  );
}

function sanitizeTarget(value: unknown, maximumLength: number): string {
  const target = Array.isArray(value)
    ? value
        .flat(3)
        .filter((part): part is string => typeof part === "string")
        .join(" > ")
    : asText(value);
  return sanitizeEvidenceText(target, maximumLength);
}

function impactOf(value: unknown): AccessibilityImpact | "unknown" {
  return typeof value === "string" &&
    ACCESSIBILITY_IMPACTS.includes(value as AccessibilityImpact)
    ? (value as AccessibilityImpact)
    : "unknown";
}

function actionOf(
  impact: AccessibilityImpact | "unknown",
  policy: Readonly<Record<AccessibilityImpact, AccessibilityPolicyAction>>,
): AccessibilityPolicyAction {
  return impact === "unknown" ? "info" : policy[impact];
}

function rawViolationOrder(
  left: RawAccessibilityViolation,
  right: RawAccessibilityViolation,
): number {
  return asText(left.id).localeCompare(asText(right.id));
}

export function processAccessibilityResults(
  violationsInput: readonly RawAccessibilityViolation[],
  options: ProcessAccessibilityOptions = {},
): AccessibilityScanResult {
  const validated = validatedOptions(options);
  const excludedRuleIds = new Set(
    validated.exclusions.map((exclusion) => exclusion.ruleId),
  );
  const impacts =
    validated.includedImpacts === undefined
      ? undefined
      : new Set(validated.includedImpacts);
  const sorted = [...violationsInput].sort(rawViolationOrder);
  const exclusionsApplied = validated.exclusions.filter((exclusion) =>
    sorted.some((violation) => asText(violation.id) === exclusion.ruleId),
  );
  const eligible = sorted.filter((violation) => {
    const impact = impactOf(violation.impact);
    return (
      !excludedRuleIds.has(asText(violation.id)) &&
      (impacts === undefined || (impact !== "unknown" && impacts.has(impact)))
    );
  });
  const retainedRaw = eligible.slice(0, validated.limits.maximumViolations);
  let retainedNodeCount = 0;
  let droppedNodeCount = 0;
  const violations = retainedRaw.map((violation) => {
    const impact = impactOf(violation.impact);
    const rawNodes = asNodes(violation.nodes);
    const retainedNodes = rawNodes
      .slice(0, validated.limits.maximumNodesPerViolation)
      .map((node) =>
        Object.freeze({
          target: sanitizeTarget(
            node.target,
            validated.limits.maximumSelectorLength,
          ),
          failureSummary: sanitizeEvidenceText(
            asText(node.failureSummary),
            validated.limits.maximumMessageLength,
          ),
        }),
      )
      .sort((left, right) => left.target.localeCompare(right.target));
    retainedNodeCount += retainedNodes.length;
    droppedNodeCount += rawNodes.length - retainedNodes.length;
    return Object.freeze({
      ruleId: sanitizeEvidenceText(
        asText(violation.id),
        validated.limits.maximumMessageLength,
      ),
      impact,
      action: actionOf(impact, validated.policy),
      help: sanitizeEvidenceText(
        asText(violation.help),
        validated.limits.maximumMessageLength,
      ),
      helpUrl: sanitizeUrl(
        asText(violation.helpUrl),
        validated.limits.maximumMessageLength,
      ),
      affectedNodeCount: rawNodes.length,
      retainedNodeCount: retainedNodes.length,
      droppedNodeCount: rawNodes.length - retainedNodes.length,
      nodes: Object.freeze(retainedNodes),
    });
  });
  const failingViolationCount = violations.filter(
    (violation) => violation.action === "fail",
  ).length;
  const warningViolationCount = violations.filter(
    (violation) => violation.action === "warn",
  ).length;
  const informationalViolationCount = violations.filter(
    (violation) => violation.action === "info",
  ).length;
  const violationsByImpact = Object.freeze(
    Object.fromEntries(
      ACCESSIBILITY_IMPACTS.map((impact) => [
        impact,
        eligible.filter((violation) => impactOf(violation.impact) === impact)
          .length,
      ]),
    ) as Record<AccessibilityImpact, number>,
  );
  const status = failingViolationCount > 0 ? "fail" : "pass";

  return Object.freeze({
    status,
    targetUrl: sanitizeUrl(options.targetUrl ?? "about:blank"),
    policy: validated.policy,
    exclusionsApplied: Object.freeze(exclusionsApplied),
    summary: Object.freeze({
      status,
      totalViolationCount: sorted.length,
      retainedViolationCount: violations.length,
      droppedViolationCount: eligible.length - violations.length,
      excludedViolationCount: sorted.length - eligible.length,
      failingViolationCount,
      warningViolationCount,
      informationalViolationCount,
      violationsByImpact,
      retainedNodeCount,
      droppedNodeCount,
      durationMs: Math.max(0, options.durationMs ?? 0),
    }),
    violations: Object.freeze(violations),
  });
}

export async function runAccessibilityScan(
  page: Page,
  options: AccessibilityScanOptions = {},
): Promise<AccessibilityScanResult> {
  const validated = validatedOptions(options);
  const now = options.now ?? Date.now;
  const startedAt = now();
  let builder = new AxeBuilder({ page });

  if (validated.includedTags !== undefined) {
    builder = builder.withTags([...validated.includedTags]);
  }
  if (validated.includedRules !== undefined) {
    builder = builder.withRules([...validated.includedRules]);
  }
  for (const selector of validated.includeRegions ?? []) {
    builder = builder.include(selector);
  }
  for (const selector of validated.excludeRegions ?? []) {
    builder = builder.exclude(selector);
  }

  const results = await builder.analyze();
  return processAccessibilityResults(results.violations, {
    ...(validated.includedTags === undefined
      ? {}
      : { includedTags: validated.includedTags }),
    ...(validated.includedRules === undefined
      ? {}
      : { includedRules: validated.includedRules }),
    ...(validated.includeRegions === undefined
      ? {}
      : { includeRegions: validated.includeRegions }),
    ...(validated.excludeRegions === undefined
      ? {}
      : { excludeRegions: validated.excludeRegions }),
    ...(validated.includedImpacts === undefined
      ? {}
      : { includedImpacts: validated.includedImpacts }),
    ruleExclusions: validated.exclusions,
    policy: validated.policy,
    limits: validated.limits,
    targetUrl: page.url(),
    durationMs: Math.max(0, now() - startedAt),
  });
}

export function assertAccessibilityPolicy(
  result: AccessibilityScanResult,
): void {
  if (result.status === "fail") {
    throw new AccessibilityPolicyError(result);
  }
}
