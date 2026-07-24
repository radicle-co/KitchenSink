import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../common/secrets.js', () => ({
    getJsonSecret: vi.fn(),
}));

import { handler } from '../migrate.js';
import { getJsonSecret } from '../../common/secrets.js';
import { resetConfigCacheForTests } from '../../config/env.js';

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
