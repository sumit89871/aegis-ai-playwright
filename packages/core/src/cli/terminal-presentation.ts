import { redactSensitiveText } from "../diagnostics/redaction.ts";

export type CliOutputMode = "rich" | "plain" | "summary-json" | "private-json";

export interface TerminalCapabilities {
  readonly outputMode: CliOutputMode;
  readonly rich: boolean;
  readonly color: boolean;
  readonly unicode: boolean;
  readonly animation: boolean;
  readonly width: number;
  readonly stdoutIsTty: boolean;
  readonly stderrIsTty: boolean;
}

export interface TerminalCapabilityInput {
  readonly arguments: readonly string[];
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly stdoutIsTty?: boolean;
  readonly stderrIsTty?: boolean;
  readonly columns?: number;
  readonly platform?: NodeJS.Platform;
}

export interface CliKeyValueRow {
  readonly label: string;
  readonly value: string;
  readonly status?: "neutral" | "success" | "warning" | "danger";
}

export const CLI_MINIMUM_WIDTH = 40;
export const CLI_MAXIMUM_RENDER_WIDTH = 140;
export const CLI_MINIMUM_RICH_WIDTH = 72;
export const CLI_MINIMUM_BORDERED_WIDTH = 80;
const ANSI = Object.freeze({
  reset: "\u001B[0m",
  cyan: "\u001B[36m",
  green: "\u001B[32m",
  yellow: "\u001B[33m",
  red: "\u001B[31m",
});

function environmentFlag(value: string | undefined): boolean {
  return value !== undefined && value !== "" && value !== "0";
}

function boundedWidth(columns: number | undefined): number {
  if (columns === undefined || !Number.isFinite(columns)) return 100;
  return Math.max(
    CLI_MINIMUM_WIDTH,
    Math.min(CLI_MAXIMUM_RENDER_WIDTH, Math.floor(columns)),
  );
}

export function detectTerminalCapabilities(
  input: TerminalCapabilityInput,
): TerminalCapabilities {
  const environment = input.environment ?? {};
  const stdoutIsTty = input.stdoutIsTty === true;
  const stderrIsTty = input.stderrIsTty === true;
  const width = boundedWidth(input.columns);
  const json = input.arguments.includes("--json");
  const summaryJson = input.arguments.includes("--summary-json");
  const explicitlyPlain = input.arguments.includes("--plain");
  const ci = environmentFlag(environment.CI);
  const dumb = environment.TERM?.toLowerCase() === "dumb";
  const rich =
    !json &&
    !summaryJson &&
    !explicitlyPlain &&
    stdoutIsTty &&
    !ci &&
    !dumb &&
    width >= CLI_MINIMUM_RICH_WIDTH;
  const noColor = environment.NO_COLOR !== undefined;
  const forceColorDisabled = environment.FORCE_COLOR === "0";
  const modernWindows =
    input.platform !== "win32" ||
    environment.WT_SESSION !== undefined ||
    environment.TERM_PROGRAM !== undefined;
  const unicode =
    rich && environment.AEGIS_ASCII !== "1" && modernWindows && !dumb;
  return Object.freeze({
    outputMode: json
      ? "private-json"
      : summaryJson
        ? "summary-json"
        : rich
          ? "rich"
          : "plain",
    rich,
    color: rich && !noColor && !forceColorDisabled,
    unicode,
    animation:
      rich && stderrIsTty && !input.arguments.includes("--no-animation"),
    width,
    stdoutIsTty,
    stderrIsTty,
  });
}

export function stripAnsi(value: string): string {
  const escapeCharacter = String.fromCodePoint(27);
  return value
    .split(escapeCharacter)
    .map((segment, index) =>
      index === 0 ? segment : segment.replace(/^\[[0-?]*[ -/]*[@-~]/u, ""),
    )
    .join("");
}

function colorize(
  value: string,
  status: CliKeyValueRow["status"],
  capabilities: TerminalCapabilities,
): string {
  if (!capabilities.color) return value;
  const color =
    status === "success"
      ? ANSI.green
      : status === "warning"
        ? ANSI.yellow
        : status === "danger"
          ? ANSI.red
          : ANSI.cyan;
  return `${color}${value}${ANSI.reset}`;
}

export function wrapCliText(
  value: string,
  width: number,
  indent = "",
  continuationIndent = indent,
): readonly string[] {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (normalized === "") return [indent];
  const lines: string[] = [];
  let line = "";
  let firstLine = true;
  const prefix = (): string => (firstLine ? indent : continuationIndent);
  const available = (): number => Math.max(10, width - prefix().length);
  const emit = (): void => {
    lines.push(`${prefix()}${line}`);
    line = "";
    firstLine = false;
  };
  for (const originalWord of normalized.split(" ")) {
    let word = originalWord;
    if (word.length > available()) {
      if (line !== "") {
        emit();
      }
      while (word.length > available()) {
        line = word.slice(0, available());
        word = word.slice(available());
        emit();
      }
    }
    if (word === "") continue;
    if (line === "") line = word;
    else if (line.length + word.length + 1 <= available())
      line = `${line} ${word}`;
    else {
      emit();
      line = word;
    }
  }
  if (line !== "") emit();
  return lines;
}

export function usesBorderedCliLayout(
  capabilities: TerminalCapabilities,
): boolean {
  return capabilities.rich && capabilities.width >= CLI_MINIMUM_BORDERED_WIDTH;
}

function visibleLength(value: string): number {
  return stripAnsi(value).length;
}

function padVisibleEnd(value: string, width: number): string {
  return `${value}${" ".repeat(Math.max(0, width - visibleLength(value)))}`;
}

function sectionLabelWidth(
  rows: readonly CliKeyValueRow[],
  contentWidth: number,
): number {
  const longest = Math.max(12, ...rows.map(({ label }) => label.length));
  return Math.min(longest, 32, Math.max(12, Math.floor(contentWidth * 0.42)));
}

function renderSectionRows(
  rows: readonly CliKeyValueRow[],
  capabilities: TerminalCapabilities,
  contentWidth: number,
): readonly string[] {
  const labelWidth = sectionLabelWidth(rows, contentWidth);
  return rows.flatMap((row) => {
    const labelText = `${row.label}:`;
    if (labelText.length > labelWidth + 1) {
      const labelLines = wrapCliText(labelText, contentWidth);
      const valueLines = wrapCliText(row.value, contentWidth, "  ", "  ");
      return [
        ...labelLines,
        ...valueLines.map((line, index) =>
          index === 0
            ? colorize(line, row.status ?? "neutral", capabilities)
            : line,
        ),
      ];
    }
    const firstPrefix = `${labelText.padEnd(labelWidth + 1)} `;
    const continuationPrefix = " ".repeat(firstPrefix.length);
    return wrapCliText(
      row.value,
      contentWidth,
      firstPrefix,
      continuationPrefix,
    ).map((line, index) =>
      index === 0
        ? colorize(line, row.status ?? "neutral", capabilities)
        : line,
    );
  });
}

export function renderCliBanner(
  title: string,
  capabilities: TerminalCapabilities,
): string {
  if (!capabilities.rich) return title.replaceAll("·", "-").toUpperCase();
  const safeTitle = capabilities.unicode ? title : title.replaceAll("·", "-");
  const horizontal = capabilities.unicode ? "─" : "-";
  const left = capabilities.unicode ? "┌" : "+";
  const right = capabilities.unicode ? "┐" : "+";
  const bottomLeft = capabilities.unicode ? "└" : "+";
  const bottomRight = capabilities.unicode ? "┘" : "+";
  const innerWidth = capabilities.width - 2;
  const heading = ` ${safeTitle} `;
  const top = `${left}${heading}${horizontal.repeat(Math.max(0, innerWidth - heading.length))}${right}`;
  const bottom = `${bottomLeft}${horizontal.repeat(innerWidth)}${bottomRight}`;
  return colorize(`${top}\n${bottom}`, "neutral", capabilities);
}

export function renderCliSection(
  title: string,
  rows: readonly CliKeyValueRow[],
  capabilities: TerminalCapabilities,
): string {
  if (usesBorderedCliLayout(capabilities)) {
    const horizontal = capabilities.unicode ? "─" : "-";
    const topLeft = capabilities.unicode ? "┌" : "+";
    const topRight = capabilities.unicode ? "┐" : "+";
    const bottomLeft = capabilities.unicode ? "└" : "+";
    const bottomRight = capabilities.unicode ? "┘" : "+";
    const vertical = capabilities.unicode ? "│" : "|";
    const innerWidth = capabilities.width - 2;
    const contentWidth = innerWidth - 4;
    const titleText = ` ${title.toUpperCase()} `;
    const top = `${topLeft}${titleText}${horizontal.repeat(
      Math.max(0, innerWidth - titleText.length),
    )}${topRight}`;
    const body = renderSectionRows(rows, capabilities, contentWidth).map(
      (line) =>
        `${vertical}  ${padVisibleEnd(line, contentWidth)}  ${vertical}`,
    );
    const bottom = `${bottomLeft}${horizontal.repeat(innerWidth)}${bottomRight}`;
    return [
      colorize(top, "neutral", capabilities),
      ...body,
      colorize(bottom, "neutral", capabilities),
    ].join("\n");
  }
  const heading = capabilities.rich
    ? colorize(
        `${capabilities.unicode ? "◆" : ">"} ${title.toUpperCase()}`,
        "neutral",
        capabilities,
      )
    : title.toUpperCase();
  const contentIndent = capabilities.rich ? "  " : "";
  const contentWidth = capabilities.width - contentIndent.length;
  const rowLines = renderSectionRows(rows, capabilities, contentWidth).map(
    (line) => `${contentIndent}${line}`,
  );
  return [heading, ...rowLines].join("\n");
}

export function renderCliNotice(
  label: "INFO" | "WARNING" | "SUCCESS" | "RISK",
  message: string,
  capabilities: TerminalCapabilities,
): string {
  const status =
    label === "SUCCESS"
      ? "success"
      : label === "WARNING"
        ? "warning"
        : label === "RISK"
          ? "danger"
          : "neutral";
  const marker = `[${label}]`;
  const prefix = `${marker} `;
  const continuationPrefix = " ".repeat(prefix.length);
  const lines = wrapCliText(
    message,
    capabilities.width,
    prefix,
    continuationPrefix,
  );
  return lines
    .map((line, index) =>
      index === 0 ? colorize(line, status, capabilities) : line,
    )
    .join("\n");
}

export function renderCliError(
  input: {
    readonly title: string;
    readonly code: string;
    readonly fieldPath?: string;
    readonly message: string;
    readonly suggestion: string;
  },
  capabilities: TerminalCapabilities,
): string {
  const safe = (value: string): string =>
    stripAnsi(redactSensitiveText(value, 500))
      .replace(/\b[A-Za-z]:\\[^\r\n]*/gu, "[PATH]")
      .replace(/(^|\s)\/(?:Users|home|tmp|var)\/[^\s]+/gu, "$1[PATH]");
  return [
    renderCliNotice("RISK", safe(input.title), capabilities),
    renderCliSection(
      "Error details",
      [
        { label: "Code", value: safe(input.code), status: "danger" },
        ...(input.fieldPath === undefined
          ? []
          : ([{ label: "Field", value: safe(input.fieldPath) }] as const)),
        { label: "Problem", value: safe(input.message) },
        { label: "Fix", value: safe(input.suggestion) },
      ],
      capabilities,
    ),
  ].join("\n\n");
}
