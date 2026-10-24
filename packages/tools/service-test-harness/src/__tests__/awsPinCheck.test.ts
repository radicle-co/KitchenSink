/**
 * The worker-side half of the AWS pin: whatever the default credential chain resolves must be the pin's dummy key.
 * A config can apply the pin and still lose it (a later `env` entry, a suite's own `process.env` write), and only the
 * resolved credentials show that.
 */
import { describe, expect, it } from 'vitest';

import { DUMMY_AWS_ACCESS_KEY_ID } from '../awsPin.js';
import { assertPinnedAwsCredentials, isAwsPinBreachedError } from '../awsPinCheck.js';

/** A provider that resolves `accessKeyId`. */
const resolving = (accessKeyId: string) => async () => ({ accessKeyId, secretAccessKey: 'secret' });

describe('assertPinnedAwsCredentials', () => {
    it('passes when the chain resolves the dummy key', async () => {
        await expect(assertPinnedAwsCredentials(resolving(DUMMY_AWS_ACCESS_KEY_ID))).resolves.toBeUndefined();
    });

    it('⛔ fails, naming the cause and not the key, when the chain resolves any other key', async () => {
        const failure: unknown = await assertPinnedAwsCredentials(resolving('ASIAREALLOOKINGKEY01')).catch(
            (error: unknown) => error,
        );

        expect(isAwsPinBreachedError(failure)).toBe(true);
        expect(String(failure)).toMatch(/AWS_PROFILE/u);
        expect(String(failure)).not.toContain('REALLOOKINGKEY01');
    });

    it('fails when the chain resolves nothing at all', async () => {
        const unresolvable = async () => {
            throw new Error('Could not load credentials from any providers');
        };

        await expect(assertPinnedAwsCredentials(unresolvable)).rejects.toThrow(/Could not load credentials/u);
    });
});
