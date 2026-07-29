/** Git commit baked into the image as SENTRY_RELEASE (CI / local docker build-arg). */
export function getDeployRelease(): string | undefined {
  const value = process.env.SENTRY_RELEASE?.trim();
  return value || undefined;
}

export function getDeployReleaseShort(): string | undefined {
  const release = getDeployRelease();
  if (!release) return undefined;
  return release.length > 7 ? release.slice(0, 7) : release;
}
