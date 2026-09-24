export interface GitBranchValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates a Git branch name according to git-check-ref-format --branch rules.
 */
export function validateGitBranchName(name: string): GitBranchValidationResult {
  const trimmed = name.trim();
  if (trimmed.length === 0) return { valid: false, error: "empty" };
  if (trimmed !== name) return { valid: false, error: "whitespace" };
  if (name === "HEAD") return { valid: false, error: "headReserved" };
  if (name.startsWith("-")) return { valid: false, error: "leadingDash" };
  if (name.startsWith("/") || name.endsWith("/")) return { valid: false, error: "slashBoundary" };
  if (name.includes("//")) return { valid: false, error: "consecutiveSlashes" };
  if (name.includes("..")) return { valid: false, error: "consecutiveDots" };
  if (name.includes("@{")) return { valid: false, error: "reflogSyntax" };
  if (name.endsWith(".")) return { valid: false, error: "trailingDot" };
  if (name.endsWith(".lock")) return { valid: false, error: "lockSuffix" };
  if (/[\x00-\x1f\x7f\s~^:?*\[\\]/.test(name)) return { valid: false, error: "disallowedChar" };
  const parts = name.split("/");
  for (const part of parts) {
    if (part.length === 0) return { valid: false, error: "emptyComponent" };
    if (part.startsWith(".")) return { valid: false, error: "dotComponent" };
    if (part.endsWith(".")) return { valid: false, error: "trailingDot" };
    if (part.endsWith(".lock")) return { valid: false, error: "lockSuffix" };
  }
  if (name.length > 255) return { valid: false, error: "tooLong" };
  return { valid: true };
}

export function isValidGitBranchName(name: string): boolean {
  return validateGitBranchName(name).valid;
}
