/** Shared local-account password policy (mirrors backend `validate_password_strength`). */

export const PASSWORD_MIN_LEN = 8;

const COMMON = new Set([
  "password",
  "password1",
  "password123",
  "admin",
  "admin123",
  "admin1234",
  "12345678",
  "123456789",
  "qwerty123",
  "letmein",
  "welcome1",
  "changeme",
]);

export type PasswordRuleId = "length" | "upper" | "lower" | "digit" | "special" | "notUsername" | "notCommon";

export type PasswordRule = { id: PasswordRuleId; labelKey: string; ok: boolean };

export function passwordRules(password: string, username?: string | null): PasswordRule[] {
  const value = password || "";
  return [
    { id: "length", labelKey: "auth.passwordRuleLength", ok: value.length >= PASSWORD_MIN_LEN },
    { id: "upper", labelKey: "auth.passwordRuleUpper", ok: /[A-Z]/.test(value) },
    { id: "lower", labelKey: "auth.passwordRuleLower", ok: /[a-z]/.test(value) },
    { id: "digit", labelKey: "auth.passwordRuleDigit", ok: /\d/.test(value) },
    { id: "special", labelKey: "auth.passwordRuleSpecial", ok: /[^A-Za-z0-9]/.test(value) },
    {
      id: "notUsername",
      labelKey: "auth.passwordRuleNotUsername",
      ok: !username || value.toLowerCase() !== username.trim().toLowerCase(),
    },
    { id: "notCommon", labelKey: "auth.passwordRuleNotCommon", ok: !COMMON.has(value.toLowerCase()) },
  ];
}

export function isPasswordStrong(password: string, username?: string | null): boolean {
  return passwordRules(password, username).every((rule) => rule.ok);
}

export function passwordPolicyError(password: string, username?: string | null): string | null {
  const failed = passwordRules(password, username).find((rule) => !rule.ok);
  return failed ? failed.labelKey : null;
}
