import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { link, lstat, open, rename, unlink } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { approvalUsageCeiling, estimateCredits, FREE_MONTHLY_CREDITS } from "./credits.js";
import { discoverInputs, outputPathForFormat, planItems } from "./discovery.js";
import { asCliError, CliError } from "./errors.js";
import {
  formatFromExtension,
  formatFromMediaType,
  parseFormatSelection,
  type FormatSelection,
  type ImageFormat
} from "./formats.js";
import type {
  ImageProvider,
  ItemResult,
  OptimizeSummary,
  ProviderTransform,
  ResizeMethod,
  ResizeOptions
} from "./types.js";

export interface OptimizeRequest {
  paths: string[];
  recursive: boolean;
  dryRun: boolean;
  json: boolean;
  replaceOriginals: boolean;
  approvePaid?: number;
  format: string;
  resize?: ResizeMethod;
  width?: number;
  height?: number;
  background?: string;
}

export interface OptimizeDependencies {
  provider: ImageProvider;
  confirmPaid?: (paidCredits: number, estimatedCostUsd: number) => Promise<boolean>;
}

function validatePositiveInteger(value: number | undefined, label: string): void {
  if (value !== undefined && (!Number.isInteger(value) || value <= 0)) {
    throw new CliError("USAGE", `${label} must be a positive integer.`, 2);
  }
}

function validateResize(request: OptimizeRequest): ResizeOptions | undefined {
  validatePositiveInteger(request.width, "Width");
  validatePositiveInteger(request.height, "Height");

  if (!request.resize) {
    if (request.width !== undefined || request.height !== undefined) {
      throw new CliError("USAGE", "--width and --height require --resize.", 2);
    }
    return undefined;
  }

  if (request.resize === "scale") {
    const supplied = Number(request.width !== undefined) + Number(request.height !== undefined);
    if (supplied !== 1) {
      throw new CliError("USAGE", "Resize method scale requires exactly one of --width or --height.", 2);
    }
  } else if (request.width === undefined || request.height === undefined) {
    throw new CliError(
      "USAGE",
      `Resize method ${request.resize} requires both --width and --height.`,
      2
    );
  }

  return { method: request.resize, width: request.width, height: request.height };
}

function validateBackground(background: string | undefined, selection: FormatSelection): void {
  if (!background) return;
  if (selection.kind === "same") {
    throw new CliError("USAGE", "--background requires an explicit conversion format.", 2);
  }
  if (!(background === "white" || background === "black" || /^#[0-9a-fA-F]{6}$/.test(background))) {
    throw new CliError("USAGE", "--background must be white, black, or #RRGGBB.", 2);
  }
}

async function imageHasAlpha(filePath: string): Promise<boolean | undefined> {
  try {
    const metadata = await sharp(filePath, { animated: true }).metadata();
    return metadata.hasAlpha;
  } catch {
    return undefined;
  }
}

async function validateJpegTransparency(
  selection: FormatSelection,
  background: string | undefined,
  inputPath: string,
  inputFormat: ImageFormat
): Promise<void> {
  if (background || selection.kind === "same") return;
  if (selection.formats.length !== 1 || selection.formats[0] !== "jpeg" || inputFormat === "jpeg") {
    return;
  }
  const hasAlpha = await imageHasAlpha(inputPath);
  if (hasAlpha !== false) {
    throw new CliError(
      "USAGE",
      `Converting a possibly transparent image to JPEG requires --background: ${inputPath}`,
      2
    );
  }
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", chunk => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

function transformForItem(
  selection: FormatSelection,
  inputFormat: ImageFormat,
  resize: ResizeOptions | undefined,
  background: string | undefined
): ProviderTransform {
  const formats =
    selection.kind === "candidates" &&
    (selection.formats.length > 1 || selection.formats[0] !== inputFormat)
      ? selection.formats
      : undefined;
  return { formats, resize, background };
}

async function syncFile(filePath: string): Promise<void> {
  const handle = await open(filePath, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function placeOutput(
  tempPath: string,
  inputPath: string,
  outputPath: string,
  replaceOriginals: boolean
): Promise<boolean> {
  if (replaceOriginals && outputPath === inputPath) {
    await rename(tempPath, inputPath);
    return true;
  }

  await link(tempPath, outputPath);
  await unlink(tempPath);
  if (replaceOriginals) {
    await unlink(inputPath);
    return true;
  }
  return false;
}

async function cleanupTemp(tempPath: string): Promise<void> {
  try {
    await unlink(tempPath);
  } catch {
    // The file may already have been moved or never created.
  }
}

function plannedResult(item: Awaited<ReturnType<typeof planItems>>[number], destructive: boolean): ItemResult {
  return {
    input: item.path,
    output: item.possibleOutputs.length === 1 ? item.possibleOutputs[0] : undefined,
    possibleOutputs: item.possibleOutputs,
    status: "planned",
    destructive,
    deletionPlanned: destructive,
    deletionPerformed: false,
    inputFormat: item.format,
    bytesBefore: item.size,
    creditsEstimated: item.estimatedCredits
  };
}

export async function optimize(
  request: OptimizeRequest,
  dependencies: OptimizeDependencies
): Promise<OptimizeSummary> {
  const selection = parseFormatSelection(request.format);
  const resize = validateResize(request);
  validateBackground(request.background, selection);
  if (request.approvePaid !== undefined &&
      (!Number.isInteger(request.approvePaid) || request.approvePaid < 0)) {
    throw new CliError("USAGE", "--approve-paid must be a non-negative integer.", 2);
  }

  const inputs = await discoverInputs(request.paths, request.recursive);
  for (const input of inputs) {
    await validateJpegTransparency(selection, request.background, input.path, input.format);
  }
  const hasDerivedTransform = Boolean(resize || request.background);
  const plan = await planItems(inputs, selection, request.replaceOriginals, hasDerivedTransform);
  const initialUsage = await dependencies.provider.validate();
  const plannedCredits = plan.reduce((total, item) => total + item.estimatedCredits, 0);
  const creditEstimate = estimateCredits(initialUsage, plannedCredits);

  let approvedPaidCredits = request.approvePaid ?? 0;
  if (!request.dryRun && creditEstimate.paid > 0) {
    if (approvedPaidCredits < creditEstimate.paid) {
      if (!dependencies.confirmPaid) {
        throw new CliError(
          "APPROVAL_REQUIRED",
          `This run may use ${creditEstimate.paid} paid credits (estimated USD ${creditEstimate.estimatedCostUsd.toFixed(3)}). Re-run with --approve-paid ${creditEstimate.paid}.`,
          3,
          { ...creditEstimate }
        );
      }
      const approved = await dependencies.confirmPaid(
        creditEstimate.paid,
        creditEstimate.estimatedCostUsd
      );
      if (!approved) {
        throw new CliError("APPROVAL_REQUIRED", "Paid credits were not approved.", 3);
      }
      approvedPaidCredits = creditEstimate.paid;
    }
  }

  const items = plan.map(item => plannedResult(item, request.replaceOriginals));
  const summary: OptimizeSummary = {
    schemaVersion: 1,
    command: "optimize",
    status: request.dryRun ? "planned" : "success",
    destructive: request.replaceOriginals,
    dryRun: request.dryRun,
    usage: {
      initial: initialUsage,
      final: initialUsage,
      freeLimit: FREE_MONTHLY_CREDITS,
      plannedCredits,
      freeCredits: creditEstimate.free,
      paidCredits: creditEstimate.paid,
      estimatedCostUsd: creditEstimate.estimatedCostUsd,
      pricingEffectiveDate: creditEstimate.pricingEffectiveDate,
      pricingUrl: creditEstimate.pricingUrl
    },
    approval: {
      required: creditEstimate.paid > 0,
      approvedPaidCredits: request.dryRun ? 0 : approvedPaidCredits
    },
    totals: {
      discovered: plan.length,
      completed: 0,
      failed: 0,
      planned: plan.length
    },
    items
  };
  if (request.dryRun) return summary;

  const usageCeiling = approvalUsageCeiling(initialUsage, approvedPaidCredits);
  let currentUsage = initialUsage;

  for (let index = 0; index < plan.length; index += 1) {
    const item = plan[index]!;
    const output = items[index]!;
    if (index > 0) currentUsage = await dependencies.provider.validate();
    if (currentUsage + item.estimatedCredits > usageCeiling) {
      output.status = "failed";
      output.error = {
        code: "APPROVAL_REQUIRED",
        message: "The next image could exceed the paid-credit ceiling approved for this run."
      };
      summary.totals.failed += 1;
      break;
    }

    const tempPath = path.join(
      path.dirname(item.path),
      `.${path.basename(item.path)}.tinypng-${randomUUID()}.tmp`
    );
    try {
      const sha256Before = await hashFile(item.path);
      const transform = transformForItem(selection, item.format, resize, request.background);
      const providerResult = await dependencies.provider.process(item.path, tempPath, transform);
      const outputFormat = formatFromExtension(providerResult.extension);
      if (!outputFormat) {
        throw new CliError(
          "PROCESSING",
          `Tinify returned an unsupported extension: ${providerResult.extension}`,
          1
        );
      }
      const mediaFormat = formatFromMediaType(providerResult.mediaType);
      if (mediaFormat !== outputFormat) {
        throw new CliError(
          "PROCESSING",
          `Tinify returned inconsistent media type and extension metadata.`,
          1
        );
      }
      const allowedFormats = selection.kind === "same" ? [item.format] : selection.formats;
      if (!allowedFormats.includes(outputFormat)) {
        throw new CliError(
          "PROCESSING",
          `Tinify returned ${outputFormat}, which was not requested.`,
          1
        );
      }

      const tempStats = await lstat(tempPath);
      if (!tempStats.isFile() || tempStats.size <= 0 || providerResult.size <= 0) {
        throw new CliError("PROCESSING", "Tinify produced an empty or invalid file.", 1);
      }
      if (tempStats.size !== providerResult.size) {
        throw new CliError("PROCESSING", "Tinify result size did not match the downloaded file.", 1);
      }
      await syncFile(tempPath);
      const sha256After = await hashFile(tempPath);
      const finalOutput = outputPathForFormat(
        item.path,
        item.format,
        outputFormat,
        request.replaceOriginals
      );
      const deletionPerformed = await placeOutput(
        tempPath,
        item.path,
        finalOutput,
        request.replaceOriginals
      );

      output.output = finalOutput;
      output.status = "completed";
      output.deletionPerformed = deletionPerformed;
      output.outputFormat = outputFormat;
      output.bytesAfter = tempStats.size;
      output.savedBytes = item.size - tempStats.size;
      output.savedPercentage = item.size === 0
        ? 0
        : Math.round(((item.size - tempStats.size) / item.size) * 10_000) / 100;
      output.width = providerResult.width;
      output.height = providerResult.height;
      output.sha256Before = sha256Before;
      output.sha256After = sha256After;
      output.compressionCount = providerResult.compressionCount;
      currentUsage = providerResult.compressionCount;
      summary.totals.completed += 1;
    } catch (error) {
      await cleanupTemp(tempPath);
      const cliError = asCliError(dependencies.provider.classifyError(error));
      output.status = "failed";
      output.error = { code: cliError.code, message: cliError.message };
      summary.totals.failed += 1;
      if (cliError.exitCode >= 3) break;
    }
  }

  summary.usage.final = currentUsage;
  summary.totals.planned = summary.items.filter(item => item.status === "planned").length;
  if (summary.totals.failed > 0) {
    summary.status = summary.totals.completed > 0 ? "partial" : "failed";
  }
  return summary;
}
