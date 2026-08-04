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

const MINIMUM_WIDTH = 40;
const MAXIMUM_WIDTH = 120;
const MINIMUM_RICH_WIDTH = 72;
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
  return Math.max(MINIMUM_WIDTH, Math.min(MAXIMUM_WIDTH, Math.floor(columns)));
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
    width >= MINIMUM_RICH_WIDTH;
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
): readonly string[] {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (normalized === "") return [indent];
  const available = Math.max(10, width - indent.length);
  const lines: string[] = [];
  let line = "";
  for (const originalWord of normalized.split(" ")) {
    let word = originalWord;
    if (word.length > available) {
      if (line !== "") {
        lines.push(`${indent}${line}`);
        line = "";
      }
      while (word.length > available) {
        lines.push(`${indent}${word.slice(0, available)}`);
        word = word.slice(available);
      }
    }
    if (word === "") continue;
    if (line === "") line = word;
    else if (line.length + word.length + 1 <= available)
      line = `${line} ${word}`;
    else {
      lines.push(`${indent}${line}`);
      line = word;
    }
  }
  if (line !== "") lines.push(`${indent}${line}`);
  return lines;
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
  const heading = capabilities.rich
    ? colorize(
        `${capabilities.unicode ? "◆" : ">"} ${title.toUpperCase()}`,
        "neutral",
        capabilities,
      )
    : title.toUpperCase();
  const labelWidth = Math.min(
    32,
    Math.max(12, Math.floor(capabilities.width * 0.4)),
    Math.max(12, ...rows.map(({ label }) => label.length)),
  );
  const rowLines = rows.flatMap((row) => {
    const label = `${row.label}:`.padEnd(labelWidth + 1);
    const prefix = `  ${label} `;
    const wrapped = wrapCliText(row.value, capabilities.width, prefix);
    return wrapped.map((line, index) =>
      index === 0
        ? colorize(line, row.status ?? "neutral", capabilities)
        : line,
    );
  });
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
  const lines = wrapCliText(message, capabilities.width, prefix);
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
