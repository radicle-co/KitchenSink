/**
 * The reference a remote hit carries (ADR-0055 point 10, review ruling 9). Food seals what adopting the hit needs, the
 * app sends it back unread, and food opens only what it sealed: the app never holds the source's key, and nothing it
 * sends can name an item food did not show it.
 *
 * - **AEAD**, as a compact JWE: `dir` key management and `A256GCM` content encryption under `FOOD_REMOTE_REFERENCE_KEY`.
 *   `jose`, which this service already ships, does the encoding, the random IV and the tag check; decrypting is
 *   restricted to exactly those two algorithms, so a header cannot choose a weaker one.
 * - **A versioned payload**: `v` names its shape, and an unknown version is refused, never guessed at.
 * - It seals the name the hit was shown under, so the root an adopt makes carries exactly that name, and the lineage
 *   key, so an adopt asks the catalog owner reader the same question the search did.
 *
 * @pattern Value Object codec — a remote food reference to an opaque token and back
 * @module
 */
import { isLineageKey, type LineageKey } from '@kitchensink/usda-client';
import { remoteSearchSourceSchema, type RemoteSearchSource } from '@kitchensink/schema-remote-search';
import { CompactEncrypt, compactDecrypt, errors } from 'jose';
import { z } from 'zod';

import { InvalidRemoteReferenceError } from './remoteReference.errors.js';

/** The payload version this build seals and opens. */
const REFERENCE_VERSION = 1;

/** An AES-256 key's length, in bytes. */
const KEY_BYTES = 32;

/** The algorithms a reference is sealed with, and the only ones opening accepts. */
const PROTECTED_HEADER = { alg: 'dir', enc: 'A256GCM' } as const;

/** What a reference names: one remote item, as the cook was shown it. */
export interface RemoteFoodReference {
    readonly source: RemoteSearchSource;
    /** The source's key for the item. */
    readonly externalKey: string;
    /** The source's link between versions of the item, or `null`. */
    readonly lineageKey: LineageKey | null;
    /** The name the hit was shown under, which its root carries. */
    readonly name: string;
}

/** A version-1 payload. */
const payloadSchema = z.strictObject({
    v: z.literal(REFERENCE_VERSION),
    source: remoteSearchSourceSchema,
    externalKey: z.string().min(1),
    lineageKey: z.custom<LineageKey>(isLineageKey).nullable(),
    name: z.string().min(1),
});

/** Any payload's version, read before its shape, so an unknown version is told apart from a malformed payload. */
const versionSchema = z.object({ v: z.number() });

export class RemoteReferenceSealer {
    /**
     * @param key - The 32-byte key, `FOOD_REMOTE_REFERENCE_KEY`.
     * @throws {RangeError} when the key is not 32 bytes.
     */
    public constructor(private readonly key: Uint8Array) {
        if (key.byteLength !== KEY_BYTES) {
            throw new RangeError(`A remote reference key is ${String(KEY_BYTES)} bytes.`);
        }
    }

    /**
     * Seal a reference.
     *
     * @param reference - The hit.
     * @returns The opaque token: base64url segments joined by `.`.
     * @sideEffect Draws a random IV.
     */
    public async seal(reference: RemoteFoodReference): Promise<string> {
        const payload: z.infer<typeof payloadSchema> = { v: REFERENCE_VERSION, ...reference };

        return new CompactEncrypt(new TextEncoder().encode(JSON.stringify(payload)))
            .setProtectedHeader(PROTECTED_HEADER)
            .encrypt(this.key);
    }

    /**
     * Open a reference this key sealed.
     *
     * @param token - The token the app sent.
     * @returns The hit it names.
     * @throws {InvalidRemoteReferenceError} when it cannot be opened, naming why.
     */
    public async open(token: string): Promise<RemoteFoodReference> {
        const payload = parseJson(await this.decrypt(token));
        const version = versionSchema.safeParse(payload);

        if (version.success && version.data.v !== REFERENCE_VERSION) {
            throw new InvalidRemoteReferenceError('version');
        }

        const parsed = payloadSchema.safeParse(payload);

        if (!parsed.success) {
            throw new InvalidRemoteReferenceError('shape');
        }

        const { source, externalKey, lineageKey, name } = parsed.data;

        return { source, externalKey, lineageKey, name };
    }

    /**
     * Decrypt a token, accepting only the sealing algorithms.
     *
     * @param token - The token.
     * @returns The plaintext.
     * @throws {InvalidRemoteReferenceError} `unreadable` for any failure `jose` reports.
     */
    private async decrypt(token: string): Promise<string> {
        try {
            const { plaintext } = await compactDecrypt(token, this.key, {
                keyManagementAlgorithms: [PROTECTED_HEADER.alg],
                contentEncryptionAlgorithms: [PROTECTED_HEADER.enc],
            });

            return new TextDecoder().decode(plaintext);
        } catch (error) {
            if (error instanceof errors.JOSEError) {
                throw new InvalidRemoteReferenceError('unreadable');
            }

            throw error;
        }
    }
}

/**
 * Parse a decrypted payload. Pure.
 *
 * @param text - The plaintext.
 * @returns The value.
 * @throws {InvalidRemoteReferenceError} `shape` when it is not JSON.
 */
function parseJson(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        // Only this key could have sealed it, so this is a defect in a past build; still a refusal, never a 500.
        throw new InvalidRemoteReferenceError('shape');
    }
}
