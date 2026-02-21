export function logError(context: string, error: unknown): void {
  // Keep logs consistent and preserve stack traces where available.
  if (error instanceof Error) {
    console.error(context, error)
    const anyErr = error as Error & { cause?: unknown }
    if (anyErr.cause) {
      console.error(`${context} (cause):`, anyErr.cause)
    }
    return
  }

  console.error(context, error)
}
