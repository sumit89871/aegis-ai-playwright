import {
  createCliProgressReporter,
  detectTerminalCapabilities,
  renderCliBanner,
  renderCliNotice,
  renderCliSection,
} from "@aegis/core";

const arguments_ = process.argv.slice(2);
if (
  arguments_.some((entry) => entry !== "--plain" && entry !== "--no-animation")
)
  throw new Error("Supported options are --plain and --no-animation.");

const capabilities = detectTerminalCapabilities({
  arguments: arguments_,
  environment: process.env,
  stdoutIsTty: process.stdout.isTTY,
  stderrIsTty: process.stderr.isTTY,
  columns: process.stdout.columns,
  platform: process.platform,
});
const progress = createCliProgressReporter({
  capabilities,
  stream: process.stderr,
});
const delay = async (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

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
process.once("SIGINT", interruptSignal);
process.once("SIGTERM", terminateSignal);

try {
  progress.start("Starting the CLI progress demonstration");
  await delay(500);
  progress.update("Advancing through a deterministic stage");
  await delay(450);
  progress.update("Verifying successful progress cleanup");
  await delay(450);
  progress.succeed();

  process.stdout.write(
    `${[
      renderCliBanner("AegisAI · CLI Progress Demonstration", capabilities),
      renderCliNotice(
        "INFO",
        "This command demonstrates presentation behavior only. It performs no business evaluation and reads no user artifacts.",
        capabilities,
      ),
      renderCliSection(
        "Demonstration result",
        [
          { label: "Lifecycle", value: "start, update, success" },
          { label: "Network calls", value: "0", status: "success" },
          { label: "User artifacts", value: "not accessed", status: "success" },
          {
            label: "Result",
            value: "progress cleanup complete",
            status: "success",
          },
        ],
        capabilities,
      ),
    ].join("\n\n")}\n`,
  );
} catch {
  progress.fail();
  process.stderr.write(
    "[ERROR] The CLI progress demonstration could not complete safely.\n",
  );
  process.exitCode = 1;
} finally {
  process.removeListener("SIGINT", interruptSignal);
  process.removeListener("SIGTERM", terminateSignal);
  progress.dispose();
}
