import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { CliError } from "../src/errors.js";
import { formatFromPath, mimeForFormat, type ImageFormat } from "../src/formats.js";
import { optimize, type OptimizeRequest } from "../src/optimize.js";
import type { ImageProvider, ProviderResult, ProviderTransform } from "../src/types.js";

class FakeProvider implements ImageProvider {
  usage: number;
  processCalls = 0;
  outputBytes = Buffer.from("optimized-image");

  constructor(usage = 0) {
    this.usage = usage;
  }

  async validate(): Promise<number> {
    return this.usage;
  }

  async process(
    inputPath: string,
    tempPath: string,
    transform: ProviderTransform
  ): Promise<ProviderResult> {
    this.processCalls += 1;
    const inputFormat = formatFromPath(inputPath)!;
    const outputFormat: ImageFormat = transform.formats?.[0] ?? inputFormat;
    if (this.outputBytes.length === 0) await copyFile(inputPath, tempPath);
    else await writeFile(tempPath, this.outputBytes);
    this.usage += transform.formats || transform.resize || transform.background ? 2 : 1;
    return {
      extension: outputFormat === "jpeg" ? "jpg" : outputFormat,
      mediaType: mimeForFormat(outputFormat),
      width: 20,
      height: 10,
      size: this.outputBytes.length,
      compressionCount: this.usage
    };
  }

  classifyError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
  }
}

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tinypng-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function request(paths: string[], overrides: Partial<OptimizeRequest> = {}): OptimizeRequest {
  return {
    paths,
    recursive: false,
    dryRun: false,
    json: true,
    replaceOriginals: false,
    format: "same",
    ...overrides
  };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, {
    recursive: true,
    force: true
  })));
});

describe("optimize", () => {
  it("keeps the original and writes an -optimized sibling by default", async () => {
    const directory = await temporaryDirectory();
    const input = path.join(directory, "photo.png");
    await writeFile(input, "original-image");
    const provider = new FakeProvider();

    const summary = await optimize(request([input]), { provider });

    expect(summary.status).toBe("success");
    expect(await readFile(input, "utf8")).toBe("original-image");
    expect(await readFile(path.join(directory, "photo-optimized.png"), "utf8"))
      .toBe("optimized-image");
    expect(summary.items[0]).toMatchObject({
      destructive: false,
      deletionPerformed: false,
      outputFormat: "png"
    });
  });

  it("replaces the source only with explicit destructive mode", async () => {
    const directory = await temporaryDirectory();
    const input = path.join(directory, "photo.png");
    await writeFile(input, "original-image");
    const provider = new FakeProvider();

    const summary = await optimize(request([input], { replaceOriginals: true }), { provider });

    expect(await readFile(input, "utf8")).toBe("optimized-image");
    expect(summary.items[0]).toMatchObject({
      destructive: true,
      deletionPerformed: true,
      output: input
    });
  });

  it("converts to a new extension while preserving the source", async () => {
    const directory = await temporaryDirectory();
    const input = path.join(directory, "photo.png");
    await writeFile(input, "original-image");
    const provider = new FakeProvider();

    const summary = await optimize(request([input], { format: "avif" }), {
      provider,
      confirmPaid: async () => true
    });

    expect(await readFile(input, "utf8")).toBe("original-image");
    expect(await readFile(path.join(directory, "photo.avif"), "utf8")).toBe("optimized-image");
    expect(summary.items[0]?.outputFormat).toBe("avif");
  });

  it("deletes a differently formatted source only in explicit destructive mode", async () => {
    const directory = await temporaryDirectory();
    const input = path.join(directory, "photo.png");
    await writeFile(input, "original-image");
    const provider = new FakeProvider();

    const summary = await optimize(request([input], {
      format: "avif",
      replaceOriginals: true
    }), { provider });

    await expect(readFile(input)).rejects.toThrow();
    expect(await readFile(path.join(directory, "photo.avif"), "utf8")).toBe("optimized-image");
    expect(summary.items[0]?.deletionPerformed).toBe(true);
  });

  it("aborts on collisions before calling the provider", async () => {
    const directory = await temporaryDirectory();
    const input = path.join(directory, "photo.png");
    await writeFile(input, "original-image");
    await writeFile(path.join(directory, "photo.avif"), "existing-output");
    const provider = new FakeProvider();

    await expect(optimize(request([input], { format: "avif" }), { provider }))
      .rejects.toMatchObject({ code: "COLLISION" });
    expect(provider.processCalls).toBe(0);
  });

  it("reports paid credits during dry-run without requiring approval", async () => {
    const directory = await temporaryDirectory();
    const input = path.join(directory, "photo.png");
    await writeFile(input, "original-image");
    const provider = new FakeProvider(499);

    const summary = await optimize(request([input], { format: "avif", dryRun: true }), { provider });

    expect(summary.status).toBe("planned");
    expect(summary.usage).toMatchObject({ freeCredits: 1, paidCredits: 1 });
    expect(summary.approval).toEqual({ required: true, approvedPaidCredits: 0 });
    expect(provider.processCalls).toBe(0);
  });

  it("requires a paid-credit ceiling in non-interactive execution", async () => {
    const directory = await temporaryDirectory();
    const input = path.join(directory, "photo.png");
    await writeFile(input, "original-image");
    const provider = new FakeProvider(499);

    await expect(optimize(request([input], { format: "avif" }), { provider }))
      .rejects.toBeInstanceOf(CliError);
    expect(provider.processCalls).toBe(0);
  });

  it("accepts an exact per-run paid-credit approval", async () => {
    const directory = await temporaryDirectory();
    const input = path.join(directory, "photo.png");
    await writeFile(input, "original-image");
    const provider = new FakeProvider(499);

    const summary = await optimize(request([input], { format: "avif", approvePaid: 1 }), {
      provider
    });

    expect(summary.status).toBe("success");
    expect(summary.usage.final).toBe(501);
    expect(summary.approval.approvedPaidCredits).toBe(1);
  });

  it.each([
    ["scale", { width: 10 }],
    ["fit", { width: 10, height: 10 }],
    ["cover", { width: 10, height: 10 }],
    ["thumb", { width: 10, height: 10 }]
  ] as const)("accepts Tinify resize method %s", async (resize, dimensions) => {
    const directory = await temporaryDirectory();
    const input = path.join(directory, `${resize}.png`);
    await writeFile(input, "original-image");
    const provider = new FakeProvider();

    const summary = await optimize(request([input], {
      dryRun: true,
      resize,
      ...dimensions
    }), { provider });

    expect(summary.usage.plannedCredits).toBe(2);
  });

  it("requires exactly one dimension for scale", async () => {
    const directory = await temporaryDirectory();
    const input = path.join(directory, "photo.png");
    await writeFile(input, "original-image");

    await expect(optimize(request([input], {
      dryRun: true,
      resize: "scale",
      width: 10,
      height: 10
    }), { provider: new FakeProvider() })).rejects.toMatchObject({ code: "USAGE" });
  });

  it("requires a background when a transparent image is converted only to JPEG", async () => {
    const directory = await temporaryDirectory();
    const input = path.join(directory, "transparent.png");
    await sharp({
      create: { width: 2, height: 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
    }).png().toFile(input);

    await expect(optimize(request([input], { dryRun: true, format: "jpeg" }), {
      provider: new FakeProvider()
    })).rejects.toThrow("requires --background");

    const planned = await optimize(request([input], {
      dryRun: true,
      format: "jpeg",
      background: "#ffffff"
    }), { provider: new FakeProvider() });
    expect(planned.status).toBe("planned");
  });
});
