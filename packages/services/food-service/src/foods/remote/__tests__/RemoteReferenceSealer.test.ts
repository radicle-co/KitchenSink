/**
 * The reference a remote hit carries (ADR-0055 point 10, ruling 9): food seals what it needs to adopt the hit, so the
 * app picks it without ever holding the source's key, and food opens only what it sealed. AEAD (JWE `dir` +
 * `A256GCM`), a versioned payload, and every other input refused.
 */
import { randomBytes } from 'node:crypto';

import { CompactEncrypt } from 'jose';
import { describe, expect, it } from 'vitest';

import { isInvalidRemoteReferenceError } from '../remoteReference.errors.js';
import { RemoteReferenceSealer, type RemoteFoodReference } from '../RemoteReferenceSealer.js';

const KEY = new Uint8Array(randomBytes(32));
const KALE: RemoteFoodReference = {
    source: 'usda',
    externalKey: '2346405',
    lineageKey: 'foundation:11233',
    name: 'Kale, raw',
};

/**
 * Seal any payload under a key, as a forger or a future version would.
 *
 * @param payload - The payload.
 * @param key - The key.
 * @param enc - The content encryption.
 * @returns The compact JWE.
 */
async function sealRaw(payload: unknown, key: Uint8Array = KEY, enc = 'A256GCM'): Promise<string> {
    return new CompactEncrypt(new TextEncoder().encode(JSON.stringify(payload)))
        .setProtectedHeader({ alg: 'dir', enc })
        .encrypt(key);
}

/**
 * Why opening a token was refused.
 *
 * @param token - The token.
 * @returns The refusal's reason.
 */
async function refusalOf(token: string): Promise<string> {
    try {
        await new RemoteReferenceSealer(KEY).open(token);
    } catch (error) {
        if (isInvalidRemoteReferenceError(error)) {
            return error.reason;
        }

        throw error;
    }

    throw new Error('expected a refusal');
}

describe('RemoteReferenceSealer', () => {
    it('opens what it sealed', async () => {
        const sealer = new RemoteReferenceSealer(KEY);

        await expect(sealer.open(await sealer.seal(KALE))).resolves.toStrictEqual(KALE);
    });

    it('opens a reference with no lineage', async () => {
        const sealer = new RemoteReferenceSealer(KEY);
        const reference = { ...KALE, lineageKey: null };

        await expect(sealer.open(await sealer.seal(reference))).resolves.toStrictEqual(reference);
    });

    it('is opaque: neither the source’s key nor the name is readable in it', async () => {
        const sealed = await new RemoteReferenceSealer(KEY).seal(KALE);
        const decoded = sealed
            .split('.')
            .map((part) => Buffer.from(part, 'base64url').toString('latin1'))
            .join(' ');

        expect(decoded).not.toContain('2346405');
        expect(decoded).not.toContain('Kale');
        expect(sealed).toMatch(/^[A-Za-z0-9_.-]+$/u);
    });

    it('seals the same hit differently each time, and both open', async () => {
        const sealer = new RemoteReferenceSealer(KEY);
        const [first, second] = [await sealer.seal(KALE), await sealer.seal(KALE)];

        expect(first).not.toBe(second);
        await expect(sealer.open(second)).resolves.toStrictEqual(KALE);
    });

    it('⛔ refuses a reference changed by one character', async () => {
        const sealed = await new RemoteReferenceSealer(KEY).seal(KALE);
        const parts = sealed.split('.');
        const ciphertext = parts[3] ?? '';
        const flipped = `${ciphertext.startsWith('A') ? 'B' : 'A'}${ciphertext.slice(1)}`;

        await expect(refusalOf([parts[0], parts[1], parts[2], flipped, parts[4]].join('.'))).resolves.toBe(
            'unreadable',
        );
    });

    it('refuses a reference sealed under another key, as after a key rotation', async () => {
        const sealed = await new RemoteReferenceSealer(new Uint8Array(randomBytes(32))).seal(KALE);

        await expect(refusalOf(sealed)).resolves.toBe('unreadable');
    });

    it('⛔ refuses a version it does not know, though it decrypts', async () => {
        await expect(refusalOf(await sealRaw({ ...KALE, v: 2 }))).resolves.toBe('version');
    });

    it.each<[string, unknown]>([
        ['no version', { ...KALE }],
        ['a source it does not search', { ...KALE, v: 1, source: 'ciqual' }],
        ['an empty key', { ...KALE, v: 1, externalKey: '' }],
        ['a lineage key in another form', { ...KALE, v: 1, lineageKey: 'ndb:11233' }],
        ['an empty name', { ...KALE, v: 1, name: '' }],
        ['an extra field', { ...KALE, v: 1, userId: 'U-1' }],
    ])('refuses a payload with %s', async (_label, payload) => {
        await expect(refusalOf(await sealRaw(payload))).resolves.toBe('shape');
    });

    it('⛔ refuses any other content encryption, even one that decrypts under the right key', async () => {
        // A128CBC-HS256 takes a 32-byte key too, so only the algorithm restriction refuses it.
        const sealed = await sealRaw({ ...KALE, v: 1 }, KEY, 'A128CBC-HS256');

        await expect(refusalOf(sealed)).resolves.toBe('unreadable');
    });

    it.each(['', 'not-a-reference', 'a.b.c.d.e', '....'])('refuses %j', async (token) => {
        await expect(refusalOf(token)).resolves.toBe('unreadable');
    });

    it('refuses to be built over a key that is not 32 bytes', () => {
        expect(() => new RemoteReferenceSealer(new Uint8Array(16))).toThrow(RangeError);
    });
});
