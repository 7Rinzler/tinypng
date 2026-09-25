import { describe, expect, it } from "vitest";
import {
  formatFromPath,
  parseFormatSelection
} from "../src/formats.js";
import { outputPathForFormat } from "../src/discovery.js";

describe("format parsing and output names", () => {
  it("normalizes supported extensions", () => {
    expect(formatFromPath("photo.JPEG")).toBe("jpeg");
    expect(formatFromPath("photo.apng")).toBe("png");
    expect(formatFromPath("photo.jxl")).toBe("jxl");
  });

  it("parses smallest and candidate lists without duplicates", () => {
    expect(parseFormatSelection("avif,webp,avif")).toEqual({
      kind: "candidates",
      formats: ["avif", "webp"],
      label: "avif,webp,avif"
    });
    const smallest = parseFormatSelection("smallest");
    expect(smallest.kind).toBe("candidates");
    if (smallest.kind === "candidates") expect(smallest.formats).toContain("jxl");
  });

  it("uses safe sibling names unless destructive mode is explicit", () => {
    expect(outputPathForFormat("/images/photo.png", "png", "png", false))
      .toBe("/images/photo-optimized.png");
    expect(outputPathForFormat("/images/photo.png", "png", "avif", false))
      .toBe("/images/photo.avif");
    expect(outputPathForFormat("/images/photo.png", "png", "png", true))
      .toBe("/images/photo.png");
  });
});
