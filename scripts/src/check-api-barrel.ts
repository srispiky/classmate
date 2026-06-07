/**
 * Codegen compatibility guard for lib/api-client-react/src/index.ts
 *
 * After every `pnpm --filter @workspace/api-spec run codegen` run, this script
 * verifies that:
 *
 *   1. Every symbol explicitly re-exported by the barrel exists in its source file.
 *   2. No `export *` wildcard source introduces a name that shadows an explicit
 *      named export (ambiguous exports are silently dropped by ES modules and
 *      cause hard-to-diagnose "does not provide an export" runtime errors).
 *   3. The generated files actually exist on disk.
 *
 * Exit code 0 = all checks pass.
 * Exit code 1 = one or more checks failed (prints details to stderr).
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WORKSPACE_ROOT = path.resolve(__dirname, "..", "..");
const BARREL = path.join(WORKSPACE_ROOT, "lib", "api-client-react", "src", "index.ts");
const BARREL_DIR = path.dirname(BARREL);

// ── Helpers ───────────────────────────────────────────────────────────────────

function readFile(p: string): string {
  if (!fs.existsSync(p)) {
    fail(`File not found: ${relativePath(p)}`);
  }
  return fs.readFileSync(p, "utf8");
}

function relativePath(p: string): string {
  return path.relative(WORKSPACE_ROOT, p);
}

const failures: string[] = [];

function fail(msg: string): void {
  failures.push(`  ✗ ${msg}`);
}

function pass(msg: string): void {
  console.log(`  ✓ ${msg}`);
}

// ── Parse exports from a TS source file ───────────────────────────────────────
//
// Extracts the set of exported names using a simple regex approach.
// Handles:
//   export const foo = ...
//   export function foo ...
//   export class Foo ...
//   export type Foo = ...
//   export interface Foo ...
//   export enum Foo ...
//   export { foo, bar }
//   export { foo as baz }
//   Does NOT follow re-exports (export * from / export { } from).

function extractExportedNames(source: string): Set<string> {
  const names = new Set<string>();

  // export const/let/var/function/class/type/interface/enum <Name>
  const declarationPattern =
    /^export\s+(?:(?:default|abstract|declare)\s+)*(?:const|let|var|function\*?|class|type|interface|enum|async\s+function\*?)\s+(\w+)/gm;
  let m: RegExpExecArray | null;
  while ((m = declarationPattern.exec(source)) !== null) {
    names.add(m[1]);
  }

  // export { foo, foo as bar, type baz }
  const namedBlockPattern = /^export\s+(?:type\s+)?\{([^}]+)\}(?!\s+from)/gm;
  while ((m = namedBlockPattern.exec(source)) !== null) {
    const block = m[1];
    for (const entry of block.split(",")) {
      const alias = entry.trim().split(/\s+as\s+/).pop()?.trim();
      if (alias && alias !== "" && !alias.startsWith("//")) {
        names.add(alias);
      }
    }
  }

  return names;
}

// ── Parse the barrel ──────────────────────────────────────────────────────────

type WildcardExport = { kind: "wildcard"; source: string };
type NamedExport = { kind: "named"; names: string[]; source: string; isType: boolean };
type BarrelEntry = WildcardExport | NamedExport;

function parseBarrel(source: string): BarrelEntry[] {
  const entries: BarrelEntry[] = [];

  // export * from "..."
  const wildcardPattern = /^export\s+\*\s+from\s+['"]([^'"]+)['"]/gm;
  let m: RegExpExecArray | null;
  while ((m = wildcardPattern.exec(source)) !== null) {
    entries.push({ kind: "wildcard", source: m[1] });
  }

  // export { foo, bar } from "..." and export type { Baz } from "..."
  const namedPattern =
    /^export\s+(type\s+)?\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/gm;
  while ((m = namedPattern.exec(source)) !== null) {
    const isType = Boolean(m[1]?.trim());
    const block = m[2];
    const source_ = m[3];
    const names: string[] = [];
    for (const entry of block.split(",")) {
      const alias = entry.trim().split(/\s+as\s+/).pop()?.trim();
      if (alias && alias !== "") names.push(alias);
    }
    if (names.length > 0) {
      entries.push({ kind: "named", names, source: source_, isType });
    }
  }

  return entries;
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log("\n🔍  Checking api-client-react barrel compatibility...\n");
console.log(`  Barrel: ${relativePath(BARREL)}\n`);

const barrelSource = readFile(BARREL);
const entries = parseBarrel(barrelSource);

const wildcardSources = entries.filter((e): e is WildcardExport => e.kind === "wildcard");
const namedEntries = entries.filter((e): e is NamedExport => e.kind === "named");

// Step 1 — confirm all generated files exist
console.log("  [1/3] Checking generated files exist...");
for (const entry of wildcardSources) {
  const candidates = [`${entry.source}.ts`, `${entry.source}/index.ts`].map((s) =>
    path.resolve(BARREL_DIR, s),
  );
  const exists = candidates.some((c) => fs.existsSync(c));
  if (exists) {
    pass(`${entry.source} exists`);
  } else {
    fail(`Wildcard source not found: ${entry.source} (checked ${candidates.map(relativePath).join(", ")})`);
  }
}

// Step 2 — verify named exports exist in their source files
console.log("\n  [2/3] Verifying named exports exist in source files...");
for (const entry of namedEntries) {
  const resolved = path.resolve(BARREL_DIR, `${entry.source}.ts`);
  const source = readFile(resolved);
  const exported = extractExportedNames(source);

  for (const name of entry.names) {
    if (exported.has(name)) {
      pass(`${name}  ←  ${relativePath(resolved)}`);
    } else {
      fail(
        `"${name}" is re-exported by the barrel from ${entry.source} but is NOT exported by that file.\n` +
          `    Available exports: ${[...exported].sort().join(", ")}`,
      );
    }
  }
}

// Step 3 — detect naming conflicts between wildcard sources and explicit named exports
console.log("\n  [3/3] Checking for wildcard/named export conflicts...");

const explicitNames = new Set(namedEntries.flatMap((e) => e.names));

const wildcardExportMap = new Map<string, string[]>(); // name → source files

for (const entry of wildcardSources) {
  const candidates = [`${entry.source}.ts`, `${entry.source}/index.ts`].map((s) =>
    path.resolve(BARREL_DIR, s),
  );
  const resolved = candidates.find((c) => fs.existsSync(c));
  if (!resolved) continue;

  const source = readFile(resolved);
  const exported = extractExportedNames(source);

  for (const name of exported) {
    const current = wildcardExportMap.get(name) ?? [];
    current.push(entry.source);
    wildcardExportMap.set(name, current);
  }
}

let conflictFound = false;
for (const name of explicitNames) {
  const collisions = wildcardExportMap.get(name) ?? [];
  if (collisions.length > 0) {
    fail(
      `"${name}" is both explicitly re-exported by the barrel AND exported by wildcard source(s): ${collisions.join(", ")}.\n` +
        `    ES modules silently drop ambiguous exports — "${name}" will NOT be accessible from the barrel.`,
    );
    conflictFound = true;
  }
}

if (!conflictFound) {
  pass("No naming conflicts between wildcard and named exports");
}

// Check for duplicate wildcard sources (two export * sources exporting the same name)
const duplicateWildcards: string[] = [];
for (const [name, sources] of wildcardExportMap) {
  if (sources.length > 1) {
    duplicateWildcards.push(`"${name}" from ${sources.join(" and ")}`);
  }
}
if (duplicateWildcards.length > 0) {
  fail(
    `Duplicate names across wildcard sources (ambiguous, will not be exported):\n    ${duplicateWildcards.slice(0, 5).join("\n    ")}${duplicateWildcards.length > 5 ? `\n    ... and ${duplicateWildcards.length - 5} more` : ""}`,
  );
} else {
  pass("No duplicate names across wildcard sources");
}

// ── Result ────────────────────────────────────────────────────────────────────

console.log();
if (failures.length === 0) {
  console.log("✅  All barrel checks passed.\n");
  process.exit(0);
} else {
  console.error(`❌  ${failures.length} barrel check(s) failed:\n`);
  for (const f of failures) {
    console.error(f);
  }
  console.error();
  process.exit(1);
}
