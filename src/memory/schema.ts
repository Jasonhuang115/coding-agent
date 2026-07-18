// Mnemosyne memory graph — Phase 1 scaffold, Phase 2 implementation
// Phase 1: Schema definition only. No runtime operations.

export interface MemoryEntry {
  id?: number;
  type: "fact" | "feedback" | "reference" | "project";
  content: string;
  source?: string;
  timestamp: number;
  // embedding is stored separately
}

export interface MemoryEdge {
  id?: number;
  source_id: number;
  target_id: number;
  relation: "relates_to" | "contradicts" | "extends" | "depends_on";
  weight: number;
  timestamp: number;
}

// ---- Extension point: Phase 2 vector search ----

export interface MemoryStore {
  addEntry(entry: MemoryEntry): Promise<number>;
  addEdge(edge: MemoryEdge): Promise<number>;
  search(query: string, limit?: number): Promise<MemoryEntry[]>;
  searchByVector(vector: Float32Array, limit?: number): Promise<MemoryEntry[]>;
  getEdges(entryId: number): Promise<MemoryEdge[]>;
  getRelated(entryId: number, depth?: number): Promise<MemoryEntry[]>;
}

// Phase 1: no-op store
// Phase 2: replaces this with MnemosyneStore
const storePlaceholder: MemoryStore = {
  async addEntry() { return -1; },
  async addEdge() { return -1; },
  async search() { return []; },
  async searchByVector() { return []; },
  async getEdges() { return []; },
  async getRelated() { return []; },
};

let activeStore: MemoryStore = storePlaceholder;

export function getMemoryStore(): MemoryStore {
  return activeStore;
}

export function setMemoryStore(store: MemoryStore): void {
  activeStore = store;
}
