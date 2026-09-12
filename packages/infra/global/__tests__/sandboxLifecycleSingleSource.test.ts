// @vitest-environment node
/**
 * Repo-wide guard: a preview's lifecycle facts have **one source each**, and no second copy exists.
 *
 * ## The two copies that must not exist, and why
 *
 * A preview's lifecycle turns on two facts: *does this PR have a sandbox*, and *when was it last touched*.
 * A second copy of either duplicates something another system already records, and fails the way copies do:
 *
 * - a **`sandbox-up` label** ("this PR wants a sandbox") is maintained by hand. A label a human must
 *   remember is a single point of failure whose failure mode is SILENCE — forget it and everything skips,
 *   green.
 * - a **`SandboxExpiresAt` stack tag** as the deadline. `UpdateStack` REPLACES a stack's tag set rather than
 *   merging, so every deploy is a writer of it and a deploy that passes no value ERASES it — and one untagged
 *   stack condemns the whole token to the reaper. Keeping it means threading the value through every
 *   workflow, teaching every CDK app to write it, having ordinary pushes read it back so they do not wipe it,
 *   and refusing hand-dispatched deploys that cannot: machinery to protect a number from the pipeline that
 *   is supposed to be carrying it.
 *
 * Both are read at the source instead: a `kitchensink-*-pr-{N}` stack EXISTING is the first fact, its
 * `LastUpdatedTime` is the second, and `gh pr view` says whether the pull request is still open. None can be
 * forgotten, and no deploy can erase them.
 *
 * ## Why a guard rather than a note in the ADR
 *
 * Both copies are the *obvious* thing to add back. A reader who wants a deadline will reach for a tag,
 * because a tag is where deadlines go; a reader who wants intent will reach for a label. Neither would be
 * acting carelessly — they would be re-deriving a design that looks right and whose failure is invisible
 * until a preview is silently reaped or silently immortal. So the prohibition is executable.
 *
 * ⛔ If a future requirement genuinely needs per-preview state that neither AWS nor GitHub already holds,
 * this guard is the place to record the decision — by being changed deliberately, with the reason, not by
 * being deleted because it failed.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { WORKFLOWS_DIR, cdkApps, withInvokedScripts, withoutComments } from './cdkApps.js';
import { repoRoot, trackedFiles } from './serviceSources.js';

/** The retired intent marker. */
const RETIRED_LABEL = 'sandbox-up';

/** The retired deadline tag. */
const RETIRED_TAG = 'SandboxExpiresAt';

/** The retired environment variable that carried the deadline into a synth. */
const RETIRED_VARIABLE = 'SANDBOX_EXPIRES_AT';

/**
 * Every workflow as the code it runs — its own text plus the `.github/scripts/*.sh` it invokes — so a retired
 * marker moved into a script is still found.
 */
const workflowTexts = (): readonly { readonly name: string; readonly text: string }[] =>
    trackedFiles(WORKFLOWS_DIR)
        .filter((file) => file.endsWith('.yml'))
        .map((file) => ({
            name: path.basename(file),
            text: withInvokedScripts(withoutComments(readFileSync(path.join(repoRoot, file), 'utf8'))),
        }));

describe('the intent label is gone and stays gone', () => {
    it('is not vacuous: there are workflows to examine', () => {
        expect(workflowTexts().length).toBeGreaterThan(5);
    });

    it('no workflow applies, removes or reads the label', () => {
        // ⚠️ Comments are stripped first, deliberately. The label is named in prose all over this
        // repository — including in the file you are reading — and a text search that counted those would
        // be unfixable, so it would be deleted rather than obeyed.
        const offenders = workflowTexts()
            .filter((workflow) =>
                new RegExp(`(?:add-label|remove-label|labels?)[^\\n]*${RETIRED_LABEL}`, 'u').test(workflow.text),
            )
            .map((workflow) => workflow.name);

        expect(offenders).toEqual([]);
    });
});

describe('the deadline tag is gone and stays gone', () => {
    it('no CDK app writes the tag', () => {
        const offenders = cdkApps().filter((app) =>
            new RegExp(`Tags\\.of\\([^)]*\\)\\.add\\(\\s*'${RETIRED_TAG}'`, 'u').test(
                readFileSync(path.join(repoRoot, app), 'utf8'),
            ),
        );

        expect(offenders).toEqual([]);
    });

    it('no CDK app reads the variable that fed it', () => {
        const offenders = cdkApps().filter((app) =>
            readFileSync(path.join(repoRoot, app), 'utf8').includes(RETIRED_VARIABLE),
        );

        expect(offenders).toEqual([]);
    });

    it('no workflow threads the deadline as an input or an environment variable', () => {
        // The whole four-workflow chain, asserted absent in one place: an `expiresAt` input declared or
        // passed, or the variable exported to a synth. Any one of them reappearing means the carry-forward
        // dance is being rebuilt.
        const offenders = workflowTexts()
            .filter((workflow) => workflow.text.includes(RETIRED_VARIABLE) || /^\s+expiresAt:/mu.test(workflow.text))
            .map((workflow) => workflow.name);

        expect(offenders).toEqual([]);
    });
});

describe('the lifecycle facts are read from their real sources', () => {
    /**
     * The reaper — the one place that decides a preview is finished — as CODE: the workflow plus the scripts
     * it runs, with comments stripped from both.
     *
     * ⚠️ Both halves matter. The sweep runs from `sandboxReap.sh`, so the workflow alone no longer contains
     * these facts; and the workflow's header still NAMES them in prose, so a reading that kept comments would
     * be satisfied by a description of a reaper that no longer reads them.
     */
    const reaper = (): string =>
        withInvokedScripts(
            withoutComments(readFileSync(path.join(repoRoot, WORKFLOWS_DIR, 'sandboxReap.yml'), 'utf8')),
        );

    it('discovers previews from CloudFormation stack NAMES', () => {
        // Names, not tags: a tag is written by a deploy and can be stripped by one; a stack's name is fixed
        // at creation and survives a half-failed deploy, which is exactly the preview a reaper must find.
        expect(reaper()).toMatch(/kitchensink-\[a-z-\]\+-\(pr-\[0-9\]\+\)/u);
    });

    it('takes the deadline from a deploy time, through the shared pure function', () => {
        expect(reaper()).toMatch(/LastUpdatedTime/u);
        // The script is invoked by a quoted path, so the closing quote may sit between name and subcommand.
        expect(reaper()).toMatch(/sandboxLifetime\.sh"?\s+expires-at/u);
    });

    it('asks GitHub whether the pull request is still open', () => {
        expect(reaper()).toMatch(/gh pr view/u);
    });
});
