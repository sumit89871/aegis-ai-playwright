import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CLI_PROGRESS_DELAY_MS,
  CLI_PROGRESS_REFRESH_MS,
  CliOptionError,
  createCliProgressReporter,
  detectTerminalCapabilities,
  isCliPresentationArgument,
  renderCliBanner,
  renderCliError,
  renderCliNotice,
  renderCliSection,
  renderCliStatusLine,
  validateCliPresentationArguments,
} from "@aegis/core";
import type { CliProgressReporter, TerminalCapabilities } from "@aegis/core";

export const CLI_PROGRESS_DEMO_STAGE_DURATION_MS = 900;
export const CLI_PROGRESS_DEMO_STAGES = Object.freeze([
  "Starting CLI progress demonstration",
  "Loading demonstration data",
  "Validating terminal rendering",
  "Rendering thinking animation",
  "Completing demonstration",
]);

interface DemoOutputStream {
  write(value: string): unknown;
}

export async function runCliProgressDemonstration(options: {
  readonly capabilities: TerminalCapabilities;
  readonly progress: CliProgressReporter;
  readonly stdout: DemoOutputStream;
  readonly wait?: (milliseconds: number) => Promise<void>;
}): Promise<void> {
  const wait =
    options.wait ??
    (async (milliseconds: number): Promise<void> =>
      new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds)));
  const firstStage = CLI_PROGRESS_DEMO_STAGES[0];
  if (firstStage !== undefined) options.progress.start(firstStage);
  for (let index = 0; index < CLI_PROGRESS_DEMO_STAGES.length; index += 1) {
    await wait(CLI_PROGRESS_DEMO_STAGE_DURATION_MS);
    const nextStage = CLI_PROGRESS_DEMO_STAGES[index + 1];
    if (nextStage !== undefined) options.progress.update(nextStage);
  }
  options.progress.succeed();
  options.stdout.write(
    `${[
      renderCliStatusLine(
        "success",
        "CLI progress demonstration completed",
        options.capabilities,
      ),
      renderCliBanner(
        "AegisAI · CLI Progress Demonstration",
        options.capabilities,
      ),
      renderCliNotice(
        "INFO",
        "This presentation-only command performs no business evaluation, artifact access, browser work, AI call, locator application, or healing.",
        options.capabilities,
      ),
      renderCliSection(
        "Demonstration result",
        [
          {
            label: "Requested progress style",
            value: options.capabilities.requestedProgressStyle,
          },
          {
            label: "Effective progress style",
            value: options.capabilities.effectiveProgressStyle,
          },
          {
            label: "Symbol mode",
            value: options.capabilities.symbolMode,
          },
          {
            label: "ANSI brightness",
            value: options.capabilities.brightness
              ? "supported"
              : "unsupported",
          },
          {
            label: "Animation",
            value: options.capabilities.animation ? "enabled" : "disabled",
          },
          {
            label: "Fallback reason",
            value: options.capabilities.fallbackReason,
          },
          { label: "Network calls", value: "0", status: "success" },
          { label: "User artifacts", value: "not accessed", status: "success" },
          {
            label: "Result",
            value: "progress cleanup complete",
            status: "success",
          },
        ],
        options.capabilities,
      ),
    ].join("\n\n")}\n`,
  );
}

export function renderCliTerminalDiagnostic(
  capabilities: TerminalCapabilities,
): string {
  return renderCliSection(
    "Safe terminal diagnostic",
    [
      { label: "stdout TTY", value: String(capabilities.stdoutIsTty) },
      { label: "stderr TTY", value: String(capabilities.stderrIsTty) },
      {
        label: "stdout colour depth",
        value: String(capabilities.stdout.colourDepth),
      },
      {
        label: "stderr colour depth",
        value: String(capabilities.stderr.colourDepth),
      },
      {
        label: "stdout basic colour",
        value: String(capabilities.stdout.supportsBasicColour),
      },
      {
        label: "stderr basic colour",
        value: String(capabilities.stderr.supportsBasicColour),
      },
      { label: "Terminal width", value: String(capabilities.width) },
      { label: "CI", value: String(capabilities.ci) },
      { label: "TERM dumb", value: String(capabilities.termDumb) },
      {
        label: "Windows Terminal hint",
        value: String(capabilities.windowsTerminal),
      },
      {
        label: "Capability source",
        value: capabilities.capabilitySources.join(", "),
      },
      { label: "Output mode", value: capabilities.outputMode },
      { label: "Colour enabled", value: String(capabilities.color) },
      { label: "ANSI SGR supported", value: String(capabilities.progressAnsi) },
      {
        label: "ANSI brightness",
        value: String(capabilities.brightness),
      },
      { label: "Unicode supported", value: String(capabilities.unicode) },
      { label: "Emoji supported", value: String(capabilities.emoji) },
      {
        label: "Requested symbol mode",
        value: capabilities.requestedSymbolMode,
      },
      { label: "Effective symbol mode", value: capabilities.symbolMode },
      { label: "Requested emoji mode", value: capabilities.emojiMode },
      {
        label: "Effective emoji mode",
        value: capabilities.effectiveEmojiMode,
      },
      {
        label: "Requested progress style",
        value: capabilities.requestedProgressStyle,
      },
      {
        label: "Effective progress style",
        value: capabilities.effectiveProgressStyle,
      },
      { label: "Animation enabled", value: String(capabilities.animation) },
      { label: "Fallback reason", value: capabilities.fallbackReason },
      { label: "Delayed start", value: `${String(CLI_PROGRESS_DELAY_MS)} ms` },
      { label: "Refresh", value: `${String(CLI_PROGRESS_REFRESH_MS)} ms` },
    ],
    capabilities,
  );
}

async function main(): Promise<void> {
  const arguments_ = process.argv.slice(2);
  const capabilities = detectTerminalCapabilities({
    arguments: arguments_,
    environment: process.env,
    stdout: process.stdout,
    stderr: process.stderr,
    platform: process.platform,
  });
  const progress = createCliProgressReporter({
    capabilities,
    stream: process.stderr,
  });
  const interrupt = (exitCode: number): void => {
    progress.interrupt();
    process.exit(exitCode);
  };
  const interruptSignal = (): void => {
    interrupt(130);
  };
  const terminateSignal = (): void => {
    interrupt(143);
  };
  const exitCleanup = (): void => {
    progress.dispose();
  };
  process.once("SIGINT", interruptSignal);
  process.once("SIGTERM", terminateSignal);
  process.once("exit", exitCleanup);
  try {
    validateCliPresentationArguments(arguments_);
    const unsupported = arguments_.find(
      (entry) =>
        entry !== "--diagnose-terminal" && !isCliPresentationArgument(entry),
    );
    if (unsupported !== undefined)
      throw new CliOptionError(
        "CLI_OPTION_UNSUPPORTED",
        unsupported,
        "The CLI progress demonstration does not support this option.",
        "Use a documented progress, symbol, animation, or diagnostic option.",
      );
    if (arguments_.includes("--diagnose-terminal")) {
      process.stdout.write(`${renderCliTerminalDiagnostic(capabilities)}\n`);
      return;
    }
    await runCliProgressDemonstration({
      capabilities,
      progress,
      stdout: process.stdout,
    });
  } catch (caught) {
    progress.fail();
    const optionError = caught as Partial<CliOptionError>;
    process.stderr.write(
      `${renderCliError(
        {
          title: "CLI progress demonstration failed",
          code:
            optionError.name === "CliOptionError"
              ? (optionError.code ?? "CLI_OPTION_INVALID")
              : "CLI_DEMO_FAILED",
          ...(optionError.name === "CliOptionError" &&
          optionError.option !== undefined
            ? { fieldPath: optionError.option }
            : {}),
          message:
            optionError.name === "CliOptionError"
              ? (optionError.message ?? "The terminal option is invalid.")
              : "The presentation-only demonstration could not complete safely.",
          suggestion:
            optionError.name === "CliOptionError"
              ? `${optionError.suggestion ?? "Choose a supported option."}${
                  optionError.allowedValues === undefined ||
                  optionError.allowedValues.length === 0
                    ? ""
                    : ` Supported: ${optionError.allowedValues.join(", ")}.`
                }`
              : "Retry with a documented presentation option.",
        },
        capabilities,
      )}\n`,
    );
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", interruptSignal);
    process.removeListener("SIGTERM", terminateSignal);
    process.removeListener("exit", exitCleanup);
    progress.dispose();
  }
}

const executedPath =
  process.argv[1] === undefined ? "" : resolve(process.argv[1]);
if (executedPath === resolve(fileURLToPath(import.meta.url))) await main();
