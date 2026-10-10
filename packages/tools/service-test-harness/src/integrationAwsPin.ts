/**
 * @module integrationAwsPin — the AWS pin for an integration tier, whose dependencies are mocked
 * (`docs/CODING_STANDARDS.md` §7.1a): a client the mocks missed is sent to a loopback port nothing serves, so it fails
 * on connect instead of reaching LocalStack or AWS. Shared rationale: `awsPin.ts`.
 *
 * It imports through the package's `#` map, because a vitest config loads it under plain Node (`awsPin.ts`).
 */
import { pinAwsTo, type AwsPin } from '#awsPin';

/** A loopback port nothing serves (the discard port), so a connection is refused at once. */
export const REFUSED_AWS_ENDPOINT = 'http://127.0.0.1:9';

/** The pin every integration tier that can build an AWS client applies. */
export const INTEGRATION_AWS_PIN: AwsPin = pinAwsTo(REFUSED_AWS_ENDPOINT);
