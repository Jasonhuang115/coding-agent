import type { MemoryEntityType, MemoryRelationType, MemoryStatus } from "./schema.js";

export interface EntityRow {
  id: number;
  type: MemoryEntityType;
  name: string;
  content: string;
  source_session: string;
  source: string;
  protected: number;
  tags: string;
  confidence: number;
  created_at: number;
  updated_at: number;
  embedding: Buffer | null;
  status: MemoryStatus;
  superseded_by: number | null;
  abstracted_from: string;
  feedback_score: number;
  access_count: number;
}

export interface RelationRow {
  id: number;
  source_id: number;
  target_id: number;
  relation_type: MemoryRelationType;
  weight: number;
  evidence: string;
  created_at: number;
}

export interface InjectedMemory {
  entity: EntityRow;
  retrievalSource: string;
  query: string;
}

export interface FeedbackSignalRow {
  memoryId: number;
  sessionId: string;
  eventType: string;
  signalType: string;
  retrievalSource: string;
  scoreDelta: number;
  context: Record<string, unknown>;
}

export interface MemorySearchOptions {
  statuses?: MemoryStatus[];
}
