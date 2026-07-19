// Mnemosyne memory graph — shared public types.
// Runtime storage is implemented by MnemosyneStore in store.ts.

export type MemoryEntityType =
  | "file"
  | "function"
  | "class"
  | "concept"
  | "config"
  | "error"
  | "deploy"
  | "api"
  | "dependency"
  | "test"
  | "note";

export type MemoryRelationType =
  | "DEPENDS_ON"
  | "FIXED_BY"
  | "RELATED_TO"
  | "MENTIONED_IN"
  | "IMPLEMENTS"
  | "CONFIGURES"
  | "TESTED_BY"
  | "ALTERNATIVE_TO"
  | "REPLACES"
  | "CAUSES"
  | "PREVENTS"
  | "EXAMPLES";

/** A memory's lifecycle state. Only active memories enter the default prompt. */
export type MemoryStatus = "active" | "superseded" | "dormant" | "deprecated";

export interface MemoryEntry {
  id?: number;
  type: MemoryEntityType;
  name?: string;
  content: string;
  source?: string;
  timestamp: number;
}

export interface MemoryEdge {
  id?: number;
  source_id: number;
  target_id: number;
  relation: MemoryRelationType;
  weight: number;
  timestamp: number;
}

export interface MemoryStore {
  addEntry(entry: MemoryEntry): Promise<number>;
  addEdge(edge: MemoryEdge): Promise<number>;
  search(query: string, limit?: number): Promise<MemoryEntry[]>;
  searchByVector(vector: Float32Array, limit?: number): Promise<MemoryEntry[]>;
  getEdges(entryId: number): Promise<MemoryEdge[]>;
  getRelated(entryId: number, depth?: number): Promise<MemoryEntry[]>;
}
