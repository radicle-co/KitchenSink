/**
 * PII keys that must be scrubbed from auth debug-trace attributes before they leave the process.
 * `clerk.sub`/`sub` and `app.user.id` are deliberately ABSENT — the opaque Clerk sub is the
 * correlation key you filter a signup's flow by, and it's the value you actually want when debugging.
 */
export const PII_DENYLIST_SUBSTRINGS = [
    'email',
    'name',
    'picture',
    'image',
    'avatar',
    'password',
    'token',
    'authorization',
    'secret',
] as const;

/**
 * Redact PII from a flat attributes object by key-substring match (case-insensitive). Returns a new
 * object; values under matching keys become `'[redacted]'`. Shallow by design — auth debug attributes
 * are flat key/value pairs (`sub`, `azp`, `outcome`, …).
 */
export const scrubAuthAttributes = (attributes: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(attributes)) {
        const lowered = key.toLowerCase();
        const isSensitive = PII_DENYLIST_SUBSTRINGS.some((deny) => lowered.includes(deny));
        // Only textual/structured values can carry PII — a boolean/number can't be an email or name,
        // so keep flags like `emailIsReal: true` even though the key matches the denylist.
        const isSafeScalar = typeof value === 'boolean' || typeof value === 'number';
        out[key] = isSensitive && !isSafeScalar ? '[redacted]' : value;
    }

    return out;
};
