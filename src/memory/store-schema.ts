import Database from "better-sqlite3";

export function initializeMemorySchema(db: Database.Database): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS entities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL CHECK(type IN ('file','function','class','concept','config','error','deploy','api','dependency','test','note')),
        name TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        source_session TEXT NOT NULL DEFAULT '',
        confidence REAL NOT NULL DEFAULT 1.0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS relations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        target_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        relation_type TEXT NOT NULL CHECK(relation_type IN (
          'DEPENDS_ON','FIXED_BY','RELATED_TO','MENTIONED_IN',
          'IMPLEMENTS','CONFIGURES','TESTED_BY','ALTERNATIVE_TO',
          'REPLACES','CAUSES','PREVENTS','EXAMPLES'
        )),
        weight REAL NOT NULL DEFAULT 1.0,
        evidence TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS access_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        accessed_at INTEGER NOT NULL,
        source_session TEXT NOT NULL DEFAULT ''
      );

      CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
      CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
      CREATE INDEX IF NOT EXISTS idx_relations_source ON relations(source_id);
      CREATE INDEX IF NOT EXISTS idx_relations_target ON relations(target_id);
      CREATE INDEX IF NOT EXISTS idx_relations_type ON relations(relation_type);
      CREATE INDEX IF NOT EXISTS idx_access_entity ON access_log(entity_id);
    `);

    // Phase 2 migration: add new columns
    migrateAddColumn(db, "entities", "source", "TEXT NOT NULL DEFAULT 'auto'");
    migrateAddColumn(db, "entities", "protected", "INTEGER NOT NULL DEFAULT 0");
    migrateAddColumn(db, "entities", "tags", "TEXT NOT NULL DEFAULT ''");
    migrateAddColumn(db, "entities", "embedding", "BLOB");
    migrateAddColumn(db, "entities", "status", "TEXT NOT NULL DEFAULT 'active'");
    migrateAddColumn(db, "entities", "superseded_by", "INTEGER DEFAULT NULL");
    migrateAddColumn(db, "entities", "abstracted_from", "TEXT NOT NULL DEFAULT ''");
    migrateAddColumn(db, "entities", "feedback_score", "REAL NOT NULL DEFAULT 0.0");
    migrateAddColumn(db, "entities", "access_count", "INTEGER NOT NULL DEFAULT 0");

    // FTS5 virtual table
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(
        name, content, tags, content='entities', content_rowid='id'
      );
    `);

    // Feedback log — tracks injection, reference, and usage signals
    db.exec(`
      CREATE TABLE IF NOT EXISTS feedback_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id INTEGER REFERENCES entities(id) ON DELETE SET NULL,
        session_id TEXT NOT NULL DEFAULT '',
        event_type TEXT NOT NULL CHECK(event_type IN ('injected','referenced','ignored','user_corrected','tool_success','tool_failed')),
        score_delta REAL NOT NULL DEFAULT 0,
        signal_type TEXT NOT NULL DEFAULT 'injected',
        context TEXT DEFAULT '{}',
        retrieval_source TEXT NOT NULL DEFAULT '',
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_feedback_memory ON feedback_log(memory_id);
      CREATE INDEX IF NOT EXISTS idx_feedback_event ON feedback_log(event_type);
    `);

    // Extra columns for feedback_log (migration-safe)
    migrateAddColumn(db, "feedback_log", "signal_type", "TEXT NOT NULL DEFAULT 'injected'");
    migrateAddColumn(db, "feedback_log", "retrieval_source", "TEXT NOT NULL DEFAULT ''");

    // Pending consolidation — lazy merging (RecMem pattern)
    db.exec(`
      CREATE TABLE IF NOT EXISTS pending_consolidation (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_hash TEXT NOT NULL,
        entity_ids TEXT NOT NULL,
        similarity REAL NOT NULL DEFAULT 0,
        trigger_count INTEGER NOT NULL DEFAULT 1,
        first_seen_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL
      );
    `);

    // Strategy weights
    db.exec(`
      CREATE TABLE IF NOT EXISTS strategy_weights (
        strategy TEXT PRIMARY KEY,
        weight REAL NOT NULL DEFAULT 0.33,
        total_calls INTEGER NOT NULL DEFAULT 0,
        success_calls INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL DEFAULT 0
      );
    `);

    const existingWeights = db.prepare("SELECT COUNT(*) as c FROM strategy_weights").get() as { c: number };
    if (existingWeights.c === 0) {
      const now = Date.now();
      db.prepare("INSERT INTO strategy_weights (strategy, weight, updated_at) VALUES (?, ?, ?)").run("fts5", 0.5, now);
      db.prepare("INSERT INTO strategy_weights (strategy, weight, updated_at) VALUES (?, ?, ?)").run("vector", 0.3, now);
      db.prepare("INSERT INTO strategy_weights (strategy, weight, updated_at) VALUES (?, ?, ?)").run("graph", 0.2, now);
    }

    // Query rewrite rules
    db.exec(`
      CREATE TABLE IF NOT EXISTS query_rewrite_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        original_pattern TEXT NOT NULL,
        rewritten_query TEXT NOT NULL,
        success_count INTEGER NOT NULL DEFAULT 1,
        last_used INTEGER NOT NULL DEFAULT 0
      );
    `);

    // FTS5 triggers — keep index in sync with entities table
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS entities_fts_insert AFTER INSERT ON entities BEGIN
        INSERT INTO entities_fts(rowid, name, content, tags) VALUES (new.id, new.name, new.content, new.tags);
      END;
      CREATE TRIGGER IF NOT EXISTS entities_fts_delete AFTER DELETE ON entities BEGIN
        INSERT INTO entities_fts(entities_fts, rowid, name, content, tags) VALUES('delete', old.id, old.name, old.content, old.tags);
      END;
      CREATE TRIGGER IF NOT EXISTS entities_fts_update AFTER UPDATE ON entities BEGIN
        INSERT INTO entities_fts(entities_fts, rowid, name, content, tags) VALUES('delete', old.id, old.name, old.content, old.tags);
        INSERT INTO entities_fts(rowid, name, content, tags) VALUES (new.id, new.name, new.content, new.tags);
      END;
    `);

    // Rebuild FTS5 index from existing data
    db.exec(`INSERT INTO entities_fts(entities_fts) VALUES('rebuild');`);
  }

  function migrateAddColumn(db: Database.Database, table: string, column: string, definition: string): void {
    const info = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
    if (!info.some((col) => col.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }


