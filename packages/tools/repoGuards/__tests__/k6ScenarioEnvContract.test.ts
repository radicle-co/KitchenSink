/**
 * ⛔ EVERY ENV VAR THE k6 SCENARIO STEPS SET MUST ACTUALLY BE READ BY THE SCRIPTS THEY RUN.
 *
 * ⚠️ MEASURED, run 34039640261. The recipe step set `RECIPE_LOAD_TEST_TOKEN_FILE` — a name that exists
 * nowhere in the corpus, invented at the workflow. `lib/common.js` reads `RECIPE_LOAD_TEST_TOKEN`, so
 * `TOKEN` was empty, `authHeaders` sent no `Authorization`, and all 4051 requests answered 401. Eight
 * scenarios ran for two minutes each and measured the 401 path.
 *
 * Nothing could catch that: `actionlint` sees a valid `env:` block, the scripts see an absent variable and
 * fall back to `''` exactly as designed, and the resulting failure looks like a service defect. The
 * credential was fine — proved by minting one by hand and getting `200` from the same endpoint.
 *
 * So the contract is asserted from BOTH SIDES, discovered rather than listed: every `__ENV['X']` the load
 * libraries read is a name the workflow MAY set, and every name the workflow sets on a scenario step MUST
 * be one of them. A typo fails on the day it lands instead of on a twelve-minute deployed run.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const read = (file: string): string => readFileSync(join(REPO_ROOT, file), 'utf8');

/** Names GitHub itself provides, or that the runner sets — never the scripts' to read. */
const NOT_SCRIPT_INPUTS = new Set(['LOAD_PROFILE']);

/**
 * Every env name the three service load libraries read.
 *
 * ⚠️ TWO SHAPES, because one of them is invisible to the obvious regex. Most names are read directly as
 * `__ENV['NAME']`. The sign-in handles are read by the SHARED refresher as `__ENV[envName]` — a computed
 * key, which no amount of scanning `session.js` can resolve to a literal — so for those the name is
 * knowable only at the call site, `loadSessionHandles('NAME')`. Missing that shape is not cosmetic: the
 * guard would report three genuinely-read names as unread and, taken at face value, invite deleting the
 * very wiring that keeps a 105-second leg authenticated.
 */
function namesTheScriptsRead(): ReadonlySet<string> {
    const names = new Set<string>();
    const patterns = [/__ENV\[['"]([A-Z0-9_]+)['"]\]/gu, /loadSessionHandles\(['"]([A-Z0-9_]+)['"]\)/gu];

    for (const service of ['recipe-service', 'food-service', 'identity']) {
        const source = read(`packages/services/${service}/tests/load/lib/common.js`);

        for (const pattern of patterns) {
            for (const match of source.matchAll(pattern)) {
                names.add(match[1] ?? '');
            }
        }
    }

    return names;
}

/** Every env name set on a step whose `run:` drives the derived scenario list. */
function namesTheWorkflowSets(): readonly { readonly step: string; readonly name: string }[] {
    const workflow = parse(read('.github/workflows/_ci-heavy.yml')) as {
        jobs: Record<string, { steps?: { name?: string; run?: string; env?: Record<string, unknown> }[] }>;
    };
    const found: { step: string; name: string }[] = [];

    for (const job of Object.values(workflow.jobs)) {
        for (const step of job.steps ?? []) {
            if (!(step.run ?? '').includes('printLoadTier.ts')) {
                continue;
            }

            for (const name of Object.keys(step.env ?? {})) {
                found.push({ step: step.name ?? '(unnamed)', name });
            }
        }
    }

    return found;
}

describe('the k6 scenario env contract', () => {
    it('is not vacuous: the workflow drives scenarios and sets env on those steps', () => {
        expect(namesTheWorkflowSets().length).toBeGreaterThan(0);
        expect(namesTheScriptsRead().size).toBeGreaterThan(0);
    });

    it('⛔ sets no name the scripts do not read', () => {
        const read = namesTheScriptsRead();
        const invented = namesTheWorkflowSets().filter(
            (entry) => !NOT_SCRIPT_INPUTS.has(entry.name) && !read.has(entry.name),
        );

        expect(
            invented.map((entry) => `${entry.step} sets ${entry.name}`),
            'a name no script reads is a silently-absent value — the scripts fall back to their default and ' +
                'measure the wrong thing, which is how eight scenarios spent two minutes each on the 401 path',
        ).toStrictEqual([]);
    });
});
