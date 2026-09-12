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
import { generateKeyPairSync, randomBytes } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

import {
    EnvironmentSchema,
    FOOD_SETTING_SCHEMAS,
    type FoodSettingName,
    parseRemoteSearchSettings,
    REMOTE_SEARCH_VARIABLES,
    resolveEnvironment,
    settingFromEnv,
} from '../env.schema.js';
import type * as SourceRegisterModule from '../../sources/sourceRegister.js';
import { FOOD_LEASE_FLOOR_SECONDS, PRODUCTION_BUDGET, worstCaseClaimSeconds } from '../../worker/leaseWindow.js';

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

        // No limit override: every source runs at its declared limit (ADR-0053 §1, §6).
        expect(env.FOOD_SOURCE_LIMIT_OVERRIDES).toEqual({});
        // Fairness-by-demotion (FR-043).
        expect(env.FOOD_DEMOTE_THRESHOLD).toBe(50);
        expect(env.FOOD_MAX_BATCH_NAMES).toBe(100);
        // TTLs (FR-025 NOT_FOUND tombstone, FR-025a UNRESOLVED candidate set, FR-032 stale refresh).
        expect(env.FOOD_NOT_FOUND_TTL_DAYS).toBe(30);
        expect(env.FOOD_UNRESOLVED_TTL_DAYS).toBe(30);
        expect(env.FOOD_STALE_THRESHOLD_DAYS).toBe(30);
        // Worker lease (FR-018). The Fargate TASK COUNTS are deliberately absent: `FOOD_DESIRED_COUNT` /
        // `FOOD_WORKER_DESIRED_COUNT` are consumed only by the CDK app at synth time and never reach a
        // container, so they are defined and validated in `infra/lib/synthEnv.ts` instead of here.
        expect(env.FOOD_LEASE_TIMEOUT_SECONDS).toBe(FOOD_LEASE_FLOOR_SECONDS);
    });

    /**
     * ⛔ REWRITTEN from `toBe(30)` (U5/R16). The literal 30 was not merely a stale number — it was SHORTER
     * THAN THE WORK IT WAS LEASING. One fan-out may issue twenty-two source requests that each hang for
     * the client timeout, so the reaper reverted rows mid-fetch, a second claim loop took them, and USDA
     * was asked for the same food twice. The default now comes from `worker/leaseWindow.ts`, and these two
     * assertions are what stop it drifting back.
     *
     * ⚠️ The schema does NOT import the derivation, and that is deliberate: this module is SOURCE-AGNOSTIC
     * by design (see its docstring — no USDA-named operational config), and `leaseWindow.ts` reads USDA's
     * page size, batch cap and request timeout from the client that enforces them. Binding the literal to
     * the derivation HERE keeps both rules: the schema stays a plain number, and a change to USDA's shape
     * fails this test rather than silently shortening every lease in production.
     */
    it('⛔ leases for LONGER than the worst case a single claim can legitimately take (R16)', () => {
        const env = EnvironmentSchema.parse(VALID_ENV);

        expect(env.FOOD_LEASE_TIMEOUT_SECONDS).toBeGreaterThan(worstCaseClaimSeconds(PRODUCTION_BUDGET));
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

    // A value test cannot tell a copy of the register's URL from the register's URL, so the register is given a
    // different one: the default must follow it.
    it("defaults USDA_API_BASE_URL to the source register's USDA base URL, its one authority", async () => {
        const registerUrl = 'https://register.example/fdc/v1';

        vi.resetModules();
        vi.doMock('../../sources/sourceRegister.js', async (importOriginal) => {
            const actual = await importOriginal<typeof SourceRegisterModule>();
            const apiAccessOf: typeof actual.apiAccessOf = (id) =>
                id === 'usda' ? { ...actual.apiAccessOf(id), baseUrl: registerUrl } : actual.apiAccessOf(id);

            return { ...actual, apiAccessOf };
        });

        try {
            const reloaded = await import('../env.schema.js');

            expect(reloaded.EnvironmentSchema.parse(VALID_ENV).USDA_API_BASE_URL).toBe(registerUrl);
        } finally {
            vi.doUnmock('../../sources/sourceRegister.js');
            vi.resetModules();
        }
    });

    it('coerces numeric overrides supplied as strings (env vars are always strings)', () => {
        const env = EnvironmentSchema.parse({
            ...VALID_ENV,
            FOOD_LEASE_TIMEOUT_SECONDS: '45',
            FOOD_MAX_BATCH_NAMES: '25',
            FOOD_DEMOTE_THRESHOLD: '5',
        });

        expect(env.FOOD_LEASE_TIMEOUT_SECONDS).toBe(45);
        expect(env.FOOD_MAX_BATCH_NAMES).toBe(25);
        expect(env.FOOD_DEMOTE_THRESHOLD).toBe(5);
    });

    it('rejects a zero lease timeout and a non-numeric batch cap (bad values)', () => {
        expect(EnvironmentSchema.safeParse({ ...VALID_ENV, FOOD_LEASE_TIMEOUT_SECONDS: '0' }).success).toBe(false);
        expect(EnvironmentSchema.safeParse({ ...VALID_ENV, FOOD_MAX_BATCH_NAMES: 'lots' }).success).toBe(false);
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

        expect(resolveEnvironment().FOOD_SOURCE_LIMIT_OVERRIDES).toEqual({});
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
        expect(SETTING_NAMES).toContain('FOOD_DEMOTE_THRESHOLD');
        expect(SETTING_NAMES).toContain('FOOD_SOURCE_LIMIT_OVERRIDES');
        expect(SETTING_NAMES).toContain('FOOD_WORKER_CONCURRENCY');
        expect(SETTING_NAMES).toContain('PORT');
        // The DB block is a union (`DATABASE_URL` OR the discrete `DB_*` parts), so it is deliberately NOT
        // a per-variable setting — `database/poolConfig.ts` owns that either/or contract.
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
        vi.stubEnv('FOOD_MAX_BATCH_NAMES', 'lots');

        expect(() => settingFromEnv('FOOD_MAX_BATCH_NAMES')).toThrow(/FOOD_MAX_BATCH_NAMES/);
        expect(() => settingFromEnv('FOOD_MAX_BATCH_NAMES')).toThrow(/lots/);
    });

    /**
     * T-199(a) — `FOOD_DEMOTE_THRESHOLD` sets the worker's drain-time demotion (FR-043; `FetchQueueDao`,
     * constructed with `new` by the Fargate worker — no injector, no boot validation). A `NaN` here made every
     * `pending > NaN` comparison `false`, silently disabling demotion.
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

/**
 * `FOOD_SOURCE_LIMIT_OVERRIDES` (ADR-0053 §6) replaced `FOOD_SOURCE_RATE_LIMIT_PER_HOUR` and
 * `FOOD_SOURCE_WINDOW_SECONDS`. An override may only lower a declared limit, and one that raises it is refused at
 * BOOT, so no stage can start with a limit above what the publisher allows.
 */
describe('EnvironmentSchema — per-source limit overrides', () => {
    it('reads a lowering override keyed by source id', () => {
        const env = EnvironmentSchema.parse({
            ...VALID_ENV,
            FOOD_SOURCE_LIMIT_OVERRIDES: '{"usda":{"requests":15,"windowSeconds":60}}',
        });

        expect(env.FOOD_SOURCE_LIMIT_OVERRIDES).toEqual({ usda: { requests: 15, windowSeconds: 60 } });
    });

    it.each([
        ['raises USDA past its declared 1,000 an hour', '{"usda":{"requests":2000,"windowSeconds":3600}}'],
        ['names a file source, which nothing calls', '{"livsmedelsverket":{"requests":1,"windowSeconds":60}}'],
        ['is not JSON', '15'],
    ])('refuses at boot an override that %s', (_, value) => {
        const parsed = EnvironmentSchema.safeParse({ ...VALID_ENV, FOOD_SOURCE_LIMIT_OVERRIDES: value });

        expect(parsed.success).toBe(false);
        expect(parsed.error?.issues[0]?.path).toEqual(['FOOD_SOURCE_LIMIT_OVERRIDES']);
    });

    it('no longer reads the retired source-agnostic variables', () => {
        const env = EnvironmentSchema.parse({
            ...VALID_ENV,
            FOOD_SOURCE_RATE_LIMIT_PER_HOUR: '5000',
            FOOD_SOURCE_WINDOW_SECONDS: '60',
        });

        expect(env).not.toHaveProperty('FOOD_SOURCE_RATE_LIMIT_PER_HOUR');
        expect(env).not.toHaveProperty('FOOD_SOURCE_WINDOW_SECONDS');
        expect(env.FOOD_SOURCE_LIMIT_OVERRIDES).toEqual({});
    });
});

/**
 * The remote search service's settings (ADR-0055 points 3, 7 and 10): its CDN origin, the key that signs every request
 * to it, and the key that seals the reference a remote hit carries. A deployed stage sets all four or none; one set
 * alone is a deploy fault, refused at boot. Two of them are secrets, so a refusal names the variable and never quotes
 * its value.
 */
describe('parseRemoteSearchSettings', () => {
    const { privateKey: RSA_PEM } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    const { privateKey: EC_PEM } = generateKeyPairSync('ec', {
        namedCurve: 'P-256',
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    const REFERENCE_KEY = randomBytes(32).toString('base64url');
    const CONFIGURED = {
        REMOTE_SEARCH_ORIGIN: 'https://d111111abcdef8.cloudfront.net',
        REMOTE_SEARCH_KEY_PAIR_ID: 'K2JCJMDEHXQW5F',
        REMOTE_SEARCH_SIGNING_KEY: RSA_PEM,
        FOOD_REMOTE_REFERENCE_KEY: REFERENCE_KEY,
    } as const;

    /**
     * The message a refusal throws.
     *
     * @param env - The environment.
     * @returns The message.
     */
    function refusalOf(env: Readonly<Record<string, string | undefined>>): string {
        try {
            parseRemoteSearchSettings(env);
        } catch (error) {
            return error instanceof Error ? error.message : String(error);
        }

        throw new Error('expected a refusal');
    }

    it('names exactly the four variables, so the infra stack and this reader share one list', () => {
        expect([...REMOTE_SEARCH_VARIABLES].sort()).toEqual(Object.keys(CONFIGURED).sort());
    });

    it('is absent when none of the four is set, which is how local development and most suites run', () => {
        expect(parseRemoteSearchSettings({ STAGE: 'dev' })).toEqual({ kind: 'absent' });
    });

    it('treats a blank value as unset, as an empty ECS variable would arrive', () => {
        expect(
            parseRemoteSearchSettings({
                REMOTE_SEARCH_ORIGIN: '',
                REMOTE_SEARCH_KEY_PAIR_ID: '',
                REMOTE_SEARCH_SIGNING_KEY: '',
                FOOD_REMOTE_REFERENCE_KEY: '',
            }),
        ).toEqual({ kind: 'absent' });
    });

    it('parses all four into typed values: the origin alone, the PEM as given, the 32 key bytes', () => {
        const settings = parseRemoteSearchSettings(CONFIGURED);

        expect(settings.kind).toBe('configured');

        if (settings.kind !== 'configured') {
            return;
        }

        expect(settings.origin).toBe('https://d111111abcdef8.cloudfront.net');
        expect(settings.keyPairId).toBe('K2JCJMDEHXQW5F');
        expect(settings.signingKey).toBe(RSA_PEM);
        expect(Buffer.from(settings.referenceKey).toString('base64url')).toBe(REFERENCE_KEY);
        expect(settings.referenceKey).toHaveLength(32);
    });

    it('accepts plain http on a loopback host, so a local stand-in can be the origin', () => {
        const settings = parseRemoteSearchSettings({ ...CONFIGURED, REMOTE_SEARCH_ORIGIN: 'http://127.0.0.1:45001' });

        expect(settings.kind === 'configured' && settings.origin).toBe('http://127.0.0.1:45001');
    });

    it.each(Object.keys(CONFIGURED))('refuses a partial set with %s missing, naming it and the fix', (missing) => {
        const message = refusalOf({ ...CONFIGURED, [missing]: undefined });

        expect(message).toBe(`Remote search is partly configured: set ${missing}, or unset all four.`);
    });

    it.each(Object.keys(CONFIGURED))('refuses %s set alone, naming the three it lacks', (present) => {
        const only = { [present]: CONFIGURED[present as keyof typeof CONFIGURED] };
        const message = refusalOf(only);

        for (const missing of Object.keys(CONFIGURED).filter((name) => name !== present)) {
            expect(message).toContain(missing);
        }
    });

    it.each<[string, string, string]>([
        ['an origin over plain http', 'REMOTE_SEARCH_ORIGIN', 'http://d111111abcdef8.cloudfront.net'],
        [
            'an origin over plain http to a host that only looks local',
            'REMOTE_SEARCH_ORIGIN',
            'http://127.0.0.1.example.com',
        ],
        ['an origin with a path', 'REMOTE_SEARCH_ORIGIN', 'https://d111111abcdef8.cloudfront.net/v1'],
        ['an origin with a query', 'REMOTE_SEARCH_ORIGIN', 'https://d111111abcdef8.cloudfront.net/?a=1'],
        ['an origin that is not a URL', 'REMOTE_SEARCH_ORIGIN', 'd111111abcdef8.cloudfront.net'],
        ['a key pair id in lower case', 'REMOTE_SEARCH_KEY_PAIR_ID', 'k2jcjmdehxqw5f'],
        ['a signing key that is not PEM', 'REMOTE_SEARCH_SIGNING_KEY', 'not-a-key'],
        ['a signing key that is not RSA', 'REMOTE_SEARCH_SIGNING_KEY', EC_PEM],
        ['a reference key of 16 bytes', 'FOOD_REMOTE_REFERENCE_KEY', randomBytes(16).toString('base64url')],
        ['a reference key of 33 bytes', 'FOOD_REMOTE_REFERENCE_KEY', randomBytes(33).toString('base64url')],
        ['a reference key in standard base64', 'FOOD_REMOTE_REFERENCE_KEY', `${REFERENCE_KEY.slice(0, 42)}+`],
    ])('refuses %s, naming the variable', (_label, name, value) => {
        expect(refusalOf({ ...CONFIGURED, [name]: value })).toContain(name);
    });

    it('never quotes a secret in a refusal: neither key, nor any value, reaches the message', () => {
        const partial = refusalOf({ ...CONFIGURED, REMOTE_SEARCH_ORIGIN: undefined });
        const malformedKey = refusalOf({ ...CONFIGURED, REMOTE_SEARCH_SIGNING_KEY: EC_PEM });
        const malformedReference = refusalOf({ ...CONFIGURED, FOOD_REMOTE_REFERENCE_KEY: `${REFERENCE_KEY}x` });

        for (const message of [partial, malformedKey, malformedReference]) {
            expect(message).not.toContain('PRIVATE KEY');
            expect(message).not.toContain(REFERENCE_KEY);
            expect(message).not.toContain(CONFIGURED.REMOTE_SEARCH_KEY_PAIR_ID);
        }
    });
});
