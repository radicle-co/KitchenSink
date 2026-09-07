/**
 * Repo-wide guard: EVERY step after the ensure-exists gate carries a gate-derived `if:` (2026-09-02).
 *
 * ## The failure this catches
 *
 * `deploy-recipe` had four post-gate steps with no `if:` at all, among twelve that had one. On a PR whose
 * per-PR stacks had been reaped — `deploy=false, live=false`, the deliberate resting state the on-demand
 * gate exists to hold — the first of them ran anyway, checked for `kitchensink-food-service-pr-{N}`,
 * found nothing and exited 1. `Sandbox Deploy` was therefore RED on every push to PR #91 for the entire
 * time its sandbox was down (stacks deleted 2026-08-27), reporting failure for "there is nothing to do".
 *
 * Red-over-nothing is the mirror of the green-over-nothing this repo already pays attention to, and it
 * costs the same thing: a check nobody can read is a check nobody reads, exactly when a real failure
 * needs noticing. One missing `if:` among twelve is invisible to review and invisible to YAML lint, so
 * it is asserted here.
 *
 * ## Why it enumerates nothing
 *
 * The subject set is DISCOVERED — every `id: gate` in the workflow, and every named step between it and
 * the next job — so a new step, or a whole new gated job, is covered the day it lands with no edit here.
 * A hand-maintained list of step names would be a second copy of the workflow, and copies rot: that is
 * how `ingredient-catalog-blend.yaml` sat unexecuted for months behind a `FLOWS` array nobody updated.
 *
 * ⚠️ It asserts only that a guard MENTIONS the gate, never which output. `deploy` and `live` answer
 * different questions — "does this run deploy?" versus "is there a preview to talk to?" — and choosing
 * between them is a judgement the step's own comment must make. Pinning one here would force the wrong
 * one on half the steps.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { repoRoot } from './serviceSources.js';

// ⚠️ `_sandbox-preview.yml`, not `sandbox-deploy.yml`: the deploy jobs moved to `_sandbox-preview.yml`, a REUSABLE workflow, because GitHub Actions has no cross-workflow `needs` — `_ci.yml` has to be able to run them as one branch of its own graph.
const WORKFLOW = join(repoRoot, '.github/workflows/_sandbox-preview.yml');

interface PostGateStep {
    readonly job: string;
    readonly name: string;
    readonly guard: string;
}

/** Every named step that follows an `id: gate` step, with whatever `if:` it carries. */
function postGateSteps(): readonly PostGateStep[] {
    const lines = readFileSync(WORKFLOW, 'utf8').split('\n');
    const isJobHeader = (line: string): boolean => /^ {4}[a-z][a-z0-9-]*:\s*$/.test(line);
    const found: PostGateStep[] = [];

    for (const [index, line] of lines.entries()) {
        if (line.trim() !== 'id: gate') {
            continue;
        }

        const job = [...lines.slice(0, index)].reverse().find(isJobHeader)?.trim().replace(':', '') ?? '(unknown)';
        const end = lines.findIndex((candidate, at) => at > index && isJobHeader(candidate));
        const stop = end === -1 ? lines.length : end;

        for (let at = index; at < stop; at += 1) {
            const name = /^ {12}- name: (.+)$/.exec(lines[at] ?? '')?.[1];

            if (name === undefined) {
                continue;
            }

            let guard = '';

            for (let lookahead = at + 1; lookahead < Math.min(at + 7, stop); lookahead += 1) {
                const next = lines[lookahead] ?? '';

                if (/^ {12}- name: /.test(next)) {
                    break;
                }

                const matched = /^ {14}if: (.+)$/.exec(next);

                if (matched) {
                    guard = matched[1] ?? '';
                    break;
                }
            }

            found.push({ job, name, guard });
        }
    }

    return found;
}

describe('every post-gate deploy step is guarded by the gate', () => {
    it('is not vacuous: the workflow really does have gated jobs with steps after the gate', () => {
        const steps = postGateSteps();
        const jobs = new Set(steps.map((step) => step.job));

        expect(steps.length).toBeGreaterThan(10);
        expect(jobs).toContain('deploy-recipe');
        expect(jobs).toContain('deploy-food');
    });

    it('⛔ no step after the gate runs unconditionally', () => {
        const unguarded = postGateSteps()
            .filter((step) => !step.guard.includes('gate.outputs'))
            .map(
                (step) => `${step.job}: "${step.name}" has no gate-derived if: — it runs even when the gate says skip`,
            );

        expect(unguarded).toEqual([]);
    });

    it('every guard reads an output the gate actually emits', () => {
        // `deploy` and `live` are the two the gate prints; a typo'd third would silently evaluate to
        // empty and skip the step forever — the quiet inverse of the bug above.
        const emitted = ['deploy', 'live'];
        const bogus = postGateSteps()
            .flatMap((step) => [...step.guard.matchAll(/gate\.outputs\.([a-z_]+)/g)].map((m) => ({ step, key: m[1] })))
            .filter(({ key }) => !emitted.includes(key ?? ''))
            .map(({ step, key }) => `${step.job}: "${step.name}" reads gate.outputs.${key}, which is never emitted`);

        expect(bogus).toEqual([]);
    });
});
