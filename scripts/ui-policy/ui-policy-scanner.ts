import ts from "typescript";

export const UI_POLICY_SEVERITIES = ["high", "medium", "info"] as const;
export type UiPolicySeverity = (typeof UI_POLICY_SEVERITIES)[number];

export const UI_POLICY_RULES = {
  "no-wait-for-timeout": "Fixed browser sleeps are prohibited.",
  "no-xpath-locator":
    "XPath locators require an explicitly documented exception.",
  "no-absolute-local-path":
    "Source must not contain an absolute local filesystem path.",
  "no-browser-ops-in-unit-tests":
    "Pure unit tests must not perform browser or page operations.",
  "review-force-action":
    "Forced actions bypass actionability checks and require review.",
  "review-positional-locator":
    "Positional locator selection can couple automation to DOM order.",
  "no-raw-selector-in-test":
    "Playwright specifications should delegate raw selectors to pages or components.",
  "review-long-interaction-timeout":
    "Long fixed interaction timeouts can hide readiness problems.",
  "review-generated-css":
    "A CSS selector appears to depend on a generated class name.",
  "review-get-by-text":
    "Text locators without exact matching should be scoped and use stable text.",
  "review-direct-page-usage":
    "Direct page operations in specifications should remain limited to test orchestration.",
  "review-locator":
    "Raw locator usage should be reviewed for semantic alternatives and stable scoping.",
  "invalid-ui-policy-suppression":
    "Policy suppressions require a valid rule ID and a non-empty reason.",
} as const;

export type UiPolicyRuleId = keyof typeof UI_POLICY_RULES;

export interface UiPolicySourceFile {
  readonly path: string;
  readonly sourceText: string;
}

export interface UiPolicyFinding {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly ruleId: UiPolicyRuleId;
  readonly severity: UiPolicySeverity;
  readonly message: string;
  readonly preview: string;
}

export interface UiPolicySuppression {
  readonly file: string;
  readonly line: number;
  readonly ruleId: string;
  readonly reason: string;
  readonly status: "valid" | "invalid";
  readonly used: boolean;
}

export interface UiPolicySummary {
  readonly filesScanned: number;
  readonly findings: number;
  readonly high: number;
  readonly medium: number;
  readonly info: number;
  readonly suppressions: number;
  readonly suppressionsUsed: number;
}

export interface UiPolicyReport {
  readonly status: "pass" | "fail";
  readonly summary: UiPolicySummary;
  readonly findingsByRule: Readonly<Record<string, number>>;
  readonly findings: readonly UiPolicyFinding[];
  readonly suppressions: readonly UiPolicySuppression[];
}

interface MutableSuppression {
  readonly file: string;
  readonly line: number;
  readonly targetLine: number;
  readonly ruleId: string;
  readonly reason: string;
  readonly status: "valid" | "invalid";
  used: boolean;
}

const MAXIMUM_PREVIEW_LENGTH = 180;
const LONG_INTERACTION_TIMEOUT_MS = 10_000;
const INTERACTION_METHODS = new Set([
  "check",
  "click",
  "dblclick",
  "fill",
  "hover",
  "press",
  "selectOption",
  "setInputFiles",
  "tap",
  "uncheck",
]);
const BROWSER_OPERATION_METHODS = new Set([
  ...INTERACTION_METHODS,
  "goto",
  "newContext",
  "newPage",
  "setContent",
]);
const EXCLUDED_PATH_SEGMENTS = new Set([
  "blob-report",
  "node_modules",
  "playwright-report",
  "test-results",
  "traces",
]);

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//u, "");
}

function shouldScanPath(path: string): boolean {
  const normalized = normalizePath(path);
  const segments = normalized.split("/");
  const fileName = segments.at(-1) ?? "";
  return (
    !segments.some((segment) => EXCLUDED_PATH_SEGMENTS.has(segment)) &&
    !fileName.startsWith(".env") &&
    fileName.endsWith(".ts")
  );
}

function truncatePreview(value: string): string {
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (normalized.length <= MAXIMUM_PREVIEW_LENGTH) {
    return normalized;
  }
  return `${normalized.slice(0, MAXIMUM_PREVIEW_LENGTH - 14)}...[truncated]`;
}

function linePreview(sourceFile: ts.SourceFile, line: number): string {
  return truncatePreview(sourceFile.text.split(/\r?\n/u)[line - 1] ?? "");
}

function nextRelevantLine(
  lines: readonly string[],
  startIndex: number,
): number {
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const candidate = lines[index]?.trim() ?? "";
    if (candidate.length > 0 && !candidate.startsWith("//")) {
      return index + 1;
    }
  }
  return startIndex + 2;
}

function collectSuppressions(file: UiPolicySourceFile): {
  readonly suppressions: MutableSuppression[];
  readonly invalidFindings: UiPolicyFinding[];
} {
  const normalizedPath = normalizePath(file.path);
  const lines = file.sourceText.split(/\r?\n/u);
  const suppressions: MutableSuppression[] = [];
  const invalidFindings: UiPolicyFinding[] = [];
  const validPattern =
    /^\s*\/\/\s*aegis-ui-policy-disable-next-line\s+(\S+)\s+--\s+(.+?)\s*$/u;

  for (const [index, line] of lines.entries()) {
    if (!line.includes("aegis-ui-policy-disable-next-line")) {
      continue;
    }

    const match = validPattern.exec(line);
    const ruleId = match?.[1] ?? "unknown";
    const reason = match?.[2]?.trim() ?? "";
    const validRule = Object.hasOwn(UI_POLICY_RULES, ruleId);
    const status =
      match !== null && validRule && reason.length > 0 ? "valid" : "invalid";
    suppressions.push({
      file: normalizedPath,
      line: index + 1,
      targetLine: nextRelevantLine(lines, index),
      ruleId,
      reason,
      status,
      used: false,
    });

    if (status === "invalid") {
      invalidFindings.push({
        file: normalizedPath,
        line: index + 1,
        column: Math.max(1, line.indexOf("aegis-ui-policy") + 1),
        ruleId: "invalid-ui-policy-suppression",
        severity: "high",
        message: UI_POLICY_RULES["invalid-ui-policy-suppression"],
        preview: truncatePreview(line),
      });
    }
  }

  return { suppressions, invalidFindings };
}

function getCallName(node: ts.CallExpression): string | undefined {
  if (ts.isPropertyAccessExpression(node.expression)) {
    return node.expression.name.text;
  }
  return ts.isIdentifier(node.expression) ? node.expression.text : undefined;
}

function getReceiverText(node: ts.CallExpression): string {
  if (!ts.isPropertyAccessExpression(node.expression)) {
    return "";
  }
  return node.expression.expression.getText();
}

function getStringArgument(node: ts.CallExpression): string | undefined {
  const argument = node.arguments[0];
  return argument !== undefined &&
    (ts.isStringLiteral(argument) ||
      ts.isNoSubstitutionTemplateLiteral(argument))
    ? argument.text
    : undefined;
}

function hasBooleanProperty(
  node: ts.Node,
  propertyName: string,
  expectedValue: boolean,
): boolean {
  let found = false;
  const visit = (child: ts.Node): void => {
    if (
      ts.isPropertyAssignment(child) &&
      child.name.getText().replaceAll(/["']/gu, "") === propertyName &&
      child.initializer.kind ===
        (expectedValue ? ts.SyntaxKind.TrueKeyword : ts.SyntaxKind.FalseKeyword)
    ) {
      found = true;
    }
    if (!found) {
      ts.forEachChild(child, visit);
    }
  };
  visit(node);
  return found;
}

function hasLongTimeout(node: ts.CallExpression): boolean {
  return node.arguments.some(
    (argument) =>
      ts.isObjectLiteralExpression(argument) &&
      argument.properties.some(
        (property) =>
          ts.isPropertyAssignment(property) &&
          property.name.getText().replaceAll(/["']/gu, "") === "timeout" &&
          ts.isNumericLiteral(property.initializer) &&
          Number(property.initializer.text) >= LONG_INTERACTION_TIMEOUT_MS,
      ),
  );
}

function appearsGeneratedCss(selector: string): boolean {
  return /(?:^|\s|>)[.#](?:css|sc|jsx|emotion)-?[a-z0-9_-]{5,}\b/iu.test(
    selector,
  );
}

function isXpath(selector: string): boolean {
  const value = selector.trim().toLowerCase();
  return (
    value.startsWith("//") ||
    value.startsWith("xpath=") ||
    value.startsWith("/html/")
  );
}

function isAbsoluteLocalPath(value: string): boolean {
  return /^[a-z]:[\\/]/iu.test(value) || /^\/(?:users|home)\//u.test(value);
}

function isSpecification(path: string): boolean {
  return /(?:^|\/)tests\/.*\.spec\.ts$/u.test(path);
}

function isUnitTest(path: string): boolean {
  return /(?:^|\/)tests\/unit\/|\.unit\.ts$/u.test(path);
}

function findingPosition(
  sourceFile: ts.SourceFile,
  node: ts.Node,
): { readonly line: number; readonly column: number } {
  const position = sourceFile.getLineAndCharacterOfPosition(
    node.getStart(sourceFile),
  );
  return { line: position.line + 1, column: position.character + 1 };
}

function scanFile(file: UiPolicySourceFile): {
  readonly findings: UiPolicyFinding[];
  readonly suppressions: MutableSuppression[];
} {
  const path = normalizePath(file.path);
  const sourceFile = ts.createSourceFile(
    path,
    file.sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const { suppressions, invalidFindings } = collectSuppressions(file);
  const findings: UiPolicyFinding[] = [...invalidFindings];

  const addFinding = (
    node: ts.Node,
    ruleId: UiPolicyRuleId,
    severity: UiPolicySeverity,
  ): void => {
    const position = findingPosition(sourceFile, node);
    const suppression = suppressions.find(
      (candidate) =>
        candidate.status === "valid" &&
        candidate.ruleId === ruleId &&
        candidate.targetLine === position.line,
    );
    if (suppression !== undefined) {
      suppression.used = true;
      return;
    }
    findings.push({
      file: path,
      ...position,
      ruleId,
      severity,
      message: UI_POLICY_RULES[ruleId],
      preview: linePreview(sourceFile, position.line),
    });
  };

  const visit = (node: ts.Node): void => {
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      isAbsoluteLocalPath(node.text)
    ) {
      addFinding(node, "no-absolute-local-path", "high");
    }

    if (ts.isCallExpression(node)) {
      const callName = getCallName(node);
      const receiver = getReceiverText(node);
      const selector = getStringArgument(node);

      if (callName === "waitForTimeout") {
        addFinding(node, "no-wait-for-timeout", "high");
      }

      if (callName === "locator") {
        addFinding(node, "review-locator", "info");
        if (selector !== undefined && isXpath(selector)) {
          addFinding(node, "no-xpath-locator", "high");
        }
        if (selector !== undefined && appearsGeneratedCss(selector)) {
          addFinding(node, "review-generated-css", "medium");
        }
        if (isSpecification(path)) {
          addFinding(node, "no-raw-selector-in-test", "medium");
        }
      }

      if (
        ["nth", "first", "last"].includes(callName ?? "") &&
        /\.locator\s*\(/u.test(receiver)
      ) {
        addFinding(node, "review-positional-locator", "medium");
      }

      if (hasBooleanProperty(node, "force", true)) {
        addFinding(node, "review-force-action", "medium");
      }

      if (
        callName !== undefined &&
        INTERACTION_METHODS.has(callName) &&
        hasLongTimeout(node)
      ) {
        addFinding(node, "review-long-interaction-timeout", "medium");
      }

      if (
        callName === "getByText" &&
        !hasBooleanProperty(node, "exact", true)
      ) {
        addFinding(node, "review-get-by-text", "info");
      }

      if (
        isSpecification(path) &&
        /^page(?:\.|$)/u.test(receiver) &&
        callName !== undefined
      ) {
        addFinding(node, "review-direct-page-usage", "info");
      }

      if (
        isUnitTest(path) &&
        callName !== undefined &&
        BROWSER_OPERATION_METHODS.has(callName) &&
        /^(?:page|browser|context)(?:\.|$)/u.test(receiver)
      ) {
        addFinding(node, "no-browser-ops-in-unit-tests", "high");
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return { findings, suppressions };
}

function findingOrder(left: UiPolicyFinding, right: UiPolicyFinding): number {
  return (
    left.file.localeCompare(right.file) ||
    left.line - right.line ||
    left.column - right.column ||
    left.ruleId.localeCompare(right.ruleId)
  );
}

export function scanUiPolicy(
  files: readonly UiPolicySourceFile[],
): UiPolicyReport {
  const sortedFiles = [...files]
    .map((file) => ({ ...file, path: normalizePath(file.path) }))
    .filter((file) => shouldScanPath(file.path))
    .sort((left, right) => left.path.localeCompare(right.path));
  const scanResults = sortedFiles.map(scanFile);
  const findings = scanResults
    .flatMap((result) => result.findings)
    .sort(findingOrder);
  const suppressions = scanResults
    .flatMap((result) => result.suppressions)
    .map((suppression) =>
      Object.freeze({
        file: suppression.file,
        line: suppression.line,
        ruleId: suppression.ruleId,
        reason: suppression.reason,
        status: suppression.status,
        used: suppression.used,
      }),
    )
    .sort(
      (left, right) =>
        left.file.localeCompare(right.file) || left.line - right.line,
    );
  const findingsByRule = Object.freeze(
    Object.fromEntries(
      [...new Set(findings.map((finding) => finding.ruleId))]
        .sort()
        .map((ruleId) => [
          ruleId,
          findings.filter((finding) => finding.ruleId === ruleId).length,
        ]),
    ),
  );
  const high = findings.filter((finding) => finding.severity === "high").length;
  const medium = findings.filter(
    (finding) => finding.severity === "medium",
  ).length;
  const info = findings.filter((finding) => finding.severity === "info").length;

  return Object.freeze({
    status: high > 0 ? "fail" : "pass",
    summary: Object.freeze({
      filesScanned: sortedFiles.length,
      findings: findings.length,
      high,
      medium,
      info,
      suppressions: suppressions.length,
      suppressionsUsed: suppressions.filter((suppression) => suppression.used)
        .length,
    }),
    findingsByRule,
    findings: Object.freeze(findings.map((finding) => Object.freeze(finding))),
    suppressions: Object.freeze(suppressions),
  });
}

export function uiPolicyExitCode(report: UiPolicyReport): 0 | 1 {
  return report.status === "pass" ? 0 : 1;
}
