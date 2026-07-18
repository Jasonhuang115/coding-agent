// Agent State Machine — tracks the agent's lifecycle state
// Used by AgentRuntime to manage transitions and emit events.

import { EventBus } from "./event-bus.js";

/** Agent lifecycle states. */
export enum AgentState {
  /** Initial state, no session active. */
  IDLE = "idle",
  /** Requirements gathering or plan generation in progress. */
  PLANNING = "planning",
  /** Actively executing tool calls. */
  EXECUTING = "executing",
  /** Verifying results (tests, typecheck, lint). */
  VERIFYING = "verifying",
  /** Task completed successfully. */
  DONE = "done",
  /** Task failed or was cancelled. */
  ERROR = "error",
  /** Waiting for user input in interactive mode. */
  WAITING = "waiting",
}

/** Valid state transitions. */
const TRANSITIONS: Record<AgentState, AgentState[]> = {
  [AgentState.IDLE]: [AgentState.PLANNING, AgentState.EXECUTING],
  [AgentState.PLANNING]: [AgentState.EXECUTING, AgentState.DONE, AgentState.ERROR, AgentState.WAITING],
  [AgentState.EXECUTING]: [AgentState.VERIFYING, AgentState.DONE, AgentState.ERROR, AgentState.WAITING, AgentState.PLANNING],
  [AgentState.VERIFYING]: [AgentState.EXECUTING, AgentState.DONE, AgentState.ERROR],
  [AgentState.DONE]: [AgentState.IDLE, AgentState.PLANNING, AgentState.EXECUTING],
  [AgentState.ERROR]: [AgentState.IDLE, AgentState.PLANNING, AgentState.EXECUTING],
  [AgentState.WAITING]: [AgentState.EXECUTING, AgentState.PLANNING, AgentState.DONE, AgentState.ERROR],
};

/** Context passed on state transitions. */
export interface StateTransition {
  from: AgentState;
  to: AgentState;
  timestamp: number;
  reason?: string;
}

export class AgentStateMachine {
  private _state: AgentState = AgentState.IDLE;
  private history: StateTransition[] = [];
  readonly eventBus: EventBus;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  get state(): AgentState {
    return this._state;
  }

  /**
   * Attempt a state transition. Throws if the transition is invalid.
   * Emits a state-changed event on success.
   */
  transition(to: AgentState, reason?: string): StateTransition {
    const allowed = TRANSITIONS[this._state];
    if (!allowed.includes(to)) {
      throw new Error(
        `Invalid state transition: ${this._state} → ${to}. Allowed: ${allowed.join(", ")}`
      );
    }

    const transition: StateTransition = {
      from: this._state,
      to,
      timestamp: Date.now(),
      reason,
    };

    this.history.push(transition);
    this._state = to;

    // Emit state change event
    this.eventBus.emit({
      type: `task.${to === AgentState.DONE ? "completed" : to === AgentState.ERROR ? "completed" : "started"}` as any,
      taskId: "",
      timestamp: transition.timestamp,
      // @ts-ignore — partial fields for state events
    });

    return transition;
  }

  /**
   * Get the full state transition history.
   */
  getHistory(): StateTransition[] {
    return [...this.history];
  }

  /**
   * Check if a transition is valid without executing it.
   */
  canTransition(to: AgentState): boolean {
    return TRANSITIONS[this._state]?.includes(to) ?? false;
  }

  /**
   * Reset to IDLE. Does not throw.
   */
  reset(): void {
    this._state = AgentState.IDLE;
  }
}
