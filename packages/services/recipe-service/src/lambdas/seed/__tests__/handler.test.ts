/**
 * THE DEPLOY-TIME SEED RUNNER REFUSES PRODUCTION, TWICE, BEFORE IT OPENS A CONNECTION.
 *
 * ⛔ WHAT IS AT STAKE. `database/seed.ts` writes recipes and a collection owned by two FABRICATED subjects,
 * some of them public. Against the production database that is fake public recipes, owned by users who do
 * not exist, in the real discovery feed. The primary interlock is that prod's CloudFormation template
 * declares no seed function at all — but a runtime that trusts its own absence is not an interlock, so the
 * runner re-asks.
 *
 * ⛔ TWO DOORS, DELIBERATELY DIFFERENT IN KIND. One reads the STAGE STRING, the other the DATABASE
 * IDENTITY. Neither may depend on the other being right: a stage variable copied between environments is
 * caught by the database check, and a database name that collides is caught by the stage check. This is
 * the shape `isScheduledCluster` uses for the nightly shutdown, and for the same reason — a false positive
 * here is a production incident.
 *
 * ⛔ AND THEY ARE CHECKED BEFORE THE POOL IS BUILT. A refusal that has already opened a connection to the
 * production database has already done the thing it exists to prevent from mattering.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const seed = vi.hoisted(() => vi.fn());
const poolFactory = vi.hoisted(() => vi.fn());

vi.mock('../../../database/seed.js', () => ({ seed }));
vi.mock('pg', () => ({ default: { Pool: poolFactory } }));

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
    vi.clearAllMocks();
    // `function`, not an arrow: the handler calls `new Pool(...)`, and vitest cannot construct an arrow.
    poolFactory.mockImplementation(function mockPool() {
        return { end: vi.fn().mockResolvedValue(undefined) };
    });
    seed.mockResolvedValue({ ingredients: 0, recipes: 5 });
    process.env['DB_HOST'] = 'db.internal';
    process.env['DB_PORT'] = '5432';
});

afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
});

/** Import the handler fresh, so each case sees the env it set. */
async function load() {
    vi.resetModules();

    return (await import('../handler.js')).handler;
}

describe('the deploy-time seed runner', () => {
    it('seeds a per-PR stage', async () => {
        process.env['STAGE'] = 'pr-91';
        process.env['DB_NAME'] = 'kitchensink_recipes_pr_91';

        await expect((await load())()).resolves.toEqual({ ingredients: 0, recipes: 5 });
        expect(seed).toHaveBeenCalledTimes(1);
    });

    it('REFUSES the prod stage, and opens no connection', async () => {
        process.env['STAGE'] = 'prod';
        process.env['DB_NAME'] = 'kitchensink_recipes_pr_91';

        await expect((await load())()).rejects.toThrow(/may not seed/u);
        expect(poolFactory).not.toHaveBeenCalled();
        expect(seed).not.toHaveBeenCalled();
    });

    it('REFUSES the shared base database even when the stage looks per-PR', async () => {
        // The second door, on a different fact from the first: a stage variable copied between
        // environments passes the stage check and must still not reach the shared database.
        process.env['STAGE'] = 'pr-91';
        process.env['DB_NAME'] = 'kitchensink_recipes';

        await expect((await load())()).rejects.toThrow(/kitchensink_recipes/u);
        expect(poolFactory).not.toHaveBeenCalled();
        expect(seed).not.toHaveBeenCalled();
    });

    it('REFUSES an absent stage rather than assuming it is safe', async () => {
        delete process.env['STAGE'];
        process.env['DB_NAME'] = 'kitchensink_recipes_pr_91';

        await expect((await load())()).rejects.toThrow(/may not seed/u);
        expect(seed).not.toHaveBeenCalled();
    });

    it('closes the pool even when the seed throws', async () => {
        const end = vi.fn().mockResolvedValue(undefined);

        poolFactory.mockImplementation(function mockPool() {
            return { end };
        });
        seed.mockRejectedValue(new Error('constraint violated'));
        process.env['STAGE'] = 'pr-91';
        process.env['DB_NAME'] = 'kitchensink_recipes_pr_91';

        await expect((await load())()).rejects.toThrow(/constraint violated/u);
        expect(end).toHaveBeenCalledTimes(1);
    });
});
