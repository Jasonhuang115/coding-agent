// PromptAssembler — assembles the complete system prompt from 3 layers
// Static → Capability → Dynamic (Ephemeral is handled by the agent loop per-turn)
// Provides token estimation for budget management.

import type { AgentContext, ToolDefinition } from "../shared/core-types.js";
import { buildStaticPrompt } from "./static.js";
import { buildCapabilityPrompt } from "./capability.js";
import { buildDynamicPrompt } from "./dynamic.js";
import type { LayeredPrompt, ModelProfile, TokenEstimate } from "./types.js";
import { MODEL_PROFILES } from "./types.js";

export class PromptAssembler {
  private profile: ModelProfile;

  constructor(providerName?: string) {
    this.profile = MODEL_PROFILES[providerName ?? "default"] ?? MODEL_PROFILES.default;
  }

  /**
   * Assemble the complete system prompt for the given context and tools.
   * Returns separated layers so the caller can decide on caching strategy.
   */
  assemble(ctx: AgentContext, tools: ToolDefinition[]): LayeredPrompt {
    return {
      static: buildStaticPrompt(),
      capability: buildCapabilityPrompt(tools),
      dynamic: buildDynamicPrompt(ctx),
    };
  }

  /**
   * Assemble as a single string for providers that don't support caching.
   */
  assembleFlat(ctx: AgentContext, tools: ToolDefinition[]): string {
    const layers = this.assemble(ctx, tools);
    return [layers.static, layers.capability, layers.dynamic]
      .filter(Boolean)
      .join("\n\n");
  }

  /**
   * Estimate token count for the assembled prompt.
   * Uses character-based estimation (approx 3 chars/token for English).
   */
  estimateTokens(ctx: AgentContext, tools: ToolDefinition[]): TokenEstimate {
    const layers = this.assemble(ctx, tools);
    const estimate = (text: string) => Math.ceil(text.length / 3);
    return {
      static: estimate(layers.static),
      capability: estimate(layers.capability),
      dynamic: estimate(layers.dynamic),
      total: estimate(layers.static + layers.capability + layers.dynamic),
    };
  }

  /**
   * Check if the assembled prompt exceeds the model's budget.
   * Returns the excess amount or 0 if within budget.
   */
  checkBudget(ctx: AgentContext, tools: ToolDefinition[]): { withinBudget: boolean; excess: number } {
    const { total } = this.estimateTokens(ctx, tools);
    const excess = total - this.profile.maxSystemPromptTokens;
    return { withinBudget: excess <= 0, excess: Math.max(0, excess) };
  }

  /**
   * Update the model profile (e.g., when switching providers).
   */
  setProfile(providerName: string): void {
    this.profile = MODEL_PROFILES[providerName] ?? MODEL_PROFILES.default;
  }

  getProfile(): ModelProfile {
    return this.profile;
  }
}

/** Default singleton assembler instance. */
let defaultAssembler: PromptAssembler | null = null;

export function getPromptAssembler(providerName?: string): PromptAssembler {
  if (!defaultAssembler) {
    defaultAssembler = new PromptAssembler(providerName);
  }
  return defaultAssembler;
}

export function resetPromptAssembler(): void {
  defaultAssembler = null;
}
