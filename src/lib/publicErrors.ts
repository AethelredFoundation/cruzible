const MAX_PUBLIC_ERROR_LENGTH = 280;
const PUBLIC_URL_PATTERN = /\bhttps?:\/\/[^\s"'<>]+/giu;
const SENSITIVE_KEY_PATTERN =
  /(?:api[-_]?key|auth|authorization|bearer|cookie|credential|jwt|mnemonic|passphrase|password|private[-_]?key|refresh[-_]?token|secret|seed[-_]?phrase|session|signature|token)/iu;
const SENSITIVE_PHRASE_ASSIGNMENT_PATTERN =
  /\b([A-Za-z0-9_-]*(?:mnemonic|passphrase|seed[-_]?phrase)[A-Za-z0-9_-]*)(\s*[=:]\s*)([^,;]+)/giu;
const SENSITIVE_ASSIGNMENT_PATTERN =
  /\b([A-Za-z0-9_-]*(?:api[-_]?key|auth|authorization|bearer|cookie|credential|jwt|mnemonic|passphrase|password|private[-_]?key|refresh[-_]?token|secret|seed[-_]?phrase|session|signature|token)[A-Za-z0-9_-]*)(\s*[=:]\s*)([^\s,;]+)/giu;
const AUTH_HEADER_PATTERN =
  /\b((?:Authorization\s*[:=]\s*)?(?:Bearer|Token))\s+[A-Za-z0-9._~+/-]+=*/giu;
const HIGH_ENTROPY_HEX_PATTERN = /\b0x[a-f0-9]{64,}\b/giu;
const HIGH_ENTROPY_BASE64URL_PATTERN =
  /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}(?:\.[A-Za-z0-9_-]{20,})?\b/gu;

function normalizePublicMessage(message: string): string {
  return message.replace(/\s+/g, " ").trim();
}

function getPublicMessageCandidate(error: unknown): string | null {
  if (typeof error === "string") {
    return error;
  }

  if (typeof error !== "object" || error === null) {
    return null;
  }

  if ("shortMessage" in error && typeof error.shortMessage === "string") {
    return error.shortMessage;
  }

  return "message" in error && typeof error.message === "string"
    ? error.message
    : null;
}

function redactPublicUrl(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return "[REDACTED_URL]";
  }
}

function redactPublicMessage(message: string): string {
  return message
    .replace(PUBLIC_URL_PATTERN, (value) => redactPublicUrl(value))
    .replace(SENSITIVE_PHRASE_ASSIGNMENT_PATTERN, "$1$2[REDACTED]")
    .replace(SENSITIVE_ASSIGNMENT_PATTERN, "$1$2[REDACTED]")
    .replace(AUTH_HEADER_PATTERN, "$1 [REDACTED]")
    .replace(HIGH_ENTROPY_HEX_PATTERN, "[REDACTED_HEX]")
    .replace(HIGH_ENTROPY_BASE64URL_PATTERN, (value) =>
      SENSITIVE_KEY_PATTERN.test(message) ? "[REDACTED_TOKEN]" : value,
    );
}

export function getPublicErrorMessage(
  error: unknown,
  fallback = "Unexpected error",
): string {
  const candidate = getPublicMessageCandidate(error);
  const rawMessage =
    candidate && candidate.trim().length > 0 ? candidate : fallback;
  const normalized = normalizePublicMessage(redactPublicMessage(rawMessage));

  return normalized.length > MAX_PUBLIC_ERROR_LENGTH
    ? `${normalized.slice(0, MAX_PUBLIC_ERROR_LENGTH - 3)}...`
    : normalized;
}
