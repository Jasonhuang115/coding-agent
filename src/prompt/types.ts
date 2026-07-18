// Prompt architecture types — 4-layer prompt system
// Layers: Static → Capability → Dynamic → Ephemeral
// Each layer has different caching and lifecycle characteristics.

/** Model-specific prompt profile for adaptive prompt generation. */
export interface ModelProfile {
  /** Maximum tokens allowed for the system prompt. */
  maxSystemPromptTokens: number;
  /** Whether the model supports Anthropic-style prompt caching. */
  supportsPromptCaching: boolean;
  /** How the system message is delivered to the model. */
  systemPromptFormat: "system" | "user" | "first_message";
  /** The model's thinking/reasoning format. */
  thinkingFormat: "thinking_delta" | "reasoning_content" | "none";
}

/** Built-in model profiles. */
export const MODEL_PROFILES: Record<string, ModelProfile> = {
  default: {
    maxSystemPromptTokens: 3000,
    supportsPromptCaching: false,
    systemPromptFormat: "system",
    thinkingFormat: "none",
  },
  claude: {
    maxSystemPromptTokens: 8000,
    supportsPromptCaching: true,
    systemPromptFormat: "system",
    thinkingFormat: "thinking_delta",
  },
  deepseek: {
    maxSystemPromptTokens: 3000,
    supportsPromptCaching: false,
    systemPromptFormat: "system",
    thinkingFormat: "reasoning_content",
  },
  openai: {
    maxSystemPromptTokens: 6000,
    supportsPromptCaching: false,
    systemPromptFormat: "system",
    thinkingFormat: "none",
  },
};

/** The assembled prompt with separated layers. */
export interface LayeredPrompt {
  /** Almost never changes — can be cached aggressively. */
  static: string;
  /** Depends on available tools — changes when tools are added/removed. */
  capability: string;
  /** Session-scoped — workspace, git, memory, plan status. */
  dynamic: string;
}

/** Estimated token counts for each layer. */
export interface TokenEstimate {
  static: number;
  capability: number;
  dynamic: number;
  total: number;
}
