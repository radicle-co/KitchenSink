// @vitest-environment node
/**
 * Repo-wide guard: every caller supplies the teardown the environment the teardown says it needs.
 *
 * ## Why this exists
 *
 * `teardown-sandbox-pr.sh` documents its inputs in its own header — `PREVIEW_ZONE`,
 * `PREVIEW_HOSTED_ZONE_ID`, the three Vercel values, `GH_ENVIRONMENT_ADMIN_TOKEN`. Every one of them serves
 * a SECTION of the teardown, and the script is deliberately tolerant: a missing value makes that section
 * warn or error and the rest of the reclamation continues. That tolerance is correct, and it is also why
 * the omission is invisible — the run reclaims the expensive things, reports a warning nobody reads, and
 * leaves the cheap ones behind.
 *
 * It has now happened twice on one branch, in the same new caller:
 *
 * 1. `PREVIEW_HOSTED_ZONE_ID` was never passed, so `sandbox-down.yml` could not delete
 *    `pr-{N}.sandbox.<domain>`. The first real reap left the CNAME pointing at Vercel with the project
 *    binding already released — the subdomain-takeover vector ADR-0001 exists for.
 * 2. `GH_ENVIRONMENT_ADMIN_TOKEN` was never passed, so the legacy `sandbox-preview/pr-{N}` GitHub
 *    Environment was left behind on every reap through that door.
 *
 * Both were written by someone reading the on-close `cleanup` job and copying its SHAPE rather than its
 * environment. A guard is cheaper than remembering.
 *
 * ## Derived on both sides
 *
 * The required names come from the script's own header, not from a list here — so a new input documented
 * tomorrow is demanded of every caller the day it is written. The callers come from
 * `sandboxReclamationReachability`'s pinned invoker set, by the same reasoning.
 *
 * ⚠️ A value may be SUPPLIED as job/step `env:` or COMPUTED inside the step body. `sandbox-down.yml`
 * resolves the hosted zone in-step deliberately (a preceding step that can abort is what the 2026-07-28
 * incident was), so demanding an `env:` key specifically would push a correct caller into the wrong shape.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { WORKFLOWS_DIR } from './cdkApps.js';
import { repoRoot, trackedFiles } from './serviceSources.js';

const TEARDOWN = path.join(repoRoot, '.github/scripts/teardown-sandbox-pr.sh');

/**
 * The environment names the teardown documents as required, read out of its header.
 *
 * The header lists them under `# Environment (required …)` blocks, one name per line, optionally as a
 * `A / B / C` group. Anything indented under that heading and spelled in SCREAMING_SNAKE is an input.
 */
function documentedInputs(): readonly string[] {
    const header = readFileSync(TEARDOWN, 'utf8').split('\nset -')[0] ?? '';
    const sections = header.split(/^# Environment \(required/mu).slice(1);

    return [
        ...new Set(
            sections.flatMap((section) =>
                section
                    .split('\n')
                    .filter((line) => /^#\s{3}[A-Z]/u.test(line))
                    .flatMap((line) => (line.match(/\b[A-Z][A-Z0-9_]{3,}\b/gu) ?? []).slice(0, 3)),
            ),
        ),
        // ⚠️ Set by the runner itself, so no caller can be asked to pass it.
    ].filter((name) => name !== 'GITHUB_REPOSITORY');
}

/** Every job that invokes the teardown, with the text a value could reach it through. */
function callers(): readonly { readonly id: string; readonly text: string }[] {
    return trackedFiles(WORKFLOWS_DIR)
        .filter((file) => file.endsWith('.yml'))
        .flatMap((file) => {
            const doc = parse(readFileSync(path.join(repoRoot, file), 'utf8')) as {
                jobs?: Record<
                    string,
                    { env?: Record<string, unknown>; steps?: { env?: Record<string, unknown>; run?: string }[] }
                >;
            } | null;

            return Object.entries(doc?.jobs ?? {})
                .filter(([, job]) =>
                    (job.steps ?? []).some((step) =>
                        (step.run ?? '')
                            .split('\n')
                            .some((line) => line.includes('teardown-sandbox-pr.sh') && !/\bchmod\b/u.test(line)),
                    ),
                )
                .map(([name, job]) => ({
                    id: `${path.basename(file)}:${name}`,
                    // Job env + every step's env + every step's body: a value is "available" if the caller
                    // supplies it OR computes it, and both are legitimate.
                    text: [
                        Object.keys(job.env ?? {}).join('\n'),
                        ...(job.steps ?? []).flatMap((step) => [
                            Object.keys(step.env ?? {}).join('\n'),
                            step.run ?? '',
                        ]),
                    ].join('\n'),
                }));
        });
}

describe('every teardown caller supplies what the teardown documents', () => {
    it('reads the documented inputs at all', () => {
        // Non-vacuity: an empty contract makes every assertion below trivially true, which is the state
        // this guard would decay into if the header were reformatted.
        expect(documentedInputs().length).toBeGreaterThanOrEqual(5);
    });

    it('finds the callers at all', () => {
        expect(callers().length).toBeGreaterThanOrEqual(3);
    });

    it.each(callers().map((caller) => [caller.id, caller] as const))('%s', (_id, caller) => {
        const missing = documentedInputs().filter((name) => !caller.text.includes(name));

        expect(missing, `${caller.id} never provides or computes these, so their teardown sections skip`).toEqual([]);
    });
});
