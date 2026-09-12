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

import { parse } from 'yaml';
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
        // ⚠️ ANY id ENDING in `gate`, not the literal `id: gate`. One job now evaluates the gate for both
        // tiers (`food-gate`, `recipe-gate`) instead of two jobs evaluating one each, and a finder pinned to
        // the old single name discovered nothing — a vacuous pass, which is this file's own subject.
        if (!/^id: [a-z-]*gate$/.test(line.trim())) {
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

            // ⛔ A GATE IS NOT A POST-GATE STEP. One job evaluates both tiers, so the recipe gate follows
            // the food gate and would otherwise be reported as an unguarded step after a gate — a gate that
            // waited on another gate's verdict would be exactly the wrong wiring, since the two tiers are
            // decided independently.
            let isGate = false;

            for (let lookahead = at + 1; lookahead < Math.min(at + 7, stop); lookahead += 1) {
                const next = lines[lookahead] ?? '';

                if (/^ {12}- name: /.test(next)) {
                    break;
                }

                if (/^ {14}id: [a-z-]*gate$/.test(next)) {
                    isGate = true;
                    break;
                }

                const matched = /^ {14}if: (.+)$/.exec(next);

                if (matched) {
                    guard = matched[1] ?? '';
                    break;
                }
            }

            if (isGate) {
                continue;
            }

            found.push({ job, name, guard });
        }
    }

    return found;
}

/**
 * Steps that legitimately follow the gate WITHOUT a gate-derived `if:`, each with the reason.
 *
 * A stale entry fails too, so this cannot rot into fiction.
 */
const EXEMPT_POST_GATE_STEPS: ReadonlyMap<string, string> = new Map([
    [
        'Compose the deploy set',
        'It READS the two verdicts and publishes them as job outputs. Gating it on the gate would mean the ' +
            'job could not report "nothing to do", which is the answer the caller needs most: a `deploy` ' +
            'output that never gets written is indistinguishable from one that says false.',
    ],
]);

describe('every post-gate deploy step is guarded by the gate', () => {
    it('is not vacuous: the workflow really does have a gated job with steps after the gate', () => {
        const steps = postGateSteps();
        const jobs = new Set(steps.map((step) => step.job));

        // ⚠️ Was `> 10` across `deploy-food` and `deploy-recipe`. Every one of those steps DEPLOYED, and all
        // of them moved to `deploy-infra.yml` so that one workflow owns each stack. What follows the gate
        // here now is bookkeeping — the database wake and the verdict — so the count is small ON PURPOSE.
        expect(steps.length).toBeGreaterThanOrEqual(2);
        expect(jobs).toContain('gate');
    });

    it('⛔ no step after the gate runs unconditionally', () => {
        const unguarded = postGateSteps()
            .filter((step) => !step.guard.includes('gate.outputs') && !EXEMPT_POST_GATE_STEPS.has(step.name))
            .map(
                (step) => `${step.job}: "${step.name}" has no gate-derived if: — it runs even when the gate says skip`,
            );

        expect(unguarded).toEqual([]);
    });

    it('⛔ every exemption names a step that still exists', () => {
        const names = new Set(postGateSteps().map((step) => step.name));

        expect([...EXEMPT_POST_GATE_STEPS.keys()].filter((name) => !names.has(name))).toEqual([]);
    });

    /**
     * ⛔ THE PROPERTY THE MOVE MADE STRUCTURAL, and the reason the count above could fall without loss.
     *
     * The original defect was ONE missing `if:` among twelve — invisible to review and to YAML lint. Those
     * twelve are now a single job-level `if:` on a job that contains the whole deploy, so the failure mode
     * is not "a step was forgotten" but "the edge was deleted", which is a much louder edit. That edge is
     * the only thing standing between a reaped preview and a red check reporting failure for "nothing to
     * do", so it is asserted rather than assumed.
     */
    it('⛔ the deploy job runs only when the gate says so', () => {
        const doc = parse(readFileSync(WORKFLOW, 'utf8')) as {
            jobs?: Record<string, { if?: string; needs?: unknown }>;
        };
        const deploy = doc.jobs?.['deploy'];

        expect(deploy, 'the deploy job was renamed or removed — update this guard').toBeDefined();
        expect(deploy?.needs, 'the deploy job must depend on the gate that decides it').toEqual(['gate']);
        expect(
            deploy?.if ?? '',
            'the deploy job has no gate-derived `if:` — it would deploy even when the gate says skip',
        ).toContain('gate.outputs.deploy');
    });

    it('every guard reads an output the gate actually emits', () => {
        // A typo'd key silently evaluates to empty and skips the step forever — the quiet inverse of the
        // bug above. ⚠️ DERIVED from the gate job's own `outputs:` block rather than listed: the hand-written
        // list said `['deploy', 'live']` and was stale in BOTH directions — the gate had stopped emitting
        // `live` and had gained `packages`, so the guard was simultaneously permitting a dead key and ready
        // to raise a false finding against a real one.
        const outputs = /^ {8}outputs:\n((?:^ {12}[a-z_]+:.*\n)+)/mu.exec(readFileSync(WORKFLOW, 'utf8'))?.[1];
        const emitted = [...(outputs ?? '').matchAll(/^ {12}([a-z_]+):/gmu)].map((match) => match[1] ?? '');

        expect(emitted, 'the gate job publishes no outputs — this assertion would describe nothing').not.toEqual([]);
        const bogus = postGateSteps()
            .flatMap((step) => [...step.guard.matchAll(/gate\.outputs\.([a-z_]+)/g)].map((m) => ({ step, key: m[1] })))
            .filter(({ key }) => !emitted.includes(key ?? ''))
            .map(({ step, key }) => `${step.job}: "${step.name}" reads gate.outputs.${key}, which is never emitted`);

        expect(bogus).toEqual([]);
    });
});
