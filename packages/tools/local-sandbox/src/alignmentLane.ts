/**
 * @module alignmentLane — which pool slots a local lane aligns.
 *
 * A lane is a platform and a 1-based shard (`MAESTRO_PLATFORM`, `COMMISE_E2E_SHARD`, both of which `localMaestro.sh`
 * and the lane scripts already export). The slots are the ones the lane's own `provision` leases, taken from the
 * roster, so the two cannot disagree about whose users exist.
 *
 * @pattern Functional core — pure parse and selection; `bin/alignIdentities.ts` is the shell
 */
import {
    MAESTRO_PLATFORMS,
    maestroErasureSlots,
    maestroSlotForShard,
    type MaestroPlatform,
    type PoolSlot,
} from '@kitchensink/e2e-fixtures/testPool';

/** A Maestro lane. */
export interface AlignmentLane {
    readonly platform: MaestroPlatform;
    readonly shard: number;
}

/**
 * Read the lane from the environment. Pure.
 *
 * Absent (or empty) is Android shard 1, the lane `local:maestro` has always been.
 *
 * @param env - The process environment.
 * @returns The lane.
 * @throws When the platform is not one the roster declares, or the shard is not a positive integer.
 */
export function laneFromEnv(env: Readonly<Record<string, string | undefined>>): AlignmentLane {
    const rawPlatform = env['MAESTRO_PLATFORM'];
    const rawShard = env['COMMISE_E2E_SHARD'];
    const platform = rawPlatform === undefined || rawPlatform === '' ? 'android' : rawPlatform;

    // `includes` on a tuple of literals: a name like `constructor` is not a member, unlike an `in` test.
    if (!(MAESTRO_PLATFORMS as readonly string[]).includes(platform)) {
        throw new Error(
            `alignIdentities: MAESTRO_PLATFORM must be one of ${MAESTRO_PLATFORMS.join(', ')}, got '${platform}'`,
        );
    }

    const shard = rawShard === undefined || rawShard === '' ? 1 : Number(rawShard);

    if (!Number.isInteger(shard) || shard < 1) {
        throw new Error(`alignIdentities: COMMISE_E2E_SHARD must be a positive integer, got '${String(rawShard)}'`);
    }

    return { platform: platform as MaestroPlatform, shard };
}

/**
 * The slots a lane signs in: its signer, its co-author, and (only on the platform's erasure shard) the erasure
 * subjects. Pure.
 *
 * @param lane - The lane.
 * @returns The slots, in the order they are aligned.
 */
export function alignmentSlots(lane: AlignmentLane): readonly PoolSlot[] {
    return [
        maestroSlotForShard('signer', lane.platform, lane.shard),
        maestroSlotForShard('coauthor', lane.platform, lane.shard),
        ...maestroErasureSlots(lane.platform, lane.shard),
    ];
}
