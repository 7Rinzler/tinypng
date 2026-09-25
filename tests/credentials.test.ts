import { describe, expect, it } from "vitest";
import { getCredential } from "../src/credentials.js";

describe("credential lookup", () => {
  it("prefers and trims TINIFY_API_KEY", () => {
    expect(getCredential({ TINIFY_API_KEY: "  secret-value  " })).toEqual({
      key: "secret-value",
      source: "environment"
    });
  });

  it("rejects an explicitly empty environment key", () => {
    expect(() => getCredential({ TINIFY_API_KEY: "  " })).toThrow("set but empty");
  });
});
