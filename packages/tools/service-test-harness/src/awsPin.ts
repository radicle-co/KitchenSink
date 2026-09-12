/**
 * @module awsPin — the AWS environment a test tier pins through its vitest config, built once for both pins
 * (`localAwsPin.ts` for the LOCAL e2e tier, `integrationAwsPin.ts` for the integration tier).
 *
 * ## ⛔ Why a tier pins the AWS environment, and why the CREDENTIALS are the load-bearing half
 *
 * A spec may construct an AWS client the way production does, `new DynamoDBClient({})`, so that it exercises the
 * deployed constructor. That client resolves the FULL default credential chain, and on a developer machine the chain
 * finds `~/.aws`. Measured 2026-09-08: food's message-substrate spec signed `PutItem` with a real long-term key against
 * real DynamoDB, in an account that also hosts another production system, and it read as an ordinary failed assertion.
 *
 * The endpoint alone does not close it: a client holding a real key and a local endpoint still puts a signed real key
 * on the wire. And dummy environment credentials alone did not close it either, because the chain reads an exported
 * `AWS_PROFILE` BEFORE them (`@aws-sdk/credential-provider-node`'s `defaultProvider` skips `fromEnv` whenever a profile
 * is set) and keeps an exported `AWS_SESSION_TOKEN` beside them. So the pin blanks the profile and the session token,
 * and points both files the chain could read at a path that cannot exist. `awsPinIsolation.test.ts` resolves the real
 * chain under each developer environment that used to defeat it.
 *
 * The worker-side check (`awsPinCheckSetup.ts`, run through `setupFiles`) asserts that the pin actually held in every
 * file of the tier.
 *
 * ## ⚠️ Loaded by plain Node at config time
 *
 * vitest bundles a config and leaves its package imports to Node, which strips this module's types but does not map a
 * `./x.js` specifier to `x.ts`. So this module and `loopbackHost.ts` import nothing relative, and the two pin modules
 * reach them through the package's `#` imports map. `awsTierPins.test.ts` loads every tier config the way vitest does.
 */
import { fileURLToPath } from 'node:url';

/** The key both pins set. AWS refuses it, so a client that escapes the endpoint signs with nothing real. */
export const DUMMY_AWS_ACCESS_KEY_ID = 'test';

/** The secret paired with {@link DUMMY_AWS_ACCESS_KEY_ID}. */
const DUMMY_AWS_SECRET_ACCESS_KEY = 'test';

/** A credentials and config path that cannot exist: nothing can be created beneath `/dev/null`. */
export const ABSENT_AWS_FILE = '/dev/null/kitchensinkAwsPin';

/**
 * The setup file that checks, inside each worker, that the pin held.
 *
 * ⚠️ A function, not a constant: the check imports this module inside the worker, where a jsdom tier's
 * `import.meta.url` is not a `file:` URL. Only a config, loaded by Node, asks for the path.
 *
 * @returns Its absolute path. Pure.
 */
export function awsPinCheckFile(): string {
    return fileURLToPath(new URL('./awsPinCheckSetup.ts', import.meta.url));
}

/** The region both pins name, so no client reads one from a config file. */
const PINNED_REGION = 'us-east-1';

/** What a tier config applies: its `test.env` entries and its `test.setupFiles` entries. */
export interface AwsPin {
    /** Where a default-constructed client is sent. */
    readonly endpoint: string;
    /** The entries the config spreads into `test.env`. */
    readonly env: Readonly<Record<string, string>>;
    /** The entries the config adds to `test.setupFiles`. */
    readonly setupFiles: readonly string[];
}

/**
 * The pin that sends every default-constructed AWS client to `endpoint` with nothing but the dummy key.
 *
 * @param endpoint - The endpoint every client is sent to.
 * @returns The pin. Pure.
 */
export function pinAwsTo(endpoint: string): AwsPin {
    return {
        endpoint,
        env: {
            AWS_ENDPOINT_URL: endpoint,
            AWS_REGION: PINNED_REGION,
            AWS_ACCESS_KEY_ID: DUMMY_AWS_ACCESS_KEY_ID,
            AWS_SECRET_ACCESS_KEY: DUMMY_AWS_SECRET_ACCESS_KEY,
            AWS_SESSION_TOKEN: '',
            AWS_PROFILE: '',
            AWS_CONFIG_FILE: ABSENT_AWS_FILE,
            AWS_SHARED_CREDENTIALS_FILE: ABSENT_AWS_FILE,
        },
        setupFiles: [awsPinCheckFile()],
    };
}
