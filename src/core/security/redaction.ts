const SECRET_PATTERNS = [
  /(sk-[a-zA-Z0-9_\-]{8,})/g,
  /(oauth_access_[a-zA-Z0-9_\-]+)/g,
  /(Bearer\s+[a-zA-Z0-9._\-]+)/gi
];

export function redactSensitive(input: string): string {
  let result = input;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}
