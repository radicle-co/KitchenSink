/**
 * @module composeValue — serialise one environment value into the generated compose file.
 *
 * ⛔ A single-quoted YAML scalar that spans lines FOLDS its newlines into spaces. The first writer emitted
 * `KEY: 'value'`, so a multi-line value arrived in the container mangled — and silently, because the
 * variable was present and looked plausible. `CLERK_JWT_KEY` is a 9-line PEM and reached the container as
 * ONE line, after which every service rejected every real Clerk token with a bare 401 that reads exactly
 * like an authorization decision rather than a corrupted key.
 */

/**
 * A compose-safe rendering of an environment value.
 *
 * `JSON.stringify` is the whole implementation on purpose: a JSON string IS a valid YAML double-quoted
 * scalar, and YAML reads `\n` inside one as a newline. That also quotes embedded quotes correctly and keeps
 * a numeric-looking value a string, which an unquoted scalar would not.
 *
 * @param value - The raw value.
 * @returns The scalar to write after `KEY: `. Pure.
 */
export function composeValue(value: string): string {
    return JSON.stringify(value);
}
