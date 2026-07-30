import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../common/secrets.js', () => ({
    getJsonSecret: vi.fn(),
}));

// S-I7: migrate is now wrapped in `withObservability` (parity with the other three handlers), whose
// real implementation reads `context.awsRequestId` before ever reaching the core — matching the
// sibling handler tests (deletion-worker/reconciliation/identityWebhook), this bypasses Sentry
// instrumentation entirely so `handler()` can still be invoked with no event/context, exactly as
// these config-boundary tests already do.
vi.mock('../../common/observability.js', () => ({
    withObservability: <T, R>(fn: (event: T, ctx: unknown) => Promise<R>) => fn,
}));

import { handler as rawHandler } from '../migrate.js';
import { getJsonSecret } from '../../common/secrets.js';
import { resetConfigCacheForTests } from '../../config/env.js';
import type { MigrateResult } from '../migrate.js';

type TestHandler = () => Promise<MigrateResult>;
const handler = rawHandler as unknown as TestHandler;

const mockGetJsonSecret = vi.mocked(getJsonSecret);

beforeEach(() => {
    vi.clearAllMocks();
    resetConfigCacheForTests();
    process.env.DB_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123:secret:db';
    process.env.AUTH_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123:secret:auth';
});

describe('migrate handler', () => {
    it('missing DB_SECRET_ARN -> fails fast on the typed config before reading any secret', async () => {
        delete process.env.DB_SECRET_ARN;

        await expect(handler()).rejects.toThrow();
        expect(mockGetJsonSecret).not.toHaveBeenCalled();
    });

    it('missing both IDP_SECRET_KEY and AUTH_SECRET_ARN -> fails fast on the typed config', async () => {
        delete process.env.AUTH_SECRET_ARN;

        await expect(handler()).rejects.toThrow();
        expect(mockGetJsonSecret).not.toHaveBeenCalled();
    });

    it('reads DB_SECRET_ARN from the typed config (not requireEnv)', async () => {
        // Short-circuit after config resolution so this stays a config-boundary test, not a full
        // migration-flow test (no existing coverage for the DB flow to preserve here).
        mockGetJsonSecret.mockRejectedValue(new Error('stop after config resolution'));

        await expect(handler()).rejects.toThrow('stop after config resolution');

        expect(mockGetJsonSecret).toHaveBeenCalledWith('arn:aws:secretsmanager:us-east-1:123:secret:db');
    });
});
