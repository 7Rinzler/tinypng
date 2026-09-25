import tinify from "tinify";
import { CliError } from "./errors.js";
import { mimeForFormat } from "./formats.js";
import type { ImageProvider, ProviderResult, ProviderTransform } from "./types.js";

export class TinifyProvider implements ImageProvider {
  constructor(key: string, version = "0.1.0") {
    tinify.key = key;
    tinify.appIdentifier = `@coding-tech/tinypng/${version}`;
  }

  async validate(): Promise<number> {
    try {
      await tinify.validate();
    } catch (error) {
      throw this.classifyError(error);
    }
    if (typeof tinify.compressionCount !== "number") {
      throw new CliError("ACCOUNT", "Tinify did not return the monthly compression count.", 3);
    }
    return tinify.compressionCount;
  }

  async process(
    inputPath: string,
    tempPath: string,
    transform: ProviderTransform
  ): Promise<ProviderResult> {
    try {
      let source = tinify.fromFile(inputPath);
      if (transform.resize) source = source.resize(transform.resize);
      if (transform.formats) {
        source = source.convert({ type: transform.formats.map(mimeForFormat) as any });
      }
      if (transform.background) source = source.transform({ background: transform.background });

      const result = source.result();
      const [, extension, mediaType, width, height, size] = await Promise.all([
        result.toFile(tempPath),
        result.extension(),
        result.mediaType(),
        result.width(),
        result.height(),
        result.size()
      ]);
      if (!extension || !mediaType) {
        throw new CliError("PROCESSING", "Tinify returned incomplete result metadata.", 1);
      }
      if (typeof tinify.compressionCount !== "number") {
        throw new CliError("ACCOUNT", "Tinify omitted the compression count after processing.", 3);
      }
      return {
        extension,
        mediaType,
        width,
        height,
        size,
        compressionCount: tinify.compressionCount
      };
    } catch (error) {
      throw this.classifyError(error);
    }
  }

  classifyError(error: unknown): Error {
    if (error instanceof CliError) return error;
    if (error instanceof tinify.AccountError) {
      const message = error.message.toLowerCase().includes("limit")
        ? "Tinify rejected the request because the account limit was reached."
        : "Tinify rejected the API credentials or account status.";
      return new CliError(message.includes("limit") ? "QUOTA" : "ACCOUNT", message, 3);
    }
    if (error instanceof tinify.ConnectionError) {
      return new CliError("NETWORK", "Could not connect to the Tinify API.", 4);
    }
    if (error instanceof tinify.ServerError) {
      return new CliError("SERVICE", "Tinify reported a temporary service error.", 4);
    }
    if (error instanceof tinify.ClientError) {
      return new CliError("PROCESSING", `Tinify rejected the image or options: ${error.message}`, 1);
    }
    const message = error instanceof Error ? error.message : "Unknown Tinify error";
    return new CliError("PROCESSING", message, 1);
  }
}
