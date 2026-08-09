/**
 * Unit tests for the source-agnostic food-service environment schema (T-002).
 *
 * Traceability:
 * - FR-019 (per-source rolling-window cap), FR-025/FR-025a (TTLs), FR-032 (stale threshold),
 *   FR-039/FR-042 (auth config), FR-046/FR-043b (queue depth + demotion), FR-052 (auth DoS shedder).
 * - T-002 acceptance: the FULL config surface consumed across the service (API + worker + auth) is
 *   validated here, source-agnostic. No USDA-specific operational knob leaks as required config — only
 *   the adapter-boundary source credentials (`USDA_API_KEY`/`USDA_API_BASE_URL`) carry the source name.
 *   A valid env parses with documented defaults; bad values are rejected; required vars fail closed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

import { demoteThresholdFromEnv, EnvironmentSchema, resolveEnvironment } from '../env.schema.js';

const VALID_ENV = {
    STAGE: 'test',
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://food_app:pw@localhost:5432/kitchensink_food',
    USDA_API_KEY: 'test-usda-key',
} as const;

describe('EnvironmentSchema — required, fail-closed config', () => {
    it('rejects a missing source API key (USDA_API_KEY) with a descriptive ZodError', () => {
        const { USDA_API_KEY: _omitted, ...withoutKey } = VALID_ENV;

        const result = EnvironmentSchema.safeParse(withoutKey);

        expect(result.success).toBe(false);
        if (result.success) {
            throw new Error('expected validation to fail');
        }
        expect(result.error).toBeInstanceOf(ZodError);
        expect(result.error.issues.some((issue) => issue.path.includes('USDA_API_KEY'))).toBe(true);
    });

    it('rejects an env with neither DATABASE_URL nor the discrete DB_* parts (fail-closed)', () => {
        const { DATABASE_URL: _url, ...withoutDb } = VALID_ENV;

        expect(EnvironmentSchema.safeParse(withoutDb).success).toBe(false);
    });

    it('accepts the discrete DB_* connection form', () => {
        const { DATABASE_URL: _url, ...rest } = VALID_ENV;
        const env = EnvironmentSchema.parse({
            ...rest,
            DB_HOST: 'localhost',
            DB_PORT: '5432',
            DB_NAME: 'kitchensink_food',
            DB_USERNAME: 'food_app',
            DB_PASSWORD: 'pw',
        });

        expect(env.USDA_API_KEY).toBe('test-usda-key');
    });
});

describe('EnvironmentSchema — source-agnostic operational defaults', () => {
    it('applies the documented operational defaults', () => {
        const env = EnvironmentSchema.parse(VALID_ENV);

        // Per-source rolling-window cap (FR-019): USDA = 1,000, worker pauses at 90% = 900.
        expect(env.FOOD_SOURCE_RATE_LIMIT_PER_HOUR).toBe(1000);
        // Fairness-by-demotion + backpressure (FR-043/FR-046).
        expect(env.FOOD_DEMOTE_THRESHOLD).toBe(50);
        expect(env.FOOD_MAX_QUEUE_DEPTH).toBe(10_000);
        expect(env.FOOD_MAX_BATCH_NAMES).toBe(100);
        // TTLs (FR-025 NOT_FOUND tombstone, FR-025a UNRESOLVED candidate set, FR-032 stale refresh).
        expect(env.FOOD_NOT_FOUND_TTL_DAYS).toBe(30);
        expect(env.FOOD_UNRESOLVED_TTL_DAYS).toBe(30);
        expect(env.FOOD_STALE_THRESHOLD_DAYS).toBe(30);
        // Worker lease + scaling (FR-018).
        expect(env.FOOD_LEASE_TIMEOUT_SECONDS).toBe(30);
        expect(env.FOOD_WORKER_DESIRED_COUNT).toBe(1);
    });

    it('keeps the source credentials at the adapter boundary (USDA_API_KEY / USDA_API_BASE_URL only)', () => {
        const env = EnvironmentSchema.parse(VALID_ENV);

        expect(env.USDA_API_KEY).toBe('test-usda-key');
        expect(env.USDA_API_BASE_URL).toBe('https://api.nal.usda.gov/fdc/v1');

        // No USDA-named OPERATIONAL knob is part of the config surface (re-baseline: source-agnostic).
        const usdaOperationalKeys = Object.keys(env).filter(
            (key) => key.startsWith('USDA_') && key !== 'USDA_API_KEY' && key !== 'USDA_API_BASE_URL',
        );
        expect(usdaOperationalKeys).toEqual([]);
    });

    it('coerces numeric overrides supplied as strings (env vars are always strings)', () => {
        const env = EnvironmentSchema.parse({
            ...VALID_ENV,
            FOOD_SOURCE_RATE_LIMIT_PER_HOUR: '500',
            FOOD_LEASE_TIMEOUT_SECONDS: '45',
            FOOD_MAX_QUEUE_DEPTH: '25',
            FOOD_DEMOTE_THRESHOLD: '5',
        });

        expect(env.FOOD_SOURCE_RATE_LIMIT_PER_HOUR).toBe(500);
        expect(env.FOOD_LEASE_TIMEOUT_SECONDS).toBe(45);
        expect(env.FOOD_MAX_QUEUE_DEPTH).toBe(25);
        expect(env.FOOD_DEMOTE_THRESHOLD).toBe(5);
    });

    it('rejects a non-positive rate-limit cap and a zero lease timeout (bad values)', () => {
        expect(EnvironmentSchema.safeParse({ ...VALID_ENV, FOOD_SOURCE_RATE_LIMIT_PER_HOUR: '0' }).success).toBe(false);
        expect(EnvironmentSchema.safeParse({ ...VALID_ENV, FOOD_SOURCE_RATE_LIMIT_PER_HOUR: '-1' }).success).toBe(
            false,
        );
        expect(EnvironmentSchema.safeParse({ ...VALID_ENV, FOOD_LEASE_TIMEOUT_SECONDS: '0' }).success).toBe(false);
        expect(EnvironmentSchema.safeParse({ ...VALID_ENV, FOOD_MAX_QUEUE_DEPTH: 'lots' }).success).toBe(false);
    });
});

describe('EnvironmentSchema — auth + DoS-shedder config (FR-039/FR-042/FR-052)', () => {
    it('treats CLERK_JWT_KEY / CLERK_AUTHORIZED_PARTIES as optional non-secret config (guard fails closed)', () => {
        // The /health probe boots without auth config; the guard fails closed (401) when the key is
        // absent, so these are validated-when-present but never boot-required.
        const env = EnvironmentSchema.parse(VALID_ENV);
        expect(env.CLERK_JWT_KEY).toBeUndefined();
        expect(env.CLERK_AUTHORIZED_PARTIES).toBeUndefined();

        const withAuth = EnvironmentSchema.parse({
            ...VALID_ENV,
            CLERK_JWT_KEY: '-----BEGIN PUBLIC KEY-----\nabc\n-----END PUBLIC KEY-----',
            CLERK_AUTHORIZED_PARTIES: 'https://app.example.com,svc-import',
        });
        expect(withAuth.CLERK_JWT_KEY).toContain('BEGIN PUBLIC KEY');
        expect(withAuth.CLERK_AUTHORIZED_PARTIES).toBe('https://app.example.com,svc-import');
    });

    it('validates the FOOD_AUTH_* shedder knobs when present, and rejects non-positive values', () => {
        const env = EnvironmentSchema.parse({
            ...VALID_ENV,
            FOOD_AUTH_MAX_CONCURRENT_VERIFICATIONS: '64',
            FOOD_AUTH_SHED_THRESHOLD: '100',
            FOOD_AUTH_SHED_WINDOW_MS: '10000',
        });
        expect(env.FOOD_AUTH_MAX_CONCURRENT_VERIFICATIONS).toBe(64);
        expect(env.FOOD_AUTH_SHED_THRESHOLD).toBe(100);
        expect(env.FOOD_AUTH_SHED_WINDOW_MS).toBe(10_000);

        expect(EnvironmentSchema.safeParse({ ...VALID_ENV, FOOD_AUTH_SHED_THRESHOLD: '0' }).success).toBe(false);
    });
});

describe('EnvironmentSchema — azp enforcement mode', () => {
    it('rejects setting BOTH the azp list and the preview pattern (ambiguous)', () => {
        const result = EnvironmentSchema.safeParse({
            ...VALID_ENV,
            CLERK_AUTHORIZED_PARTIES: 'https://app.commise.app',
            CLERK_AZP_PATTERN: 'sandbox.commise.app',
        });

        expect(result.success).toBe(false);
    });

    it("rejects CLERK_AZP_PATTERN on the 'prod' stage (prod uses exact-match)", () => {
        const result = EnvironmentSchema.safeParse({
            ...VALID_ENV,
            STAGE: 'prod',
            CLERK_AZP_PATTERN: 'sandbox.commise.app',
        });

        expect(result.success).toBe(false);
    });

    it('accepts pattern-only on a non-prod stage, and neither (azp is optional by design)', () => {
        expect(EnvironmentSchema.safeParse({ ...VALID_ENV, CLERK_AZP_PATTERN: 'sandbox.commise.app' }).success).toBe(
            true,
        );
        // Food keeps azp optional — neither set is allowed (the guard fails closed at runtime).
        expect(EnvironmentSchema.safeParse({ ...VALID_ENV }).success).toBe(true);
    });
});

describe('resolveEnvironment', () => {
    it('parses process.env (smoke: returns the validated env when the required vars are present)', () => {
        const saved = { ...process.env };
        try {
            process.env['DATABASE_URL'] = VALID_ENV.DATABASE_URL;
            process.env['USDA_API_KEY'] = VALID_ENV.USDA_API_KEY;
            const env = resolveEnvironment();
            expect(env.FOOD_SOURCE_RATE_LIMIT_PER_HOUR).toBe(1000);
        } finally {
            process.env = saved;
        }
    });
});

/**
 * T-199(a) — `FOOD_DEMOTE_THRESHOLD` is consumed OUTSIDE the NestJS injector (the drain-time demotion
 * lives in `FetchQueueDao`, which the Fargate worker constructs with `new`), so it needs a reader that
 * shares ONE default + ONE validation rule with {@link EnvironmentSchema}. Before this existed the
 * threshold was hardcoded in the DAO and read with a bare `Number()` in the admission service, so a
 * tuned value had no effect on the drain and a malformed one degraded to `NaN` (which silently disables
 * the near-ceiling flood-shed, because every `pending > NaN` comparison is `false`).
 */
describe('demoteThresholdFromEnv', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('defaults to the schema default (50) when FOOD_DEMOTE_THRESHOLD is unset', () => {
        vi.stubEnv('FOOD_DEMOTE_THRESHOLD', undefined);

        expect(demoteThresholdFromEnv()).toBe(50);
        // The same default the boot-time validation applies — one source of truth, not two literals.
        expect(EnvironmentSchema.parse(VALID_ENV).FOOD_DEMOTE_THRESHOLD).toBe(demoteThresholdFromEnv());
    });

    it('returns the operator-configured value (env vars arrive as strings)', () => {
        vi.stubEnv('FOOD_DEMOTE_THRESHOLD', '7');

        expect(demoteThresholdFromEnv()).toBe(7);
    });

    it.each(['fifty', '', '0', '-1', '2.5'])('throws on the malformed value %o rather than yielding NaN', (value) => {
        vi.stubEnv('FOOD_DEMOTE_THRESHOLD', value);

        expect(() => demoteThresholdFromEnv()).toThrow(/FOOD_DEMOTE_THRESHOLD/);
    });
});
