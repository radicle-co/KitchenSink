import { defineConfig } from 'vitest/config';

/**
 * Integration test config (a real Postgres, named by `DATABASE_ADMIN_URL`). Kept separate from the default
 * `test` task so DB-backed specs never bleed into the unit run (constitution Principle IV).
 *
 * ## ⛔ Why this tier pins the AWS environment, and why DUMMY CREDENTIALS are the load-bearing half
 *
 * A spec here may legitimately construct an AWS client the way PRODUCTION does — `new DynamoDBClient({})`,
 * with no endpoint and no credentials — precisely so the test exercises the deployed constructor rather
 * than the test's own configuration (`messageSubstrate.integration.test.ts` says so explicitly, and it is
 * right to).
 *
 * ⛔ But a default-constructed client resolves the FULL credential chain, and on a developer machine that
 * chain finds `~/.aws/credentials` and `~/.aws/config`. Measured on 2026-09-08: the message-substrate spec
 * was resolving a real long-term `AKIA…` key and `region = us-east-1` with the default AWS endpoint — i.e.
 * issuing `PutItem` against **real DynamoDB**, in the account that also hosts a separate production system.
 * It failed with `ResourceNotFoundException` (no table of that name there), which reads exactly like an
 * ordinary broken assertion, so nothing ever pointed at the cause.
 *
 * These four variables close it for the WHOLE tier rather than one file, because the hazard is a property
 * of the tier: any integration spec that builds a default client inherits the same chain. `AWS_ENDPOINT_URL`
 * sends it to LocalStack; `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` are what actually stop the shared
 * credentials file being consulted, since environment credentials take precedence over it. Removing the
 * dummy pair "because the endpoint is already local" reopens the hole: a client holding real credentials
 * and a local endpoint still puts a signed real key on the wire.
 */
export default defineConfig({
    test: {
        env: {
            AWS_ENDPOINT_URL: process.env['AWS_ENDPOINT_URL'] ?? 'http://localhost:4566',
            AWS_REGION: process.env['AWS_REGION'] ?? 'us-east-1',
            AWS_ACCESS_KEY_ID: 'test',
            AWS_SECRET_ACCESS_KEY: 'test',
        },
        include: ['tests/**/*.integration.test.ts'],
        // Provisions the role-split database once per run (ADR-0039) — the suites connect as `food_app`.
        globalSetup: ['./tests/globalSetup.ts'],
        // Integration specs share a database; run serially to avoid cross-file interference.
        fileParallelism: false,
        hookTimeout: 60_000,
        testTimeout: 30_000,
        typecheck: {
            enabled: false,
        },
    },
});
