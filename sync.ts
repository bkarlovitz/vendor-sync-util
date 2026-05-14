#!/usr/bin/env bun
import { $ } from "bun";
import { existsSync, readdirSync, statSync } from "node:fs";
import { rm, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

type Entry = { package: string; version: string; repo: string; ref: string; dir: string };
type Config = { outDir: string; entries: Entry[] };

const CONFIG_PATH = "vendor.config.json";
const REF_FILE = ".vendor-ref";
const ENTRY_FIELDS = ["package", "version", "repo", "ref", "dir"] as const;

const cmd = process.argv[2];
if (cmd !== "sync" && cmd !== "status") {
  console.error("Usage: bun sync.ts <sync|status>");
  process.exit(1);
}
const config = await loadConfig();
if (cmd === "sync") await sync(config);
else await status(config);

async function loadConfig(): Promise<Config> {
  if (!existsSync(CONFIG_PATH)) die(`${CONFIG_PATH} not found in current directory`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
  } catch (err) {
    die(`Invalid JSON in ${CONFIG_PATH}: ${(err as Error).message}`);
  }
  if (typeof parsed !== "object" || parsed === null) badConfig("config must be an object");
  const o = parsed as Record<string, unknown>;
  if (typeof o.outDir !== "string") badConfig("outDir must be a string");
  if (!Array.isArray(o.entries)) badConfig("entries must be an array");
  const entries = o.entries.map((e, i) => {
    if (typeof e !== "object" || e === null) badConfig(`entries[${i}] must be an object`);
    const ent = e as Record<string, unknown>;
    for (const f of ENTRY_FIELDS) {
      if (typeof ent[f] !== "string") badConfig(`entries[${i}].${f} must be a string`);
    }
    return Object.fromEntries(ENTRY_FIELDS.map((f) => [f, ent[f]])) as Entry;
  });
  return { outDir: o.outDir, entries };
}

async function sync(config: Config) {
  const outDir = resolve(process.cwd(), config.outDir);
  if (!existsSync(outDir)) await mkdir(outDir, { recursive: true });

  let cloned = 0, skipped = 0, orphans = 0;
  for (const entry of config.entries) {
    const target = join(outDir, entry.dir);
    const tag = `[${entry.package}]`;
    if (!existsSync(target)) {
      console.log(`${tag} cloning ${entry.repo} at ${entry.ref}`);
      await clone(entry, target);
      cloned++;
      continue;
    }
    const current = await readRef(target);
    if (current === entry.ref) {
      console.log(`${tag} already at ${entry.ref}, skipping`);
      skipped++;
    } else {
      console.log(`${tag} ref mismatch (have ${current ?? "unknown"}, want ${entry.ref}), re-cloning`);
      await rm(target, { recursive: true, force: true });
      await clone(entry, target);
      cloned++;
    }
  }

  for (const name of orphansIn(outDir, config)) {
    console.log(`[orphan] removing ${name}`);
    await rm(join(outDir, name), { recursive: true, force: true });
    orphans++;
  }

  console.log(`Synced ${config.entries.length} entries (${cloned} cloned, ${skipped} skipped, ${orphans} orphans removed)`);
}

async function status(config: Config) {
  const outDir = resolve(process.cwd(), config.outDir);
  const rows: string[][] = [];
  for (const entry of config.entries) {
    const target = join(outDir, entry.dir);
    const present = existsSync(target);
    const matches = present ? ((await readRef(target)) === entry.ref ? "yes" : "no") : null;
    rows.push([
      `${entry.package}@${entry.version}`,
      `ref=${entry.ref}`,
      `present=${present ? "yes" : "no"}`,
      matches === null ? "" : `matches=${matches}`,
    ]);
  }
  const widths = [0, 0, 0, 0];
  for (const r of rows) for (let i = 0; i < 4; i++) widths[i] = Math.max(widths[i], r[i].length);
  for (const r of rows) console.log(r.map((c, i) => c.padEnd(widths[i])).join("  ").trimEnd());

  if (existsSync(outDir)) {
    const orphans = orphansIn(outDir, config);
    if (orphans.length > 0) {
      console.log("\nOrphans (in outDir but not in config):");
      for (const o of orphans) console.log(`  ${o}`);
    }
  }
}

async function clone(entry: Entry, target: string) {
  try {
    await $`git clone --depth 1 --single-branch --no-tags --branch ${entry.ref} ${entry.repo} ${target}`.quiet();
  } catch (err) {
    const e = err as { stderr?: Buffer; message?: string };
    const msg = e.stderr ? e.stderr.toString() : e.message ?? "unknown error";
    console.error(`[${entry.package}] clone failed:\n${msg}`);
    process.exit(1);
  }
  await writeFile(join(target, REF_FILE), entry.ref, "utf8");
}

async function readRef(target: string): Promise<string | null> {
  const p = join(target, REF_FILE);
  if (!existsSync(p)) return null;
  return (await readFile(p, "utf8")).trim();
}

function orphansIn(outDir: string, config: Config): string[] {
  const declared = new Set(config.entries.map((e) => e.dir));
  return readdirSync(outDir).filter((name) => {
    return statSync(join(outDir, name)).isDirectory() && !declared.has(name);
  });
}

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}

function badConfig(msg: string): never {
  die(`Invalid vendor.config.json: ${msg}`);
}
