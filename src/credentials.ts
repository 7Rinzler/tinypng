import { execFileSync, spawnSync } from "node:child_process";
import { CliError } from "./errors.js";

const SECURITY = "/usr/bin/security";
const SERVICE = "com.coding-tech.tinypng";
const ACCOUNT = "default";

export type CredentialSource = "environment" | "keychain";

export interface Credential {
  key: string;
  source: CredentialSource;
}

export function getKeychainCredential(): Credential {
  if (process.platform !== "darwin") {
    throw new CliError(
      "CONFIG",
      "macOS Keychain is unavailable on this platform. Set TINIFY_API_KEY instead.",
      2
    );
  }
  try {
    const key = execFileSync(
      SECURITY,
      ["find-generic-password", "-a", ACCOUNT, "-s", SERVICE, "-w"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim();
    if (!key) throw new Error("empty key");
    return { key, source: "keychain" };
  } catch {
    throw new CliError(
      "CONFIG",
      "No Tinify API key is configured. Run `tinypng setup` or set TINIFY_API_KEY.",
      2
    );
  }
}

export function getCredential(environment = process.env): Credential {
  if (Object.prototype.hasOwnProperty.call(environment, "TINIFY_API_KEY")) {
    const key = environment.TINIFY_API_KEY?.trim() ?? "";
    if (!key) {
      throw new CliError("CONFIG", "TINIFY_API_KEY is set but empty.", 2);
    }
    return { key, source: "environment" };
  }

  return getKeychainCredential();
}

export function setKeyInteractively(): void {
  if (process.platform !== "darwin") {
    throw new CliError(
      "CONFIG",
      "Interactive secure storage is currently available only on macOS. Set TINIFY_API_KEY instead.",
      2
    );
  }
  console.error("macOS Keychain will ask for the Tinify API key. The value will not be echoed.");
  const result = spawnSync(
    SECURITY,
    ["add-generic-password", "-a", ACCOUNT, "-s", SERVICE, "-U", "-w"],
    { stdio: "inherit" }
  );
  if (result.status !== 0) {
    throw new CliError("CONFIG", "The API key was not saved to macOS Keychain.", 2);
  }
}

export function deleteKey(): boolean {
  if (process.platform !== "darwin") return false;
  const result = spawnSync(
    SECURITY,
    ["delete-generic-password", "-a", ACCOUNT, "-s", SERVICE],
    { stdio: ["ignore", "ignore", "ignore"] }
  );
  return result.status === 0;
}
