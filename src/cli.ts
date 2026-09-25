#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { Command, InvalidArgumentError } from "commander";
import { FREE_MONTHLY_CREDITS, PRICING_URL } from "./credits.js";
import {
  deleteKey,
  getCredential,
  getKeychainCredential,
  setKeyInteractively
} from "./credentials.js";
import { asCliError } from "./errors.js";
import { optimize, type OptimizeRequest } from "./optimize.js";
import { TinifyProvider } from "./provider.js";
import { installSkill, removeSkill, skillStatus } from "./skill.js";
import type { OptimizeSummary, ResizeMethod } from "./types.js";

const VERSION = "0.1.0";

function integer(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new InvalidArgumentError("Expected a non-negative integer.");
  }
  return parsed;
}

function positiveInteger(value: string): number {
  const parsed = integer(value);
  if (parsed === 0) throw new InvalidArgumentError("Expected a positive integer.");
  return parsed;
}

function printJson(value: unknown): void {
  stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function provider(): { instance: TinifyProvider; source: string } {
  const credential = getCredential();
  return { instance: new TinifyProvider(credential.key, VERSION), source: credential.source };
}

async function confirmPaid(paidCredits: number, cost: number): Promise<boolean> {
  const phrase = `APROBAR ${paidCredits}`;
  console.error(`This run may use ${paidCredits} paid credits (estimated USD ${cost.toFixed(3)}).`);
  console.error(`Pricing: ${PRICING_URL}`);
  const readline = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await readline.question(`Type "${phrase}" to continue: `);
    return answer.trim() === phrase;
  } finally {
    readline.close();
  }
}

function printOptimizeSummary(summary: OptimizeSummary): void {
  const verb = summary.dryRun ? "Planned" : "Processed";
  console.log(`${verb} ${summary.totals.discovered} image(s).`);
  console.log(
    `Credits: ${summary.usage.plannedCredits} planned, ${summary.usage.freeCredits} free, ${summary.usage.paidCredits} paid.`
  );
  if (summary.usage.paidCredits > 0) {
    console.log(`Estimated paid cost: USD ${summary.usage.estimatedCostUsd.toFixed(3)}.`);
  }
  for (const item of summary.items) {
    const target = item.output ?? item.possibleOutputs?.join(" | ") ?? "unknown";
    const action = item.deletionPlanned ? "replace" : "create";
    console.log(`${item.status.toUpperCase()} ${action}: ${item.input} -> ${target}`);
    if (item.error) console.error(`  ${item.error.code}: ${item.error.message}`);
  }
}

async function runSetup(): Promise<void> {
  setKeyInteractively();
  const credential = getKeychainCredential();
  const api = new TinifyProvider(credential.key, VERSION);
  const used = await api.validate();
  const installed = await installSkill();
  console.log(`Tinify account validated: ${used} compression(s) used this month.`);
  console.log(`Free allowance remaining: ${Math.max(0, FREE_MONTHLY_CREDITS - used)}.`);
  console.log(`Codex skill installed at ${installed.path}.`);
}

async function runStatus(json: boolean): Promise<void> {
  const api = provider();
  const used = await api.instance.validate();
  const result = {
    schemaVersion: 1,
    command: "status",
    valid: true,
    credentialSource: api.source,
    usage: {
      used,
      freeLimit: FREE_MONTHLY_CREDITS,
      freeRemaining: Math.max(0, FREE_MONTHLY_CREDITS - used),
      paidUsageStarted: used > FREE_MONTHLY_CREDITS,
      totalAvailable: null,
      note: "Tinify does not expose card state or prepaid-credit balance through the documented API."
    },
    pricingUrl: PRICING_URL
  };
  if (json) printJson(result);
  else {
    console.log(`Credential: ${api.source}`);
    console.log(`Monthly usage: ${used}`);
    console.log(`Free allowance remaining: ${result.usage.freeRemaining}`);
    console.log(`Pricing: ${PRICING_URL}`);
  }
}

interface CommandOptions {
  recursive?: boolean;
  dryRun?: boolean;
  json?: boolean;
  replaceOriginals?: boolean;
  approvePaid?: number;
  format?: string;
  resize?: ResizeMethod;
  width?: number;
  height?: number;
  background?: string;
}

async function runOptimize(paths: string[], options: CommandOptions): Promise<void> {
  const api = provider();
  const request: OptimizeRequest = {
    paths,
    recursive: Boolean(options.recursive),
    dryRun: Boolean(options.dryRun),
    json: Boolean(options.json),
    replaceOriginals: Boolean(options.replaceOriginals),
    approvePaid: options.approvePaid,
    format: options.format ?? "same",
    resize: options.resize,
    width: options.width,
    height: options.height,
    background: options.background
  };
  const mayPrompt = !request.json && !request.dryRun && stdin.isTTY && stdout.isTTY;
  const summary = await optimize(request, {
    provider: api.instance,
    confirmPaid: mayPrompt ? confirmPaid : undefined
  });
  if (request.json) printJson(summary);
  else printOptimizeSummary(summary);
  if (summary.status === "partial" || summary.status === "failed") process.exitCode = 1;
}

const program = new Command();
program
  .name("tinypng")
  .description("Safety-first image compression, conversion, and resize through Tinify")
  .version(VERSION);

program
  .command("setup")
  .description("Store the API key in macOS Keychain, validate it, and install the Codex skill")
  .action(runSetup);

program
  .command("status")
  .description("Validate the account and show monthly usage")
  .option("--json", "print machine-readable JSON")
  .action(async options => runStatus(Boolean(options.json)));

program
  .command("optimize")
  .description("Compress, convert, or resize local images without replacing originals by default")
  .argument("<paths...>", "image files or directories")
  .option("--format <format>", "same, smallest, a format, or comma-separated candidates", "same")
  .option("--resize <method>", "scale, fit, cover, or thumb")
  .option("--width <pixels>", "target width", positiveInteger)
  .option("--height <pixels>", "target height", positiveInteger)
  .option("--background <color>", "white, black, or #RRGGBB for conversion transparency")
  .option("--recursive", "walk directories recursively")
  .option("--dry-run", "plan outputs and credits without changing images")
  .option("--json", "print machine-readable JSON and never prompt")
  .option("--replace-originals", "explicitly replace or delete source images after verification")
  .option("--approve-paid <credits>", "maximum paid credits approved for this run", integer)
  .action(runOptimize);

const config = program.command("config").description("Manage the Tinify credential");
config
  .command("set-key")
  .description("Securely add or replace the API key in macOS Keychain")
  .action(async () => {
    setKeyInteractively();
    const credential = getKeychainCredential();
    const used = await new TinifyProvider(credential.key, VERSION).validate();
    console.log(`API key validated. Monthly usage: ${used}.`);
  });
config
  .command("delete-key")
  .description("Delete the API key from macOS Keychain")
  .action(() => {
    console.log(deleteKey() ? "API key deleted." : "No Keychain API key was found.");
  });

const skill = program.command("skill").description("Manage the bundled Codex skill");
skill.command("install").action(async () => {
  const result = await installSkill();
  console.log(`Codex skill ${result.version} installed at ${result.path}.`);
});
skill.command("status").action(async () => {
  printJson(await skillStatus());
});
skill.command("remove").action(async () => {
  console.log((await removeSkill()) ? "Codex skill removed." : "Codex skill was not installed.");
});

async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    const cliError = asCliError(error);
    const wantsJson = process.argv.includes("--json");
    if (wantsJson) {
      printJson({
        schemaVersion: 1,
        status: "error",
        error: { code: cliError.code, message: cliError.message, details: cliError.details }
      });
    } else {
      console.error(`${cliError.code}: ${cliError.message}`);
    }
    process.exitCode = cliError.exitCode;
  }
}

void main();
