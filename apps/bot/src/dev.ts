export function isDevMode(): boolean {
  return process.env.DEV_MODE === "true";
}

export function requireDevMode(): void {
  if (!isDevMode()) {
    throw new Error("This command is only available when DEV_MODE=true.");
  }
}
