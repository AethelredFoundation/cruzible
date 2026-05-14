export function rejectUrlUserInfoAndFragment(
  value: string | undefined,
  envName: string,
): void {
  if (!value) {
    return;
  }

  const parsed = new URL(value);

  if (parsed.username || parsed.password || parsed.hash) {
    throw new Error(`${envName} must not contain credentials or fragments`);
  }
}

export function redactUrlForLogs(
  value: string | undefined,
): string | undefined {
  if (!value) {
    return value;
  }

  try {
    const parsed = new URL(value);

    if (parsed.username) {
      parsed.username = "redacted";
    }
    if (parsed.password) {
      parsed.password = "redacted";
    }
    if (parsed.search) {
      parsed.search = "?redacted";
    }
    if (parsed.hash) {
      parsed.hash = "";
    }

    return parsed.href;
  } catch {
    return "[invalid-url]";
  }
}
