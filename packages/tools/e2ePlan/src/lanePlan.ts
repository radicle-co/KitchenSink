/** What one lane costs the machine. Measured, see `web/scripts/e2eLanes.ts`. */
export interface LaneCost {
    readonly cpus: number;
    readonly memBytes: number;
}

export interface LanePlanInput {
    readonly cpus: number;
    /** One-minute load average: CPUs already busy with something else. */
    readonly load1: number;
    readonly memAvailable: number;
    readonly perLane: LaneCost;
    /** What runs once whatever the lane count, such as a server the lanes share. Taken off the machine first. */
    readonly fixed?: LaneCost | undefined;
    /** Distinct sign-in identities the pool holds for this tier. */
    readonly identityCap: number;
    /** Lanes Clerk's rate limit tolerates signing in at once. */
    readonly clerkCap: number;
    /** Tests to run. */
    readonly work: number;
    /** A caller's wish (`E2E_LANES`); it can only lower the count. */
    readonly requested?: number | undefined;
}

export type LaneCap = 'cpu' | 'memory' | 'identity' | 'clerk' | 'work' | 'requested';

export interface LanePlan {
    readonly count: number;
    /** The cap that set `count` (the first, in the order of {@link CAP_ORDER}, on a tie). */
    readonly boundBy: LaneCap;
    readonly caps: Readonly<Record<LaneCap, number>>;
}

const CAP_ORDER: readonly LaneCap[] = ['identity', 'clerk', 'cpu', 'memory', 'work', 'requested'];

/**
 * How many parallel lanes to run: the smallest of every cap, never below one when there is work.
 * Pure.
 *
 * @param input - The machine, the pool and the work.
 * @returns The count, the cap that bound it, and every cap.
 */
export function planLanes(input: LanePlanInput): LanePlan {
    const caps: Record<LaneCap, number> = {
        cpu: Math.max(0, Math.floor((input.cpus - input.load1 - (input.fixed?.cpus ?? 0)) / input.perLane.cpus)),
        memory: Math.max(0, Math.floor((input.memAvailable - (input.fixed?.memBytes ?? 0)) / input.perLane.memBytes)),
        identity: input.identityCap,
        clerk: input.clerkCap,
        work: input.work,
        requested: input.requested ?? Number.POSITIVE_INFINITY,
    };
    const smallest = Math.min(...CAP_ORDER.map((cap) => caps[cap]));
    const boundBy = CAP_ORDER.find((cap) => caps[cap] === smallest) ?? 'identity';

    return { count: input.work <= 0 ? 0 : Math.max(1, smallest), boundBy, caps };
}
