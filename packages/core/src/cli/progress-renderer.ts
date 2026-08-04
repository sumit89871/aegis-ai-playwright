import type { TerminalCapabilities } from "./terminal-presentation.ts";

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
}

export interface CliProgressReporter {
  start(stage: string): void;
  update(stage: string): void;
  succeed(): void;
  fail(): void;
  interrupt(): void;
  dispose(): void;
}

const DEFAULT_DELAY_MS = 300;
const DEFAULT_INTERVAL_MS = 80;

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
};

export function createCliProgressReporter(options: {
  readonly capabilities: TerminalCapabilities;
  readonly stream: CliProgressStream;
  readonly scheduler?: CliProgressScheduler;
  readonly delayMs?: number;
  readonly intervalMs?: number;
}): CliProgressReporter {
  const scheduler = options.scheduler ?? defaultScheduler;
  const enabled =
    options.capabilities.rich &&
    options.capabilities.stderrIsTty &&
    options.stream.isTTY !== false;
  const animated = enabled && options.capabilities.animation;
  const frames = options.capabilities.unicode
    ? ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
    : ["-", "\\", "|", "/"];
  let stage = "";
  let frame = 0;
  let delayHandle: unknown;
  let intervalHandle: unknown;
  let visible = false;
  let disposed = false;

  const clearTransient = (): void => {
    if (!visible || !animated) return;
    options.stream.write("\r\u001B[2K\u001B[?25h");
    visible = false;
  };
  const renderFrame = (): void => {
    if (disposed) return;
    visible = true;
    if (animated) {
      const symbol = frames[frame % frames.length] ?? "-";
      options.stream.write(`\r\u001B[2K\u001B[?25l${symbol} ${stage}`);
      frame += 1;
    } else options.stream.write(`[PROGRESS] ${stage}\n`);
  };
  const stopTimers = (): void => {
    if (delayHandle !== undefined) scheduler.clearTimeout(delayHandle);
    if (intervalHandle !== undefined) scheduler.clearInterval(intervalHandle);
    delayHandle = undefined;
    intervalHandle = undefined;
  };
  const schedule = (): void => {
    if (!enabled || disposed) return;
    delayHandle = scheduler.setTimeout(() => {
      delayHandle = undefined;
      renderFrame();
      if (animated)
        intervalHandle = scheduler.setInterval(
          renderFrame,
          options.intervalMs ?? DEFAULT_INTERVAL_MS,
        );
    }, options.delayMs ?? DEFAULT_DELAY_MS);
  };
  const finish = (failureMessage?: string): void => {
    stopTimers();
    clearTransient();
    if (failureMessage !== undefined && enabled)
      options.stream.write(`[ERROR] ${failureMessage}\n`);
    disposed = true;
  };

  return Object.freeze({
    start(nextStage: string): void {
      if (disposed || !enabled) return;
      stage = nextStage;
      schedule();
    },
    update(nextStage: string): void {
      if (disposed || !enabled) return;
      stage = nextStage;
      if (visible) renderFrame();
    },
    succeed(): void {
      finish();
    },
    fail(): void {
      finish("Operation failed.");
    },
    interrupt(): void {
      finish("Interrupted.");
    },
    dispose(): void {
      finish();
    },
  });
}
