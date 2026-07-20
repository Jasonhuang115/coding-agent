/** Convert unknown failures into stable, user-readable diagnostic text. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Report a recoverable failure without hiding its operation or target. */
export function warnRecoverable(scope: string, error: unknown): void {
  console.warn(`[rubato:${scope}] ${errorMessage(error)}`);
}
