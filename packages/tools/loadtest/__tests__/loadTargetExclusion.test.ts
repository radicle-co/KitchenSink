/**
 * ⛔ A SCENARIO THAT CANNOT MEAN ANYTHING AGAINST A TARGET SAYS SO IN ITS OWN HEADER, AND THE TIER LIST HONOURS IT.
 *
 *     // @loadExcludeTarget prod — ADR-0040 contains a test principal's analytics on an enforcing stage
 *
 * The case that introduced it (staff-architect REVIEW, LOW-7): against production, ADR-0040's containment answers
 * every analytics event a signed test principal sends with `landed: 0` BY DESIGN, so `analyticsIngest.load.js` could
 * only fail its landing threshold there. Today the k6 job's containment gate runs no authenticated scenario on prod
 * at all; this declaration is what keeps the scenario off prod the day that gate lifts, because it is a fact about
 * the scenario rather than about the job.
 *
 * ⚠️ PARSED STRICTLY. A marker that is present but malformed — no reason, an unknown target, the wrong separator —
 * THROWS rather than reading as "no exclusion": silently dropping it would put the scenario back on the target it
 * declared it cannot run against, and a list that looks right while running the wrong thing is the failure this
 * package's tier module already exists to prevent.
 */
import { describe, expect, it } from 'vitest';

import { excludedTargetsOf, parsePrintLoadTierArgs, scriptsInTier } from '@kitchensink/loadtest';

const ANALYTICS = 'packages/services/recipe-service/tests/load/analyticsIngest.load.js';

describe('excludedTargetsOf', () => {
    it('reads a declared exclusion and its reason, in either comment style', () => {
        expect(
            excludedTargetsOf('// @loadExcludeTarget prod — nothing can land there\nimport http from "k6/http";'),
        ).toEqual([{ target: 'prod', reason: 'nothing can land there' }]);
        expect(excludedTargetsOf('/**\n * @loadExcludeTarget sandbox — a reason\n */')).toEqual([
            { target: 'sandbox', reason: 'a reason' },
        ]);
    });

    it('reads no exclusion from a script that declares none', () => {
        expect(excludedTargetsOf('// @loadTier deployed-capable — a reason\n')).toEqual([]);
    });

    it.each([
        ['no reason', '// @loadExcludeTarget prod\n'],
        ['an unknown target', '// @loadExcludeTarget staging — a reason\n'],
        ['a hyphen instead of the em dash', '// @loadExcludeTarget prod - a reason\n'],
    ])('⛔ refuses a malformed marker (%s) rather than reading it as no exclusion', (_, source) => {
        expect(() => excludedTargetsOf(source)).toThrow(/@loadExcludeTarget/u);
    });
});

describe('the tier list for a target', () => {
    it('⛔ keeps the analytics ingest scenario OFF production and ON the sandbox', () => {
        expect(scriptsInTier('deployed-capable', 'prod')).not.toContain(ANALYTICS);
        expect(scriptsInTier('deployed-capable', 'sandbox')).toContain(ANALYTICS);
    });

    it('excludes nothing else from production that it does not declare', () => {
        const sandbox = scriptsInTier('deployed-capable', 'sandbox');
        const prod = scriptsInTier('deployed-capable', 'prod');

        expect(sandbox.filter((script) => !prod.includes(script))).toEqual([ANALYTICS]);
    });
});

/**
 * REWRITTEN (CI run 34855978400): these cases used to spawn `npx tsx printLoadTier.ts` twice and three times, which
 * blew vitest's 5 s budget on a loaded runner — a timing failure, not a behavioural one. The CLI's whole decision now
 * lives in the pure `parsePrintLoadTierArgs`, asserted in-process; `printLoadTier.ts` only prints what it returns.
 */
describe('printLoadTier arguments', () => {
    it('⛔ requires a --target, so no invocation can forget the exclusions', () => {
        expect(parsePrintLoadTierArgs(['deployed-capable', 'recipe-service'])).toEqual({
            kind: 'usage',
            message: expect.stringMatching(/--target/u) as string,
        });
    });

    it.each([
        ['an unknown tier', ['everything', '--target', 'prod']],
        ['an unknown target', ['deployed-capable', '--target', 'staging']],
        ['a --target with no value', ['deployed-capable', '--target']],
        ['no tier at all', ['--target', 'sandbox']],
    ])('refuses %s with the usage line', (_, argv) => {
        expect(parsePrintLoadTierArgs(argv)).toMatchObject({ kind: 'usage' });
    });

    it('reads the tier, the optional path fragment and the target, wherever --target sits', () => {
        expect(parsePrintLoadTierArgs(['deployed-capable', 'recipe-service', '--target', 'prod'])).toEqual({
            kind: 'print',
            tier: 'deployed-capable',
            filter: 'recipe-service',
            target: 'prod',
        });
        expect(parsePrintLoadTierArgs(['--target', 'sandbox', 'substrate-bound'])).toEqual({
            kind: 'print',
            tier: 'substrate-bound',
            filter: undefined,
            target: 'sandbox',
        });
    });
});
