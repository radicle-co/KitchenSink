import { describe, expect, it } from 'vitest';

import { EnvironmentSchema, resolveTestPrincipalContainment } from '../src/config/env.schema.js';

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

    it('accepts CLERK_AZP_PATTERN in place of the list on a deployed non-prod stage', () => {
        const result = EnvironmentSchema.parse({
            ...base,
            STAGE: 'sandbox',
            CLERK_JWT_KEY: '-----BEGIN PUBLIC KEY-----\nMIIB\n-----END PUBLIC KEY-----',
            CLERK_AZP_PATTERN: 'sandbox.commise.app',
        });

        expect(result.CLERK_AZP_PATTERN).toBe('sandbox.commise.app');
        expect(result.CLERK_AUTHORIZED_PARTIES).toEqual([]);
    });

    it('rejects BOTH the list and the pattern on a deployed stage (ambiguous)', () => {
        expect(() =>
            EnvironmentSchema.parse({
                ...base,
                STAGE: 'sandbox',
                CLERK_JWT_KEY: '-----BEGIN PUBLIC KEY-----\nMIIB\n-----END PUBLIC KEY-----',
                CLERK_AUTHORIZED_PARTIES: 'https://commise.app',
                CLERK_AZP_PATTERN: 'sandbox.commise.app',
            }),
        ).toThrow(/exactly one/);
    });

    it("rejects CLERK_AZP_PATTERN on the 'prod' stage (prod uses exact-match)", () => {
        expect(() =>
            EnvironmentSchema.parse({
                ...base,
                STAGE: 'prod',
                CLERK_JWT_KEY: '-----BEGIN PUBLIC KEY-----\nMIIB\n-----END PUBLIC KEY-----',
                CLERK_AZP_PATTERN: 'sandbox.commise.app',
            }),
        ).toThrow(/not allowed on the 'prod' stage/);
    });

    it('does not require Clerk vars on dev/test stages', () => {
        expect(() => EnvironmentSchema.parse({ ...base, STAGE: 'test' })).not.toThrow();
        expect(() => EnvironmentSchema.parse({ ...base, STAGE: 'dev' })).not.toThrow();
    });
});

/**
 * ADR-0040 containment switch. The boot-time schema REJECTS a typo (a deploy that meant `off` and wrote `Off` must
 * not boot silently enforcing, nor silently open), while the call-time resolver FAILS CLOSED: anything that is not
 * exactly `off` resolves to `enforce`, so a value that slipped past validation can never disarm containment.
 */
describe('TEST_PRINCIPAL_CONTAINMENT', () => {
    it('defaults to enforce when unset', () => {
        expect(EnvironmentSchema.parse(base).TEST_PRINCIPAL_CONTAINMENT).toBe('enforce');
    });

    it.each(['enforce', 'off'] as const)('accepts %s', (mode) => {
        expect(EnvironmentSchema.parse({ ...base, TEST_PRINCIPAL_CONTAINMENT: mode }).TEST_PRINCIPAL_CONTAINMENT).toBe(
            mode,
        );
    });

    it.each(['Off', 'OFF', 'false', '', 'disabled'])('rejects the unrecognised value %j at boot', (value) => {
        expect(() => EnvironmentSchema.parse({ ...base, TEST_PRINCIPAL_CONTAINMENT: value })).toThrow();
    });

    it('resolves exactly `off` to off at call time', () => {
        expect(resolveTestPrincipalContainment('off')).toBe('off');
    });

    it.each([undefined, 'enforce', 'Off', 'OFF', 'false', '', ' off'])(
        'fails CLOSED: %j resolves to enforce',
        (raw) => {
            expect(resolveTestPrincipalContainment(raw)).toBe('enforce');
        },
    );
});
