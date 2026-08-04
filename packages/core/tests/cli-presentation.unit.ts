import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ANSI_BRIGHT,
  ANSI_DIM,
  ANSI_NORMAL,
  ANSI_RESET,
  CLI_MAXIMUM_RENDER_WIDTH,
  CLI_MINIMUM_BORDERED_WIDTH,
  CLI_ASCII_PROGRESS_SYMBOL,
  CLI_PROGRESS_DELAY_MS,
  CLI_PROGRESS_REFRESH_MS,
  CLI_THINKING_EMOJI,
  CLI_UNICODE_PROGRESS_SYMBOL,
  THINKING_BRIGHTNESS_FRAMES,
  CliOptionError,
  cliProgressSymbol,
  cliStatusSymbol,
  createCliProgressReporter,
  createLocatorBlindHoldoutAggregateSummary,
  detectTerminalCapabilities,
  padToWidth,
  renderCliError,
  renderCliNotice,
  renderCliSection,
  renderLocatorBlindHoldoutTerminal,
  runLocatorBlindHoldoutEvaluation,
  stripAnsi,
  splitAtVisibleWidth,
  truncateToWidth,
  usesBorderedCliLayout,
  validateCliPresentationArguments,
  visibleWidth,
  wrapCliText,
} from "../src/index.ts";
import type {
  CliCapabilityStream,
  CliProgressScheduler,
  LocatorBlindHoldoutAggregateSummary,
  TerminalCapabilities,
} from "../src/index.ts";

function capabilities(
  options: {
    readonly arguments?: readonly string[];
    readonly environment?: Readonly<Record<string, string | undefined>>;
    readonly stdoutIsTty?: boolean;
    readonly stderrIsTty?: boolean;
    readonly columns?: number;
    readonly platform?: NodeJS.Platform;
    readonly stdout?: CliCapabilityStream;
    readonly stderr?: CliCapabilityStream;
  } = {},
): TerminalCapabilities {
  return detectTerminalCapabilities({
    arguments: options.arguments ?? [],
    environment: options.environment ?? {},
    ...(options.stdout === undefined ? {} : { stdout: options.stdout }),
    ...(options.stderr === undefined ? {} : { stderr: options.stderr }),
    stdoutIsTty: options.stdoutIsTty ?? true,
    stderrIsTty: options.stderrIsTty ?? true,
    columns: options.columns ?? 100,
    platform: options.platform ?? "linux",
  });
}

function capableStream(
  options: {
    readonly isTTY?: boolean;
    readonly columns?: number;
    readonly colourDepth?: number;
    readonly hasBasicColour?: boolean;
  } = {},
): CliCapabilityStream {
  return {
    isTTY: options.isTTY ?? true,
    columns: options.columns ?? 100,
    getColorDepth: () => options.colourDepth ?? 24,
    hasColors: () => options.hasBasicColour ?? true,
  };
}

async function emptySummary(): Promise<LocatorBlindHoldoutAggregateSummary> {
  return createLocatorBlindHoldoutAggregateSummary(
    await runLocatorBlindHoldoutEvaluation([], {
      calibrationPilotReviewed: 5,
    }),
  );
}

class FakeScheduler implements CliProgressScheduler {
  public currentTime = 0;
  public unrefCount = 0;
  private nextId = 1;
  private readonly timeouts = new Map<
    number,
    { readonly callback: () => void; readonly due: number }
  >();
  private readonly intervals = new Map<
    number,
    { readonly callback: () => void; readonly delay: number; due: number }
  >();

  public readonly now = (): number => this.currentTime;
  public readonly setTimeout = (
    callback: () => void,
    delayMs: number,
  ): number => {
    const id = this.nextId++;
    this.timeouts.set(id, { callback, due: this.currentTime + delayMs });
    return id;
  };
  public readonly clearTimeout = (handle: unknown): void => {
    this.timeouts.delete(Number(handle));
  };
  public readonly setInterval = (
    callback: () => void,
    delayMs: number,
  ): number => {
    const id = this.nextId++;
    this.intervals.set(id, {
      callback,
      delay: delayMs,
      due: this.currentTime + delayMs,
    });
    return id;
  };
  public readonly clearInterval = (handle: unknown): void => {
    this.intervals.delete(Number(handle));
  };
  public readonly unref = (): void => {
    this.unrefCount += 1;
  };

  public advance(milliseconds: number): void {
    const target = this.currentTime + milliseconds;
    for (;;) {
      const nextTimeout = [...this.timeouts.entries()].sort(
        ([leftId, left], [rightId, right]) =>
          left.due - right.due || leftId - rightId,
      )[0];
      const nextInterval = [...this.intervals.entries()].sort(
        ([leftId, left], [rightId, right]) =>
          left.due - right.due || leftId - rightId,
      )[0];
      const timeoutDue = nextTimeout?.[1].due ?? Number.POSITIVE_INFINITY;
      const intervalDue = nextInterval?.[1].due ?? Number.POSITIVE_INFINITY;
      const due = Math.min(timeoutDue, intervalDue);
      if (due > target) break;
      this.currentTime = due;
      if (timeoutDue <= intervalDue && nextTimeout !== undefined) {
        this.timeouts.delete(nextTimeout[0]);
        nextTimeout[1].callback();
      } else if (nextInterval !== undefined) {
        nextInterval[1].due += nextInterval[1].delay;
        nextInterval[1].callback();
      }
    }
    this.currentTime = target;
  }
}

await describe("terminal capability detection", async () => {
  await it("enables rich interactive output and animation for a TTY", () => {
    const result = capabilities();
    assert.equal(result.outputMode, "rich");
    assert.equal(result.rich, true);
    assert.equal(result.animation, true);
    assert.equal(result.unicode, true);
  });

  await it("selects responsive layouts consistently on Windows Terminal", () => {
    for (const columns of [80, 100, 120, 160]) {
      const result = capabilities({
        columns,
        platform: "win32",
        environment: { WT_SESSION: "test-session" },
      });
      assert.equal(result.rich, true);
      assert.equal(usesBorderedCliLayout(result), true);
      assert.equal(result.width, Math.min(columns, CLI_MAXIMUM_RENDER_WIDTH));
    }
    assert.equal(CLI_MINIMUM_BORDERED_WIDTH, 80);
    assert.equal(usesBorderedCliLayout(capabilities({ columns: 79 })), false);
    assert.equal(capabilities({ columns: 79 }).rich, true);
    assert.equal(capabilities({ columns: 71 }).outputMode, "plain");
  });

  await it("uses plain output for CI, dumb, redirected, narrow, or explicit plain modes", () => {
    for (const result of [
      capabilities({ environment: { CI: "true" } }),
      capabilities({ environment: { TERM: "dumb" } }),
      capabilities({ stdoutIsTty: false }),
      capabilities({ columns: 60 }),
      capabilities({ arguments: ["--plain"] }),
    ]) {
      assert.equal(result.outputMode, "plain");
      assert.equal(result.rich, false);
      assert.equal(result.animation, false);
    }
  });

  await it("keeps rich formatting but disables animation explicitly", () => {
    const result = capabilities({ arguments: ["--no-animation"] });
    assert.equal(result.outputMode, "rich");
    assert.equal(result.rich, true);
    assert.equal(result.animation, false);
  });

  await it("gives JSON modes strict precedence over terminal features", () => {
    const summary = capabilities({ arguments: ["--summary-json"] });
    const privateResult = capabilities({ arguments: ["--json"] });
    assert.equal(summary.outputMode, "summary-json");
    assert.equal(privateResult.outputMode, "private-json");
    assert.equal(summary.animation, false);
    assert.equal(privateResult.color, false);
  });

  await it("honors NO_COLOR and uses an ASCII fallback on legacy Windows", () => {
    assert.equal(capabilities({ environment: { NO_COLOR: "1" } }).color, false);
    assert.equal(
      capabilities({ environment: { FORCE_COLOR: "0" } }).color,
      false,
    );
    assert.equal(
      capabilities({ environment: { FORCE_COLOR: "1" } }).color,
      true,
    );
    const windows = capabilities({ platform: "win32" });
    assert.equal(windows.rich, true);
    assert.equal(windows.unicode, false);
  });

  await it("detects emoji, Unicode, ANSI, colour, and animation independently", () => {
    const windowsTerminal = capabilities({
      platform: "win32",
      environment: { WT_SESSION: "opaque-session", NO_COLOR: "1" },
    });
    assert.equal(windowsTerminal.windowsTerminal, true);
    assert.equal(windowsTerminal.progressStyle, "thinking");
    assert.equal(windowsTerminal.symbolMode, "emoji");
    assert.equal(windowsTerminal.emoji, true);
    assert.equal(windowsTerminal.unicode, true);
    assert.equal(windowsTerminal.ansi, true);
    assert.equal(windowsTerminal.brightness, true);
    assert.equal(windowsTerminal.color, false);
    assert.equal(windowsTerminal.animation, true);

    const forceColorOff = capabilities({
      platform: "win32",
      environment: { WT_SESSION: "opaque-session", FORCE_COLOR: "0" },
    });
    assert.equal(forceColorOff.color, false);
    assert.equal(forceColorOff.emoji, true);
    assert.equal(forceColorOff.unicode, true);
  });

  await it("uses positive stream evidence on Win32 without terminal-brand hints", () => {
    const stream = capableStream();
    const result = capabilities({
      platform: "win32",
      stdout: stream,
      stderr: stream,
    });
    assert.equal(result.windowsTerminal, false);
    assert.equal(result.stdout.colourDepth, 24);
    assert.equal(result.stderr.colourDepth, 24);
    assert.equal(result.stdout.supportsBasicColour, true);
    assert.equal(result.stderr.supportsBasicColour, true);
    assert.equal(result.ansi, true);
    assert.equal(result.progressAnsi, true);
    assert.equal(result.brightness, true);
    assert.equal(result.cursorControl, true);
    assert.equal(result.color, true);
    assert.equal(result.unicode, true);
    assert.equal(result.emoji, true);
    assert.equal(result.symbolMode, "emoji");
    assert.equal(result.requestedProgressStyle, "thinking");
    assert.equal(result.effectiveProgressStyle, "thinking");
    assert.equal(result.animation, true);
    assert.equal(result.fallbackReason, "none");
    assert.deepEqual(result.capabilitySources, ["stream-apis"]);
  });

  await it("preserves explicit symbol precedence on a capable unbranded Win32 TTY", () => {
    const stream = capableStream();
    for (const [arguments_, symbolMode, emojiMode] of [
      [["--progress-style=thinking", "--emoji"], "emoji", "enabled"],
      [
        ["--progress-style=thinking", "--no-emoji", "--unicode"],
        "unicode",
        "disabled",
      ],
      [["--progress-style=thinking", "--ascii"], "ascii", "disabled"],
    ] as const) {
      const result = capabilities({
        arguments: arguments_,
        platform: "win32",
        stdout: stream,
        stderr: stream,
      });
      assert.equal(result.symbolMode, symbolMode);
      assert.equal(result.effectiveEmojiMode, emojiMode);
      assert.equal(result.requestedProgressStyle, "thinking");
      assert.equal(result.effectiveProgressStyle, "thinking");
      assert.equal(result.brightness, true);
      assert.equal(result.animation, true);
      assert.equal(result.fallbackReason, "none");
      assert.ok(result.capabilitySources.includes("explicit-override"));
    }
  });

  await it("separates semantic colour overrides from SGR brightness and symbols", () => {
    const stream = capableStream();
    for (const environment of [{ NO_COLOR: "1" }, { FORCE_COLOR: "0" }]) {
      const result = capabilities({
        arguments: ["--progress-style=thinking"],
        environment,
        platform: "win32",
        stdout: stream,
        stderr: stream,
      });
      assert.equal(result.color, false);
      assert.equal(result.brightness, true);
      assert.equal(result.effectiveProgressStyle, "thinking");
      assert.equal(result.symbolMode, "emoji");
    }
  });

  await it("accepts either colour-depth or hasColors as positive stream evidence", () => {
    const depthOnly = capableStream({ hasBasicColour: false });
    const hasColorsOnly = capableStream({ colourDepth: 1 });
    for (const stream of [depthOnly, hasColorsOnly]) {
      const result = capabilities({
        platform: "win32",
        stdout: stream,
        stderr: stream,
      });
      assert.equal(result.color, true);
      assert.equal(result.brightness, true);
    }
  });

  await it("selects explicit emoji, Unicode, ASCII, and static modes", () => {
    assert.equal(capabilities({ arguments: ["--emoji"] }).symbolMode, "emoji");
    assert.equal(
      capabilities({ arguments: ["--no-emoji"] }).symbolMode,
      "unicode",
    );
    assert.equal(capabilities({ arguments: ["--ascii"] }).symbolMode, "ascii");
    assert.equal(
      capabilities({ arguments: ["--unicode"] }).symbolMode,
      "unicode",
    );
    assert.equal(
      capabilities({ arguments: ["--progress-style=spinner"] }).progressStyle,
      "spinner",
    );
    assert.equal(
      capabilities({ arguments: ["--progress-style=static"] }).animation,
      false,
    );
  });

  await it("uses conservative legacy Windows and non-human fallbacks", () => {
    const legacy = capabilities({ platform: "win32" });
    assert.equal(legacy.windowsTerminal, false);
    assert.equal(legacy.ansi, false);
    assert.equal(legacy.unicode, false);
    assert.equal(legacy.symbolMode, "ascii");
    for (const terminal of [
      capabilities({ environment: { CI: "true" } }),
      capabilities({ environment: { TERM: "dumb" } }),
      capabilities({ stdoutIsTty: false }),
      capabilities({ stderrIsTty: false }),
      capabilities({ arguments: ["--plain"] }),
      capabilities({ arguments: ["--summary-json"] }),
      capabilities({ arguments: ["--json"] }),
    ])
      assert.equal(terminal.animation, false);
  });

  await it("rejects unsupported styles and conflicting presentation options", () => {
    for (const [arguments_, code] of [
      [["--progress-style=blink"], "CLI_PROGRESS_STYLE_UNSUPPORTED"],
      [["--progress-style="], "CLI_PROGRESS_STYLE_UNSUPPORTED"],
      [["--unicode", "--ascii"], "CLI_SYMBOL_MODE_CONFLICT"],
      [["--emoji", "--no-emoji"], "CLI_EMOJI_MODE_CONFLICT"],
      [["--ascii", "--emoji"], "CLI_ASCII_EMOJI_CONFLICT"],
      [["--json", "--plain"], "CLI_JSON_HUMAN_OPTION_CONFLICT"],
    ] as const) {
      assert.throws(
        () => {
          validateCliPresentationArguments(arguments_);
        },
        (error: unknown) =>
          error instanceof CliOptionError && error.code === code,
      );
    }
    for (const style of ["thinking", "spinner", "static"])
      assert.doesNotThrow(() => {
        validateCliPresentationArguments([`--progress-style=${style}`]);
      });
  });
});

await describe("terminal rendering", async () => {
  await it("renders bordered rich output at 80, 100, 120, and 160 columns", async () => {
    const base = await emptySummary();
    const summary: LocatorBlindHoldoutAggregateSummary = {
      ...base,
      status: "insufficient-sample",
      counts: { ...base.counts, blindHoldoutReviewed: 1 },
      sampleNotice:
        "One independently reviewed blind case is useful directional evidence, not production proof.",
    };
    for (const columns of [80, 100, 120, 160]) {
      const terminal = capabilities({
        columns,
        platform: "win32",
        environment: { WT_SESSION: "test-session" },
      });
      const output = renderLocatorBlindHoldoutTerminal(summary, terminal, 1250);
      for (const section of [
        "RUN STATUS",
        "REVIEW ELIGIBILITY",
        "DIAGNOSIS QUALITY",
        "RECOMMENDATION QUALITY",
        "CANDIDATE RANKING",
        "SAFETY SIGNALS",
        "CONFIDENCE AND ABSTENTION",
        "EXECUTION ISOLATION",
        "FINAL INTERPRETATION",
      ])
        assert.match(output, new RegExp(section, "u"));
      assert.match(output, /INSUFFICIENT-SAMPLE/u);
      assert.match(output, /N\/A \(0 eligible cases\)/u);
      assert.match(output, /Elapsed time.*1\.25s/u);
      assert.match(stripAnsi(output), /┌ RUN STATUS ─+/u);
      assert.match(stripAnsi(output), /│.*Sample status:/u);
      assert.ok(
        stripAnsi(output)
          .split("\n")
          .every((line) => line.length <= terminal.width),
      );
    }
  });

  await it("uses compact rich sections only below the bordered threshold", async () => {
    const terminal = capabilities({ columns: 79 });
    const output = renderLocatorBlindHoldoutTerminal(
      await emptySummary(),
      terminal,
      10,
    );
    assert.equal(terminal.outputMode, "rich");
    assert.equal(usesBorderedCliLayout(terminal), false);
    assert.match(stripAnsi(output), /◆ RUN STATUS/u);
    assert.doesNotMatch(stripAnsi(output), /┌ RUN STATUS/u);
  });

  await it("aligns values per section and wraps labels without excessive gaps", () => {
    const terminal = capabilities({ columns: 80 });
    const output = stripAnsi(
      renderCliSection(
        "Alignment",
        [
          { label: "Short", value: "alpha" },
          { label: "Longer label", value: "beta" },
          {
            label: "An intentionally oversized label that must wrap",
            value: "gamma",
          },
        ],
        terminal,
      ),
    );
    const alpha = output.split("\n").find((line) => line.includes("alpha"));
    const beta = output.split("\n").find((line) => line.includes("beta"));
    assert.ok(alpha !== undefined && beta !== undefined);
    assert.equal(alpha.indexOf("alpha"), beta.indexOf("beta"));
    assert.ok(output.split("\n").every((line) => line.length <= 80));
    assert.match(output, /intentionally oversized label/u);
  });

  await it("indents wrapped notices without repeating their semantic marker", () => {
    const output = stripAnsi(
      renderCliNotice(
        "RISK",
        "One or more aggregate safety signals require investigation before another advisory experiment is considered, while locator application remains absent.",
        capabilities({ columns: 80 }),
      ),
    );
    assert.equal(output.match(/\[RISK\]/gu)?.length, 1);
    const lines = output.split("\n");
    assert.ok(lines.length > 1);
    assert.ok(lines.slice(1).every((line) => line.startsWith("       ")));
  });

  await it("renders plain ASCII output without terminal control sequences", async () => {
    const output = renderLocatorBlindHoldoutTerminal(
      await emptySummary(),
      capabilities({ arguments: ["--plain"] }),
      50,
    );
    assert.match(output, /^AEGISAI - BLIND LOCATOR HOLDOUT/mu);
    assert.match(output, /\[WARNING\]/u);
    assert.equal(stripAnsi(output), output);
    assert.doesNotMatch(output, /[┌┐└┘◆]/u);
  });

  await it("falls back to wrapped plain output in a narrow terminal", async () => {
    const output = renderLocatorBlindHoldoutTerminal(
      await emptySummary(),
      capabilities({ columns: 40 }),
      50,
    );
    assert.equal(capabilities({ columns: 40 }).outputMode, "plain");
    assert.ok(output.split("\n").every((line) => line.length <= 40));
    assert.equal(output.includes("\u001B"), false);
  });

  await it("renders rich structure without ANSI when NO_COLOR is set", async () => {
    const output = renderLocatorBlindHoldoutTerminal(
      await emptySummary(),
      capabilities({ environment: { NO_COLOR: "1" } }),
      25,
    );
    assert.match(output, /┌ AegisAI · Blind Locator Holdout/u);
    assert.equal(output.includes("\u001B"), false);
  });

  await it("renders rich ASCII borders when Unicode is unavailable", async () => {
    const output = renderLocatorBlindHoldoutTerminal(
      await emptySummary(),
      capabilities({ platform: "win32" }),
      25,
    );
    assert.match(stripAnsi(output), /^\+ AegisAI - Blind Locator Holdout/mu);
    assert.doesNotMatch(stripAnsi(output), /[┌┐└┘◆]/u);
  });

  await it("uses semantic risk labels when unsafe aggregates are present", async () => {
    const base = await emptySummary();
    const summary: LocatorBlindHoldoutAggregateSummary = {
      ...base,
      meaningful: true,
      status: "evaluated",
      metrics: {
        ...base.metrics,
        safety: {
          ...base.metrics.safety,
          unsafeRecommendation: { numerator: 1, denominator: 2, value: 0.5 },
        },
      },
    };
    const output = renderLocatorBlindHoldoutTerminal(
      summary,
      capabilities({ arguments: ["--plain"] }),
      10,
    );
    assert.match(output, /\[RISK\]/u);
    assert.match(output, /50\.0% \(1\/2\)/u);
  });

  await it("renders a sufficient aggregate as evaluated without implying healing", async () => {
    const base = await emptySummary();
    const summary: LocatorBlindHoldoutAggregateSummary = {
      ...base,
      meaningful: true,
      status: "evaluated",
      counts: { ...base.counts, blindHoldoutReviewed: 30 },
      sampleNotice:
        "Aggregate metrics describe independently reviewed blind holdout cases.",
    };
    const output = renderLocatorBlindHoldoutTerminal(
      summary,
      capabilities({ arguments: ["--plain"] }),
      100,
    );
    assert.match(output, /Sample status:.*EVALUATED/u);
    assert.match(output, /\[SUCCESS\]/u);
    assert.match(output, /Automatic healing:.*absent/u);
  });

  await it("wraps text deterministically for narrow readable output", () => {
    const lines = wrapCliText(
      "A controlled blind sample remains directional evidence rather than production proof.",
      40,
      "  ",
    );
    assert.ok(lines.length > 1);
    assert.ok(lines.every((line) => line.length <= 40));
    assert.ok(
      wrapCliText("A".repeat(100), 40).every((line) => line.length <= 40),
    );
  });

  await it("renders structured errors without a stack trace", () => {
    const output = renderCliError(
      {
        title: "Review validation failed",
        code: "REVIEW_INVALID",
        fieldPath: "$.reviewStatus",
        message:
          "The value is unsupported at C:\\Users\\person\\private.json; authorization: Bearer secret-value",
        suggestion: "Choose a supported status.",
      },
      capabilities({ arguments: ["--plain"] }),
    );
    assert.match(output, /Code:.*REVIEW_INVALID/u);
    assert.match(output, /Field:.*\$\.reviewStatus/u);
    assert.match(output, /Fix:.*Choose a supported status/u);
    assert.doesNotMatch(output, /\n\s+at /u);
    assert.doesNotMatch(output, /C:\\Users|secret-value/u);
    assert.match(output, /\[PATH\]|\[REDACTED\]/u);
  });
});

await describe("terminal-cell width", async () => {
  await it("ignores ANSI and measures supported symbols by terminal cells", () => {
    assert.equal(visibleWidth(`${ANSI_DIM}message${ANSI_RESET}`), 7);
    assert.equal(visibleWidth(CLI_THINKING_EMOJI), 2);
    assert.equal(visibleWidth("✅"), 2);
    assert.equal(visibleWidth(CLI_UNICODE_PROGRESS_SYMBOL), 1);
    assert.equal(visibleWidth(CLI_ASCII_PROGRESS_SYMBOL), 3);
  });

  await it("truncates without breaking emoji, surrogate pairs, or ANSI state", () => {
    const styled = `${ANSI_BRIGHT}ab${CLI_THINKING_EMOJI}cd${ANSI_RESET}`;
    const truncated = truncateToWidth(styled, 4);
    assert.equal(visibleWidth(truncated), 4);
    assert.match(truncated, /💭/u);
    assert.ok(truncated.endsWith(ANSI_RESET));
    assert.equal(truncated.includes("\uFFFD"), false);
    assert.equal(stripAnsi(truncateToWidth("A💭B", 2)), "A");
    assert.deepEqual(splitAtVisibleWidth("A💭B", 3), ["A💭", "B"]);
  });

  await it("pads styled and emoji text to one stable visible width", () => {
    for (const value of [
      `${ANSI_DIM}Working...${ANSI_RESET}`,
      `${ANSI_NORMAL}Working...${ANSI_RESET}`,
      `${ANSI_BRIGHT}Working...${ANSI_RESET}`,
      `${CLI_THINKING_EMOJI} Working...`,
    ])
      assert.equal(visibleWidth(padToWidth(value, 30)), 30);
  });
});

await describe("delayed CLI progress", async () => {
  function fixture(
    options: {
      readonly arguments?: readonly string[];
      readonly environment?: Readonly<Record<string, string | undefined>>;
      readonly platform?: NodeJS.Platform;
      readonly animation?: boolean;
      readonly brightness?: boolean;
      readonly stderrIsTty?: boolean;
      readonly stdout?: CliCapabilityStream;
      readonly stderr?: CliCapabilityStream;
    } = {},
  ): {
    readonly scheduler: FakeScheduler;
    readonly writes: string[];
    readonly reporter: ReturnType<typeof createCliProgressReporter>;
  } {
    const scheduler = new FakeScheduler();
    const writes: string[] = [];
    const detected = capabilities({
      ...(options.arguments === undefined
        ? {}
        : { arguments: options.arguments }),
      ...(options.environment === undefined
        ? {}
        : { environment: options.environment }),
      ...(options.platform === undefined ? {} : { platform: options.platform }),
      ...(options.stderrIsTty === undefined
        ? {}
        : { stderrIsTty: options.stderrIsTty }),
      ...(options.stdout === undefined ? {} : { stdout: options.stdout }),
      ...(options.stderr === undefined ? {} : { stderr: options.stderr }),
    });
    const reporter = createCliProgressReporter({
      capabilities: {
        ...detected,
        animation: options.animation ?? detected.animation,
        brightness: options.brightness ?? detected.brightness,
      },
      stream: {
        isTTY: options.stderrIsTty ?? true,
        write: (value) => writes.push(value),
      },
      scheduler,
    });
    return { scheduler, writes, reporter };
  }

  await it("avoids flicker for a 0.39-second operation", () => {
    const { scheduler, writes, reporter } = fixture();
    reporter.start("Loading records");
    scheduler.advance(390);
    reporter.succeed();
    scheduler.advance(1000);
    assert.deepEqual(writes, []);
    assert.equal(CLI_PROGRESS_DELAY_MS, 400);
  });

  await it("uses the exact looping brightness sequence on one stable line", () => {
    const { scheduler, writes, reporter } = fixture({
      platform: "win32",
      environment: { WT_SESSION: "opaque-session" },
    });
    reporter.start("Validating blind review integrity");
    scheduler.advance(CLI_PROGRESS_DELAY_MS);
    for (
      let index = 1;
      index < THINKING_BRIGHTNESS_FRAMES.length + 1;
      index += 1
    )
      scheduler.advance(CLI_PROGRESS_REFRESH_MS);
    reporter.succeed();
    const frames = writes.filter((entry) => entry.includes("Validating"));
    assert.equal(frames.length, THINKING_BRIGHTNESS_FRAMES.length + 1);
    const styles = frames.map((entry) =>
      THINKING_BRIGHTNESS_FRAMES.find((style) =>
        entry.includes(`${CLI_THINKING_EMOJI} ${style}`),
      ),
    );
    assert.deepEqual(styles.slice(0, 6), [
      ANSI_DIM,
      ANSI_NORMAL,
      ANSI_BRIGHT,
      ANSI_NORMAL,
      ANSI_DIM,
      ANSI_NORMAL,
    ]);
    assert.equal(styles[6], ANSI_DIM);
    assert.equal(
      THINKING_BRIGHTNESS_FRAMES.join("").includes("\u001B[5m"),
      false,
    );
    assert.ok(frames.every((entry) => entry.includes(ANSI_RESET)));
    assert.ok(frames.every((entry) => entry.startsWith("\r")));
    assert.ok(frames.every((entry) => !entry.includes("\n")));
    assert.ok(frames.every((entry) => visibleWidth(entry) === 100));
    assert.equal(new Set(frames.map((entry) => visibleWidth(entry))).size, 1);
    assert.equal(
      frames.every(
        (entry) =>
          entry.indexOf(CLI_THINKING_EMOJI) < entry.indexOf(ANSI_DIM) ||
          !entry.includes(ANSI_DIM),
      ),
      true,
    );
    assert.ok(writes.join("").endsWith("\u001B[?25h"));
    assert.equal(CLI_PROGRESS_REFRESH_MS, 150);
  });

  await it("pulses with forced emoji, Unicode, and ASCII symbols without spinner rotation", () => {
    const stream = capableStream();
    for (const [arguments_, symbol] of [
      [["--progress-style=thinking", "--emoji"], CLI_THINKING_EMOJI],
      [
        ["--progress-style=thinking", "--no-emoji", "--unicode"],
        CLI_UNICODE_PROGRESS_SYMBOL,
      ],
      [["--progress-style=thinking", "--ascii"], CLI_ASCII_PROGRESS_SYMBOL],
    ] as const) {
      const progress = fixture({
        arguments: arguments_,
        platform: "win32",
        stdout: stream,
        stderr: stream,
      });
      progress.reporter.start("Capability based thinking");
      progress.scheduler.advance(CLI_PROGRESS_DELAY_MS);
      progress.scheduler.advance(CLI_PROGRESS_REFRESH_MS * 2);
      progress.reporter.stop();
      const frames = progress.writes.filter((entry) =>
        entry.includes("Capability based thinking"),
      );
      assert.equal(frames.length, 3);
      for (const frame of frames) {
        assert.ok(stripAnsi(frame).trimStart().startsWith(symbol));
        assert.ok(frame.includes(ANSI_RESET));
        assert.doesNotMatch(frame, /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/u);
      }
    }
  });

  await it("updates stage text while pulsing and prevents writes after success", () => {
    const { scheduler, writes, reporter } = fixture();
    reporter.start("Loading records");
    scheduler.advance(CLI_PROGRESS_DELAY_MS);
    reporter.update("Validating records");
    scheduler.advance(CLI_PROGRESS_REFRESH_MS);
    reporter.succeed("Completed");
    const writeCount = writes.length;
    scheduler.advance(1000);
    reporter.update("Late update");
    reporter.succeed("Duplicate");
    assert.equal(writes.length, writeCount);
    const output = writes.join("");
    assert.match(output, /Loading records/u);
    assert.match(output, /Validating records/u);
    assert.match(output, /✓ Completed/u);
    assert.doesNotMatch(output, /Late update|Duplicate/u);
    assert.ok(output.includes("\u001B[?25l"));
    assert.ok(output.includes("\u001B[?25h"));
  });

  await it("cleans failure and interruption before a bounded completion line", () => {
    for (const method of ["fail", "interrupt"] as const) {
      const { scheduler, writes, reporter } = fixture();
      reporter.start("Evaluating");
      scheduler.advance(CLI_PROGRESS_DELAY_MS);
      if (method === "fail") reporter.fail("Operation failed.");
      else reporter.interrupt();
      const output = writes.join("");
      assert.ok(output.includes("\u001B[?25h"));
      assert.match(
        output,
        method === "fail" ? /✗ Operation failed/u : /⚠ Interrupted/u,
      );
      assert.doesNotMatch(output, /authorization|secret/iu);
    }
  });

  await it("uses static progress without cursor control for no-animation", () => {
    const { scheduler, writes, reporter } = fixture({
      arguments: ["--no-animation"],
    });
    reporter.start("Loading records");
    scheduler.advance(CLI_PROGRESS_DELAY_MS);
    reporter.update("Writing reports");
    reporter.succeed();
    const output = writes.join("");
    assert.match(output, /\[PROGRESS\] Loading records/u);
    assert.match(output, /\[PROGRESS\] Writing reports/u);
    assert.equal(output.includes("\u001B"), false);
  });

  await it("preserves explicit spinner and brightness fallback behavior", () => {
    const spinner = fixture({ arguments: ["--progress-style=spinner"] });
    spinner.reporter.start("Spinning");
    spinner.scheduler.advance(CLI_PROGRESS_DELAY_MS);
    spinner.scheduler.advance(CLI_PROGRESS_REFRESH_MS);
    spinner.reporter.stop();
    assert.match(spinner.writes[0] ?? "", /⠋ Spinning/u);
    assert.match(spinner.writes[1] ?? "", /⠙ Spinning/u);

    const fallback = fixture({ brightness: false });
    fallback.reporter.start("Fallback");
    fallback.scheduler.advance(CLI_PROGRESS_DELAY_MS);
    fallback.reporter.stop();
    assert.match(fallback.writes[0] ?? "", /⠋ Fallback/u);
    const fallbackOutput = fallback.writes.join("");
    for (const brightness of [ANSI_BRIGHT, ANSI_DIM, ANSI_NORMAL])
      assert.equal(fallbackOutput.includes(brightness), false);
  });

  await it("keeps symbols and completion hierarchy deterministic", () => {
    assert.equal(cliProgressSymbol("emoji"), CLI_THINKING_EMOJI);
    assert.equal(cliProgressSymbol("unicode"), CLI_UNICODE_PROGRESS_SYMBOL);
    assert.equal(cliProgressSymbol("ascii"), CLI_ASCII_PROGRESS_SYMBOL);
    assert.equal(cliStatusSymbol("success", "emoji"), "✅");
    assert.equal(cliStatusSymbol("warning", "emoji"), "⚠️");
    assert.equal(cliStatusSymbol("failure", "emoji"), "❌");
    assert.equal(cliStatusSymbol("information", "emoji"), "ℹ️");
    assert.equal(cliStatusSymbol("success", "unicode"), "✓");
    assert.equal(cliStatusSymbol("failure", "unicode"), "✗");
    assert.equal(cliStatusSymbol("success", "ascii"), "[OK]");
    assert.equal(cliStatusSymbol("not-applicable", "ascii"), "[N/A]");
  });

  await it("handles starts, pre-start updates, repeated stops, and unref safely", () => {
    const { scheduler, writes, reporter } = fixture();
    reporter.update("Ignored before start");
    reporter.start("First");
    reporter.start("Second");
    assert.equal(scheduler.unrefCount, 1);
    scheduler.advance(CLI_PROGRESS_DELAY_MS);
    assert.match(writes.join(""), /Second/u);
    assert.equal(scheduler.unrefCount, 2);
    reporter.stop();
    reporter.stop();
    scheduler.advance(1000);
    assert.doesNotMatch(writes.join(""), /Ignored before start/u);
  });

  await it("does nothing outside an explicitly interactive rich terminal", () => {
    const writes: string[] = [];
    const scheduler = new FakeScheduler();
    const reporter = createCliProgressReporter({
      capabilities: capabilities({ stdoutIsTty: false, stderrIsTty: false }),
      stream: { isTTY: false, write: (value) => writes.push(value) },
      scheduler,
    });
    reporter.start("Loading records");
    scheduler.advance(1000);
    reporter.fail();
    assert.deepEqual(writes, []);
  });
});
