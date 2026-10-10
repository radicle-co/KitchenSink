/**
 * @module awsPinCheck — the worker-side half of the AWS pin (`awsPin.ts`): the credentials the default chain resolves
 * inside a test worker are the pin's dummy key, or the file does not run.
 *
 * A config can apply the pin and still lose it, through a later `env` entry or a suite's own `process.env` write, and
 * only the resolved credentials show that. `awsPinCheckSetup.ts` runs this in every file of a pinned tier.
 */
import { DUMMY_AWS_ACCESS_KEY_ID } from './awsPin.js';

/** The part of a resolved identity the check reads. */
interface ResolvedKey {
    readonly accessKeyId: string;
}

/** Raised when the default chain resolves a key other than the dummy. Matching guard: {@link isAwsPinBreachedError}. */
export class AwsPinBreachedError extends Error {
    public constructor(keyPrefix: string) {
        super(
            `the default AWS credential chain resolved a key beginning '${keyPrefix}' instead of the tier's dummy key ` +
                `'${DUMMY_AWS_ACCESS_KEY_ID}'. An exported AWS_PROFILE, a session token, a credentials file or a later ` +
                'env entry beat the pin, so any AWS client this file builds would sign with that key. Apply the tier ' +
                "pin from @kitchensink/service-test-harness last in the config's `test.env`.",
        );
        this.name = 'AwsPinBreachedError';
        Object.setPrototypeOf(this, AwsPinBreachedError.prototype);
    }
}

/**
 * Type guard for {@link AwsPinBreachedError}.
 *
 * @param error - Anything thrown.
 * @returns Whether it is the breach.
 */
export function isAwsPinBreachedError(error: unknown): error is AwsPinBreachedError {
    return error instanceof AwsPinBreachedError;
}

/**
 * Resolve the credentials and refuse any key but the dummy.
 *
 * @param resolve - The credential provider, normally the SDK's default chain.
 * @throws {AwsPinBreachedError} when it resolves another key; only the key's first four characters are reported.
 * @sideEffect Resolves credentials through `resolve`.
 */
export async function assertPinnedAwsCredentials(resolve: () => Promise<ResolvedKey>): Promise<void> {
    const { accessKeyId } = await resolve();

    if (accessKeyId !== DUMMY_AWS_ACCESS_KEY_ID) {
        throw new AwsPinBreachedError(accessKeyId.slice(0, 4));
    }
}
