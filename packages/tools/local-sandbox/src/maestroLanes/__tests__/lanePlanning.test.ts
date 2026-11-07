import { describe, expect, it } from 'vitest';

import { fitLaneCount, flowSelector, laneSpecs } from '../lanePlanning.js';

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
    /** A fake packer: the given flows go round-robin, except the pinned ones, which all go to lane 1. */
    const packer =
        (flows: readonly string[], pinned: readonly string[]) =>
        (index: number, count: number): readonly string[] => {
            const loose = flows.filter((flow) => !pinned.includes(flow));

            return [...(index === 1 ? pinned : []), ...loose.filter((_, position) => position % count === index - 1)];
        };

    it('keeps the count when every lane is busy', () => {
        expect(fitLaneCount(3, packer(['a', 'b', 'c', 'd'], []))).toBe(3);
    });

    it('lowers the count until no lane is empty (three pinned flows are one lane, not three)', () => {
        expect(fitLaneCount(3, packer(['a', 'b', 'c'], ['a', 'b', 'c']))).toBe(1);
        expect(fitLaneCount(4, packer(['p', 'q', 'a', 'b'], ['p', 'q']))).toBe(2);
    });

    it('answers zero when even one lane would be empty', () => {
        expect(fitLaneCount(2, packer([], []))).toBe(0);
    });
});
