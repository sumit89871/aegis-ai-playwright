import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createCliProgressReporter,
  createLocatorBlindHoldoutAggregateSummary,
  detectTerminalCapabilities,
  renderCliError,
  renderLocatorBlindHoldoutTerminal,
  runLocatorBlindHoldoutEvaluation,
  stripAnsi,
  wrapCliText,
} from "../src/index.ts";
import type {
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
  } = {},
): TerminalCapabilities {
  return detectTerminalCapabilities({
    arguments: options.arguments ?? [],
    environment: options.environment ?? {},
    stdoutIsTty: options.stdoutIsTty ?? true,
    stderrIsTty: options.stderrIsTty ?? true,
    columns: options.columns ?? 100,
    platform: options.platform ?? "linux",
  });
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
});

await describe("terminal rendering", async () => {
  await it("renders grouped rich output at 120 and 80 columns", async () => {
    const base = await emptySummary();
    const summary: LocatorBlindHoldoutAggregateSummary = {
      ...base,
      status: "insufficient-sample",
      counts: { ...base.counts, blindHoldoutReviewed: 1 },
      sampleNotice:
        "One independently reviewed blind case is useful directional evidence, not production proof.",
    };
    for (const width of [120, 80]) {
      const output = renderLocatorBlindHoldoutTerminal(
        summary,
        capabilities({ columns: width }),
        1250,
      );
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
      assert.ok(
        stripAnsi(output)
          .split("\n")
          .every((line) => line.length <= width),
      );
    }
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

await describe("delayed CLI progress", async () => {
  function fixture(animation = true): {
    readonly scheduler: FakeScheduler;
    readonly writes: string[];
    readonly reporter: ReturnType<typeof createCliProgressReporter>;
  } {
    const scheduler = new FakeScheduler();
    const writes: string[] = [];
    const reporter = createCliProgressReporter({
      capabilities: {
        ...capabilities(),
        animation,
      },
      stream: { isTTY: true, write: (value) => writes.push(value) },
      scheduler,
      delayMs: 300,
      intervalMs: 80,
    });
    return { scheduler, writes, reporter };
  }

  await it("avoids flicker when work succeeds before the delay", () => {
    const { scheduler, writes, reporter } = fixture();
    reporter.start("Loading records");
    scheduler.advance(299);
    reporter.succeed();
    scheduler.advance(1000);
    assert.deepEqual(writes, []);
  });

  await it("animates on stderr-compatible streams and restores the cursor", () => {
    const { scheduler, writes, reporter } = fixture();
    reporter.start("Loading records");
    scheduler.advance(300);
    reporter.update("Validating records");
    scheduler.advance(80);
    reporter.succeed();
    const output = writes.join("");
    assert.match(output, /Loading records/u);
    assert.match(output, /Validating records/u);
    assert.ok(output.includes("\u001B[?25l"));
    assert.ok(output.endsWith("\u001B[?25h"));
  });

  await it("preserves bounded failure and interruption states", () => {
    for (const method of ["fail", "interrupt"] as const) {
      const { scheduler, writes, reporter } = fixture();
      reporter.start("Evaluating");
      scheduler.advance(300);
      if (method === "fail") reporter.fail();
      else reporter.interrupt();
      const output = writes.join("");
      assert.ok(output.includes("\u001B[?25h"));
      assert.match(output, /\[ERROR\]/u);
      assert.doesNotMatch(output, /authorization|secret/iu);
    }
  });

  await it("uses static progress without cursor control for no-animation", () => {
    const { scheduler, writes, reporter } = fixture(false);
    reporter.start("Loading records");
    scheduler.advance(300);
    reporter.update("Writing reports");
    reporter.succeed();
    const output = writes.join("");
    assert.match(output, /\[PROGRESS\] Loading records/u);
    assert.match(output, /\[PROGRESS\] Writing reports/u);
    assert.equal(output.includes("\u001B"), false);
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
