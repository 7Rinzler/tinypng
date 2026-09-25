import type { ImageFormat } from "./formats.js";

export type ResizeMethod = "scale" | "fit" | "cover" | "thumb";

export interface ResizeOptions {
  method: ResizeMethod;
  width?: number;
  height?: number;
}

export interface ProviderTransform {
  formats?: ImageFormat[];
  resize?: ResizeOptions;
  background?: string;
}

export interface ProviderResult {
  extension: string;
  mediaType: string;
  width: number;
  height: number;
  size: number;
  compressionCount: number;
}

export interface ImageProvider {
  validate(): Promise<number>;
  process(inputPath: string, tempPath: string, transform: ProviderTransform): Promise<ProviderResult>;
  classifyError(error: unknown): Error;
}

export interface InputFile {
  path: string;
  format: ImageFormat;
  size: number;
}

export interface PlannedItem extends InputFile {
  possibleOutputs: string[];
  estimatedCredits: number;
}

export interface ItemResult {
  input: string;
  output?: string;
  possibleOutputs?: string[];
  status: "planned" | "completed" | "failed";
  destructive: boolean;
  deletionPlanned: boolean;
  deletionPerformed: boolean;
  inputFormat: ImageFormat;
  outputFormat?: ImageFormat;
  bytesBefore: number;
  bytesAfter?: number;
  savedBytes?: number;
  savedPercentage?: number;
  width?: number;
  height?: number;
  sha256Before?: string;
  sha256After?: string;
  creditsEstimated: number;
  compressionCount?: number;
  error?: { code: string; message: string };
}

export interface OptimizeSummary {
  schemaVersion: 1;
  command: "optimize";
  status: "planned" | "success" | "partial" | "failed";
  destructive: boolean;
  dryRun: boolean;
  usage: {
    initial: number;
    final: number;
    freeLimit: number;
    plannedCredits: number;
    freeCredits: number;
    paidCredits: number;
    estimatedCostUsd: number;
    pricingEffectiveDate: string;
    pricingUrl: string;
  };
  approval: {
    required: boolean;
    approvedPaidCredits: number;
  };
  totals: {
    discovered: number;
    completed: number;
    failed: number;
    planned: number;
  };
  items: ItemResult[];
}
