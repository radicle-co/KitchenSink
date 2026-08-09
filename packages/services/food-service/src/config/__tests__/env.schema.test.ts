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

import {
    EnvironmentSchema,
    FOOD_SETTING_SCHEMAS,
    type FoodSettingName,
    resolveEnvironment,
    settingFromEnv,
} from '../env.schema.js';

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
        // Worker lease (FR-018). The Fargate TASK COUNTS are deliberately absent: `FOOD_DESIRED_COUNT` /
        // `FOOD_WORKER_DESIRED_COUNT` are consumed only by the CDK app at synth time and never reach a
        // container, so they are defined and validated in `infra/lib/synth-env.ts` instead of here.
        expect(env.FOOD_LEASE_TIMEOUT_SECONDS).toBe(30);
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
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    // Mutates through `vi.stubEnv` and NEVER by reassigning `process.env`: a whole-object replacement
    // detaches the runner's env-stub machinery, after which `vi.stubEnv(name, undefined)` silently stops
    // deleting and `vi.unstubAllEnvs()` silently stops restoring — poisoning every later test in the file
    // (measured: three `settingFromEnv` cases below saw a leaked value from an earlier case).
    it('parses process.env (smoke: returns the validated env when the required vars are present)', () => {
        vi.stubEnv('DATABASE_URL', VALID_ENV.DATABASE_URL);
        vi.stubEnv('USDA_API_KEY', VALID_ENV.USDA_API_KEY);

        expect(resolveEnvironment().FOOD_SOURCE_RATE_LIMIT_PER_HOUR).toBe(1000);
    });
});

/**
 * `settingFromEnv` — the ONE validated reader for a single food setting, replacing the per-variable
 * `*FromEnv()` copies (T-199a/c) and the hand-rolled `Number(process.env[...] ?? DEFAULT)` reads scattered
 * across the DAOs, the workers, and the API entrypoint.
 *
 * Why it exists: most of this service's settings are consumed OUTSIDE the NestJS injector (both Fargate
 * entrypoints, the DAOs the worker constructs with `new`), where no `ConfigService` and no boot-time
 * validation is in play. A bare `Number()` there turns a malformed value into `NaN`, and every comparison
 * against `NaN` is `false` — so a safety control does not tighten, it DISAPPEARS, with no error and no log.
 *
 * The invariant these tests defend is stronger than "it throws": the reader resolves each variable through
 * the SAME schema node {@link EnvironmentSchema} validates it with, so the boot check and the runtime read
 * can NEVER disagree about a default or a rule. The property tests below assert that mechanically, over
 * EVERY declared setting — a reader with its own private copy of any rule cannot pass them.
 */
describe('settingFromEnv', () => {
    /** Every setting the boot-time schema declares — read from the registry, never re-listed by hand. */
    const SETTING_NAMES = Object.keys(FOOD_SETTING_SCHEMAS) as FoodSettingName[];

    /**
     * Values chosen to straddle every rule in the schema: blank, non-numeric, zero, negative, fractional,
     * the two coercion traps (`NaN`/`Infinity` are numbers to `Number()` but not integers), a valid
     * positive integer, and a URL (the only shape `USDA_API_BASE_URL` accepts).
     */
    const CANDIDATES = ['', 'lots', '0', '-1', '2.5', '7', 'NaN', 'Infinity', 'https://example.com/v1'] as const;

    /** Index a parsed environment by a dynamic setting name (the parsed type has no index signature). */
    function settingOf(env: unknown, name: FoodSettingName): unknown {
        return (env as Record<string, unknown>)[name];
    }

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('covers the whole declared setting surface (a new schema field is readable without new code)', () => {
        expect(SETTING_NAMES).toContain('FOOD_MAX_QUEUE_DEPTH');
        expect(SETTING_NAMES).toContain('FOOD_SOURCE_WINDOW_SECONDS');
        expect(SETTING_NAMES).toContain('FOOD_WORKER_CONCURRENCY');
        expect(SETTING_NAMES).toContain('PORT');
        // The DB block is a union (`DATABASE_URL` OR the discrete `DB_*` parts), so it is deliberately NOT
        // a per-variable setting — `database/pool-config.ts` owns that either/or contract.
        expect(SETTING_NAMES).not.toContain('DATABASE_URL');
        expect(SETTING_NAMES).not.toContain('DB_PORT');
    });

    it.each(SETTING_NAMES)('%s — an unset variable yields exactly the default the boot-time schema applies', (name) => {
        vi.stubEnv(name, undefined);

        const booted = EnvironmentSchema.safeParse({ ...VALID_ENV, [name]: undefined });

        if (!booted.success) {
            // No default and no `.optional()` (e.g. USDA_API_KEY): the reader must fail closed too,
            // naming the variable, rather than hand back `undefined` for a required credential.
            expect(() => settingFromEnv(name)).toThrow(new RegExp(name));

            return;
        }

        expect(settingFromEnv(name)).toEqual(settingOf(booted.data, name));
    });

    it.each(SETTING_NAMES)('%s — accepts and rejects exactly what the boot-time schema does', (name) => {
        for (const value of CANDIDATES) {
            vi.stubEnv(name, value);

            const booted = EnvironmentSchema.safeParse({ ...VALID_ENV, [name]: value });

            if (booted.success) {
                // Accepted: the reader must also return the SAME coerced value, not merely not-throw.
                expect(settingFromEnv(name)).toEqual(settingOf(booted.data, name));
            } else {
                // Rejected: a loud failure that names the offending variable, never a silent fallback.
                expect(() => settingFromEnv(name)).toThrow(new RegExp(name));
            }
        }
    });

    it('names the variable AND quotes the offending value, so the operator can find the typo', () => {
        vi.stubEnv('FOOD_MAX_QUEUE_DEPTH', 'lots');

        expect(() => settingFromEnv('FOOD_MAX_QUEUE_DEPTH')).toThrow(/FOOD_MAX_QUEUE_DEPTH/);
        expect(() => settingFromEnv('FOOD_MAX_QUEUE_DEPTH')).toThrow(/lots/);
    });

    /**
     * T-199(a) — `FOOD_DEMOTE_THRESHOLD` gates BOTH halves of FR-043 fairness: the API's near-ceiling
     * flood-shed (`AdmissionService`) and the worker's drain-time demotion (`FetchQueueDao`, constructed
     * with `new` by the Fargate worker — no injector, no boot validation). A `NaN` here made every
     * `pending > NaN` comparison `false`, silently disabling the shed.
     */
    describe('FOOD_DEMOTE_THRESHOLD (FR-043/FR-043b)', () => {
        it('defaults to the schema default when unset — one source of truth, not two literals', () => {
            vi.stubEnv('FOOD_DEMOTE_THRESHOLD', undefined);

            expect(settingFromEnv('FOOD_DEMOTE_THRESHOLD')).toBe(
                EnvironmentSchema.parse(VALID_ENV).FOOD_DEMOTE_THRESHOLD,
            );
        });

        it('returns the operator-configured value (env vars arrive as strings)', () => {
            vi.stubEnv('FOOD_DEMOTE_THRESHOLD', '7');

            expect(settingFromEnv('FOOD_DEMOTE_THRESHOLD')).toBe(7);
        });

        it.each(['fifty', '', '0', '-1', '2.5'])(
            'throws on the malformed value %o rather than yielding NaN',
            (value) => {
                vi.stubEnv('FOOD_DEMOTE_THRESHOLD', value);

                expect(() => settingFromEnv('FOOD_DEMOTE_THRESHOLD')).toThrow(/FOOD_DEMOTE_THRESHOLD/);
            },
        );
    });

    /**
     * T-199(c) — `FOOD_MAX_QUEUE_DEPTH` is the FR-046 hard ceiling, the `503` backpressure backstop. `NaN`
     * does not raise that ceiling, it REMOVES it: every `depth >= NaN` is `false`, so the service accepts
     * unbounded enqueues behind no error and no log.
     */
    describe('FOOD_MAX_QUEUE_DEPTH (FR-046)', () => {
        it('defaults to the schema default when unset — one source of truth, not two literals', () => {
            vi.stubEnv('FOOD_MAX_QUEUE_DEPTH', undefined);

            expect(settingFromEnv('FOOD_MAX_QUEUE_DEPTH')).toBe(
                EnvironmentSchema.parse(VALID_ENV).FOOD_MAX_QUEUE_DEPTH,
            );
        });

        it('returns the operator-configured value (env vars arrive as strings)', () => {
            vi.stubEnv('FOOD_MAX_QUEUE_DEPTH', '250');

            expect(settingFromEnv('FOOD_MAX_QUEUE_DEPTH')).toBe(250);
        });

        it.each(['lots', '', '0', '-1', '2.5', 'NaN', 'Infinity'])(
            'throws on the malformed value %o rather than yielding NaN',
            (value) => {
                vi.stubEnv('FOOD_MAX_QUEUE_DEPTH', value);

                expect(() => settingFromEnv('FOOD_MAX_QUEUE_DEPTH')).toThrow(/FOOD_MAX_QUEUE_DEPTH/);
            },
        );
    });

    /**
     * `FOOD_WORKER_CONCURRENCY` is the one setting whose ABSENCE is meaningful: unset means "size the
     * drainer off the container's vCPUs" (see `worker/concurrency.ts`), so the reader must hand back
     * `undefined` rather than a stand-in default — while still refusing a malformed value.
     */
    describe('FOOD_WORKER_CONCURRENCY (an optional setting with no default)', () => {
        it('is undefined when unset, so the caller can tell "unset" from "set to a number"', () => {
            vi.stubEnv('FOOD_WORKER_CONCURRENCY', undefined);

            expect(settingFromEnv('FOOD_WORKER_CONCURRENCY')).toBeUndefined();
        });

        it('still refuses a malformed value instead of degrading it to "unset"', () => {
            vi.stubEnv('FOOD_WORKER_CONCURRENCY', 'eight');

            expect(() => settingFromEnv('FOOD_WORKER_CONCURRENCY')).toThrow(/FOOD_WORKER_CONCURRENCY/);
        });
    });
});
