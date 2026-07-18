// AgentRuntime — lifecycle container for agent execution
// Wraps agentLoop() with state machine tracking, event emission, and resource management.
// AgentLoop remains the core execution engine; Runtime adds observability and control.

import { EventBus } from "./event-bus.js";
import { AgentStateMachine, AgentState } from "./state-machine.js";
import type { AgentConfig, StreamRenderer, ConfirmDecision, TokenUsage } from "../shared/core-types.js";
import type { AgentEvent } from "../agent/loop.js";
import type { SessionManager } from "./session/manager.js";

export interface RuntimeOptions {
  config: AgentConfig;
  workingDir: string;
  prompt: string;
  renderer: StreamRenderer;
  sessionId?: string;
  sessionManager?: SessionManager;
  onConfirmTool?: (toolName: string, input: Record<string, unknown>) => Promise<ConfirmDecision>;
  resumeSummary?: string;
}

export class AgentRuntime {
  readonly eventBus: EventBus;
  readonly stateMachine: AgentStateMachine;
  readonly options: RuntimeOptions;

  private _totalTokens: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  private _totalSteps = 0;
  private _startTime = 0;

  constructor(options: RuntimeOptions) {
    this.options = options;
    this.eventBus = new EventBus();
    this.stateMachine = new AgentStateMachine(this.eventBus);
  }

  /** Total tokens consumed across all steps. */
  get totalTokens(): TokenUsage {
    return { ...this._totalTokens };
  }

  /** Total steps executed. */
  get totalSteps(): number {
    return this._totalSteps;
  }

  /** Elapsed time since run() started. */
  get elapsedMs(): number {
    return this._startTime > 0 ? Date.now() - this._startTime : 0;
  }

  /**
   * Run the agent loop and return a summary.
   * Delegates to the existing agentLoop() generator.
   */
  async run(): Promise<{ totalSteps: number; totalTokens: TokenUsage }> {
    // Lazy import to avoid circular dependency
    const { agentLoop } = await import("../agent/loop.js");

    this._startTime = Date.now();
    this.stateMachine.reset();
    this.stateMachine.transition(AgentState.EXECUTING, "Starting agent loop");

    const { config, workingDir, prompt, renderer, sessionId, sessionManager, onConfirmTool, resumeSummary } = this.options;

    try {
      for await (const event of agentLoop({
        config,
        workingDir,
        prompt,
        renderer,
        sessionId,
        sessionManager,
        onConfirmTool,
        resumeSummary,
      })) {
        // Track step completion
        if (event.type === "turn_end") {
          this._totalSteps++;
        }

        // Track token usage from done/completed events
        if (event.type === "done") {
          this.stateMachine.transition(AgentState.DONE, "Agent loop completed");
          this.eventBus.emit({
            type: "task.completed",
            taskId: sessionId ?? "",
            timestamp: Date.now(),
            totalSteps: this._totalSteps,
            totalTokens: this._totalTokens,
          });
        }

        // Track errors
        if (event.type === "error") {
          this.eventBus.emit({
            type: "error",
            timestamp: Date.now(),
            error: typeof event === "object" && "message" in event ? String((event as any).message) : "Unknown error",
            context: "agent_loop",
            recoverable: true,
          });
        }
      }
    } catch (err) {
      this.stateMachine.transition(AgentState.ERROR, String(err));
      this.eventBus.emit({
        type: "error",
        timestamp: Date.now(),
        error: String(err),
        context: "agent_runtime",
        recoverable: false,
      });
    }

    return { totalSteps: this._totalSteps, totalTokens: this._totalTokens };
  }

  /**
   * Abort the currently running agent loop (set by entry.ts).
   * This is a signal-based approach — the loop checks the abort signal.
   */
  // The abort mechanism is handled externally via abortCurrentRequest() from loop.ts
}
