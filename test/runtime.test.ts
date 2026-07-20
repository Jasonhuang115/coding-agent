// Tests for runtime components used by the production agent loop.
import { describe, it, expect } from "vitest";
import { roughTokenEstimate, estimateMessageTokens } from "../src/runtime/compaction-controller.js";

describe("CompactionController token estimation", () => {
  it("estimates text and structured messages", () => {
    expect(roughTokenEstimate("hello world")).toBeGreaterThan(0);
    expect(estimateMessageTokens([{ role: "user", content: "hello world" }])).toBeGreaterThan(0);
    expect(estimateMessageTokens([{
      role: "assistant",
      content: [{ type: "text", text: "answer" }],
    }])).toBeGreaterThan(0);
  });
});
