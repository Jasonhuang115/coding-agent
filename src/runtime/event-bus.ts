// EventBus — typed pub/sub for the Agent Runtime
// All runtime behavior is event-driven: Logger, CLI, Telemetry, Replay consume events.
// Zero dependencies, built on the observer pattern.

import type { TokenUsage } from "../shared/core-types.js";

// ---- Event type definitions ----

export type RuntimeEvent =
  // Task lifecycle
  | { type: "task.started"; taskId: string; timestamp: number }
  | { type: "task.completed"; taskId: string; timestamp: number; totalSteps: number; totalTokens: TokenUsage }

  // Step lifecycle
  | { type: "step.started"; stepIndex: number; timestamp: number }
  | { type: "step.completed"; stepIndex: number; timestamp: number; usage: TokenUsage; latencyMs: number }

  // Prompt
  | { type: "prompt.built"; timestamp: number; layers: string[]; estimatedTokens: number }

  // Model
  | { type: "model.invoked"; timestamp: number; provider: string; model: string }
  | { type: "model.streaming"; timestamp: number; provider: string }
  | { type: "model.responded"; timestamp: number; provider: string; latencyMs: number; usage: TokenUsage }

  // Tool execution
  | { type: "tool.executing"; timestamp: number; tool: string; input: Record<string, unknown> }
  | { type: "tool.executed"; timestamp: number; tool: string; input: Record<string, unknown>; output: string; isError: boolean; latencyMs: number }

  // Security
  | { type: "security.decision"; timestamp: number; tool: string; verdict: string; risk: string; reason: string }

  // Retry
  | { type: "retry.attempted"; timestamp: number; attempt: number; maxAttempts: number; reason: string }

  // Compaction
  | { type: "compaction.triggered"; timestamp: number; reason: string; messagesBefore: number; messagesAfter: number }

  // Error
  | { type: "error"; timestamp: number; error: string; context: string; recoverable: boolean };

/** Handler for a specific event type or pattern. */
export type EventHandler = (event: RuntimeEvent) => void;

/** Unsubscribe function returned by on(). */
export type Unsubscribe = () => void;

// ---- EventBus implementation ----

export class EventBus {
  private handlers = new Map<string, Set<EventHandler>>();

  /**
   * Subscribe to events matching a pattern.
   *
   * Patterns:
   *   - "tool.*" matches tool.executing, tool.executed
   *   - "task.started" matches exactly
   *   - "*" matches all events
   *
   * Returns an unsubscribe function.
   */
  on(pattern: string, handler: EventHandler): Unsubscribe {
    if (!this.handlers.has(pattern)) {
      this.handlers.set(pattern, new Set());
    }
    this.handlers.get(pattern)!.add(handler);

    return () => {
      this.handlers.get(pattern)?.delete(handler);
      if (this.handlers.get(pattern)?.size === 0) {
        this.handlers.delete(pattern);
      }
    };
  }

  /**
   * Subscribe to a single event, then automatically unsubscribe.
   */
  once(pattern: string, handler: EventHandler): Unsubscribe {
    const wrapped: EventHandler = (event) => {
      unsubscribe();
      handler(event);
    };
    const unsubscribe = this.on(pattern, wrapped);
    return unsubscribe;
  }

  /**
   * Emit an event to all matching handlers.
   */
  emit(event: RuntimeEvent): void {
    for (const [pattern, handlers] of this.handlers) {
      if (this.matches(pattern, event.type)) {
        for (const handler of handlers) {
          try {
            handler(event);
          } catch {
            // Don't let one handler break others
          }
        }
      }
    }
  }

  /**
   * Remove all handlers. Useful for cleanup between tests/sessions.
   */
  removeAllListeners(): void {
    this.handlers.clear();
  }

  /**
   * Get the count of registered handlers.
   */
  get handlerCount(): number {
    let count = 0;
    for (const handlers of this.handlers.values()) {
      count += handlers.size;
    }
    return count;
  }

  // ---- Pattern matching ----

  private matches(pattern: string, eventType: string): boolean {
    if (pattern === "*") return true;
    if (pattern === eventType) return true;

    // Wildcard: "tool.*" matches "tool.executing"
    if (pattern.endsWith(".*")) {
      const prefix = pattern.slice(0, -2);
      return eventType.startsWith(prefix + ".");
    }

    return false;
  }
}
