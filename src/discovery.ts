import { access, lstat, readdir } from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";
import { CliError } from "./errors.js";
import {
  extensionForFormat,
  formatFromPath,
  type FormatSelection,
  type ImageFormat
} from "./formats.js";
import type { InputFile, PlannedItem } from "./types.js";

export const MAX_FILE_BYTES = 500 * 1024 * 1024;

async function walkDirectory(directory: string, recursive: boolean): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
  const files: string[] = [];

  for (const entry of entries) {
    const child = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isFile()) {
      if (formatFromPath(child)) files.push(child);
    } else if (entry.isDirectory() && recursive) {
      files.push(...(await walkDirectory(child, true)));
    }
  }
  return files;
}

async function inspectFile(filePath: string): Promise<InputFile> {
  const absolute = path.resolve(filePath);
  const stats = await lstat(absolute);
  if (stats.isSymbolicLink()) {
    throw new CliError("USAGE", `Symbolic links are not accepted: ${absolute}`, 2);
  }
  if (!stats.isFile()) {
    throw new CliError("USAGE", `Not a regular file: ${absolute}`, 2);
  }
  const format = formatFromPath(absolute);
  if (!format) {
    throw new CliError("USAGE", `Unsupported image format: ${absolute}`, 2);
  }
  if (stats.size > MAX_FILE_BYTES) {
    throw new CliError("USAGE", `File exceeds Tinify's 500 MB limit: ${absolute}`, 2);
  }
  await access(absolute, constants.R_OK);
  return { path: absolute, format, size: stats.size };
}

export async function discoverInputs(paths: string[], recursive: boolean): Promise<InputFile[]> {
  if (paths.length === 0) {
    throw new CliError("USAGE", "Provide at least one image or directory.", 2);
  }

  const discovered: string[] = [];
  for (const supplied of paths) {
    const absolute = path.resolve(supplied);
    let stats;
    try {
      stats = await lstat(absolute);
    } catch {
      throw new CliError("USAGE", `Input does not exist: ${absolute}`, 2);
    }
    if (stats.isSymbolicLink()) {
      throw new CliError("USAGE", `Symbolic links are not accepted: ${absolute}`, 2);
    }
    if (stats.isDirectory()) {
      discovered.push(...(await walkDirectory(absolute, recursive)));
    } else {
      discovered.push(absolute);
    }
  }

  const unique = [...new Set(discovered)].sort((left, right) => left.localeCompare(right, "en"));
  if (unique.length === 0) {
    throw new CliError("USAGE", "No supported images were found.", 2);
  }
  return Promise.all(unique.map(inspectFile));
}

function candidateFormats(input: ImageFormat, selection: FormatSelection): ImageFormat[] {
  return selection.kind === "same" ? [input] : selection.formats;
}

export function outputPathForFormat(
  inputPath: string,
  inputFormat: ImageFormat,
  outputFormat: ImageFormat,
  replaceOriginals: boolean
): string {
  if (replaceOriginals && inputFormat === outputFormat) return inputPath;
  const parsed = path.parse(inputPath);
  if (inputFormat === outputFormat) {
    return path.join(parsed.dir, `${parsed.name}-optimized${parsed.ext}`);
  }
  return path.join(parsed.dir, `${parsed.name}${extensionForFormat(outputFormat)}`);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function planItems(
  inputs: InputFile[],
  selection: FormatSelection,
  replaceOriginals: boolean,
  hasDerivedTransform: boolean
): Promise<PlannedItem[]> {
  const reservations = new Map<string, string>();
  const items: PlannedItem[] = [];

  for (const input of inputs) {
    const possibleOutputs = candidateFormats(input.format, selection).map(format =>
      outputPathForFormat(input.path, input.format, format, replaceOriginals)
    );
    const uniqueOutputs = [...new Set(possibleOutputs)];

    for (const output of uniqueOutputs) {
      const existingReservation = reservations.get(output);
      if (existingReservation && existingReservation !== input.path) {
        throw new CliError(
          "COLLISION",
          `Multiple inputs can produce the same output: ${output}`,
          2,
          { firstInput: existingReservation, secondInput: input.path, output }
        );
      }
      reservations.set(output, input.path);

      const isOwnDestructiveReplacement = replaceOriginals && output === input.path;
      if (!isOwnDestructiveReplacement && (await exists(output))) {
        throw new CliError("COLLISION", `Output already exists: ${output}`, 2, {
          input: input.path,
          output
        });
      }
    }

    const converts = selection.kind === "candidates" &&
      (selection.formats.length > 1 || selection.formats[0] !== input.format);
    items.push({
      ...input,
      possibleOutputs: uniqueOutputs,
      estimatedCredits: hasDerivedTransform || converts ? 2 : 1
    });
  }
  return items;
}
