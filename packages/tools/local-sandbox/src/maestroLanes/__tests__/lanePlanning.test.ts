import { describe, expect, it } from 'vitest';

import { fitLaneCount, flowSelector, laneSpecs, parseLaneArgs } from '../lanePlanning.js';

const ANDROID = (index: number): string => `emulator-${5554 + 2 * index}`;

describe('laneSpecs — what each lane is', () => {
    it('gives lane k its device, port 7000+k and its own state folder and manifest', () => {
        const lanes = laneSpecs({ platform: 'android', count: 3, stateDir: '/state', deviceFor: ANDROID });

        expect(lanes).toEqual(
            [1, 2, 3].map((index) => ({
                platform: 'android',
                index,
                count: 3,
                device: `emulator-${5554 + 2 * index}`,
                driverPort: 7000 + index,
                stateDir: `/state/lanes/android-${index}`,
                fixtureEnvFile: `/state/lanes/android-${index}/fixture.env`,
            })),
        );
    });

    it('refuses a lane on emulator-5554, the emulator that is not ours', () => {
        expect(() =>
            laneSpecs({ platform: 'android', count: 1, stateDir: '/s', deviceFor: () => 'emulator-5554' }),
        ).toThrow(/5554/u);
    });

    it('refuses a lane past the Clerk roster before any device boots', () => {
        expect(() => laneSpecs({ platform: 'ios', count: 6, stateDir: '/s', deviceFor: (k) => `udid-${k}` })).toThrow(
            /ios Maestro shard 6/u,
        );
    });

    it('refuses a lane the device table cannot name', () => {
        const deviceFor = (index: number): string => {
            if (index > 2) {
                throw new Error(`no device for lane ${index}`);
            }

            return ANDROID(index);
        };

        expect(() => laneSpecs({ platform: 'android', count: 3, stateDir: '/s', deviceFor })).toThrow(/lane 3/u);
    });

    it('refuses zero lanes', () => {
        expect(() => laneSpecs({ platform: 'android', count: 0, stateDir: '/s', deviceFor: ANDROID })).toThrow();
    });
});

describe('flowSelector — the runner selector for a selection', () => {
    it('is empty, the full run, for all', () => {
        expect(flowSelector('all')).toBe('');
    });

    it('is one flow key per flow', () => {
        expect(flowSelector(['home', 'recipes/edit'])).toBe('flow:home=true flow:recipes/edit=true');
    });

    it('refuses an empty list, which would mean the full run by accident', () => {
        expect(() => flowSelector([])).toThrow();
    });

    it('refuses a flow name the selector would split', () => {
        expect(() => flowSelector(['recipes/a b'])).toThrow();
        expect(() => flowSelector(['a=b'])).toThrow();
    });
});

describe('fitLaneCount — every lane holds at least one flow', () => {
    /**
     * A fake packer: the given flows go round-robin, except the pinned ones, which all go to lane 1. It records every
     * `index/count` it is asked for, because each real call is a run of the runner's packer.
     */
    const packer = (flows: readonly string[], pinned: readonly string[], asked: string[] = []) => {
        return (index: number, count: number): Promise<readonly string[]> => {
            asked.push(`${index}/${count}`);
            const loose = flows.filter((flow) => !pinned.includes(flow));

            return Promise.resolve([
                ...(index === 1 ? pinned : []),
                ...loose.filter((_, position) => position % count === index - 1),
            ]);
        };
    };

    it('keeps the count when every lane is busy', async () => {
        await expect(fitLaneCount(3, packer(['a', 'b', 'c', 'd'], []))).resolves.toBe(3);
    });

    it('lowers the count until no lane is empty (three pinned flows are one lane, not three)', async () => {
        await expect(fitLaneCount(3, packer(['a', 'b', 'c'], ['a', 'b', 'c']))).resolves.toBe(1);
        await expect(fitLaneCount(4, packer(['p', 'q', 'a', 'b'], ['p', 'q']))).resolves.toBe(2);
    });

    it('answers zero when even one lane would be empty', async () => {
        await expect(fitLaneCount(2, packer([], []))).resolves.toBe(0);
    });

    it('packs lazily: a count whose lanes are all busy costs one call per lane, and nothing below it is asked', async () => {
        const asked: string[] = [];

        await fitLaneCount(3, packer(['a', 'b', 'c', 'd'], [], asked));

        expect(asked).toEqual(['1/3', '2/3', '3/3']);
    });

    it('leaves a count at its first empty lane, without packing the lanes after it', async () => {
        const asked: string[] = [];

        await expect(fitLaneCount(4, packer(['p', 'q', 'a', 'b'], ['p', 'q'], asked))).resolves.toBe(2);

        expect(asked).toEqual(['1/4', '2/4', '3/4', '1/3', '2/3', '3/3', '1/2', '2/2']);
    });
});

describe('parseLaneArgs — the maestro:lanes command line', () => {
    it('reads a platform, a lane count and named flows', () => {
        expect(parseLaneArgs(['--platform', 'android', '--lanes', '3', '--flows', 'home', 'recipes/edit'], {})).toEqual(
            {
                platforms: ['android'],
                requested: 3,
                selection: ['home', 'recipes/edit'],
                staggerSeconds: 20,
            },
        );
    });

    it('reads the lane stagger from MAESTRO_LANE_STAGGER_SECONDS, whole seconds, zero allowed', () => {
        expect(parseLaneArgs(['--platform', 'android'], { MAESTRO_LANE_STAGGER_SECONDS: '5' }).staggerSeconds).toBe(5);
        expect(parseLaneArgs(['--platform', 'android'], { MAESTRO_LANE_STAGGER_SECONDS: '0' }).staggerSeconds).toBe(0);
    });

    /** `Number('')` is 0 and `Number('abc')` is NaN: either used to reach the stagger timer unannounced. */
    it.each(['', 'abc', '-1', '1.5', '20s', ' 5'])('refuses MAESTRO_LANE_STAGGER_SECONDS=%j by name', (raw) => {
        expect(() => parseLaneArgs(['--platform', 'android'], { MAESTRO_LANE_STAGGER_SECONDS: raw })).toThrow(
            /MAESTRO_LANE_STAGGER_SECONDS/u,
        );
    });

    it('expands both to both platforms', () => {
        expect(parseLaneArgs(['--platform', 'both'], {}).platforms).toEqual(['android', 'ios']);
    });

    it('asks the impact selector when no flow is named, and runs everything under FULL_SUITE=1', () => {
        expect(parseLaneArgs(['--platform', 'android'], {}).selection).toBe('changed');
        expect(parseLaneArgs(['--platform', 'android', '--flows', 'home'], { FULL_SUITE: '1' }).selection).toBe('all');
    });

    it.each([
        [['--lanes', '2']],
        [['--platform', 'tvos']],
        [['--platform', 'android', '--lanes', '0']],
        [['--platform', 'android', '--lanes', '2x']],
        [['--platform', 'android', '--flows']],
        [['--platform', 'android', 'home']],
        [['--platform', 'android', '--nonsense']],
    ])('refuses %j', (argv) => {
        expect(() => parseLaneArgs(argv, {})).toThrow(/maestro:lanes/u);
    });
});
