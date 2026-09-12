// @vitest-environment node
/**
 * Repo-wide guard: a workflow that can only be reached by `schedule` or `workflow_dispatch` must be
 * REGISTRABLE from a branch, and registering it must do no work.
 *
 * ## The trap, which has now caught this repository three times
 *
 * GitHub will not dispatch a workflow it holds no RECORD for, and it creates a record only when the file
 * reaches the default branch or when the workflow actually RUNS. A file whose only triggers are
 * `workflow_dispatch` and `schedule` can do neither while it lives on a feature branch:
 *
 *   - `schedule` fires only from the default branch, so it never runs;
 *   - `workflow_dispatch` needs the record that running would have created.
 *
 * A closed loop. The symptom is not an error in CI — it is `gh workflow run <file>` answering
 * `not found on the default branch`, and the workflow appearing nowhere in the Actions list, which reads as
 * "this button does not exist" rather than "this button is not registered yet".
 *
 * It caught `sandbox-up.yml` (fixed by the `push:` registration trigger its header documents), it caught
 * `deployed-e2e.yml` and `sandbox-reconcile.yml`, and then it caught `sandbox-reap.yml`, `sandbox-down.yml`
 * and `account-deploy.yml` on the day they were written — by an author who had read that header earlier the
 * same session. A comment in one file does not generalise; this does.
 *
 * ## The compounding case, which is worse than the first
 *
 * `sandbox-reap.yml` dispatches `sandbox-down.yml`. An unregistered CALLEE means the reaper runs, finds the
 * expired previews, dispatches nothing, and reports what it did — a green run that reclaimed no
 * infrastructure. That is the "green having done nothing" failure this repository keeps paying for, one
 * indirection further out than usual, and it is why the second assertion below exists.
 *
 * ## What a registration trigger must NOT do
 *
 * It exists so the button EXISTS. A push must therefore stand nothing up and tear nothing down — otherwise
 * registration becomes the automatic-deploy posture ADR-0028 removed, or, for `sandbox-down.yml`,
 * a push that DESTROYS a preview. So every job in such a workflow is asserted to be guarded against the
 * push event, and the `paths:` scoped to the workflow's own file.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { WORKFLOWS_DIR, foldContinuations, withoutComments } from './cdkApps.js';
import { repoRoot, trackedFiles } from './serviceSources.js';

interface Workflow {
    readonly name: string;
    /** The parsed document, for trigger and job structure. */
    readonly doc: {
        on?: Record<string, unknown>;
        jobs?: Record<string, { if?: string }>;
    };
    /** The raw text, comments stripped, for the dispatch scan. */
    readonly text: string;
}

const workflows = (): readonly Workflow[] =>
    trackedFiles(WORKFLOWS_DIR)
        .filter((file) => file.endsWith('.yml'))
        .map((file) => {
            const raw = readFileSync(path.join(repoRoot, file), 'utf8');

            return { name: path.basename(file), doc: parse(raw) ?? {}, text: withoutComments(raw) };
        });

/** The triggers a workflow declares. */
const triggers = (workflow: Workflow): readonly string[] => Object.keys(workflow.doc.on ?? {});

/**
 * Whether the default branch already holds this workflow.
 *
 * ⛔ THE OTHER HALF OF THE PROPERTY, and without it this guard is nonsense. Being on the default branch IS
 * what creates a record — so `prod-deploy.yml`, `ci-pr.yml` and every other long-merged
 * dispatch-or-schedule workflow needs no registration trigger and never did. A guard that demanded one
 * everywhere would be reporting a defect against eight correct files, and would be deleted rather than
 * obeyed.
 *
 * The population is therefore self-limiting: a workflow drops out of it the day it merges, at which point
 * its registration trigger becomes redundant (harmless, and cheaper to leave than to remove — removing it
 * would un-register the file on every branch that has not merged yet).
 */
let defaultBranchVerified = false;

const onDefaultBranch = (name: string): boolean => {
    // ⛔ "The default branch is not here" must not read as "this file is not on the default branch". A
    // depth-1 checkout has no `origin/main` at all, and the `cat-file` below then fails for EVERY workflow —
    // which is how this guard's first CI run accused five workflows that have lived on `main` for months of
    // lacking a registration trigger. Fail once, loudly, naming the real cause.
    if (!defaultBranchVerified) {
        try {
            execFileSync('git', ['rev-parse', '--verify', '--quiet', 'origin/main^{commit}'], {
                cwd: repoRoot,
                stdio: 'ignore',
            });
        } catch {
            throw new Error(
                'origin/main is not in this checkout, so whether a workflow is on the default branch cannot be ' +
                    'answered. Check out with `fetch-depth: 0` (deploy-infra.yml › global does).',
            );
        }

        defaultBranchVerified = true;
    }

    try {
        execFileSync('git', ['cat-file', '-e', `origin/main:${WORKFLOWS_DIR}/${name}`], {
            cwd: repoRoot,
            stdio: 'ignore',
        });

        return true;
    } catch {
        return false;
    }
};

/**
 * Workflows reachable ONLY from the default branch — the ones that need a registration trigger.
 *
 * `pull_request` and `workflow_call` both run a file from a feature branch, so a workflow carrying either is
 * exercised (and recorded) without help. What is left is the dispatch/schedule-only file.
 */
const branchUnreachable = (workflow: Workflow): boolean => {
    const on = triggers(workflow);
    const reachable = ['pull_request', 'pull_request_target', 'workflow_call', 'workflow_run', 'issue_comment'];

    if (!on.includes('workflow_dispatch') && !on.includes('schedule')) {
        return false;
    }

    if (on.some((trigger) => reachable.includes(trigger))) {
        return false;
    }

    // ⚠️ A `push` trigger only registers the file if it can fire on the branch the file is ON. A
    // `branches: [main]` push cannot, and that is not a hypothetical: `account-deploy.yml` was written with
    // exactly that trigger and was just as unregistrable as the two workflows with no push at all — while
    // LOOKING registered to any check that merely asked "is there a push trigger?".
    const push = (workflow.doc.on ?? {})['push'] as { branches?: string[] } | undefined;
    const firesOnThisBranch = push !== undefined && !(push.branches ?? []).every((branch) => branch === 'main');

    return !firesOnThisBranch;
};

/**
 * Workflows exempted from carrying a registration trigger, each with the reason.
 *
 * ⛔ A stale entry FAILS, so this cannot rot into fiction.
 */
const EXEMPT: ReadonlyMap<string, string> = new Map([
    [
        'publish-infra-shared.yml',
        'Its `push` on main IS its work trigger — publishing the shared package on a change to ' +
            '`shared/infra/**` — so the job cannot be guarded against push without disabling the release ' +
            'path it exists for. Registering it would mean restructuring a release workflow, which is a ' +
            'larger and riskier change than the defect warrants. It is dispatchable the day it merges.',
    ],
]);

describe('a dispatch-only workflow can be registered from a branch', () => {
    const subjects = () =>
        workflows().filter(
            (workflow) => branchUnreachable(workflow) && !onDefaultBranch(workflow.name) && !EXEMPT.has(workflow.name),
        );

    it('finds the workflows this applies to', () => {
        // Non-vacuity: `it.each` over an empty population is a green suite asserting nothing.
        expect(subjects().length).toBeGreaterThan(0);
    });

    it('every exemption still names a workflow that would otherwise be a subject', () => {
        // A stale exemption is a lie that reads as a rule. If the named workflow merges, or gains a real
        // registration trigger, the entry must go.
        const stale = [...EXEMPT.keys()].filter((name) => {
            const workflow = workflows().find((entry) => entry.name === name);

            return workflow === undefined || !branchUnreachable(workflow) || onDefaultBranch(name);
        });

        expect(stale).toEqual([]);
    });

    it.each(subjects().map((workflow) => [workflow.name] as const))(
        '%s carries a push registration trigger',
        (name) => {
            const workflow = workflows().find((entry) => entry.name === name);
            const push = (workflow?.doc.on ?? {})['push'] as { paths?: string[] } | undefined;

            expect(
                push,
                `${name} has no push trigger, so GitHub will never hold a record for it and it cannot be dispatched`,
            ).toBeDefined();
            // Scoped to its OWN file: a broader `paths:` turns every unrelated push into a run of this workflow.
            expect(push?.paths ?? []).toContain(`.github/workflows/${name}`);
            // ⛔ AND it must be able to fire on the branch the file is on. A `branches: [main]` push names the
            // right path and still registers nothing from a feature branch — which is precisely how
            // `account-deploy.yml` looked correct to a check that only asked whether a push trigger existed.
            expect(
                (push as { branches?: string[] } | undefined)?.branches ?? [],
                `${name}'s push cannot fire off main, so it registers nothing`,
            ).not.toEqual(['main']);
        },
    );

    it.each(subjects().map((workflow) => [workflow.name] as const))(
        '%s does no work on the registering push',
        (name) => {
            // ⛔ The registration run must be inert. For `sandbox-down.yml` this is not a tidiness rule —
            // an unguarded job would DESTROY a preview on every push that touched the file.
            const workflow = workflows().find((entry) => entry.name === name);
            const jobs = Object.entries(workflow?.doc.jobs ?? {});

            expect(jobs.length).toBeGreaterThan(0);

            for (const [job, body] of jobs) {
                expect(body.if ?? '', `${name}:${job} runs on a registration push`).toMatch(
                    /github\.event_name\s*==\s*'(workflow_dispatch|schedule)'/u,
                );
            }
        },
    );
});

describe('every workflow dispatched by another workflow is itself registrable', () => {
    /** `gh workflow run <file>` targets, found in any workflow's steps. */
    const dispatched = (): readonly { readonly caller: string; readonly callee: string }[] =>
        workflows().flatMap((workflow) =>
            [...workflow.text.matchAll(/gh workflow run\s+([a-z0-9._-]+\.yml)/gu)].map((match) => ({
                caller: workflow.name,
                callee: match[1] ?? '',
            })),
        );

    it('finds the dispatch sites', () => {
        expect(dispatched().length).toBeGreaterThan(0);
    });

    it.each(dispatched().map(({ caller, callee }) => [`${caller} -> ${callee}`, caller] as const))(
        '%s — the dispatch names a ref',
        (_label, caller) => {
            // ⛔ `gh workflow run` with no `--ref` targets the DEFAULT BRANCH. For a workflow that does not
            // exist there, GitHub answers `HTTP 422: Workflow does not have 'workflow_dispatch' trigger` —
            // a message that names the wrong cause entirely and sends the reader to inspect triggers that
            // are correct. The reaper hit this on its first real run: it found the expired preview, judged
            // it, and could not press the button.
            // ⚠️ Continuations folded first: these commands are written across several lines with `\`, so
            // a per-line scan reports `gh workflow run x.yml \` as ref-less while the `--ref` sits two lines
            // down. `foldContinuations` is the same helper `cdkApps.ts` uses for exactly this reason.
            const text = foldContinuations(workflows().find((workflow) => workflow.name === caller)?.text ?? '');

            for (const site of text.matchAll(/gh workflow run\s+[a-z0-9._-]+\.yml[^\n]*/gu)) {
                expect(site[0], `${caller} dispatches without --ref`).toMatch(/--ref/u);
            }
        },
    );

    it.each(dispatched().map(({ caller, callee }) => [`${caller} -> ${callee}`, callee] as const))(
        '%s — the callee can be dispatched at all',
        (_label, callee) => {
            // ⛔ THE COMPOUNDING CASE. A caller that dispatches an unregistered workflow does not fail
            // loudly: `gh workflow run` answers `not found on the default branch`, and unless the caller
            // treats that as fatal it reports success having caused nothing. `sandbox-reap.yml` would have
            // found every expired preview and reclaimed none of them.
            const target = workflows().find((workflow) => workflow.name === callee);

            expect(target, `${callee} is dispatched but does not exist`).toBeDefined();

            if (target !== undefined && branchUnreachable(target) && !onDefaultBranch(callee)) {
                const push = (target.doc.on ?? {})['push'] as { paths?: string[] } | undefined;

                expect(push?.paths ?? [], `${callee} is dispatched but can never hold a record`).toContain(
                    `.github/workflows/${callee}`,
                );
            }
        },
    );
});
