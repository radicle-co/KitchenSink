// @vitest-environment node
/**
 * `_ci-heavy.yml`'s `install` job skips `npm ci` — and the cache save — when the `node_modules` entry already exists.
 *
 * ## The measurement (run 38322183404, 2026-10-13)
 *
 * The heavy `install` job took 2.9 minutes on a run whose lockfile had not changed: it restored nothing, ran `npm ci` and
 * saved an entry that already existed (the save is a no-op for the loser of a same-key race, but `npm ci` is not free).
 * Every other job of the tier restores that entry, so the job exists only to SEED it; when it is already seeded there is
 * nothing to do.
 *
 * ## What is held, and the property that makes a skip safe
 *
 * The decision is made by a `lookup-only` restore of the EXACT key the save writes. `cache-hit` is `true` only for an exact
 * primary-key match (a `restore-keys` prefix match is not a hit), so a skipped `npm ci` is never a skipped install of a
 * different lockfile's tree. Three facts have to hold together, and each is its own test: the probe and the save use the
 * SAME key and path (or "hit" does not mean "the save would be redundant"); `npm ci` and the save are both gated on the
 * miss (or the fast path is a slow path); and the probe has no `restore-keys` (or a stale tree could be reported a hit).
 *
 * Pattern: Cache-aside, with `lookup-only` as the existence check.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import { scalarText } from './workflowScalar.js';

const WORKFLOW = fileURLToPath(new URL('../../../../.github/workflows/_ci-heavy.yml', import.meta.url));

interface Step {
    readonly name?: string;
    readonly id?: string;
    readonly if?: unknown;
    readonly uses?: string;
    readonly run?: unknown;
    readonly with?: Readonly<Record<string, unknown>>;
}

const workflow = parse(readFileSync(WORKFLOW, 'utf8')) as {
    readonly jobs?: Readonly<Record<string, { readonly steps?: readonly Step[] }>>;
};
const steps = workflow.jobs?.['install']?.steps ?? [];
const probe = steps.find((step) => /^actions\/cache\/restore@/u.test(step.uses ?? ''));
const save = steps.find((step) => /^actions\/cache\/save@/u.test(step.uses ?? ''));
const install = steps.find((step) => /^npm ci$/u.test(scalarText(step.run).trim()));
const setupNode = steps.find((step) => /^actions\/setup-node@/u.test(step.uses ?? ''));

describe('the heavy install job’s fast path', () => {
    it('finds every step it orders (non-vacuity)', () => {
        for (const [label, step] of Object.entries({ probe, save, install, setupNode })) {
            expect(step, `no ${label} step in install`).toBeDefined();
        }
    });

    it('⛔ probes with a LOOKUP-ONLY restore: it must not download a multi-gigabyte entry just to learn it exists', () => {
        expect(probe?.with?.['lookup-only']).toBe(true);
        expect(probe?.id, 'the gates below read the probe’s output by id').toBeTruthy();
    });

    it('⛔ probes the EXACT key the save writes, over the same paths — and offers no restore-keys', () => {
        expect(scalarText(probe?.with?.['key'])).toBe(scalarText(save?.with?.['key']));
        expect(scalarText(probe?.with?.['path'])).toBe(scalarText(save?.with?.['path']));
        expect(probe?.with?.['restore-keys'], 'a prefix match would report a stale tree as a hit').toBeUndefined();
    });

    it('⛔ runs npm ci and the save ONLY on a miss — on an exact hit both are skipped', () => {
        const miss = `steps.${probe?.id ?? 'MISSING'}.outputs.cache-hit != 'true'`;

        expect(scalarText(install?.if)).toBe(miss);
        expect(scalarText(save?.if)).toBe(miss);
    });

    it('orders the probe before everything it gates, and checks out before it (the key hashes the lockfile)', () => {
        const at = (step: Step | undefined): number => steps.indexOf(step as Step);
        const checkout = steps.findIndex((step) => /^actions\/checkout@/u.test(step.uses ?? ''));

        expect(at(probe)).toBeGreaterThan(checkout);
        expect(at(probe)).toBeLessThan(at(install));
        expect(at(install)).toBeLessThan(at(save));
    });

    /**
     * `setup-node`'s `cache: npm` restores the npm tarball cache before `npm ci` and saves it afterwards. On a fast-path run
     * there is no `npm ci`, so there is nothing for it to restore and the post-step would try to save an empty directory.
     * It is therefore enabled on a miss only.
     */
    it('turns the npm tarball cache on only when npm ci will run', () => {
        expect(scalarText(setupNode?.with?.['cache'])).toBe(
            `\${{ steps.${probe?.id ?? 'MISSING'}.outputs.cache-hit != 'true' && 'npm' || '' }}`,
        );
    });

    it('the lockfile hash is in the key, so a changed lockfile is always a miss', () => {
        expect(scalarText(probe?.with?.['key'])).toContain("hashFiles('package-lock.json')");
    });
});
