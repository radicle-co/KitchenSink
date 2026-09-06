/**
 * PER-RUN Clerk fixture identity — the derivation, and the cleanup rules built on it.
 *
 * WHY THIS EXISTS (a structural CI bug, not bad luck). The suite used to provision ONE FIXED sign-in
 * fixture (`commise-e2e-signin+clerk_test@example.com`) and tear down with "delete every `commise-e2e*`
 * user on the instance". The sandbox Clerk instance is SHARED, and two pipelines (`ci-pr.yml` and
 * `heavy-e2e.yml`) both called the same reusable `_ci.yml`, so a labelled PR ran `e2e-web` TWICE
 * concurrently on the same commit. Whichever run finished first deleted the other's LIVE fixture, and
 * the loser failed with `test sign-in user is missing — globalSetup should have created it`. Proof:
 * commit bbf7ea7c — `CI — PR (sandbox)`'s e2e-web passed 78/1 while `Heavy E2E`'s identical job failed.
 * A shared, fixed USERNAME was the same bug's second face: concurrent `createUser` calls raced on a
 * per-instance uniqueness constraint.
 *
 * THE FIX, in two halves:
 *   1. Every run derives its OWN fixture identity from a RUN KEY (this module), so two concurrent runs
 *      cannot address the same Clerk user.
 *   2. Teardown deletes only what THIS run created, plus an AGE-GATED sweep of leaked users from
 *      crashed runs — old enough that no live run could still own them
 *      ({@link LEAKED_FIXTURE_MAX_AGE_MS}).
 *
 * `+clerk_test` addressing is preserved on every derived address: it is what makes Clerk treat the
 * account as a test user (no real mailbox, and the fixed `424242` verification code the sign-in specs
 * and the Maestro flow type). The unique part goes in the local part BEFORE the `+clerk_test` tag, so
 * the tag's semantics are untouched.
 */
import { createHash } from 'node:crypto';

/**
 * The FIXED, long-lived fixture the MOBILE Maestro flows sign in as
 * (`packages/apps/commise/mobile/tests/e2e/ensure-signin-user.mjs`, typed as LITERAL TEXT by
 * `.maestro/auth/signin-home.yaml`). It is deliberately NOT run-scoped — an on-device flow cannot derive
 * an address — so the web suite must never delete it, and its provisioner is idempotent + concurrency-safe
 * instead. Every rule here is written so it CANNOT match: the run-scoped shapes all carry a `-` separator
 * after `signin`/`signup`, which this address does not have. Asserted in the unit tests.
 */
export const MAESTRO_SHARED_FIXTURE_EMAIL = 'commise-e2e-signin+clerk_test@example.com';

/** Local-part prefix shared by every e2e user — the Clerk `query` the cleanup list call filters on. */
export const E2E_USER_QUERY = 'commise-e2e';

/**
 * Age at which a leftover run-scoped e2e user is provably NOT owned by a live run and may be swept.
 *
 * A run's fixture is created in `globalSetup`, so its age can never exceed the job's own wall clock, and
 * a GitHub Actions job is HARD-CAPPED at 6 hours. 12h is therefore 2x the longest possible live-run age
 * — no reachable trigger (nightly heavy run, weekly load run, ad-hoc dispatch) can put a LIVE fixture
 * anywhere near it — while still reclaiming crashed-run leaks within a day, which is what keeps the
 * single-page cleanup list call sufficient.
 */
export const LEAKED_FIXTURE_MAX_AGE_MS = 12 * 60 * 60 * 1_000;

/**
 * Max run-key length. Budget (RFC 5321 caps an email local part at 64 chars, and Clerk caps a username
 * at 64): `commise-e2e-signup-` (19) + key (20) + `-` + unique (<=9) + `+clerk_test` (11) = 60, and
 * `commise_e2e_signin_` (19) + key (20) = 39. Both fit with room to spare.
 */
const MAX_RUN_KEY_LENGTH = 20;

/** The env slice the run key is derived from. Passed IN so the derivation stays pure and testable. */
export interface RunKeyEnv {
    /** Explicit override — how `globalSetup` pins one key for every process of the run. */
    readonly COMMISE_E2E_RUN_KEY?: string | undefined;
    readonly GITHUB_RUN_ID?: string | undefined;
    readonly GITHUB_RUN_ATTEMPT?: string | undefined;
    readonly GITHUB_JOB?: string | undefined;
    /**
     * This shard's index, when the job runs as a Playwright `--shard` matrix (`e2e-web` does, 4-way).
     *
     * `GITHUB_JOB` is the job's ID, NOT its matrix leg, so every shard of `e2e-web` sees the identical
     * `GITHUB_JOB` — and each shard is a separate Playwright process that runs `globalSetup` **and**
     * `globalTeardown`. Without this segment all four shards derive one key, and the first shard to finish
     * deletes the sign-in fixture the other three are still authenticating as (`planE2EUserCleanup`'s `own`
     * rule matches it). That is exactly bbf7ea7c's cross-workflow failure, reproduced inside a single run.
     *
     * Absent or blank leaves the key byte-identical to the unsharded derivation, so every other job and
     * every local run is untouched.
     */
    readonly COMMISE_E2E_SHARD?: string | undefined;
}

/** Lowercase, collapse everything outside `[a-z0-9]` to a single `-`, and trim the separators. */
function slug(raw: string): string {
    return raw
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/** Base36 a pure-numeric segment (an 11-digit GitHub run id becomes 7 chars) — lossless and shorter. */
function compact(segment: string): string {
    return /^[0-9]+$/.test(segment) ? Number(segment).toString(36) : segment;
}

/**
 * Clamp a key to {@link MAX_RUN_KEY_LENGTH} without ever aliasing two different inputs: an over-long key
 * keeps a readable head and ends in 8 hex of its own SHA-256, so the result stays deterministic (same
 * input → same key in every process of the run) AND collision-resistant.
 *
 * Hashing the WHOLE key (rather than truncating each segment) is deliberate: truncated segments alias —
 * `load-test` and `load-test-food`, or every `integration-*` job, would otherwise share a key.
 */
function clamp(key: string): string {
    if (key.length <= MAX_RUN_KEY_LENGTH) {
        return key;
    }

    const digest = createHash('sha256').update(key).digest('hex').slice(0, 8);

    return `${key.slice(0, MAX_RUN_KEY_LENGTH - digest.length - 1)}-${digest}`;
}

/**
 * Derive the run key that scopes this run's Clerk fixtures.
 *
 * Precedence:
 *   1. `COMMISE_E2E_RUN_KEY` — the propagation channel (`globalSetup` writes the resolved key back into
 *      the environment so Playwright's worker processes derive the identical identity) and the knob the
 *      concurrency proof uses to simulate two overlapping runs.
 *   2. `GITHUB_RUN_ID` + `GITHUB_RUN_ATTEMPT` + `GITHUB_JOB` (+ `COMMISE_E2E_SHARD`) — unique per workflow
 *      run, per re-run attempt, per job, AND per shard, so `e2e-web` and `e2e-mobile-maestro` in ONE run
 *      never share a fixture, and neither do two shards of `e2e-web`.
 *   3. `localSeed` — the caller's process-local, non-deterministic seed (pid + clock), for developer
 *      machines where none of the above exist.
 *
 * Pure: every input is an argument.
 */
export function deriveRunKey(env: RunKeyEnv, localSeed: string): string {
    const override = slug(env.COMMISE_E2E_RUN_KEY ?? '');

    if (override.length > 0) {
        return clamp(override);
    }

    const runId = slug(env.GITHUB_RUN_ID ?? '');

    if (runId.length > 0) {
        const attempt = compact(slug(env.GITHUB_RUN_ATTEMPT ?? '')) || '1';
        const job = slug(env.GITHUB_JOB ?? '') || 'job';
        // Appended only when present, so an UNSHARDED job's key is byte-identical to what it derived
        // before sharding existed — a shard segment must never renumber the mobile/k6/local fixtures.
        const shard = slug(env.COMMISE_E2E_SHARD ?? '');
        const suffix = shard.length > 0 ? `-s${shard}` : '';

        return clamp(`gh${compact(runId)}-${attempt}-${job}${suffix}`);
    }

    return clamp(slug(localSeed) || 'local');
}

/** This run's sign-in fixture address. `+clerk_test` is preserved; the run key precedes the tag. */
export function signInFixtureEmail(runKey: string): string {
    return `commise-e2e-signin-${runKey}+clerk_test@example.com`;
}

/**
 * This run's sign-in fixture username. The Clerk instance requires a username on every user and enforces
 * it UNIQUE per instance — a shared literal is what made two concurrent `createUser` calls race — so it
 * is run-scoped too. Underscores only (the charset Clerk accepts for usernames).
 */
export function signInFixtureUsername(runKey: string): string {
    return `commise_e2e_signin_${runKey.replace(/-/g, '_')}`;
}

/** A run-scoped, per-call-unique `+clerk_test` address for a one-off sign-UP spec. */
export function signUpEmail(runKey: string, unique: string): string {
    return `commise-e2e-signup-${runKey}-${slug(unique)}+clerk_test@example.com`;
}

/**
 * The AUXILIARY identities a deployed run needs beyond its signer.
 *
 * A single identity cannot express the world the Maestro flows assert:
 *
 *   - `author` owns a PUBLIC recipe the signer does not own. That is not a convenience — it is the entire
 *     premise of `recipes/discover-clone` (clone, then assert the owner-only `Edit recipe` appears on the
 *     COPY) and of `recipes/rating`, whose docblock says it exists "so the own-recipe gate, Sc8, is NOT
 *     engaged". No amount of seeding under one owner produces "a recipe you do not own".
 *   - `erasure` exists to be DELETED. `account-erasure` used to be answered by a runner-local stub, because
 *     a real call would have destroyed the shared fixture every later flow signs in as. Against a deployed
 *     stage the erasure is real, so it needs a subject of its own — and that subject is why the flow may
 *     safely run at all.
 */
export const AUXILIARY_ROLES = ['author', 'erasure'] as const;

/** One of {@link AUXILIARY_ROLES}. */
export type AuxiliaryRole = (typeof AUXILIARY_ROLES)[number];

/**
 * An auxiliary identity's address.
 *
 * ⛔ Derived THROUGH {@link signUpEmail} rather than as a new address shape, and that is the whole safety
 * argument rather than a shortcut. {@link isThisRunE2EEmail} and {@link isRunScopedE2EEmail} are the two
 * predicates that stop one run deleting another run's LIVE user; a fourth shape would mean editing them,
 * and editing them is exactly the change nobody should have to review under time pressure. Reusing the
 * sign-up shape means both auxiliary identities are own-matched and leak-swept with those predicates
 * UNTOUCHED — asserted in `runFixtureIdentity.test.ts`, in both directions.
 */
export function auxiliaryFixtureEmail(runKey: string, role: AuxiliaryRole): string {
    return signUpEmail(runKey, role);
}

/**
 * An auxiliary identity's username — run-scoped for the same reason {@link signInFixtureUsername} is:
 * Clerk enforces it unique per instance, and a shared literal is what made two concurrent `createUser`
 * calls race.
 */
export function auxiliaryFixtureUsername(runKey: string, role: AuxiliaryRole): string {
    return `commise_e2e_${role}_${runKey.replace(/-/g, '_')}`;
}

/** Shape of every run-scoped e2e address: `commise-e2e-{signin|signup}-<key>…+clerk_test@example.com`. */
const RUN_SCOPED_EMAIL = /^commise-e2e-(?:signin|signup)-.+\+clerk_test@example\.com$/;

/** True when the address was minted by {@link signInFixtureEmail} / {@link signUpEmail} for SOME run. */
export function isRunScopedE2EEmail(email: string): boolean {
    return RUN_SCOPED_EMAIL.test(email.toLowerCase());
}

/**
 * True when the address belongs to THIS run. Delimiter-aware, like the ADR-0005 `pr-{N}` match: the key
 * is followed by `+` (the sign-in fixture) or `-` (a sign-up user), so run key `abc` never claims run
 * key `abcd`'s users.
 */
export function isThisRunE2EEmail(email: string, runKey: string): boolean {
    const address = email.toLowerCase();

    return address === signInFixtureEmail(runKey) || address.startsWith(`commise-e2e-signup-${runKey}-`);
}

/** A Clerk user reduced to the facts the cleanup decision needs. */
export interface CleanupCandidate {
    readonly id: string;
    /** EVERY address on the user — a match on any one of them is a match. */
    readonly emails: readonly string[];
    /** Clerk `createdAt`, epoch ms. */
    readonly createdAtMs: number;
}

export interface CleanupContext {
    readonly runKey: string;
    readonly nowMs: number;
    readonly maxAgeMs: number;
}

/** Which users teardown deletes, split by the rule that selected them. */
export interface CleanupPlan {
    /** Created by THIS run — deleted unconditionally. */
    readonly ownFixtureIds: readonly string[];
    /** Run-scoped leftovers from OTHER runs, old enough that no live run can still own them. */
    readonly leakedIds: readonly string[];
}

/**
 * Decide, purely, which Clerk users this run's teardown may delete.
 *
 * The two rules are deliberately narrow, and they are the whole safety argument:
 *   - own: the address carries THIS run's key → this run created it → always safe to delete.
 *   - leaked: the address has the run-scoped SHAPE but another run's key, AND is older than `maxAgeMs`
 *     → older than a GitHub job can live, so it cannot belong to a run in flight.
 * Anything else — the fixed Maestro fixture, a human's account, an unrelated `commise-e2e`-ish name, a
 * concurrent run's FRESH fixture — is never returned.
 */
export function planE2EUserCleanup(users: readonly CleanupCandidate[], ctx: CleanupContext): CleanupPlan {
    const ownFixtureIds: string[] = [];
    const leakedIds: string[] = [];

    for (const user of users) {
        const emails = user.emails.map((email) => email.toLowerCase());

        if (emails.some((email) => isThisRunE2EEmail(email, ctx.runKey))) {
            ownFixtureIds.push(user.id);
            continue;
        }

        if (emails.some(isRunScopedE2EEmail) && ctx.nowMs - user.createdAtMs > ctx.maxAgeMs) {
            leakedIds.push(user.id);
        }
    }

    return { ownFixtureIds, leakedIds };
}

/**
 * Resolve this process's run key, and PIN it into the environment.
 *
 * Playwright runs `globalSetup` in the main process and the specs in worker processes, which inherit
 * `process.env` — so writing the resolved key back is what makes a locally-seeded key identical in
 * setup, in every worker, and in teardown. Idempotent: a second call returns the pinned value.
 *
 * @sideEffect Reads and writes `process.env['COMMISE_E2E_RUN_KEY']`; seeds from the pid + clock.
 */
export function resolveRunKey(): string {
    const runKey = deriveRunKey(
        {
            COMMISE_E2E_RUN_KEY: process.env['COMMISE_E2E_RUN_KEY'],
            GITHUB_RUN_ID: process.env['GITHUB_RUN_ID'],
            GITHUB_RUN_ATTEMPT: process.env['GITHUB_RUN_ATTEMPT'],
            GITHUB_JOB: process.env['GITHUB_JOB'],
            COMMISE_E2E_SHARD: process.env['COMMISE_E2E_SHARD'],
        },
        `local-${process.pid}-${Date.now().toString(36)}`,
    );

    process.env['COMMISE_E2E_RUN_KEY'] = runKey;

    return runKey;
}
