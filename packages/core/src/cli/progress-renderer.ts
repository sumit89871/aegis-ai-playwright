import {
  ANSI_RESET,
  ANSI_STYLE,
  THINKING_BRIGHTNESS_FRAMES,
} from "./ansi-styles.ts";
import type {
  CliProgressStyle,
  CliSymbolMode,
  TerminalCapabilities,
} from "./terminal-presentation.ts";
import { padToWidth, truncateToWidth, visibleWidth } from "./terminal-width.ts";

export interface CliProgressStream {
  readonly isTTY?: boolean;
  write(value: string): unknown;
}

export interface CliProgressScheduler {
  readonly now: () => number;
  readonly setTimeout: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
  readonly setInterval: (callback: () => void, delayMs: number) => unknown;
  readonly clearInterval: (handle: unknown) => void;
  readonly unref?: (handle: unknown) => void;
}

export interface CliProgressReporter {
  start(stage: string): void;
  update(stage: string): void;
  succeed(message?: string): void;
  fail(message?: string): void;
  stop(): void;
  interrupt(): void;
  dispose(): void;
}

export type CliStatusKind =
  "success" | "warning" | "failure" | "information" | "not-applicable";

export const CLI_PROGRESS_DELAY_MS = 400;
export const CLI_PROGRESS_REFRESH_MS = 150;
export const CLI_THINKING_EMOJI = "💭";
export const CLI_UNICODE_PROGRESS_SYMBOL = "↻";
export const CLI_ASCII_PROGRESS_SYMBOL = "[~]";

const UNICODE_SPINNER_FRAMES = Object.freeze([
  "⠋",
  "⠙",
  "⠹",
  "⠸",
  "⠼",
  "⠴",
  "⠦",
  "⠧",
  "⠇",
  "⠏",
]);
const ASCII_SPINNER_FRAMES = Object.freeze(["-", "\\", "|", "/"]);

const defaultScheduler: CliProgressScheduler = {
  now: Date.now,
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => {
    clearTimeout(handle as NodeJS.Timeout);
  },
  setInterval: (callback, delayMs) => setInterval(callback, delayMs),
  clearInterval: (handle) => {
    clearInterval(handle as NodeJS.Timeout);
  },
  unref: (handle) => {
    (handle as NodeJS.Timeout).unref();
  },
};

export function cliProgressSymbol(mode: CliSymbolMode): string {
  return mode === "emoji"
    ? CLI_THINKING_EMOJI
    : mode === "unicode"
      ? CLI_UNICODE_PROGRESS_SYMBOL
      : CLI_ASCII_PROGRESS_SYMBOL;
}

export function cliStatusSymbol(
  kind: CliStatusKind,
  mode: CliSymbolMode,
): string {
  if (mode === "emoji") {
    if (kind === "success") return "✅";
    if (kind === "warning") return "⚠️";
    if (kind === "failure") return "❌";
    if (kind === "information") return "ℹ️";
    return "○";
  }
  if (mode === "unicode") {
    if (kind === "success") return "✓";
    if (kind === "warning") return "⚠";
    if (kind === "failure") return "✗";
    return "○";
  }
  if (kind === "success") return "[OK]";
  if (kind === "warning") return "[WARN]";
  if (kind === "failure") return "[FAIL]";
  if (kind === "information") return "[INFO]";
  return "[N/A]";
}

export function renderCliStatusLine(
  kind: CliStatusKind,
  message: string,
  capabilities: TerminalCapabilities,
): string {
  return `${cliStatusSymbol(kind, capabilities.symbolMode)} ${message}`;
}

export function resolveCliProgressStyle(
  capabilities: TerminalCapabilities,
): CliProgressStyle {
  if (!capabilities.animation || capabilities.progressStyle === "static")
    return "static";
  if (capabilities.progressStyle === "thinking" && !capabilities.brightness)
    return "spinner";
  return capabilities.progressStyle;
}

function messageWithEllipsis(stage: string): string {
  const normalized = stage
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/\.{3}$/u, "");
  return `${normalized}...`;
}

function boundedMessage(message: string, width: number): string {
  if (visibleWidth(message) <= width) return message;
  if (width <= 3) return truncateToWidth("...", width);
  return `${truncateToWidth(message, width - 3).replace(/\s+$/u, "")}...`;
}

export function createCliProgressReporter(options: {
  readonly capabilities: TerminalCapabilities;
  readonly stream: CliProgressStream;
  readonly scheduler?: CliProgressScheduler;
  readonly delayMs?: number;
  readonly intervalMs?: number;
  readonly style?: CliProgressStyle;
}): CliProgressReporter {
  const scheduler = options.scheduler ?? defaultScheduler;
  const enabled =
    options.capabilities.rich &&
    options.capabilities.stderrIsTty &&
    options.stream.isTTY !== false;
  const requestedStyle = options.style ?? options.capabilities.progressStyle;
  const effectiveStyle = resolveCliProgressStyle({
    ...options.capabilities,
    progressStyle: requestedStyle,
  });
  const animated = enabled && effectiveStyle !== "static";
  const spinnerFrames = options.capabilities.unicode
    ? UNICODE_SPINNER_FRAMES
    : ASCII_SPINNER_FRAMES;
  const stableSymbol = cliProgressSymbol(options.capabilities.symbolMode);
  let stage = "";
  let frameIndex = 0;
  let delayHandle: unknown;
  let intervalHandle: unknown;
  let visible = false;
  let started = false;
  let finished = false;

  const stopTimers = (): void => {
    if (delayHandle !== undefined) scheduler.clearTimeout(delayHandle);
    if (intervalHandle !== undefined) scheduler.clearInterval(intervalHandle);
    delayHandle = undefined;
    intervalHandle = undefined;
  };
  const clearTransient = (): void => {
    if (!visible || !animated) return;
    const reset = options.capabilities.ansi ? ANSI_RESET : "";
    const clear = options.capabilities.ansi
      ? ANSI_STYLE.clearLine
      : " ".repeat(options.capabilities.width);
    const showCursor = options.capabilities.ansi ? ANSI_STYLE.showCursor : "";
    options.stream.write(`${reset}\r${clear}\r${showCursor}`);
    visible = false;
  };
  const renderAnimatedFrame = (): void => {
    if (finished || !started || !animated) return;
    const message = messageWithEllipsis(stage);
    let line: string;
    if (effectiveStyle === "thinking") {
      const brightness =
        THINKING_BRIGHTNESS_FRAMES[
          frameIndex % THINKING_BRIGHTNESS_FRAMES.length
        ] ?? ANSI_RESET;
      const maximumMessageWidth = Math.max(
        1,
        options.capabilities.width - visibleWidth(stableSymbol) - 1,
      );
      const safeMessage = boundedMessage(message, maximumMessageWidth);
      line = `${stableSymbol} ${brightness}${safeMessage}${ANSI_RESET}`;
    } else {
      const symbol =
        spinnerFrames[frameIndex % spinnerFrames.length] ??
        CLI_ASCII_PROGRESS_SYMBOL;
      const maximumMessageWidth = Math.max(
        1,
        options.capabilities.width - visibleWidth(symbol) - 1,
      );
      line = `${symbol} ${boundedMessage(message, maximumMessageWidth)}`;
    }
    const hideCursor = options.capabilities.ansi ? ANSI_STYLE.hideCursor : "";
    const clear = options.capabilities.ansi ? ANSI_STYLE.clearLine : "";
    options.stream.write(
      `\r${clear}${hideCursor}${padToWidth(line, options.capabilities.width)}`,
    );
    visible = true;
    frameIndex += 1;
  };
  const renderStaticStage = (): void => {
    if (finished || !started || !enabled) return;
    options.stream.write(`[PROGRESS] ${stage}\n`);
    visible = true;
  };
  const renderFrame = (): void => {
    if (animated) renderAnimatedFrame();
    else renderStaticStage();
  };
  const schedule = (): void => {
    if (!enabled || finished) return;
    delayHandle = scheduler.setTimeout(() => {
      delayHandle = undefined;
      renderFrame();
      if (animated) {
        intervalHandle = scheduler.setInterval(
          renderFrame,
          options.intervalMs ?? CLI_PROGRESS_REFRESH_MS,
        );
        scheduler.unref?.(intervalHandle);
      }
    }, options.delayMs ?? CLI_PROGRESS_DELAY_MS);
    scheduler.unref?.(delayHandle);
  };
  const finish = (kind?: CliStatusKind, message?: string): void => {
    if (finished) return;
    finished = true;
    stopTimers();
    clearTransient();
    if (message !== undefined && enabled)
      options.stream.write(
        `${renderCliStatusLine(kind ?? "information", message, options.capabilities)}\n`,
      );
  };

  return Object.freeze({
    start(nextStage: string): void {
      if (finished) return;
      if (started) {
        stage = nextStage;
        if (visible) renderFrame();
        return;
      }
      started = true;
      stage = nextStage;
      schedule();
    },
    update(nextStage: string): void {
      if (finished || !started) return;
      stage = nextStage;
      if (visible) renderFrame();
    },
    succeed(message?: string): void {
      finish("success", message);
    },
    fail(message?: string): void {
      finish("failure", message);
    },
    stop(): void {
      finish();
    },
    interrupt(): void {
      finish("warning", "Interrupted.");
    },
    dispose(): void {
      finish();
    },
  });
}
