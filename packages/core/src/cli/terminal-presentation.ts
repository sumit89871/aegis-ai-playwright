import { redactSensitiveText } from "../diagnostics/redaction.ts";
import { ANSI_STYLE } from "./ansi-styles.ts";
import {
  padToWidth,
  splitAtVisibleWidth,
  stripAnsi,
  visibleWidth,
} from "./terminal-width.ts";

export type CliOutputMode = "rich" | "plain" | "summary-json" | "private-json";
export type CliProgressStyle = "thinking" | "spinner" | "static";
export type CliEmojiMode = "auto" | "always" | "never";
export type CliSymbolMode = "emoji" | "unicode" | "ascii";
export type CliRequestedSymbolMode = "auto" | "unicode" | "ascii";
export type CliEffectiveEmojiMode = "enabled" | "disabled";
export type CliCapabilitySource =
  "stream-apis" | "terminal-hint" | "explicit-override" | "fallback";

export interface CliCapabilityStream {
  readonly isTTY?: boolean;
  readonly columns?: number;
  getColorDepth?(environment?: NodeJS.ProcessEnv): number;
  hasColors?(count?: number, environment?: NodeJS.ProcessEnv): boolean;
}

export interface CliStreamCapabilities {
  readonly isInteractive: boolean;
  readonly colourDepth: number;
  readonly supportsBasicColour: boolean;
  readonly supportsAnsiSgr: boolean;
  readonly supportsBrightness: boolean;
  readonly supportsCursorControl: boolean;
  readonly supportsUnicode: boolean;
  readonly supportsEmoji: boolean;
  readonly width: number;
  readonly source: CliCapabilitySource;
}

export class CliOptionError extends Error {
  public readonly code: string;
  public readonly option: string;
  public readonly suggestion: string;
  public readonly allowedValues: readonly string[];

  public constructor(
    code: string,
    option: string,
    message: string,
    suggestion: string,
    allowedValues: readonly string[] = [],
  ) {
    super(message);
    this.name = "CliOptionError";
    this.code = code;
    this.option = option;
    this.suggestion = suggestion;
    this.allowedValues = allowedValues;
  }
}

export interface TerminalCapabilities {
  readonly outputMode: CliOutputMode;
  readonly rich: boolean;
  readonly ansi: boolean;
  readonly progressAnsi: boolean;
  readonly brightness: boolean;
  readonly cursorControl: boolean;
  readonly color: boolean;
  readonly unicode: boolean;
  readonly emoji: boolean;
  readonly emojiMode: CliEmojiMode;
  readonly effectiveEmojiMode: CliEffectiveEmojiMode;
  readonly requestedSymbolMode: CliRequestedSymbolMode;
  readonly symbolMode: CliSymbolMode;
  readonly requestedProgressStyle: CliProgressStyle;
  readonly effectiveProgressStyle: CliProgressStyle;
  readonly progressStyle: CliProgressStyle;
  readonly fallbackReason: string;
  readonly capabilitySources: readonly CliCapabilitySource[];
  readonly animation: boolean;
  readonly windowsTerminal: boolean;
  readonly ci: boolean;
  readonly termDumb: boolean;
  readonly width: number;
  readonly stdoutIsTty: boolean;
  readonly stderrIsTty: boolean;
  readonly stdout: CliStreamCapabilities;
  readonly stderr: CliStreamCapabilities;
}

export interface TerminalCapabilityInput {
  readonly arguments: readonly string[];
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly stdout?: CliCapabilityStream;
  readonly stderr?: CliCapabilityStream;
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
const PROGRESS_STYLES = Object.freeze([
  "thinking",
  "spinner",
  "static",
] as const);

function progressStyleArgument(
  arguments_: readonly string[],
): string | undefined {
  return arguments_
    .find((entry) => entry.startsWith("--progress-style="))
    ?.slice("--progress-style=".length);
}

export function isCliPresentationArgument(value: string): boolean {
  return (
    value === "--plain" ||
    value === "--no-animation" ||
    value === "--unicode" ||
    value === "--ascii" ||
    value === "--emoji" ||
    value === "--no-emoji" ||
    value.startsWith("--progress-style=")
  );
}

export function validateCliPresentationArguments(
  arguments_: readonly string[],
): void {
  const styleArguments = arguments_.filter((entry) =>
    entry.startsWith("--progress-style="),
  );
  const style = progressStyleArgument(arguments_);
  if (
    styleArguments.length > 1 ||
    style === undefined ||
    !PROGRESS_STYLES.includes(style as CliProgressStyle)
  ) {
    if (styleArguments.length > 0)
      throw new CliOptionError(
        "CLI_PROGRESS_STYLE_UNSUPPORTED",
        "--progress-style",
        `The progress style ${style === "" ? "<empty>" : JSON.stringify(style)} is unsupported.`,
        "Choose one supported progress style.",
        PROGRESS_STYLES,
      );
  }
  if (arguments_.includes("--unicode") && arguments_.includes("--ascii"))
    throw new CliOptionError(
      "CLI_SYMBOL_MODE_CONFLICT",
      "--unicode/--ascii",
      "Unicode and ASCII symbol modes cannot be requested together.",
      "Choose either --unicode or --ascii.",
      ["--unicode", "--ascii"],
    );
  if (arguments_.includes("--emoji") && arguments_.includes("--no-emoji"))
    throw new CliOptionError(
      "CLI_EMOJI_MODE_CONFLICT",
      "--emoji/--no-emoji",
      "Emoji cannot be both requested and disabled.",
      "Choose either --emoji or --no-emoji.",
      ["--emoji", "--no-emoji"],
    );
  if (arguments_.includes("--ascii") && arguments_.includes("--emoji"))
    throw new CliOptionError(
      "CLI_ASCII_EMOJI_CONFLICT",
      "--ascii/--emoji",
      "ASCII mode cannot render an emoji progress symbol.",
      "Remove --emoji or replace --ascii with --unicode.",
      ["--ascii --no-emoji", "--unicode --emoji"],
    );
  if (arguments_.includes("--json") && arguments_.includes("--summary-json"))
    throw new CliOptionError(
      "CLI_JSON_MODE_CONFLICT",
      "--json/--summary-json",
      "Private JSON and safe summary JSON cannot be emitted together.",
      "Choose either --json or --summary-json.",
      ["--json", "--summary-json"],
    );
  const humanOptions = arguments_.filter(isCliPresentationArgument);
  if (
    (arguments_.includes("--json") || arguments_.includes("--summary-json")) &&
    humanOptions.length > 0
  )
    throw new CliOptionError(
      "CLI_JSON_HUMAN_OPTION_CONFLICT",
      humanOptions[0] ?? "human-output option",
      "JSON output cannot be combined with human terminal presentation options.",
      "Remove the human presentation option when requesting JSON.",
      ["--json", "--summary-json"],
    );
}

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

function capabilityEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): NodeJS.ProcessEnv {
  return {
    ...(environment.TERM === undefined ? {} : { TERM: environment.TERM }),
    ...(environment.COLORTERM === undefined
      ? {}
      : { COLORTERM: environment.COLORTERM }),
    ...(environment.TERM_PROGRAM === undefined
      ? {}
      : { TERM_PROGRAM: environment.TERM_PROGRAM }),
    ...(environment.WT_SESSION === undefined ? {} : { WT_SESSION: "1" }),
  };
}

function safeColourDepth(
  stream: CliCapabilityStream | undefined,
  environment?: NodeJS.ProcessEnv,
): number | undefined {
  try {
    const value =
      environment === undefined
        ? stream?.getColorDepth?.()
        : stream?.getColorDepth?.(environment);
    return value === undefined || !Number.isFinite(value)
      ? undefined
      : Math.max(1, Math.floor(value));
  } catch {
    return undefined;
  }
}

function safeHasBasicColour(
  stream: CliCapabilityStream | undefined,
  environment?: NodeJS.ProcessEnv,
): boolean | undefined {
  try {
    return environment === undefined
      ? stream?.hasColors?.(16)
      : stream?.hasColors?.(16, environment);
  } catch {
    return undefined;
  }
}

function detectStreamCapabilities(input: {
  readonly stream?: CliCapabilityStream;
  readonly legacyIsTty?: boolean;
  readonly legacyColumns?: number;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly platform: NodeJS.Platform;
  readonly termDumb: boolean;
  readonly terminalHint: boolean;
}): CliStreamCapabilities {
  const isInteractive = input.stream?.isTTY ?? input.legacyIsTty === true;
  const hasSemanticColourOverride =
    input.environment.NO_COLOR !== undefined ||
    input.environment.FORCE_COLOR === "0";
  const probeEnvironment = hasSemanticColourOverride
    ? capabilityEnvironment(input.environment)
    : undefined;
  const colourDepth = safeColourDepth(input.stream, probeEnvironment);
  const hasBasicColour = safeHasBasicColour(input.stream, probeEnvironment);
  const streamApiAvailable =
    colourDepth !== undefined || hasBasicColour !== undefined;
  const positiveStreamEvidence =
    (colourDepth ?? 0) >= 4 || hasBasicColour === true;
  const fallbackAnsiHint = input.platform !== "win32" || input.terminalHint;
  const supportsAnsiSgr =
    isInteractive &&
    !input.termDumb &&
    (streamApiAvailable ? positiveStreamEvidence : fallbackAnsiHint);
  const supportsUnicode =
    isInteractive &&
    !input.termDumb &&
    (input.platform !== "win32" ||
      positiveStreamEvidence ||
      input.terminalHint);
  const supportsEmoji =
    supportsUnicode &&
    (input.platform === "win32"
      ? positiveStreamEvidence || input.terminalHint
      : input.terminalHint);
  return Object.freeze({
    isInteractive,
    colourDepth: colourDepth ?? 1,
    supportsBasicColour: streamApiAvailable
      ? positiveStreamEvidence
      : supportsAnsiSgr,
    supportsAnsiSgr,
    supportsBrightness: supportsAnsiSgr,
    supportsCursorControl: supportsAnsiSgr,
    supportsUnicode,
    supportsEmoji,
    width: boundedWidth(input.stream?.columns ?? input.legacyColumns),
    source: streamApiAvailable
      ? "stream-apis"
      : input.terminalHint
        ? "terminal-hint"
        : "fallback",
  });
}

export function detectTerminalCapabilities(
  input: TerminalCapabilityInput,
): TerminalCapabilities {
  const environment = input.environment ?? {};
  const platform = input.platform ?? process.platform;
  const json = input.arguments.includes("--json");
  const summaryJson = input.arguments.includes("--summary-json");
  const explicitlyPlain = input.arguments.includes("--plain");
  const ci = environmentFlag(environment.CI);
  const dumb = environment.TERM?.toLowerCase() === "dumb";
  const requestedStyle = PROGRESS_STYLES.includes(
    progressStyleArgument(input.arguments) as CliProgressStyle,
  )
    ? (progressStyleArgument(input.arguments) as CliProgressStyle)
    : "thinking";
  const emojiMode: CliEmojiMode = input.arguments.includes("--emoji")
    ? "always"
    : input.arguments.includes("--no-emoji")
      ? "never"
      : "auto";
  const windowsTerminal =
    platform === "win32" && environment.WT_SESSION !== undefined;
  const terminalHint =
    windowsTerminal || environment.TERM_PROGRAM !== undefined;
  const stdout = detectStreamCapabilities({
    ...(input.stdout === undefined ? {} : { stream: input.stdout }),
    ...(input.stdoutIsTty === undefined
      ? {}
      : { legacyIsTty: input.stdoutIsTty }),
    ...(input.columns === undefined ? {} : { legacyColumns: input.columns }),
    environment,
    platform,
    termDumb: dumb,
    terminalHint,
  });
  const stderr = detectStreamCapabilities({
    ...(input.stderr === undefined ? {} : { stream: input.stderr }),
    ...(input.stderrIsTty === undefined
      ? {}
      : { legacyIsTty: input.stderrIsTty }),
    ...(input.columns === undefined ? {} : { legacyColumns: input.columns }),
    environment,
    platform,
    termDumb: dumb,
    terminalHint,
  });
  const stdoutIsTty = stdout.isInteractive;
  const stderrIsTty = stderr.isInteractive;
  const width = stdout.width;
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
  const asciiRequested =
    input.arguments.includes("--ascii") || environment.AEGIS_ASCII === "1";
  const unicodeRequested = input.arguments.includes("--unicode");
  const requestedSymbolMode: CliRequestedSymbolMode = asciiRequested
    ? "ascii"
    : unicodeRequested
      ? "unicode"
      : "auto";
  const symbolOverride =
    asciiRequested || unicodeRequested || emojiMode !== "auto";
  const unicode =
    rich &&
    !asciiRequested &&
    (unicodeRequested || emojiMode === "always" || stdout.supportsUnicode);
  const emoji =
    unicode &&
    emojiMode !== "never" &&
    (emojiMode === "always" || stdout.supportsEmoji);
  const symbolMode: CliSymbolMode = asciiRequested
    ? "ascii"
    : emoji
      ? "emoji"
      : unicode
        ? "unicode"
        : "ascii";
  const noAnimation = input.arguments.includes("--no-animation");
  const baseAnimation =
    rich && stderrIsTty && stderr.supportsCursorControl && !noAnimation;
  const animation = baseAnimation && requestedStyle !== "static";
  const effectiveProgressStyle: CliProgressStyle = !animation
    ? "static"
    : requestedStyle === "thinking" && !stderr.supportsBrightness
      ? "spinner"
      : requestedStyle;
  const fallbackReason =
    effectiveProgressStyle === requestedStyle
      ? "none"
      : !rich
        ? "Human rich output is disabled by the output contract."
        : noAnimation
          ? "Animation was disabled explicitly."
          : !stderrIsTty
            ? "Transient stderr is not an interactive TTY."
            : !stderr.supportsCursorControl
              ? "Cursor control is unsupported on transient stderr."
              : requestedStyle === "thinking" && !stderr.supportsBrightness
                ? "ANSI brightness is unsupported on transient stderr."
                : "The requested progress style is unavailable.";
  const capabilitySources = Object.freeze([
    ...new Set<CliCapabilitySource>([
      stdout.source,
      stderr.source,
      ...(symbolOverride ? (["explicit-override"] as const) : []),
    ]),
  ]);
  return Object.freeze({
    outputMode: json
      ? "private-json"
      : summaryJson
        ? "summary-json"
        : rich
          ? "rich"
          : "plain",
    rich,
    ansi: rich && stdout.supportsAnsiSgr,
    progressAnsi: rich && stderr.supportsAnsiSgr,
    brightness: rich && stderr.supportsBrightness,
    cursorControl: rich && stderr.supportsCursorControl,
    color:
      rich && stdout.supportsBasicColour && !noColor && !forceColorDisabled,
    unicode,
    emoji,
    emojiMode,
    effectiveEmojiMode: emoji ? "enabled" : "disabled",
    requestedSymbolMode,
    symbolMode,
    requestedProgressStyle: requestedStyle,
    effectiveProgressStyle,
    progressStyle: effectiveProgressStyle,
    fallbackReason,
    capabilitySources,
    animation,
    windowsTerminal,
    ci,
    termDumb: dumb,
    width,
    stdoutIsTty,
    stderrIsTty,
    stdout,
    stderr,
  });
}

function colorize(
  value: string,
  status: CliKeyValueRow["status"],
  capabilities: TerminalCapabilities,
): string {
  if (!capabilities.color) return value;
  const color =
    status === "success"
      ? ANSI_STYLE.green
      : status === "warning"
        ? ANSI_STYLE.yellow
        : status === "danger"
          ? ANSI_STYLE.red
          : ANSI_STYLE.cyan;
  return `${color}${value}${ANSI_STYLE.reset}`;
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
  const available = (): number => Math.max(10, width - visibleWidth(prefix()));
  const emit = (): void => {
    lines.push(`${prefix()}${line}`);
    line = "";
    firstLine = false;
  };
  for (const originalWord of normalized.split(" ")) {
    let word = originalWord;
    if (visibleWidth(word) > available()) {
      if (line !== "") {
        emit();
      }
      while (visibleWidth(word) > available()) {
        const [head, tail] = splitAtVisibleWidth(word, available());
        line = head;
        word = tail;
        emit();
      }
    }
    if (word === "") continue;
    if (line === "") line = word;
    else if (visibleWidth(line) + visibleWidth(word) + 1 <= available())
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

function sectionLabelWidth(
  rows: readonly CliKeyValueRow[],
  contentWidth: number,
): number {
  const longest = Math.max(12, ...rows.map(({ label }) => visibleWidth(label)));
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
    if (visibleWidth(labelText) > labelWidth + 1) {
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
    const firstPrefix = `${padToWidth(labelText, labelWidth + 1)} `;
    const continuationPrefix = " ".repeat(visibleWidth(firstPrefix));
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
  const top = `${left}${heading}${horizontal.repeat(Math.max(0, innerWidth - visibleWidth(heading)))}${right}`;
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
      Math.max(0, innerWidth - visibleWidth(titleText)),
    )}${topRight}`;
    const body = renderSectionRows(rows, capabilities, contentWidth).map(
      (line) => `${vertical}  ${padToWidth(line, contentWidth)}  ${vertical}`,
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
  const contentWidth = capabilities.width - visibleWidth(contentIndent);
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
  const continuationPrefix = " ".repeat(visibleWidth(prefix));
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
