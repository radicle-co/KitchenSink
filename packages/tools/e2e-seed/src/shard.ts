/**
 * WHICH SHARD of WHICH PLATFORM's Maestro matrix this process belongs to — and the check that the two channels
 * carrying each of those facts have not drifted apart.
 *
 * ## Why there are two channels at all
 *
 * `COMMISE_E2E_SHARD` is the channel `deriveRunKey` already reads (`runFixtureIdentity.ts`), so it is what
 * makes two shards of one run scope their fixture TITLES differently; it is also what tells `provision` which
 * signer, co-author and erasure subject to lease. `--shard N` is the channel `resetPool` takes, because
 * `testPoolWorkflowWiring.test.ts` requires every reset of a per-shard lease to state its shard on the
 * command line — a lease that interpolates `matrix.shard` must hand that shard to its resets, or a reset
 * empties a slot another run holds.
 *
 * ⛔ Two channels for one fact is a drift hazard, and the drift is DESTRUCTIVE rather than merely wrong: a job
 * that reset shard 2's slots while provisioning shard 1's would purge a live run's world and leave its own
 * residue behind. So the channels are not merely both present — they are ASSERTED to agree, here, before the
 * first purge. This is the same posture ADR-0035 takes for the migration manifest: two independent
 * computations of one value, compared, rather than one value trusted twice.
 *
 * ## The platform is the same shape of fact (2026-10-13)
 *
 * Android and iOS have pool lanes of their own, so a (platform, shard) pair is what names a lane. `MAESTRO_PLATFORM` is
 * the environment channel (the runner's own `PLATFORMS` variable reads the same name, and its absent value is
 * `android`); `--platform` is the command-line channel `resetPool` and `poolAdmin` take. They are asserted to agree for
 * the reason the shard's are.
 *
 * @pattern Parse, don't validate — an unreadable or disagreeing shard or platform throws rather than defaulting
 */
import { MAESTRO_PLATFORMS, type MaestroPlatform } from '@kitchensink/e2e-fixtures/testPool';

/** The environment variable the run key and the slot allocation both read. */
const SHARD_ENV = 'COMMISE_E2E_SHARD';

/** The environment variable that names the Maestro platform. */
const PLATFORM_ENV = 'MAESTRO_PLATFORM';

/**
 * The shard this process is, from the environment. Pure.
 *
 * ⛔ ABSENT IS SHARD 1, and that is the unsharded run rather than a guess: `deriveRunKey` appends a shard
 * segment "only when present, so an UNSHARDED job's key is byte-identical to what it derived before sharding
 * existed", and shard 1's pool lanes are the original `signer`/`coauthor` ids for the same reason. A PRESENT
 * but unreadable value throws — that is a broken matrix, not an unsharded run, and silently demoting it to 1
 * would put two shards on one signer.
 *
 * @param env - The process environment.
 * @returns The 1-based shard index.
 */
export function resolveShard(env: Readonly<Record<string, string | undefined>>): number {
    const raw = env[SHARD_ENV];

    if (raw === undefined || raw === '') {
        return 1;
    }

    // ⛔ A DIGIT-ONLY MATCH, not `Number()` alone. `Number(' 2')` is 2, so a coercion accepts a value with
    // surrounding whitespace — and every leniency here is a way for a shard nobody stated to be admitted. The
    // pattern is anchored at both ends over a single character class, so it is linear in the input.
    if (!/^[0-9]+$/u.test(raw)) {
        throw new Error(`e2e-seed: ${SHARD_ENV}='${raw}' is not a positive integer — refusing to guess a shard`);
    }

    const shard = Number(raw);

    if (shard < 1) {
        throw new Error(`e2e-seed: ${SHARD_ENV}='${raw}' is not a positive integer — refusing to guess a shard`);
    }

    return shard;
}

/**
 * Refuse a run whose two statements of "which shard am I" disagree. Pure.
 *
 * @param flagged - The shard the command line stated.
 * @param env - The process environment.
 * @throws When {@link SHARD_ENV} is set and names a different shard.
 */
export function assertShardsAgree(flagged: number, env: Readonly<Record<string, string | undefined>>): void {
    if (env[SHARD_ENV] === undefined || env[SHARD_ENV] === '') {
        return;
    }

    const declared = resolveShard(env);

    if (declared !== flagged) {
        throw new Error(
            `e2e-seed: --shard ${String(flagged)} contradicts ${SHARD_ENV}=${String(declared)} — one of them would ` +
                'purge or lease another shard’s pool slots. Fix the workflow; do not pick a winner here.',
        );
    }
}

/**
 * The Maestro platform this process is, from the environment. Pure.
 *
 * ⛔ ABSENT IS `android`, and that is the runner's own rule rather than a guess (`runMaestroFlows.sh` defaults its
 * `PLATFORMS` the same way, and a local run sets nothing). A PRESENT value that is not exactly a declared platform
 * throws — no trimming, no case folding — because demoting an iOS job to Android would put it on Android's lane.
 *
 * @param env - The process environment.
 * @returns The platform whose pool lanes this process leases and resets.
 */
export function resolveMaestroPlatform(env: Readonly<Record<string, string | undefined>>): MaestroPlatform {
    const raw = env[PLATFORM_ENV];

    if (raw === undefined || raw === '') {
        return 'android';
    }

    const platform = MAESTRO_PLATFORMS.find((candidate) => candidate === raw);

    if (platform === undefined) {
        throw new Error(
            `e2e-seed: ${PLATFORM_ENV}='${raw}' is not one of ${MAESTRO_PLATFORMS.join(', ')} — refusing to guess a platform`,
        );
    }

    return platform;
}

/**
 * Refuse a run whose two statements of "which platform am I" disagree. Pure.
 *
 * @param flagged - The platform the command line stated.
 * @param env - The process environment.
 * @throws When {@link PLATFORM_ENV} is set and names a different platform.
 */
export function assertPlatformsAgree(
    flagged: MaestroPlatform,
    env: Readonly<Record<string, string | undefined>>,
): void {
    if (env[PLATFORM_ENV] === undefined || env[PLATFORM_ENV] === '') {
        return;
    }

    const declared = resolveMaestroPlatform(env);

    if (declared !== flagged) {
        throw new Error(
            `e2e-seed: --platform ${flagged} contradicts ${PLATFORM_ENV}=${declared} — one of them would ` +
                'purge or lease another platform’s pool slots. Fix the workflow; do not pick a winner here.',
        );
    }
}
