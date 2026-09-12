// @vitest-environment node
/**
 * Repo-wide guard: **every production settle that opts OUT of the food queue's lease fence is in the
 * register below, and each one carries its reason.**
 *
 * ## Why
 *
 * U5/R16 made a food settle present the `leased_at` stamp its claim wrote, so a claim that was reaped or
 * reclaimed mid-work cannot land its result on a row another loop now owns. `SettleAuthority` deliberately
 * includes a second member — `'out-of-band'` — because one caller genuinely holds no claim: the API's
 * corroboration path completes a food beside the drainer and must be able to clear the row regardless of
 * who is draining it.
 *
 * That literal was chosen over an optional argument so the bypass would be visible at the call site. But
 * "visible" is a property of the code, not a guarantee about it: nobody greps. A future settle can leave
 * R16 entirely by typing eleven characters, with every test in the repository still green — which is the
 * same hole `natEgressConsumers.test.ts` was written to close for the NAT list, and
 * `queueProducerRegister.test.ts` for queue authorities. A register asserted by SET EQUALITY is what turns
 * a convention into a rule: adding a bypass reds here, and clearing it means writing down why.
 *
 * ## What it reads
 *
 * Production `src/**` only. Tests pass `'out-of-band'` constantly and correctly — they drive the DAO
 * directly to observe the backoff curve and the tombstone lifecycle, with no worker claim behind them —
 * and a guard that counted those would be noise measuring nothing.
 */
import { describe, expect, it } from 'vitest';

import { productionSources, readSource, withoutTsComments } from './roleSplitSources.js';

/** The literal a settle presents when it holds no claim (`foods/dao/leaseFence.ts`). */
const BYPASS = "'out-of-band'";

/**
 * Every production site permitted to settle without a fence, and the reason it is not a fence evasion.
 *
 * ⛔ Both reasons are STRUCTURAL — neither is "this caller is trusted". A settle that cannot justify itself
 * on one of these grounds is a settle that should be carrying a fence.
 */
const REGISTER: Readonly<Record<string, readonly string[]>> = {
    'packages/services/food-service/src/foods/foods.service.ts': [
        // `corroborateFood` is an API caller, not a drainer: it never claimed the row, so it has no stamp
        // to present. A drainer whose claim this clears finds its own settle refused, which is the correct
        // order — the corroboration has already decided the outcome.
        'corroborateFood',
    ],
    'packages/services/food-service/src/worker/foodConsumer.service.ts': [
        // `tombstoneFailed` runs only AFTER `recordFailure`, which has already reverted the row to
        // `pending` and cleared `leased_at` — there is no claim left to fence against. What holds the row
        // for the milliseconds until the tombstone lands is that failure's exponential backoff gate, which
        // with an exhausted budget sits 2^5 seconds out. Passing the spent fence would refuse every
        // tombstone instead, leaving a food that has failed five times cycling forever.
        'tombstoneFailed',
    ],
};

/**
 * The two files that IMPLEMENT the bypass rather than take it: `leaseFence.ts` declares the union member,
 * and the DAO compares against it to decide whether zero rows is a refusal. They necessarily spell the
 * literal, and they are not call sites.
 *
 * ⛔ Named here, and separately asserted below, rather than filtered out by a path pattern. A pattern like
 * "anything under `dao/`" would quietly swallow a real bypass added to any future DAO — which is the exact
 * shape of hole this register exists to close.
 */
const MECHANISM: readonly string[] = [
    'packages/services/food-service/src/foods/dao/fetchQueue.dao.ts',
    'packages/services/food-service/src/foods/dao/leaseFence.ts',
];

/** Repo-relative production files that mention the bypass literal outside a comment. */
function filesUsingBypass(): readonly string[] {
    return productionSources().filter((path) => withoutTsComments(readSource(path)).includes(BYPASS));
}

describe('the lease-fence bypass is a register, not a convention (R16)', () => {
    it('⛔ is used by EXACTLY the files the register names — no more, and no fewer', () => {
        expect(filesUsingBypass()).toEqual([...MECHANISM, ...Object.keys(REGISTER)].sort());
    });

    it('the files excused as MECHANISM really are the fence itself, not call sites', () => {
        const [dao, fence] = MECHANISM.map((path) => withoutTsComments(readSource(path)));

        // The union member is declared in one place...
        expect(fence).toMatch(/SettleAuthority = LeaseFence \| 'out-of-band'/u);
        // ...and the DAO spells it only to DECIDE, never to present it to something else.
        expect(dao).toMatch(/authority === 'out-of-band'/u);
        expect(dao).not.toMatch(/\(\s*\w+\s*,\s*'out-of-band'\s*\)/u);
    });

    it('⛔ every registered file still declares the function its entry justifies', () => {
        const missing = Object.entries(REGISTER).flatMap(([path, functions]) => {
            const source = readSource(path);

            return functions.filter((name) => !source.includes(name)).map((name) => `${path}: ${name}`);
        });

        // A renamed or deleted function leaves a reason attached to nothing, which reads as justification
        // for whatever bypass is in the file now.
        expect(missing).toEqual([]);
    });

    it('⛔ the fence itself is still REQUIRED — every settle takes an authority it cannot omit', () => {
        const dao = withoutTsComments(readSource('packages/services/food-service/src/foods/dao/fetchQueue.dao.ts'));

        // An optional parameter (`authority?:`) would restore exactly the hole the literal was chosen to
        // close: a bypass reachable by forgetting an argument, which no register can see.
        expect(dao).not.toMatch(/authority\?\s*:/u);

        for (const settle of ['resolve', 'tombstone', 'recordFailure', 'deferLease']) {
            expect(dao, `${settle} must take a SettleAuthority`).toMatch(
                new RegExp(String.raw`public async ${settle}\([\s\S]*?authority: SettleAuthority`, 'u'),
            );
        }
    });
});
