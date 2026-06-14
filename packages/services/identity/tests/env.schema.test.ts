import { describe, expect, it } from 'vitest';

import { EnvironmentSchema } from '../src/config/env.schema.js';

const base = {
    DATABASE_URL: 'postgres://user:pass@host:5432/db',
    DELETION_QUEUE_URL: 'https://sqs.example.com/queue',
};

describe('EnvironmentSchema', () => {
    it('parses without Sentry vars (all optional)', () => {
        const result = EnvironmentSchema.parse(base);

        expect(result.SENTRY_DSN).toBeUndefined();
        expect(result.STAGE).toBe('dev');
    });

    it('parses with Sentry vars and a real deploy stage', () => {
        const result = EnvironmentSchema.parse({
            ...base,
            SENTRY_DSN: 'https://key@o1.ingest.sentry.io/1',
            SENTRY_TRACES_SAMPLE_RATE: '0.1',
            SENTRY_RELEASE: 'abc123',
            STAGE: 'prod',
            CLERK_JWT_KEY: '-----BEGIN PUBLIC KEY-----\nMIIB\n-----END PUBLIC KEY-----',
            CLERK_AUTHORIZED_PARTIES: 'https://commise.app',
        });

        expect(result.SENTRY_DSN).toBe('https://key@o1.ingest.sentry.io/1');
        expect(result.SENTRY_RELEASE).toBe('abc123');
        expect(result.STAGE).toBe('prod');
    });

    it('rejects a non-URL SENTRY_DSN', () => {
        expect(() => EnvironmentSchema.parse({ ...base, SENTRY_DSN: 'not-a-url' })).toThrow();
    });

    it('defaults CLERK_AUTHORIZED_PARTIES to an empty list when absent (dev)', () => {
        const result = EnvironmentSchema.parse(base);

        expect(result.CLERK_AUTHORIZED_PARTIES).toEqual([]);
        expect(result.CLERK_JWT_KEY).toBeUndefined();
    });

    it('parses CLERK_AUTHORIZED_PARTIES as a trimmed, comma-split list', () => {
        const result = EnvironmentSchema.parse({
            ...base,
            CLERK_AUTHORIZED_PARTIES: 'https://a.com, https://b.com ,,https://c.com',
        });

        expect(result.CLERK_AUTHORIZED_PARTIES).toEqual(['https://a.com', 'https://b.com', 'https://c.com']);
    });

    it('requires CLERK_JWT_KEY on a deployed stage', () => {
        expect(() =>
            EnvironmentSchema.parse({ ...base, STAGE: 'prod', CLERK_AUTHORIZED_PARTIES: 'https://commise.app' }),
        ).toThrow(/CLERK_JWT_KEY is required/);
    });

    it('requires a non-empty CLERK_AUTHORIZED_PARTIES on a deployed stage', () => {
        expect(() =>
            EnvironmentSchema.parse({
                ...base,
                STAGE: 'sandbox',
                CLERK_JWT_KEY: '-----BEGIN PUBLIC KEY-----\nMIIB\n-----END PUBLIC KEY-----',
            }),
        ).toThrow(/CLERK_AUTHORIZED_PARTIES/);
    });

    it('does not require Clerk vars on dev/test stages', () => {
        expect(() => EnvironmentSchema.parse({ ...base, STAGE: 'test' })).not.toThrow();
        expect(() => EnvironmentSchema.parse({ ...base, STAGE: 'dev' })).not.toThrow();
    });
});
