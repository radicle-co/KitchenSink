import { describe, expect, it } from 'vitest';

import { planLanes, type LanePlanInput } from '../src/lanePlan.js';

const GIB = 1024 ** 3;

/** A roomy machine: no cap but the one a test lowers. */
const roomy = (overrides: Partial<LanePlanInput> = {}): LanePlanInput => ({
    cpus: 20,
    load1: 0,
    memAvailable: 32 * GIB,
    perLane: { cpus: 2, memBytes: 2 * GIB },
    identityCap: 8,
    clerkCap: 8,
    work: 100,
    ...overrides,
});

describe('planLanes', () => {
    it('runs no lane when there is no work', () => {
        expect(planLanes(roomy({ work: 0 })).count).toBe(0);
    });

    it('runs at least one lane when there is work, however loaded the machine is', () => {
        const plan = planLanes(roomy({ load1: 40, memAvailable: 0.1 * GIB }));

        expect(plan.count).toBe(1);
    });

    it('is bound by the CPU left after the current load', () => {
        const plan = planLanes(roomy({ cpus: 10, load1: 4, identityCap: 99, clerkCap: 99 }));

        expect(plan).toMatchObject({ count: 3, boundBy: 'cpu' });
        expect(plan.caps.cpu).toBe(3);
    });

    it('is bound by available memory', () => {
        const plan = planLanes(roomy({ memAvailable: 5 * GIB, identityCap: 99, clerkCap: 99 }));

        expect(plan).toMatchObject({ count: 2, boundBy: 'memory' });
    });

    it('is bound by the identity pool', () => {
        const plan = planLanes(roomy({ identityCap: 3 }));

        expect(plan).toMatchObject({ count: 3, boundBy: 'identity' });
    });

    it('is bound by the Clerk rate ceiling', () => {
        expect(planLanes(roomy({ clerkCap: 2 }))).toMatchObject({ count: 2, boundBy: 'clerk' });
    });

    it('never runs more lanes than there are tests', () => {
        expect(planLanes(roomy({ work: 2 }))).toMatchObject({ count: 2, boundBy: 'work' });
    });

    it('honours a request below every other cap, and ignores one above them', () => {
        expect(planLanes(roomy({ requested: 1 }))).toMatchObject({ count: 1, boundBy: 'requested' });
        expect(planLanes(roomy({ requested: 50 })).count).toBe(8);
    });

    it('takes the shared server’s fixed cost off the machine before dividing among lanes', () => {
        const fixed = { cpus: 4, memBytes: 8 * GIB };

        // 20 - 4 = 16 CPUs over 2 each = 8; 32 - 8 = 24 GiB over 2 each = 12.
        expect(planLanes(roomy({ fixed, work: 100, identityCap: 100, clerkCap: 100 })).caps.cpu).toBe(8);
        expect(planLanes(roomy({ fixed, identityCap: 100, clerkCap: 100 })).caps.memory).toBe(12);
    });

    it('costs nothing fixed when no shared server runs', () => {
        expect(planLanes(roomy()).caps.cpu).toBe(10);
        expect(planLanes(roomy()).caps.memory).toBe(16);
    });

    it('names the first cap in a tie, in a fixed order', () => {
        expect(planLanes(roomy({ identityCap: 4, clerkCap: 4 })).boundBy).toBe('identity');
    });

    it('does not let a load above the CPU count make the cap negative', () => {
        expect(planLanes(roomy({ load1: 99 })).caps.cpu).toBe(0);
    });
});
