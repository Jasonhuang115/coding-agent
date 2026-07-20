#!/usr/bin/env node
// CLI entry point — parses arguments, loads config, runs the agent

import { randomUUID } from "crypto";
import path from "path";
import * as readline from "readline";
import type { ConfirmDecision } from "../shared/core-types.js";
import { loadConfig, loadEnvFiles } from "./config-loader.js";
import { parseArgs, loadMcpConfigs } from "./options.js";
import {
  handleGitCommand,
  handleJournalCommand,
  handleMemoryCommand,
  handleModelCommand,
  handleSessionsCommand,
  handleSkillCommand,
  handlePlanCommand,
  handleGrillMeCommand,
} from "./command-handlers.js";
import { AnsiStreamRenderer } from "./stream-renderer.js";
import { agentLoop, abortCurrentRequest } from "../agent/loop.js";
import {
  register,
  unregister,
  getAllTools,
} from "../tools/registry.js";
import { bashTool } from "../tools/bash.js";
import { readTool } from "../tools/read.js";
import { writeTool } from "../tools/write.js";
import { editTool } from "../tools/edit.js";
import { grepTool } from "../tools/grep.js";
import { globTool } from "../tools/glob.js";
import { webFetchTool, webSearchTool } from "../tools/web.js";
import { todoWriteTool } from "../tools/todo.js";
import { planTool } from "../tools/plan.js";
import { agentTool } from "../tools/agent.js";
import { skillTool } from "../tools/skill.js";
import { PlanManager } from "../agent/planner/manager.js";
import { getMnemosyneStore } from "../memory/store.js";
import { initCustomDefinitions } from "../agent/agent-defs.js";
import { McpClient } from "../tools/mcp/client.js";
import { connectMcpServer, disconnectMcpServer } from "../tools/mcp/adapter.js";
import { loadAllSkills } from "../skills/loader.js";
import { getSkillRegistry } from "../skills/registry.js";
import type { AgentConfig } from "../shared/core-types.js";
import { warnRecoverable } from "../shared/diagnostics.js";
import { SessionManager } from "../runtime/session/manager.js";

// Register all tools
register(readTool);
register(writeTool);
register(editTool);
register(bashTool);
register(grepTool);
register(globTool);
register(webFetchTool);
register(webSearchTool);
register(todoWriteTool);
register(planTool);
register(agentTool);
register(skillTool);

// ---- Tab completion & / menu ----

function getSlashCompletions(): string[] {
  const builtin = [
    "/exit", "/quit", "/compact", "/clear", "/help",
    "/plan", "/plan new", "/plan list", "/plan done", "/plan show",
    "/grillme", "/grillme on", "/grillme off", "/grillme strict", "/grillme normal", "/grillme loose",
    "/git", "/git health",
    "/journal", "/journal recent", "/journal search", "/journal stats",
    "/remember",
    "/memory", "/memory stats", "/memory search",
    "/model",
    "/sessions", "/sessions list", "/sessions resume",
  ];

  // Add skill commands
  const skillCmds = getSkillRegistry()
    .listSkills()
    .map((s) => `/${s.name}`);

  return [...builtin, ...skillCmds];
}

function createSlashCompleter(): readline.Completer {
  const commands = getSlashCompletions();
  return (line: string) => {
    if (!line.startsWith("/")) {
      return [[], line];
    }

    const hits = commands.filter((cmd) => cmd.startsWith(line));
    // If only one hit, complete it with trailing space
    if (hits.length === 1 && hits[0] === line) {
      return [[], line];
    }
    return [hits.length > 0 ? hits : [], line];
  };
}

function showSlashMenu(): void {
  const skills = getSkillRegistry().listSkills();

  console.log("\n  ── Commands ──");
  console.log("  /exit, /quit       Exit");
  console.log("  /clear              Start a fresh session");
  console.log("  /compact            Compact context");
  console.log("  /plan               Show plan | /plan new <desc> | /plan done");
  console.log("  /grillme            Toggle plan tracking | /grillme on/off/strict/normal/loose");
  console.log("  /git                Git status | /git health");
  console.log("  /journal            Search journal | /journal search <q>");
  console.log("  /remember <title>   Save to journal");
  console.log("  /memory             Memory stats | /memory search <q>");
  console.log("  /model              Switch model | /model <name>");
  console.log("  /sessions           List sessions | /sessions resume <#>");
  console.log("  /help               Full help");

  if (skills.length > 0) {
    console.log("\n  ── Skills ──");
    for (const s of skills) {
      const mode = s.context === "fork" ? "⚡fork" : "📋inline";
      console.log(`  /${s.name.padEnd(18)} ${mode}  ${s.description ?? ""}`);
    }
  }

  console.log(`\n  Tab → autocomplete. Type /name for details.`);
}

// ---- Loop state (for session restart signaling) ----

interface LoopState {
  shouldRestart: boolean;
  newSessionId?: string;
  resumeSummary?: string;
}

// ---- First message handler (with slash command support) ----

// Read input. First line via rl.question() (compatible with confirm prompts).
// If the user continues typing (paste or manual), switches to rl.on('line')
// for continuation lines. Empty line = send. Slash commands send immediately.
function readMultiLineInput(
  rl: readline.Interface,
  firstPrompt: string,
): Promise<string> {
  return new Promise((resolve) => {
    rl.question(firstPrompt, (firstAnswer) => {
      const firstLine = firstAnswer.trimEnd();

      if (!firstLine.trim()) { resolve(""); return; }
      if (firstLine.trim().startsWith("/")) { resolve(firstLine.trim()); return; }

      // Continuation mode: listen for more lines (paste or manual multi-line)
      const lines = [firstLine];
      let resolved = false;

      const done = (result: string) => {
        if (resolved) return;
        resolved = true;
        rl.removeListener("line", onLine);
        rl.setPrompt("");
        resolve(result);
      };

      const onLine = (raw: string) => {
        const line = raw.trimEnd();
        if (!line.trim()) {
          done(lines.join("\n"));
          return;
        }
        lines.push(line);
        rl.prompt();
      };

      rl.on("line", onLine);
      rl.setPrompt("  > ");
      rl.prompt();
    });
  });
}

async function getFirstMessage(
  rl: readline.Interface,
  planManager: PlanManager,
  workdir: string,
  config: { model: { provider: string; model: string } }
): Promise<string> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const trimmed = await readMultiLineInput(rl, "\n▸ You: ");
    if (!trimmed) return "/exit";

    // Handle slash commands locally, loop back for real message
    if (trimmed === "/exit" || trimmed === "/quit") return "/exit";
    if (trimmed === "/help") { showHelp(); continue; }
    if (trimmed.startsWith("/plan")) { handlePlanCommand(trimmed, planManager); continue; }
    if (trimmed.startsWith("/grillme")) { handleGrillMeCommand(trimmed, planManager); continue; }
    if (trimmed.startsWith("/git")) { handleGitCommand(trimmed, workdir); continue; }
    if (trimmed.startsWith("/journal") || trimmed.startsWith("/remember")) { handleJournalCommand(trimmed, workdir); continue; }
    if (trimmed.startsWith("/memory")) { handleMemoryCommand(trimmed); continue; }
    if (trimmed.startsWith("/model")) { handleModelCommand(trimmed, config); continue; }

    // Not a slash command — send to agent
    return trimmed;
  }
}

function showHelp(): void {
  console.log("\n  REPL Commands:");
  console.log("  /plan               Show plan | /plan new <desc> | /plan done");
  console.log("  /grillme on/off     Toggle Grill Me tracking");
  console.log("  /grillme strict|normal|loose — Set sensitivity");
  console.log("  /git                Show current git status");
  console.log("  /git health         Show branch health summary");
  console.log("  /journal search <q> Search personal knowledge base");
  console.log("  /remember <title>   Save current context");
  console.log("  /memory             Memory stats | /memory search <q> | /memory list");
  console.log("  /model              List / switch models");
  console.log("  /help               Show this help");
  console.log("  /exit, /quit        Exit");
  console.log("  Ctrl+C              Exit");
}

// ---- Main ----

function createRepl(
  rl: readline.Interface,
  planManager: PlanManager,
  workdir: string,
  config: AgentConfig,
  loopOptions: { forceCompaction?: boolean },
  sessionManager: SessionManager,
  loopState: LoopState,
  currentSessionId: () => string,
  onSessionFinalize: () => void,
): () => Promise<string | null> {
  return async () => {
    const trimmed = await readMultiLineInput(rl, "\n▸ You: ");
    if (trimmed === "/") {
      showSlashMenu();
      return createRepl(rl, planManager, workdir, config, loopOptions, sessionManager, loopState, currentSessionId, onSessionFinalize)();
    } else if (trimmed === "/exit" || trimmed === "/quit") {
          onSessionFinalize();
          return null;
        } else if (trimmed === "/clear") {
          // Finalize current session and restart
          onSessionFinalize();
          loopState.shouldRestart = true;
          loopState.newSessionId = randomUUID();
          console.log("\n  ✨ Session saved. Starting fresh...");
          return null;
        } else if (trimmed === "/compact") {
          if (loopOptions) { loopOptions.forceCompaction = true; }
          console.log("\n  Compacting on next turn...");
          return createRepl(rl, planManager, workdir, config, loopOptions, sessionManager, loopState, currentSessionId, onSessionFinalize)();
        } else if (trimmed.startsWith("/sessions")) {
          const result = handleSessionsCommand(trimmed, sessionManager);
          if (result.restartLoop && result.resumeId) {
            onSessionFinalize();
            try {
              const { summary } = sessionManager.resumeSession(result.resumeId);
              loopState.shouldRestart = true;
              loopState.newSessionId = randomUUID();
              loopState.resumeSummary = summary;
              console.log(`\n  📋 Resuming session ${result.resumeId.slice(0, 8)}...`);
            } catch (err) {
              console.log(`\n  ✖ Failed to resume: ${err instanceof Error ? err.message : err}`);
              loopState.shouldRestart = false;
            }
            return null;
          } else {
            return createRepl(rl, planManager, workdir, config, loopOptions, sessionManager, loopState, currentSessionId, onSessionFinalize)();
          }
        } else if (trimmed === "/help") {
          console.log("\n  REPL Commands:");
          console.log("  /exit, /quit      — Exit the chat");
          console.log("  /clear             — Start a fresh session (saves current)");
          console.log("  /compact           — Summarize earlier context to free space");
          console.log("  /plan             — Show current plan");
          console.log("  /plan new <desc>  — Start a new plan (gathering mode)");
          console.log("  /plan done        — Mark plan as completed");
          console.log("  /grillme on/off   — Toggle Grill Me tracking");
          console.log("  /grillme strict|normal|loose — Set sensitivity");
          console.log("  /git              — Show current git status");
          console.log("  /git health       — Show branch health summary");
          console.log("  /journal search <q> — Search personal knowledge base");
          console.log("  /remember <title> — Save current context to journal");
          console.log("  /memory stats     — Show Mnemosyne memory stats");
          console.log("  /model            — List / switch models");
          console.log("  /sessions         — List project sessions | /sessions resume <#>");
          console.log("  /help             — Show this help");
          console.log("  Ctrl+C            — Interrupt / Exit when idle");
          // List loaded skills
          const skills = getSkillRegistry().listSkills();
          if (skills.length > 0) {
            console.log("\n  Skills (/<name>):");
            for (const s of skills) {
              const mode = s.context === "inline" ? "inline" : "fork";
              console.log(`  /${s.name.padEnd(18)} — ${s.description ?? "(no description)"} [${mode}]`);
            }
          }
          return createRepl(rl, planManager, workdir, config, loopOptions, sessionManager, loopState, currentSessionId, onSessionFinalize)();
        } else if (trimmed.startsWith("/plan")) {
          handlePlanCommand(trimmed, planManager);
          return createRepl(rl, planManager, workdir, config, loopOptions, sessionManager, loopState, currentSessionId, onSessionFinalize)();
        } else if (trimmed.startsWith("/grillme")) {
          handleGrillMeCommand(trimmed, planManager);
          return createRepl(rl, planManager, workdir, config, loopOptions, sessionManager, loopState, currentSessionId, onSessionFinalize)();
        } else if (trimmed.startsWith("/git")) {
          handleGitCommand(trimmed, workdir);
          return createRepl(rl, planManager, workdir, config, loopOptions, sessionManager, loopState, currentSessionId, onSessionFinalize)();
        } else if (trimmed.startsWith("/journal") || trimmed.startsWith("/remember")) {
          handleJournalCommand(trimmed, workdir);
          return createRepl(rl, planManager, workdir, config, loopOptions, sessionManager, loopState, currentSessionId, onSessionFinalize)();
        } else if (trimmed.startsWith("/memory")) {
          handleMemoryCommand(trimmed);
          return createRepl(rl, planManager, workdir, config, loopOptions, sessionManager, loopState, currentSessionId, onSessionFinalize)();
        } else if (trimmed.startsWith("/model")) {
          handleModelCommand(trimmed, config);
          return createRepl(rl, planManager, workdir, config, loopOptions, sessionManager, loopState, currentSessionId, onSessionFinalize)();
        } else if (trimmed.startsWith("/") && getSkillRegistry().getSkill(trimmed.split(/\s+/)[0].slice(1))) {
          const passthrough = await handleSkillCommand(trimmed, workdir, config);
          if (typeof passthrough === "string") {
            // Inline skill: pass through to the model
            return passthrough;
          } else {
            // Fork skill or unknown: already handled, next REPL prompt
            return createRepl(rl, planManager, workdir, config, loopOptions, sessionManager, loopState, currentSessionId, onSessionFinalize)();
          }
        } else {
          return trimmed || null;
        }
  };
}

// ---- Permission confirmation prompt ----

/**
 * Format tool input for display in the confirmation prompt.
 * Shows the most relevant parameter (command for Bash, file_path for Read/Write/Edit).
 */
function formatToolInput(toolName: string, input: Record<string, unknown>): string {
  if (toolName === "Bash" && input.command) {
    return String(input.command);
  }
  if (input.file_path) {
    return `${toolName}: ${input.file_path}`;
  }
  // Fallback: show first key-value pair
  const entries = Object.entries(input).slice(0, 2);
  return entries.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ");
}

const CONFIRM_BOX_WIDTH = 54;

function createConfirmPrompt(
  rl: readline.Interface,
): (toolName: string, input: Record<string, unknown>) => Promise<ConfirmDecision> {
  return (toolName: string, input: Record<string, unknown>): Promise<ConfirmDecision> => {
    return new Promise((resolve) => {
      const detail = formatToolInput(toolName, input);
      const truncated = detail.length > CONFIRM_BOX_WIDTH - 6
        ? detail.slice(0, CONFIRM_BOX_WIDTH - 9) + "..."
        : detail;

      // Box drawing with ANSI
      const top = `\n  ╔══ \x1b[33m🔧 ${toolName}\x1b[0m ${"═".repeat(Math.max(0, CONFIRM_BOX_WIDTH - toolName.length - 12))}╗`;
      const mid = `  ║  \x1b[36m${truncated}\x1b[0m${" ".repeat(Math.max(0, CONFIRM_BOX_WIDTH - truncated.length - 6))}║`;
      const sep = `  ║  ${" ".repeat(CONFIRM_BOX_WIDTH - 6)}║`;
      const opt = `  ║  \x1b[32m[y]\x1b[0m Yes   \x1b[32m[a]\x1b[0m Always   \x1b[31m[n]\x1b[0m No   \x1b[31m[d]\x1b[0m Deny all  ║`;
      const bot = `  ╚${"═".repeat(CONFIRM_BOX_WIDTH - 2)}╝`;

      console.log(top);
      console.log(mid);
      console.log(sep);
      console.log(opt);
      console.log(bot);

      rl.question("  ▸ ", (answer) => {
        const trimmed = answer.trim().toLowerCase();
        switch (trimmed) {
          case "y": case "yes": resolve("allow_once"); break;
          case "a": case "always": resolve("allow_always"); break;
          case "d": case "deny all": resolve("deny_always"); break;
          case "n": case "no": default: resolve("deny_once"); break;
        }
      });
    });
  };
}

async function main(): Promise<void> {
  const { prompt, workdir, model, provider, interactive, continueSession, resumeSession } = parseArgs();

  // Load API keys from .env files (shell env takes priority)
  loadEnvFiles(workdir);

  const config = loadConfig(workdir);

  // CLI overrides
  if (model) config.model.model = model;
  if (provider) config.model.provider = provider;

  const renderer = new AnsiStreamRenderer();

  console.log(`rubato v0.2.0`);
  console.log(`Provider: ${config.model.provider} | Model: ${config.model.model}`);
  console.log(`Working dir: ${workdir}`);
  console.log(`Tools: ${getAllTools().length} registered`);

  // ---- Session manager ----
  const sessionManager = new SessionManager(workdir);

  // Migrate old Journal entries into unified Mnemosyne (one-time, best-effort)
  try {
    const store = getMnemosyneStore();
    const journalDbPath = path.join(process.env.HOME ?? "/tmp", ".rubato", "journal", "journal.db");
    const migrated = store.migrateJournalEntries(journalDbPath);
    if (migrated > 0) {
      console.log(`📓 已将 ${migrated} 条旧知识迁移到统一记忆图谱。`);
    }
  } catch (error) { warnRecoverable(`memory:${workdir}:journal-migration`, error); }

  // Initialize custom agent definitions
  try { initCustomDefinitions(workdir); } catch (error) { warnRecoverable(`agents:${workdir}:load`, error); }
  // Load skills from .rubato/skills/
  try { loadAllSkills(workdir); } catch (error) { warnRecoverable(`skills:${workdir}:load`, error); }
  // Backfill embeddings for any entities missing them
  try {
    const { embedAllEntities } = await import("../memory/vector-search.js");
    const store = getMnemosyneStore();
    const n = await embedAllEntities(store);
    if (n > 0) console.log(`🔢 Generated embeddings for ${n} entities`);
  } catch (error) { warnRecoverable(`memory:${workdir}:embedding-backfill`, error); }

  // Memory health report
  try {
    const store = getMnemosyneStore();
    const health = store.getHealthReport();
    const pending = health.pendingConsolidation > 0 ? ` | 待合并 ${health.pendingConsolidation}` : "";
    console.log(`🧠 记忆健康: 活跃 ${health.active} | 过期 ${health.superseded} | 休眠 ${health.dormant} | 弃用 ${health.deprecated}${pending} | 向量 ${health.vectorReady ? "✅" : "⏳"}`);
  } catch (error) { warnRecoverable(`memory:${workdir}:health-report`, error); }

  // Bootstrap memory seeder on first project open
  if (config.mnemosyne.bootstrap_on_first_open) {
    try {
      const { bootstrapMemories } = await import("../memory/seeder.js");
      const seedResult = await bootstrapMemories(workdir, config.mnemosyne.bootstrap_max_files);
      if (seedResult.totalSeeded > 0) {
        console.log(`🌱 Seeded ${seedResult.totalSeeded} initial memories from project scan.`);
        // Backfill embeddings for vector search
        const { embedAllEntities } = await import("../memory/vector-search.js");
        const store = getMnemosyneStore();
        const n = await embedAllEntities(store);
        if (n > 0) console.log(`🔢 Generated embeddings for ${n} entities`);
      }
    } catch (error) { warnRecoverable(`memory:${workdir}:bootstrap`, error); }
  }

  // Load and display active plan
  const planManager = new PlanManager(workdir);
  const planSummary = planManager.getPlanSummary();
  if (planSummary) {
    console.log(`\n${planSummary}`);
  }

  // ---- MCP Server Startup ----
  const mcpConfigs = loadMcpConfigs(workdir);
  for (const cfg of mcpConfigs) {
    try {
      const client = new McpClient(cfg);
      const tools = await connectMcpServer(client, cfg.name);
      for (const tool of tools) register(tool);
      console.log(`MCP: ${cfg.name} connected (${tools.length} tools)`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`MCP: ${cfg.name} failed — ${msg}`);
    }
  }

  if (interactive) {
    console.log(`Mode: interactive (type /exit to quit, /help for help)`);
  }

  // ---- Handle --continue / --resume ----
  let effectivePrompt = prompt || (interactive ? "" : "Hello! What would you like to work on?");
  let initialResumeSummary: string | undefined;

  if (continueSession) {
    const recent = SessionManager.findMostRecent(workdir);
    if (recent) {
      try {
        const { summary } = sessionManager.resumeSession(recent.id);
        initialResumeSummary = summary;
        console.log(`\n  📋 Resuming session: ${recent.id.slice(0, 8)}...`);
        if (recent.firstMessage) {
          console.log(`  "${recent.firstMessage.slice(0, 80)}"`);
        }
      } catch (error) { warnRecoverable(`session:${recent.id}:resume`, error); }
    } else {
      console.log("\n  No previous sessions found for this project.");
    }
  }

  if (resumeSession !== undefined) {
    if (resumeSession === "") {
      // Show interactive picker
      const sessions = sessionManager.listSessions();
      if (sessions.length === 0) {
        console.log("\n  No sessions found for this project.");
        process.exit(1);
      }
      console.log("\n  Select a session to resume:");
      sessions.forEach((s, i) => {
        const when = new Date(s.createdAt).toLocaleString();
          console.log(`  ${i}: ${s.id.slice(0, 8)}... — ${s.firstMessage?.slice(0, 60)} (${s.status}, ${when})`);
      });
      // Use readline to get selection
      const selection = await new Promise<string>((resolve) => {
        const selRl = readline.createInterface({ input: process.stdin, output: process.stdout });
        selRl.question("\n  Enter #: ", (answer) => {
          selRl.close();
          resolve(answer.trim());
        });
      });
      const idx = parseInt(selection, 10);
      if (isNaN(idx) || idx < 0 || idx >= sessions.length) {
        console.log("\n  Invalid selection.");
        process.exit(1);
      }
      const { summary } = sessionManager.resumeSession(sessions[idx].id);
      initialResumeSummary = summary;
    } else {
      // Resume specific session by ID/prefix
      const sessions = sessionManager.listSessions();
      const matches = sessions.filter((s) => s.id.startsWith(resumeSession));
      if (matches.length === 0) {
        console.log(`\n  No session found matching "${resumeSession}".`);
        process.exit(1);
      }
      if (matches.length > 1) {
        console.log("\n  Multiple matches. Be more specific:");
        matches.forEach((s) => console.log(`    ${s.id}`));
        process.exit(1);
      }
      try {
        const { summary } = sessionManager.resumeSession(matches[0].id);
        initialResumeSummary = summary;
        console.log(`\n  📋 Resuming session: ${matches[0].id.slice(0, 8)}...`);
      } catch (error) { warnRecoverable(`session:${matches[0].id}:resume`, error); }
    }
  }

  // Setup REPL if interactive
  const rl = interactive
    ? readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        completer: createSlashCompleter(),
      })
    : null;

  // In interactive mode with no initial prompt, wait for the user's first real message
  if (interactive && !prompt && !continueSession && !resumeSession) {
    effectivePrompt = await getFirstMessage(rl!, planManager, workdir, config);
    if (effectivePrompt === "/exit") {
      console.log("Exiting...");
      if (rl) rl.close();
      process.exit(0);
    }
    if (!effectivePrompt) {
      console.log("Exiting...");
      if (rl) rl.close();
      process.exit(0);
    }
    // Don't renderUserMessage here — readline already echoes what the user typed
  } else if (effectivePrompt) {
    renderer.renderUserMessage(effectivePrompt);
  }

  const loopOptions: { forceCompaction?: boolean } = {};

  // Track whether we're processing a turn (so Ctrl+C knows to abort vs exit)
  let processing = true;

  // Ctrl+C handling: abort current request when processing, exit when idle
  const onSigInt = () => {
    if (processing) {
      abortCurrentRequest();
      console.log("\n  ⏹ Interrupted — returning to prompt...");
    } else {
      console.log("\n  Exiting...");
      if (rl) rl.close();
      process.exit(0);
    }
  };
  process.on("SIGINT", onSigInt);

  // ---- Outer restart loop ----
  let loopState: LoopState = { shouldRestart: false };
  let sessionTokens = 0;
  let activeSessionId = "";

  // Mutable getter for current session ID (for REPL handlers)
  const getSessionId = () => activeSessionId;

  // Called by REPL before restarting/exiting to save session state
  const onSessionFinalize = () => {
    if (activeSessionId && sessionManager) {
      sessionManager.updateSession(activeSessionId, {
        tokenCount: sessionTokens,
        status: "ended",
      });
    }
  };

  do {
    loopState = { shouldRestart: false };
    activeSessionId = loopState.newSessionId ?? randomUUID();
    sessionTokens = 0;

    const resumeSummary = loopState.resumeSummary ?? initialResumeSummary;
    initialResumeSummary = undefined; // only inject on first iteration

    try {
      for await (const event of agentLoop({
        config,
        workingDir: workdir,
        prompt: effectivePrompt,
        renderer,
        sessionId: activeSessionId,
        sessionManager,
        resumeSummary,
        getNextUserMessage: rl
          ? createRepl(rl, planManager, workdir, config, loopOptions, sessionManager, loopState, getSessionId, onSessionFinalize)
          : undefined,
        forceCompaction: loopOptions.forceCompaction,
        onConfirmTool: rl ? createConfirmPrompt(rl) : undefined,
      })) {
        switch (event.type) {
          case "turn_start":
            processing = true;
            break;

          case "text":
            // Already rendered by stream
            break;

          case "thinking":
            break;

          case "tool_result":
            renderer.renderToolResult(
              `${event.name}: ${event.isError ? "✖" : "✓"} ${event.result.substring(0, 200)}`
            );
            break;

          case "error":
            renderer.renderError(event.message);
            break;

          case "warning":
            renderer.renderWarning(event.message);
            break;

          case "compacting":
            renderer.renderSystemMessage(`Compacting context: ${event.reason}`);
            break;

          case "waiting_for_input":
            processing = false; // idle — Ctrl+C will exit
            break;

          case "done":
            console.log(`\n[Session ended: ${event.reason}]`);
            processing = false;
            break;

          case "turn_end":
            if (event.usage) {
              sessionTokens += event.usage.input + event.usage.output;
            }
            break;
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      renderer.renderError(`Fatal: ${message}`);
      process.exit(1);
    }

    // Finalize session if it was active
    if (activeSessionId) {
      onSessionFinalize();
    }

    // If restarting, wait for user input instead of auto-sending a prompt
    if (loopState.shouldRestart) {
      effectivePrompt = await readMultiLineInput(rl!, "\n▸ You: ") || "/exit";
      if (effectivePrompt === "/exit") {
        console.log("Exiting...");
        break;
      }
      loopOptions.forceCompaction = false;
    }
  } while (loopState.shouldRestart);

  process.off("SIGINT", onSigInt);
  if (rl) rl.close();
  for (const cfg of mcpConfigs) {
    for (const toolName of disconnectMcpServer(cfg.name)) unregister(toolName);
  }
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
