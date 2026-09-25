import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CliError } from "./errors.js";

const OWNER = "@coding-tech/tinypng";
const MARKER = ".tinypng-skill.json";

interface Marker {
  owner: string;
  version: string;
}

function packageRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function sourceSkillDirectory(): string {
  return path.join(packageRoot(), "skills", "tinypng");
}

export function targetSkillDirectory(environment = process.env): string {
  const codexRoot = environment.CODEX_HOME?.trim() || path.join(os.homedir(), ".codex");
  return path.join(codexRoot, "skills", "tinypng");
}

async function packageVersion(): Promise<string> {
  const raw = await readFile(path.join(packageRoot(), "package.json"), "utf8");
  const parsed = JSON.parse(raw) as { version: string };
  return parsed.version;
}

async function readMarker(target: string): Promise<Marker | undefined> {
  try {
    const raw = await readFile(path.join(target, MARKER), "utf8");
    return JSON.parse(raw) as Marker;
  } catch {
    return undefined;
  }
}

export async function installSkill(): Promise<{ path: string; version: string }> {
  const source = sourceSkillDirectory();
  const target = targetSkillDirectory();
  if (!existsSync(path.join(source, "SKILL.md"))) {
    throw new CliError("CONFIG", `Bundled Codex skill is missing: ${source}`, 2);
  }

  if (existsSync(target)) {
    const marker = await readMarker(target);
    if (!marker || marker.owner !== OWNER) {
      throw new CliError(
        "CONFIG",
        `Refusing to replace an unowned skill directory: ${target}`,
        2
      );
    }
    await rm(target, { recursive: true, force: true });
  }

  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target, { recursive: true, errorOnExist: true });
  const version = await packageVersion();
  await writeFile(
    path.join(target, MARKER),
    `${JSON.stringify({ owner: OWNER, version }, null, 2)}\n`,
    { mode: 0o600 }
  );
  return { path: target, version };
}

export async function skillStatus(): Promise<{
  installed: boolean;
  owned: boolean;
  path: string;
  version?: string;
}> {
  const target = targetSkillDirectory();
  try {
    await stat(path.join(target, "SKILL.md"));
  } catch {
    return { installed: false, owned: false, path: target };
  }
  const marker = await readMarker(target);
  return {
    installed: true,
    owned: marker?.owner === OWNER,
    path: target,
    version: marker?.version
  };
}

export async function removeSkill(): Promise<boolean> {
  const status = await skillStatus();
  if (!status.installed) return false;
  if (!status.owned) {
    throw new CliError("CONFIG", `Refusing to remove an unowned skill: ${status.path}`, 2);
  }
  await rm(status.path, { recursive: true, force: true });
  return true;
}
