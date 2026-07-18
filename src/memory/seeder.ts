// Seeder — bootstrap the memory graph by scanning the project
// Runs on first open. Creates seed memories with moderate confidence.
// source = "seeder", protected = 0

import fs from "fs";
import path from "path";
import { getMnemosyneStore } from "./store.js";
import { isGitRepo, gitExec } from "../tools/git/advisor.js";

export interface SeedResult {
  totalSeeded: number;
  breakdown: { dependencies: number; structure: number; gitHistory: number; config: number };
  warnings: string[];
}

export async function bootstrapMemories(workingDir: string, maxFiles = 50): Promise<SeedResult> {
  const store = getMnemosyneStore();
  const warnings: string[] = [];
  const breakdown = { dependencies: 0, structure: 0, gitHistory: 0, config: 0 };

  try { breakdown.dependencies = await seedDependencies(store, workingDir); } catch (err) { warnings.push(`Dependency scan: ${err}`); }
  try { breakdown.structure = await seedStructure(store, workingDir, maxFiles); } catch (err) { warnings.push(`Structure scan: ${err}`); }
  try { if (await isGitRepo(workingDir)) breakdown.gitHistory = await seedGitHistory(store, workingDir); } catch (err) { warnings.push(`Git scan: ${err}`); }
  try { breakdown.config = await seedConfig(store, workingDir); } catch (err) { warnings.push(`Config scan: ${err}`); }

  return { totalSeeded: breakdown.dependencies + breakdown.structure + breakdown.gitHistory + breakdown.config, breakdown, warnings };
}

async function seedDependencies(store: ReturnType<typeof getMnemosyneStore>, workingDir: string): Promise<number> {
  const pkgPath = path.join(workingDir, "package.json");
  if (!fs.existsSync(pkgPath)) return 0;
  let count = 0;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    const projectName = pkg.name || path.basename(workingDir);
    store.upsertEntity(projectName, "concept", `Project: ${pkg.description || projectName}. Version: ${pkg.version || "unknown"}.`, "seeder", 0.7, "seeder", 0);
    count++;
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const [name, version] of Object.entries(deps).slice(0, 30)) {
      const depType = pkg.dependencies?.[name] ? "dependency" : "devDependency";
      store.upsertEntity(`${projectName}/deps/${name}`, "dependency", `${projectName} depends on ${name}@${version} (${depType})`, "seeder", 0.7, "seeder", 0);
      count++;
    }
    if (pkg.scripts) {
      for (const [name, script] of Object.entries(pkg.scripts).slice(0, 10)) {
        store.upsertEntity(`${projectName}/scripts/${name}`, "config", `npm script "${name}": ${script}`, "seeder", 0.6, "seeder", 0);
        count++;
      }
    }
  } catch { /* invalid JSON */ }
  return count;
}

async function seedStructure(store: ReturnType<typeof getMnemosyneStore>, workingDir: string, maxFiles: number): Promise<number> {
  let count = 0;
  const entries = fs.readdirSync(workingDir, { withFileTypes: true });
  const topDirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules").map((e) => e.name);

  if (topDirs.length > 0) {
    store.upsertEntity(`${path.basename(workingDir)}/structure`, "concept", `Top-level directories: ${topDirs.join(", ")}`, "seeder", 0.7, "seeder", 0);
    count++;
  }

  const frameworkSignals: Record<string, string> = {
    src: "Source code in src/ — typical TS/JS project layout",
    app: "Application code in app/ — may use Next.js App Router",
    pages: "Pages directory — likely file-based routing (Next.js)",
    components: "Components directory — component-based UI architecture",
    lib: "Library/utility code in lib/", utils: "Utility functions in utils/",
    hooks: "React hooks directory found", api: "API route handlers in api/",
    tests: "Tests directory found", "__tests__": "Tests colocated (Jest convention)",
    docs: "Documentation directory", public: "Static assets in public/",
    config: "Configuration files directory", scripts: "Build/utility scripts",
    ".github": "GitHub Actions CI/CD workflows present",
  };

  for (const dir of topDirs) {
    const signal = frameworkSignals[dir];
    if (signal) {
      store.upsertEntity(`${path.basename(workingDir)}/structure/${dir}`, "concept", signal, "seeder", 0.65, "seeder", 0);
      count++;
    }
  }

  // Detect languages from file extensions
  const extCounts = new Map<string, number>();
  countExtensions(workingDir, extCounts, maxFiles);
  if (extCounts.size > 0) {
    const topExts = [...extCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const langMap: Record<string, string> = { ".ts": "TypeScript", ".tsx": "TSX", ".js": "JavaScript", ".jsx": "JSX", ".py": "Python", ".rs": "Rust", ".go": "Go", ".css": "CSS", ".html": "HTML", ".json": "JSON", ".yaml": "YAML", ".yml": "YAML", ".md": "Markdown", ".sql": "SQL", ".vue": "Vue", ".svelte": "Svelte" };
    const langDesc = topExts.map(([ext, c]) => `${langMap[ext] || ext} (${c} files)`).join(", ");
    store.upsertEntity(`${path.basename(workingDir)}/languages`, "concept", `Primary languages: ${langDesc}`, "seeder", 0.7, "seeder", 0);
    count++;
  }

  return count;
}

function countExtensions(dir: string, counts: Map<string, number>, maxFiles: number): void {
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (counts.size >= 100) return;
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) countExtensions(fullPath, counts, maxFiles);
      else if (entry.isFile()) { const ext = path.extname(entry.name); if (ext) counts.set(ext, (counts.get(ext) || 0) + 1); }
    }
  } catch { /* skip */ }
}

async function seedGitHistory(store: ReturnType<typeof getMnemosyneStore>, workingDir: string): Promise<number> {
  let count = 0;
  try {
    const log = await gitExec(["log", "-10", "--format=%h|%s|%an"], workingDir);
    for (const line of log.split("\n").filter(Boolean)) {
      const [hash, ...rest] = line.split("|");
      store.upsertEntity(`git/commit/${hash}`, "concept", `Commit ${hash}: ${rest.join("|")}`, "seeder", 0.5, "seeder", 0);
      count++;
    }
    const remoteUrl = await gitExec(["remote", "get-url", "origin"], workingDir).catch(() => "");
    if (remoteUrl) { store.upsertEntity("git/remote", "config", `Git remote: ${remoteUrl}`, "seeder", 0.8, "seeder", 0); count++; }
  } catch { /* skip */ }
  return count;
}

async function seedConfig(store: ReturnType<typeof getMnemosyneStore>, workingDir: string): Promise<number> {
  let count = 0;
  const projectName = path.basename(workingDir);

  const configFiles: Array<{ filename: string; factType: string }> = [
    { filename: "tsconfig.json", factType: "TypeScript configuration" },
    { filename: ".eslintrc.js", factType: "ESLint configuration" },
    { filename: "eslint.config.js", factType: "ESLint flat config" },
    { filename: ".prettierrc", factType: "Prettier configuration" },
    { filename: "vite.config.ts", factType: "Vite build tool" },
    { filename: "next.config.js", factType: "Next.js framework" },
    { filename: "tailwind.config.js", factType: "Tailwind CSS" },
    { filename: "jest.config.ts", factType: "Jest test framework" },
    { filename: "vitest.config.ts", factType: "Vitest test framework" },
    { filename: "docker-compose.yml", factType: "Docker Compose" },
    { filename: "Dockerfile", factType: "Docker container" },
    { filename: ".env.example", factType: "Environment variables template" },
    { filename: ".rubato.yml", factType: "Rubato config" },
    { filename: "CLAUDE.md", factType: "Claude Code instructions" },
    { filename: ".gitignore", factType: "Git ignore rules" },
  ];

  for (const { filename, factType } of configFiles) {
    if (fs.existsSync(path.join(workingDir, filename))) {
      store.upsertEntity(`${projectName}/config/${filename}`, "config", `${factType} found: ${filename}`, "seeder", 0.8, "seeder", 0);
      count++;
    }
  }

  // Parse tsconfig for compiler options
  try {
    const tsconfigPath = path.join(workingDir, "tsconfig.json");
    if (fs.existsSync(tsconfigPath)) {
      const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, "utf-8"));
      const opts = tsconfig.compilerOptions;
      if (opts) {
        const summary = [opts.strict ? "strict mode" : "", opts.target ? `target: ${opts.target}` : "", opts.module ? `module: ${opts.module}` : "", opts.jsx ? `JSX: ${opts.jsx}` : ""].filter(Boolean).join(", ");
        if (summary) { store.upsertEntity(`${projectName}/config/tsconfig-options`, "config", `TS compiler options: ${summary}`, "seeder", 0.75, "seeder", 0); count++; }
      }
    }
  } catch { /* skip */ }

  return count;
}

// ---- MEMORY.md import ----

export async function importMemoryMd(filePath: string): Promise<number> {
  if (!fs.existsSync(filePath)) return 0;
  const store = getMnemosyneStore();
  const content = fs.readFileSync(filePath, "utf-8");
  let count = 0;

  const sections = content.split(/\n## /);
  for (const section of sections) {
    const lines = section.trim().split("\n");
    if (lines.length === 0) continue;
    const title = lines[0].replace(/^## /, "").trim();
    const body = lines.slice(1).join("\n").trim();
    if (!title || !body) continue;
    const tagMatches = body.match(/#[\w-]+/g) || [];
    store.addManualMemory(title, body, tagMatches.map((t) => t.replace(/^#/, "")), "memories_md", "note");
    count++;
  }

  if (count === 0 && content.trim()) {
    const firstLine = content.trim().split("\n")[0];
    store.addManualMemory(firstLine.slice(0, 80), content.trim(), [], "memories_md", "note");
    count = 1;
  }

  return count;
}
