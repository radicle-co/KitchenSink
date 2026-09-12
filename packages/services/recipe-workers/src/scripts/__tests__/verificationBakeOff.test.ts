/**
 * WHICH MODELS A BAKE-OFF RUN WILL SPEND MONEY ON — the one decision in the runner that is worth a test.
 *
 * DESIGN PATTERN: the same pure-`decide` / impure-`evaluate` split as `deploy-gate.sh` and
 * `spend/spendArithmetic.ts`. {@link resolveModels} is the whole of the decision; everything else in
 * `verificationBakeOff.ts` is calling, reading and printing.
 *
 * ⛔ WHY THIS IS NOT "just argument parsing". Every element the resolver returns is ~4,300 billed Bedrock
 * calls. The three failure modes below all present as a green run:
 *
 *  1. A model the rate table cannot price is accepted, and the run dies partway through having already spent.
 *  2. A model is named TWICE, so the corpus is judged twice at twice the cost and the report carries two
 *     entries with the same `modelId` — which is a comparison table that silently compares a model to itself.
 *  3. A bare invocation quietly widens to every model the table happens to price, so adding a rate entry —
 *     an act the table's own docstring calls "the decision to ALLOW it" — turns into an unasked-for spend.
 *
 * ⚠️ Importing the runner module is SAFE and must stay so: its `main()` is behind an `import.meta.main`
 * guard, which is false under vitest. If that guard is ever removed, this file starts calling Bedrock.
 */
import { describe, expect, it } from 'vitest';

import {
    CLAUDE_HAIKU_4_5_MODEL_ID,
    NOVA_LITE_MODEL_ID,
    NOVA_MICRO_MODEL_ID,
    NOVA_PRO_MODEL_ID,
} from '@kitchensink/recipe-core/spend/spend-arithmetic';

import { DEFAULT_MODELS, resolveModels } from '../verificationBakeOff.js';

describe('resolveModels', () => {
    it('runs ADR-0024 §4a’s roster, and ONLY that, when --models is not given', () => {
        // ⛔ NOT "everything the rate table prices". The table is the authority for what MAY be called; this
        // is the authority for what a bare invocation DOES call. Pricing Nova Lite and Nova Pro so a family
        // sweep can be costed must not conscript them into every future run.
        expect(resolveModels(undefined)).toEqual([NOVA_MICRO_MODEL_ID, CLAUDE_HAIKU_4_5_MODEL_ID]);
        expect(DEFAULT_MODELS).not.toContain(NOVA_LITE_MODEL_ID);
        expect(DEFAULT_MODELS).not.toContain(NOVA_PRO_MODEL_ID);
    });

    it('accepts any model the rate table prices, in the order asked for', () => {
        // Order is preserved because the runner writes each model's raw trials to disk before starting the
        // next one; "the cheap model first" is therefore a real operator choice about what survives a crash.
        expect(resolveModels(`${NOVA_LITE_MODEL_ID},${NOVA_PRO_MODEL_ID}`)).toEqual([
            NOVA_LITE_MODEL_ID,
            NOVA_PRO_MODEL_ID,
        ]);
        expect(resolveModels(`${NOVA_PRO_MODEL_ID},${NOVA_LITE_MODEL_ID}`)).toEqual([
            NOVA_PRO_MODEL_ID,
            NOVA_LITE_MODEL_ID,
        ]);
    });

    it('tolerates the whitespace a shell leaves behind', () => {
        expect(resolveModels(` ${NOVA_LITE_MODEL_ID} ,\t${NOVA_PRO_MODEL_ID}`)).toEqual([
            NOVA_LITE_MODEL_ID,
            NOVA_PRO_MODEL_ID,
        ]);
    });

    it('REFUSES a model the rate table cannot price, and names it', () => {
        // The refusal must arrive before the first call, not on call 1 of 4,272. `judge` throws for an
        // unpriced model too, but by then the run has begun and — with more than one model requested — may
        // already have spent on the earlier one.
        expect(() => resolveModels('meta.llama3-70b-instruct-v1:0')).toThrow(/meta\.llama3-70b-instruct-v1:0/u);
        expect(() => resolveModels(`${NOVA_LITE_MODEL_ID},meta.llama3-70b-instruct-v1:0`)).toThrow(
            /meta\.llama3-70b-instruct-v1:0/u,
        );
    });

    it('REFUSES the us.-prefixed inference profile id, because that is not what the table keys on', () => {
        // ⛔ The exact confusion the runner's INVOCATION_IDS map exists to prevent, arriving from the command
        // line instead of from the code. `us.amazon.nova-pro-v1:0` is a real, callable id — which is why
        // accepting it would be silently uncosted rather than loudly broken.
        expect(() => resolveModels(`us.${NOVA_PRO_MODEL_ID}`)).toThrow(/us\.amazon\.nova-pro-v1:0/u);
    });

    it('REFUSES a duplicate, which would double the spend and compare a model to itself', () => {
        expect(() => resolveModels(`${NOVA_LITE_MODEL_ID},${NOVA_LITE_MODEL_ID}`)).toThrow(/twice|duplicate/iu);
    });

    it('REFUSES an empty selection rather than running nothing and reporting success', () => {
        // ⚠️ Matched against a MESSAGE, not a bare `.toThrow()`. An assertion that any throw satisfies also
        // passes when the symbol under test does not exist at all — which is precisely how this case sailed
        // through its own red run.
        expect(() => resolveModels('')).toThrow(/--models/u);
        expect(() => resolveModels(',')).toThrow(/--models/u);
        expect(() => resolveModels('   ')).toThrow(/--models/u);
    });
});
