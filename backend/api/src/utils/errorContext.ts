export function errorContext(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { error };
  }

  return { errorType: typeof error };
}
