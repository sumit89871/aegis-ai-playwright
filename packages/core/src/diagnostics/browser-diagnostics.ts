import type {
  BrowserContext,
  ConsoleMessage,
  Page,
  Request,
  Response,
} from "@playwright/test";

import { BoundedBuffer } from "./bounded-buffer.ts";
import {
  DEFAULT_MAX_TEXT_LENGTH,
  DEFAULT_MAX_URL_LENGTH,
  redactSensitiveText,
  sanitizeUrl,
} from "./redaction.ts";

export interface BrowserDiagnosticsLimits {
  readonly maximumEntriesPerCategory: number;
  readonly maximumTextLength: number;
  readonly maximumStackLength: number;
  readonly maximumUrlLength: number;
}

export interface BrowserDiagnosticsOptions {
  readonly limits?: Partial<BrowserDiagnosticsLimits>;
  readonly now?: () => Date;
}

export interface SourceLocationDiagnostic {
  readonly url: string;
  readonly lineNumber: number;
  readonly columnNumber: number;
}

export interface BrowserConsoleErrorDiagnostic {
  readonly timestamp: string;
  readonly pageUrl: string;
  readonly messageType: "error";
  readonly text: string;
  readonly sourceLocation?: SourceLocationDiagnostic;
}

export interface PageErrorDiagnostic {
  readonly timestamp: string;
  readonly pageUrl: string;
  readonly errorName: string;
  readonly message: string;
  readonly stack?: string;
}

export interface FailedRequestDiagnostic {
  readonly timestamp: string;
  readonly method: string;
  readonly url: string;
  readonly resourceType: string;
  readonly failureText: string;
}

export interface HttpErrorResponseDiagnostic {
  readonly timestamp: string;
  readonly method: string;
  readonly url: string;
  readonly status: number;
  readonly statusText: string;
  readonly resourceType: string;
}

export interface DiagnosticCategoryCounts {
  readonly browserConsoleErrors: number;
  readonly pageErrors: number;
  readonly failedRequests: number;
  readonly httpErrorResponses: number;
}

export interface DiagnosticSummary {
  readonly collectionStartedAt: string;
  readonly collectionEndedAt: string;
  readonly counts: DiagnosticCategoryCounts;
  readonly droppedEntries: DiagnosticCategoryCounts;
  readonly internalErrorCount: number;
}

export interface BrowserDiagnosticsSnapshot {
  readonly browserConsoleErrors: readonly BrowserConsoleErrorDiagnostic[];
  readonly pageErrors: readonly PageErrorDiagnostic[];
  readonly failedRequests: readonly FailedRequestDiagnostic[];
  readonly httpErrorResponses: readonly HttpErrorResponseDiagnostic[];
  readonly summary: DiagnosticSummary;
}

interface DiagnosticSummaryInput {
  readonly collectionStartedAt: string;
  readonly collectionEndedAt: string;
  readonly counts: DiagnosticCategoryCounts;
  readonly droppedEntries: DiagnosticCategoryCounts;
  readonly internalErrorCount: number;
}

const DEFAULT_LIMITS: BrowserDiagnosticsLimits = Object.freeze({
  maximumEntriesPerCategory: 100,
  maximumTextLength: DEFAULT_MAX_TEXT_LENGTH,
  maximumStackLength: 8_000,
  maximumUrlLength: DEFAULT_MAX_URL_LENGTH,
});

export function createDiagnosticSummary(
  input: DiagnosticSummaryInput,
): DiagnosticSummary {
  return {
    collectionStartedAt: input.collectionStartedAt,
    collectionEndedAt: input.collectionEndedAt,
    counts: { ...input.counts },
    droppedEntries: { ...input.droppedEntries },
    internalErrorCount: input.internalErrorCount,
  };
}

function positiveIntegerOrDefault(
  value: number | undefined,
  fallback: number,
  optionName: string,
): number {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${optionName} must be a positive integer.`);
  }

  return value;
}

function resolveLimits(
  limits: Partial<BrowserDiagnosticsLimits> | undefined,
): BrowserDiagnosticsLimits {
  return Object.freeze({
    maximumEntriesPerCategory: positiveIntegerOrDefault(
      limits?.maximumEntriesPerCategory,
      DEFAULT_LIMITS.maximumEntriesPerCategory,
      "maximumEntriesPerCategory",
    ),
    maximumTextLength: positiveIntegerOrDefault(
      limits?.maximumTextLength,
      DEFAULT_LIMITS.maximumTextLength,
      "maximumTextLength",
    ),
    maximumStackLength: positiveIntegerOrDefault(
      limits?.maximumStackLength,
      DEFAULT_LIMITS.maximumStackLength,
      "maximumStackLength",
    ),
    maximumUrlLength: positiveIntegerOrDefault(
      limits?.maximumUrlLength,
      DEFAULT_LIMITS.maximumUrlLength,
      "maximumUrlLength",
    ),
  });
}

interface PageListeners {
  readonly console: (message: ConsoleMessage) => void;
  readonly pageError: (error: Error) => void;
}

export class BrowserDiagnosticsCollector {
  readonly #limits: BrowserDiagnosticsLimits;
  readonly #now: () => Date;
  readonly #browserConsoleErrors: BoundedBuffer<BrowserConsoleErrorDiagnostic>;
  readonly #pageErrors: BoundedBuffer<PageErrorDiagnostic>;
  readonly #failedRequests: BoundedBuffer<FailedRequestDiagnostic>;
  readonly #httpErrorResponses: BoundedBuffer<HttpErrorResponseDiagnostic>;
  readonly #instrumentedPages = new WeakSet<Page>();
  readonly #pageListeners = new Map<Page, PageListeners>();
  #context: BrowserContext | undefined;
  readonly #collectionStartedAt: string;
  #collectionEndedAt: string | undefined;
  #internalErrorCount = 0;
  #disposed = false;

  public constructor(options: BrowserDiagnosticsOptions = {}) {
    this.#limits = resolveLimits(options.limits);
    this.#now = options.now ?? ((): Date => new Date());
    this.#browserConsoleErrors = new BoundedBuffer(
      this.#limits.maximumEntriesPerCategory,
    );
    this.#pageErrors = new BoundedBuffer(
      this.#limits.maximumEntriesPerCategory,
    );
    this.#failedRequests = new BoundedBuffer(
      this.#limits.maximumEntriesPerCategory,
    );
    this.#httpErrorResponses = new BoundedBuffer(
      this.#limits.maximumEntriesPerCategory,
    );
    this.#collectionStartedAt = this.timestamp();
  }

  readonly #handleNewPage = (page: Page): void => {
    this.instrumentPage(page);
  };

  readonly #handleFailedRequest = (request: Request): void => {
    this.captureSafely(() => {
      this.#failedRequests.add({
        timestamp: this.timestamp(),
        method: redactSensitiveText(
          request.method(),
          this.#limits.maximumTextLength,
        ),
        url: sanitizeUrl(request.url(), this.#limits.maximumUrlLength),
        resourceType: redactSensitiveText(
          request.resourceType(),
          this.#limits.maximumTextLength,
        ),
        failureText: redactSensitiveText(
          request.failure()?.errorText ?? "Unknown request failure",
          this.#limits.maximumTextLength,
        ),
      });
    });
  };

  readonly #handleResponse = (response: Response): void => {
    this.captureSafely(() => {
      if (response.status() < 400) {
        return;
      }

      const request = response.request();
      this.#httpErrorResponses.add({
        timestamp: this.timestamp(),
        method: redactSensitiveText(
          request.method(),
          this.#limits.maximumTextLength,
        ),
        url: sanitizeUrl(response.url(), this.#limits.maximumUrlLength),
        status: response.status(),
        statusText: redactSensitiveText(
          response.statusText(),
          this.#limits.maximumTextLength,
        ),
        resourceType: redactSensitiveText(
          request.resourceType(),
          this.#limits.maximumTextLength,
        ),
      });
    });
  };

  public start(context: BrowserContext, initialPage: Page): void {
    if (this.#disposed) {
      return;
    }

    if (this.#context === undefined) {
      this.#context = context;
      context.on("page", this.#handleNewPage);
      context.on("requestfailed", this.#handleFailedRequest);
      context.on("response", this.#handleResponse);
    }

    this.instrumentPage(initialPage);
    for (const page of context.pages()) {
      this.instrumentPage(page);
    }
  }

  public dispose(): void {
    if (this.#disposed) {
      return;
    }

    this.#disposed = true;
    this.#collectionEndedAt = this.timestamp();

    if (this.#context !== undefined) {
      this.removeListenerSafely(() => {
        this.#context?.off("page", this.#handleNewPage);
        this.#context?.off("requestfailed", this.#handleFailedRequest);
        this.#context?.off("response", this.#handleResponse);
      });
    }

    for (const [page, listeners] of this.#pageListeners) {
      this.removeListenerSafely(() => {
        page.off("console", listeners.console);
        page.off("pageerror", listeners.pageError);
      });
    }

    this.#pageListeners.clear();
    this.#context = undefined;
  }

  public snapshot(): BrowserDiagnosticsSnapshot {
    const browserConsoleErrors = this.#browserConsoleErrors.toArray();
    const pageErrors = this.#pageErrors.toArray();
    const failedRequests = this.#failedRequests.toArray();
    const httpErrorResponses = this.#httpErrorResponses.toArray();
    const summary = createDiagnosticSummary({
      collectionStartedAt: this.#collectionStartedAt,
      collectionEndedAt: this.#collectionEndedAt ?? this.timestamp(),
      counts: {
        browserConsoleErrors: browserConsoleErrors.length,
        pageErrors: pageErrors.length,
        failedRequests: failedRequests.length,
        httpErrorResponses: httpErrorResponses.length,
      },
      droppedEntries: {
        browserConsoleErrors: this.#browserConsoleErrors.droppedEntries,
        pageErrors: this.#pageErrors.droppedEntries,
        failedRequests: this.#failedRequests.droppedEntries,
        httpErrorResponses: this.#httpErrorResponses.droppedEntries,
      },
      internalErrorCount: this.#internalErrorCount,
    });

    return {
      browserConsoleErrors,
      pageErrors,
      failedRequests,
      httpErrorResponses,
      summary,
    };
  }

  private instrumentPage(page: Page): void {
    if (this.#disposed || this.#instrumentedPages.has(page)) {
      return;
    }

    this.#instrumentedPages.add(page);
    const listeners: PageListeners = {
      console: (message) => {
        this.captureConsoleMessage(page, message);
      },
      pageError: (error) => {
        this.capturePageError(page, error);
      },
    };

    this.captureSafely(() => {
      page.on("console", listeners.console);
      page.on("pageerror", listeners.pageError);
      this.#pageListeners.set(page, listeners);
    });
  }

  private captureConsoleMessage(page: Page, message: ConsoleMessage): void {
    this.captureSafely(() => {
      if (message.type() !== "error") {
        return;
      }

      const location = message.location();
      const hasSourceLocation =
        location.url.length > 0 ||
        location.lineNumber > 0 ||
        location.columnNumber > 0;

      this.#browserConsoleErrors.add({
        timestamp: this.timestamp(),
        pageUrl: sanitizeUrl(page.url(), this.#limits.maximumUrlLength),
        messageType: "error",
        text: redactSensitiveText(
          message.text(),
          this.#limits.maximumTextLength,
        ),
        ...(hasSourceLocation
          ? {
              sourceLocation: {
                url: sanitizeUrl(location.url, this.#limits.maximumUrlLength),
                lineNumber: location.lineNumber,
                columnNumber: location.columnNumber,
              },
            }
          : {}),
      });
    });
  }

  private capturePageError(page: Page, error: Error): void {
    this.captureSafely(() => {
      const stack = error.stack;
      this.#pageErrors.add({
        timestamp: this.timestamp(),
        pageUrl: sanitizeUrl(page.url(), this.#limits.maximumUrlLength),
        errorName: redactSensitiveText(
          error.name,
          this.#limits.maximumTextLength,
        ),
        message: redactSensitiveText(
          error.message,
          this.#limits.maximumTextLength,
        ),
        ...(stack === undefined
          ? {}
          : {
              stack: redactSensitiveText(
                stack,
                this.#limits.maximumStackLength,
              ),
            }),
      });
    });
  }

  private captureSafely(operation: () => void): void {
    try {
      operation();
    } catch {
      this.#internalErrorCount++;
    }
  }

  private removeListenerSafely(operation: () => void): void {
    try {
      operation();
    } catch {
      this.#internalErrorCount++;
    }
  }

  private timestamp(): string {
    try {
      return this.#now().toISOString();
    } catch {
      this.#internalErrorCount++;
      return new Date(0).toISOString();
    }
  }
}

export function createBrowserDiagnosticsCollector(
  options: BrowserDiagnosticsOptions = {},
): BrowserDiagnosticsCollector {
  return new BrowserDiagnosticsCollector(options);
}
