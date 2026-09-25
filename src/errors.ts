export type ErrorCode =
  | "USAGE"
  | "CONFIG"
  | "COLLISION"
  | "APPROVAL_REQUIRED"
  | "ACCOUNT"
  | "QUOTA"
  | "NETWORK"
  | "SERVICE"
  | "PROCESSING";

export class CliError extends Error {
  readonly code: ErrorCode;
  readonly exitCode: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    exitCode: number,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "CliError";
    this.code = code;
    this.exitCode = exitCode;
    this.details = details;
  }
}

export function asCliError(error: unknown): CliError {
  if (error instanceof CliError) return error;
  const message = error instanceof Error ? error.message : "Unknown error";
  return new CliError("PROCESSING", message, 1);
}
