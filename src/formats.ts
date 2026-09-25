import path from "node:path";
import { CliError } from "./errors.js";

export const IMAGE_FORMATS = ["avif", "webp", "jpeg", "png", "jxl"] as const;
export type ImageFormat = (typeof IMAGE_FORMATS)[number];

export type FormatSelection =
  | { kind: "same" }
  | { kind: "candidates"; formats: ImageFormat[]; label: string };

const MIME_TYPES: Record<ImageFormat, string> = {
  avif: "image/avif",
  webp: "image/webp",
  jpeg: "image/jpeg",
  png: "image/png",
  jxl: "image/jxl"
};

const EXTENSIONS: Record<ImageFormat, string> = {
  avif: ".avif",
  webp: ".webp",
  jpeg: ".jpg",
  png: ".png",
  jxl: ".jxl"
};

export function formatFromPath(filePath: string): ImageFormat | undefined {
  switch (path.extname(filePath).toLowerCase()) {
    case ".avif":
      return "avif";
    case ".webp":
      return "webp";
    case ".jpg":
    case ".jpeg":
      return "jpeg";
    case ".png":
    case ".apng":
      return "png";
    case ".jxl":
      return "jxl";
    default:
      return undefined;
  }
}

export function formatFromExtension(extension: string): ImageFormat | undefined {
  return formatFromPath(`file.${extension.replace(/^\./, "")}`);
}

export function formatFromMediaType(mediaType: string): ImageFormat | undefined {
  switch (mediaType.toLowerCase().split(";", 1)[0]?.trim()) {
    case "image/avif":
      return "avif";
    case "image/webp":
      return "webp";
    case "image/jpg":
    case "image/jpeg":
      return "jpeg";
    case "image/png":
    case "image/apng":
      return "png";
    case "image/jxl":
      return "jxl";
    default:
      return undefined;
  }
}

export function extensionForFormat(format: ImageFormat): string {
  return EXTENSIONS[format];
}

export function mimeForFormat(format: ImageFormat): string {
  return MIME_TYPES[format];
}

export function parseFormatSelection(value: string): FormatSelection {
  const normalized = value.trim().toLowerCase();
  if (normalized === "same") return { kind: "same" };

  const requested = normalized === "smallest" ? [...IMAGE_FORMATS] : normalized.split(",");
  const unique: ImageFormat[] = [];
  for (const item of requested) {
    if (!IMAGE_FORMATS.includes(item as ImageFormat)) {
      throw new CliError(
        "USAGE",
        `Unsupported output format: ${item}. Use same, smallest, avif, webp, jpeg, png, jxl, or a comma-separated list.`,
        2
      );
    }
    const format = item as ImageFormat;
    if (!unique.includes(format)) unique.push(format);
  }
  if (unique.length === 0) {
    throw new CliError("USAGE", "At least one output format is required.", 2);
  }
  return { kind: "candidates", formats: unique, label: normalized };
}

export function sameCanonicalFormat(left: ImageFormat, right: ImageFormat): boolean {
  return left === right;
}
