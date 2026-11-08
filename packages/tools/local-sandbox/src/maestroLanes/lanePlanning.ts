/**
 * The pure half of planning a lane run: what each lane is, the runner selector for a selection, and how many lanes the
 * flows can fill. The orchestrator gathers the facts (the selection, the packer's answers) and these functions decide;
 * how many lanes have their Clerk users is `poolAdmin`'s `listLocalLanes`.
 */
import path from 'node:path';
import { parseArgs } from 'node:util';

import { maestroSlotForShard } from '@kitchensink/e2e-fixtures/testPool';

import type { LanePlatform, LaneSpec } from './laneTypes.js';

/** The emulator the owner runs by hand. A lane never drives it. */
const FOREIGN_EMULATOR = 'emulator-5554';

/** Below the kernel's ephemeral range on Linux and macOS, one per lane (the runner's driver-port note). */
const DRIVER_PORT_BASE = 7000;

export interface LaneSpecsInput {
    readonly platform: LanePlatform;
    readonly count: number;
    readonly stateDir: string;
    readonly deviceFor: (index: number) => string;
}

/**
 * Every lane of one platform. Pure but for the pool namespace `maestroSlotForShard` reads.
 *
 * @throws When the count is not a positive integer, a lane has no Clerk lane in the roster, the device table cannot
 *   name a lane, or a lane would drive {@link FOREIGN_EMULATOR}. All before any device boots.
 */
export function laneSpecs(input: LaneSpecsInput): readonly LaneSpec[] {
    if (!Number.isInteger(input.count) || input.count < 1) {
        throw new Error(`maestro:lanes: a run needs at least one lane, got ${String(input.count)}`);
    }

    return Array.from({ length: input.count }, (_, offset) => {
        const index = offset + 1;

        for (const role of ['signer', 'coauthor'] as const) {
            maestroSlotForShard(role, input.platform, index);
        }

        const device = input.deviceFor(index);

        if (device === FOREIGN_EMULATOR) {
            throw new Error(`maestro:lanes: lane ${index} would drive ${FOREIGN_EMULATOR}, which is not a lane device`);
        }

        const stateDir = path.join(input.stateDir, 'lanes', `${input.platform}-${index}`);

        return {
            platform: input.platform,
            index,
            count: input.count,
            device,
            driverPort: DRIVER_PORT_BASE + index,
            stateDir,
            fixtureEnvFile: path.join(stateDir, 'fixture.env'),
        };
    });
}

/**
 * The runner's `MAESTRO_FLOW_SELECTOR` for a selection: empty (the full run) for `all`, else one `flow:` key per flow.
 *
 * @throws On an empty list (an empty selector is the FULL run, so it must never stand for "none") or a flow name the
 *   selector would split.
 */
export function flowSelector(selection: 'all' | readonly string[]): string {
    if (selection === 'all') {
        return '';
    }

    if (selection.length === 0) {
        throw new Error('maestro:lanes: no flows to select - a run over no flows is refused before it starts');
    }

    for (const flow of selection) {
        if (!/^[\w./-]+$/u.test(flow)) {
            throw new Error(`maestro:lanes: '${flow}' is not a flow name the runner selector can carry`);
        }
    }

    return selection.map((flow) => `flow:${flow}=true`).join(' ');
}

/**
 * The largest lane count, at most `count`, whose every lane the packer gives at least one flow. Pinned flows all go to
 * lane 1, so "flows minus the spine" can promise more lanes than can be filled. Each packer call is a run of the runner's
 * packer, so it asks lazily: from the planned count down, lane by lane, and it leaves a count at its first empty lane.
 *
 * @param count - The planned count.
 * @param packed - The packer's flows for lane `index` of `count`.
 * @returns The count, or 0 when even one lane would be empty.
 */
export async function fitLaneCount(
    count: number,
    packed: (index: number, count: number) => Promise<readonly string[]>,
): Promise<number> {
    for (let candidate = count; candidate >= 1; candidate -= 1) {
        if (await everyLaneHolds(candidate, packed)) {
            return candidate;
        }
    }

    return 0;
}

async function everyLaneHolds(
    count: number,
    packed: (index: number, count: number) => Promise<readonly string[]>,
): Promise<boolean> {
    for (let index = 1; index <= count; index += 1) {
        if ((await packed(index, count)).length === 0) {
            return false;
        }
    }

    return true;
}

/** What `maestro:lanes` was asked to run. */
export interface LaneArgs {
    readonly platforms: readonly LanePlatform[];
    readonly requested?: number;
    /** `changed` asks the impact selector; `all` is the whole suite; a list is the flows named. */
    readonly selection: 'all' | 'changed' | readonly string[];
    /** Seconds between lane starts, so the lanes' first sign-ins do not meet Clerk's per-IP limit at once. */
    readonly staggerSeconds: number;
}

const DEFAULT_STAGGER_SECONDS = 20;

/**
 * Read `--platform android|ios|both [--lanes <n>] [--flows <f...>]`. `FULL_SUITE=1` runs everything, and
 * `MAESTRO_LANE_STAGGER_SECONDS` (whole seconds, default 20) spaces the lane starts. Pure.
 *
 * @throws On a missing or unknown platform, a lane count that is not a positive integer, `--flows` naming nothing, a
 *   flow named without `--flows`, any other argument, or a stagger that is not a whole number of seconds.
 */
export function parseLaneArgs(argv: readonly string[], env: Readonly<Record<string, string | undefined>>): LaneArgs {
    let parsed;

    try {
        parsed = parseArgs({
            args: [...argv],
            strict: true,
            allowPositionals: true,
            options: { platform: { type: 'string' }, lanes: { type: 'string' }, flows: { type: 'boolean' } },
        });
    } catch (error) {
        throw new Error(`maestro:lanes: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }

    const { platform, lanes, flows } = parsed.values;
    const platforms: Readonly<Record<string, readonly LanePlatform[]>> = {
        android: ['android'],
        ios: ['ios'],
        both: ['android', 'ios'],
    };
    const chosen = platform === undefined ? undefined : platforms[platform];

    if (chosen === undefined) {
        throw new Error('maestro:lanes: --platform android|ios|both is required');
    }

    if (lanes !== undefined && !/^[1-9]\d*$/u.test(lanes)) {
        throw new Error(`maestro:lanes: --lanes '${lanes}' is not a positive integer`);
    }

    if ((flows === true) !== parsed.positionals.length > 0) {
        throw new Error('maestro:lanes: name flows after --flows, and only there');
    }

    const stagger = env['MAESTRO_LANE_STAGGER_SECONDS'];

    if (stagger !== undefined && !/^\d+$/u.test(stagger)) {
        throw new Error(`maestro:lanes: MAESTRO_LANE_STAGGER_SECONDS '${stagger}' is not a whole number of seconds`);
    }

    return {
        platforms: chosen,
        ...(lanes === undefined ? {} : { requested: Number(lanes) }),
        selection: env['FULL_SUITE'] === '1' ? 'all' : flows === true ? parsed.positionals : 'changed',
        staggerSeconds: stagger === undefined ? DEFAULT_STAGGER_SECONDS : Number(stagger),
    };
}
