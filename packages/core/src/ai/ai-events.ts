import type { AiErrorCode } from "./ai-errors.ts";
import type { AiTokenUsage } from "./ai-types.ts";

export const AI_EVENT_TYPES = [
  "request-started",
  "request-completed",
  "retry-scheduled",
  "request-failed",
  "request-blocked",
  "ai-disabled",
  "mock-response-used",
] as const;
export type AiEventType = (typeof AI_EVENT_TYPES)[number];

export interface AiLifecycleEvent {
  readonly sequence: number;
  readonly type: AiEventType;
  readonly providerId: string;
  readonly model: string;
  readonly promptTemplateId?: string;
  readonly promptTemplateVersion?: string;
  readonly inputCharacterCount?: number;
  readonly requestedOutputTokens?: number;
  readonly durationMs?: number;
  readonly retryNumber?: number;
  readonly usage?: AiTokenUsage;
  readonly approximateCostUsd?: number;
  readonly errorCode?: AiErrorCode;
}

export type AiEventSink = (event: AiLifecycleEvent) => void;

export class AiEventRecorder {
  readonly #events: AiLifecycleEvent[] = [];
  readonly #sink: AiEventSink | undefined;

  public constructor(sink?: AiEventSink) {
    this.#sink = sink;
  }

  public emit(event: Omit<AiLifecycleEvent, "sequence">): void {
    const record = Object.freeze({
      sequence: this.#events.length + 1,
      ...event,
    });
    this.#events.push(record);
    try {
      this.#sink?.(record);
    } catch {
      // Optional observability must not change the AI request result.
    }
  }

  public snapshot(): readonly AiLifecycleEvent[] {
    return Object.freeze([...this.#events]);
  }
}
