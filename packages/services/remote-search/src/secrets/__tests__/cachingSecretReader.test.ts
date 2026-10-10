/**
 * The once-per-container secret read: a secret is asked for once for the life of the process, every concurrent
 * caller shares that one read, and a failed read is not remembered, so the next request asks again.
 */
import { describe, expect, it } from 'vitest';

import { cachingSecretReader } from '../cachingSecretReader.js';
import type { SecretReader } from '../secretPorts.js';

/** A reader that records each id it is asked for and answers from a script. */
interface ScriptedReader {
    readonly reader: SecretReader;
    readonly asked: string[];
}

/**
 * Build a reader that answers each read with the next scripted step.
 *
 * @param steps - Each read's answer: a value, or an error to reject with.
 * @returns The reader and its record.
 */
function scriptedReader(...steps: readonly (string | Error)[]): ScriptedReader {
    const asked: string[] = [];
    const remaining = [...steps];

    return {
        asked,
        reader: (secretId) => {
            asked.push(secretId);

            const step = remaining.shift();

            if (step === undefined) {
                return Promise.reject(new Error('the script ran out'));
            }

            return step instanceof Error ? Promise.reject(step) : Promise.resolve(step);
        },
    };
}

describe('cachingSecretReader', () => {
    it('asks once, however many requests read the secret', async () => {
        const { reader, asked } = scriptedReader('key-1');
        const read = cachingSecretReader(reader);

        await expect(read('usda')).resolves.toBe('key-1');
        await expect(read('usda')).resolves.toBe('key-1');
        await expect(read('usda')).resolves.toBe('key-1');
        expect(asked).toStrictEqual(['usda']);
    });

    it('shares one read between callers that arrive before it settles', async () => {
        const { reader, asked } = scriptedReader('key-1');
        const read = cachingSecretReader(reader);

        await expect(Promise.all([read('usda'), read('usda')])).resolves.toStrictEqual(['key-1', 'key-1']);
        expect(asked).toStrictEqual(['usda']);
    });

    it('fails the request whose read failed, and asks again on the next one', async () => {
        const failure = new Error('ThrottlingException');
        const { reader, asked } = scriptedReader(failure, 'key-1');
        const read = cachingSecretReader(reader);

        await expect(read('usda')).rejects.toBe(failure);
        await expect(read('usda')).resolves.toBe('key-1');
        await expect(read('usda')).resolves.toBe('key-1');
        expect(asked).toStrictEqual(['usda', 'usda']);
    });

    it('reads each secret separately', async () => {
        const { reader, asked } = scriptedReader('usda-key', 'other-key');
        const read = cachingSecretReader(reader);

        await expect(read('usda')).resolves.toBe('usda-key');
        await expect(read('other')).resolves.toBe('other-key');
        await expect(read('usda')).resolves.toBe('usda-key');
        expect(asked).toStrictEqual(['usda', 'other']);
    });

    it('keeps each cache to its own reader, so a new container reads afresh', async () => {
        const first = scriptedReader('key-1');
        const second = scriptedReader('key-2');

        await expect(cachingSecretReader(first.reader)('usda')).resolves.toBe('key-1');
        await expect(cachingSecretReader(second.reader)('usda')).resolves.toBe('key-2');
    });
});
