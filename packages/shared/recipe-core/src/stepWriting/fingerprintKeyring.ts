/**
 * THE FINGERPRINT KEYRING: one secret holding every key version and which is current.
 *
 * DESIGN PATTERN: **parse, don't validate** (a zod smart constructor) over a secret read at the edge. The secret is
 * `{"current": 2, "k1": "...", "k2": "..."}`. Rotation adds `k{n+1}` and bumps `current`; old versions stay so a
 * stored fingerprint can still be re-checked under its own key.
 *
 * A bad secret throws {@link FingerprintKeyringError}. Its message names the problem, never a key value.
 */
import { z } from 'zod';

const MIN_KEY_LENGTH = 16;
const KEY_NAME = /^k([1-9]\d*)$/u;

/** A parsed keyring. `keys` always holds `current`. */
export interface FingerprintKeyring {
    readonly current: number;
    readonly keys: ReadonlyMap<number, string>;
}

/** Raised for a keyring secret that is unreadable, malformed or missing its current key. */
export class FingerprintKeyringError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'FingerprintKeyringError';
        Object.setPrototypeOf(this, FingerprintKeyringError.prototype);
    }
}

/** Type guard for {@link FingerprintKeyringError}. */
export function isFingerprintKeyringError(error: unknown): error is FingerprintKeyringError {
    return error instanceof FingerprintKeyringError;
}

const RingSchema = z.object({ current: z.number().int().positive() }).catchall(z.string().min(MIN_KEY_LENGTH));

/**
 * Parse the keyring secret string.
 *
 * @throws {FingerprintKeyringError} when the JSON, a key name, a key value or the current version is wrong.
 */
export function parseFingerprintKeyring(json: string): FingerprintKeyring {
    let raw: unknown;

    try {
        raw = JSON.parse(json);
    } catch {
        throw new FingerprintKeyringError('Fingerprint keyring is not valid JSON.');
    }

    const parsed = RingSchema.safeParse(raw);

    if (!parsed.success) {
        // Issue paths only: a zod message can echo the offending value, and a value here is a secret.
        const where = parsed.error.issues.map((issue) => issue.path.join('.') || 'keyring').join(', ');
        throw new FingerprintKeyringError(`Fingerprint keyring is malformed at: ${where}.`);
    }

    const { current, ...named } = parsed.data;
    const keys = new Map<number, string>();

    for (const [name, key] of Object.entries(named)) {
        const match = KEY_NAME.exec(name);

        if (match?.[1] === undefined) {
            throw new FingerprintKeyringError('Fingerprint keyring has a key with an unexpected name.');
        }

        keys.set(Number(match[1]), key);
    }

    if (!keys.has(current)) {
        throw new FingerprintKeyringError(`Fingerprint keyring has no key for its current key version ${current}.`);
    }

    return { current, keys: new Map([...keys].sort(([a], [b]) => a - b)) };
}
