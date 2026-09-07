// @vitest-environment node
/**
 * Repo-wide guard: the PROVENANCE invariants of `.github/workflows/` — where CI's tools come from, and
 * whose name goes on the commits CI makes.
 *
 * ## Why this file exists (two real defects, one shape)
 *
 * `#139` and `#134` below are code-quality-backlog IDs, NOT github.com issue numbers in this repo (whose
 * highest number was 90 on 2026-08-07) — do not waste a lookup on them; the defects are described in full.
 *
 * `workflowInvariants.test.ts` asserts that the pipeline's WORK cannot silently vanish. This file asserts
 * the complementary property: that the pipeline's INPUTS and OUTPUTS are attributable.
 *
 *   1. **Unpinned third-party tooling** (issue #139). The Maestro CLI was installed with
 *      `curl -Ls https://get.maestro.mobile.dev | bash`, which takes whatever is latest. Two distinct
 *      failures. Correctness: the pixel baselines under
 *      `packages/apps/commise/mobile/.maestro/visual/baselines` are coupled to the screenshot pipeline and
 *      image-comparison engine of the CLI that recorded them, so an upstream release reds the visual tier
 *      with no change on our side — a red nobody can attribute to a diff. Security: this is a PUBLIC repo,
 *      and piping a mutable script from a third-party host into `bash` executes whatever that host serves
 *      at the moment CI runs, unreviewed, unrecorded, and with the runner's full token scope in the
 *      environment. Pinning the version is also the documented PREREQUISITE for activating those (still
 *      inert) visual flows.
 *   2. **Ambient commit identity** (issue #134). No workflow in this repo creates a commit today — verified
 *      below, and asserted, so the claim stays true rather than being folklore. A workflow that grows one
 *      and does not configure `user.name`/`user.email` inherits the runner's ambient identity, and the
 *      resulting commit is attributable to nobody: `github-actions@users.noreply.github.com` (the string
 *      issue #134 names) is NOT GitHub's actions-bot address — the real one carries the app's numeric id
 *      (`41898282+github-actions[bot]@users.noreply.github.com`) — so commits bearing it link to no
 *      GitHub account at all, and neither `git shortlog` nor the blame sidebar can tell them from a
 *      human's. The repository convention is: the ACCOUNTABLE HUMAN is the author, and an agent's
 *      contribution is marked with the `Co-Authored-By:` trailer that `CLAUDE.md` already mandates. An
 *      automated commit that genuinely has no human behind it must say so with an explicit, non-default
 *      bot identity. Either way it is a decision written down in the workflow, not a default.
 *
 * ## How it is asserted
 *
 * Each invariant is a PURE analyzer: parsed workflows in, a sorted list of compact violation IDs out. Two
 * callers exercise every analyzer — the real tree (must be clean) and deliberately broken FIXTURES in a
 * temp dir (must be flagged, with negative controls that must not be). The fixtures carry the permanent
 * mutation evidence, which matters more than usual here: invariant 2's real-tree result is EMPTY BECAUSE
 * NOTHING COMMITS, so a `toEqual([])` against the real tree alone would pass just as happily with the
 * analyzer deleted. The fixtures are what make it a guard instead of a decoration.
 *
 * ## Mutation evidence (every assertion below has been watched fail)
 *
 * Written BEFORE the fix, against the then-unpinned `_ci-heavy.yml`, and its first run reported the LIVE
 * defect rather than a green tree:
 *
 *     - "piped-to-shell _ci-heavy.yml::e2e-mobile-maestro::Install Maestro CLI"
 *     - "maestro-unpinned … → no literal MAESTRO_VERSION"
 *     - "maestro-unpinned … → no tagged release URL"
 *     - "maestro-unverified … → no sha256 recorded" / "→ no sha256 checked"
 *
 * That same first run also flagged the SIBLING step `Boot recipe-service (Docker, dev-bypass)`, because the
 * original predicate was "mentions maestro AND curls": the container is tagged `recipe-maestro` and the boot
 * loop curls `/health`. A guard that cries wolf is a guard nobody reads, so `isMaestroInstall` was narrowed
 * to the two upstream SOURCES; mutation M8 below restores the loose predicate and reds, which is what keeps
 * that fix from being undone.
 *
 * Then 12 analyzer mutations, each applied to a byte-copy of this file, run, and reverted (`md5sum -c`
 * verified). ALL 12 were killed:
 *
 *   1. **Pipe-to-shell** — M1 stub `pipesRemoteScriptIntoShell` → `[]`; M2 drop the floating-release term
 *      (reds `floating.yml`); M3 drop the pipe term (reds `piped.yml` AND the `wget … | sudo sh` variant,
 *      which is why the pattern is not just `curl … | bash`).
 *   2. **Maestro pin** — M4 accept any `MAESTRO_VERSION` (reds `unpinned.yml` and
 *      `version-expression-only.yml`: a version fed from an input is not a pin); M5 drop the tagged-URL
 *      check (reds `pinned-but-latest-url.yml` — the var declared and then ignored, i.e. how a pin rots);
 *      M6 drop the recorded-digest check; M7 drop the digest-VERIFIED check (reds
 *      `digest-printed-not-checked.yml` — printing a digest is not checking one); M8 the loose predicate
 *      above.
 *   3. **Commit identity** — M9 stub the analyzer; M10 look for `git config` anywhere in the WORKFLOW
 *      instead of the same job (reds `identity-other-job.yml`, whose identity is set on a different runner);
 *      M11 drop the action-input requirement (reds `action-no-author.yml`); M12 drop the unlinked-address
 *      check (reds `bot-lookalike.yml`, which carries issue #134's exact string).
 *
 * Real-tree anti-vacuity for invariant 3, which is otherwise empty-because-nothing-commits: injecting
 *
 *     - name: Commit the report back
 *       run: |
 *           git add -A
 *           git commit -m regenerate
 *
 * into `_ci-heavy.yml` produced `unattributed-commit _ci-heavy.yml::e2e-mobile-maestro::Commit the report
 * back → no git user.name/user.email in this job` and reds BOTH assertions in that block. The file was
 * restored from a byte-copy and re-verified with `md5sum -c`.
 */
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const WORKFLOW_DIR = fileURLToPath(new URL('../../../../.github/workflows/', import.meta.url));

interface WorkflowStep {
    readonly name?: string;
    readonly run?: string;
    readonly uses?: string;
    readonly env?: Readonly<Record<string, unknown>>;
    readonly with?: Readonly<Record<string, unknown>>;
}

interface WorkflowJob {
    readonly env?: Readonly<Record<string, unknown>>;
    readonly steps?: readonly WorkflowStep[];
}

interface WorkflowDocument {
    readonly env?: Readonly<Record<string, unknown>>;
    readonly jobs?: Readonly<Record<string, WorkflowJob>>;
}

interface Workflow {
    readonly file: string;
    readonly doc: WorkflowDocument;
}

/** One step, carried with enough context to name it in a violation ID. */
interface LocatedStep {
    readonly workflow: Workflow;
    readonly job: string;
    readonly step: WorkflowStep;
    readonly index: number;
}

/** Parse every workflow in a directory, in filename order. */
function load(directory: string): readonly Workflow[] {
    return readdirSync(directory)
        .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
        .sort()
        .map((file) => ({ file, doc: parse(readFileSync(join(directory, file), 'utf8')) as WorkflowDocument }));
}

/** The real `.github/workflows/` tree. */
function realWorkflows(): readonly Workflow[] {
    return load(WORKFLOW_DIR);
}

/**
 * Write the given YAML bodies into a throwaway directory and parse them as a workflow tree.
 *
 * @sideEffect Creates a temp directory. Real workflow files are never touched.
 */
function fixture(files: Readonly<Record<string, string>>): readonly Workflow[] {
    const directory = mkdtempSync(join(tmpdir(), 'workflow-provenance-'));

    for (const [name, body] of Object.entries(files)) {
        writeFileSync(join(directory, name), body);
    }

    return load(directory);
}

/** Every step of every job, flattened, in declaration order. */
function allSteps(workflows: readonly Workflow[]): readonly LocatedStep[] {
    return workflows.flatMap((workflow) =>
        Object.entries(workflow.doc.jobs ?? {}).flatMap(([job, definition]) =>
            (definition.steps ?? []).map((step, index) => ({ workflow, job, step, index })),
        ),
    );
}

/** A step's stable identity for violation IDs. */
function label({ workflow, job, step, index }: LocatedStep): string {
    const own = step.name ?? step.uses ?? (step.run ?? '').split('\n')[0]?.trim();

    return `${workflow.file}::${job}::${own === undefined || own === '' ? `step[${index}]` : own}`;
}

/** The env visible to a step: workflow-level, then job-level, then the step's own. */
function visibleEnv(located: LocatedStep): Readonly<Record<string, string>> {
    const job = located.workflow.doc.jobs?.[located.job];
    const merged: Record<string, string> = {};

    for (const source of [located.workflow.doc.env, job?.env, located.step.env]) {
        for (const [key, value] of Object.entries(source ?? {})) {
            merged[key] = String(value);
        }
    }

    return merged;
}

// ---------------------------------------------------------------------------------------------------------
// Invariant 1 — no floating third-party tooling.
//
// Two shapes, one property: CI must never execute bytes it cannot name. Piping a remote script into a shell
// is the worst case (the bytes are chosen at run time by someone else); a `releases/latest/download` URL is
// the same defect one layer down, and is what an installer that "helpfully" tracks upstream does.
// ---------------------------------------------------------------------------------------------------------

/** `curl … | bash`, `wget … | sh`, `… | sudo bash` — a remote script executed sight-unseen. */
const PIPE_TO_SHELL = /\b(?:curl|wget)\b[^|\n]*\|[^|\n]*\b(?:ba|z|k)?sh\b/;

/** A release URL that resolves to whatever is newest at run time. */
const FLOATING_RELEASE_URL = /releases\/latest\/download/;

function pipesRemoteScriptIntoShell(workflows: readonly Workflow[]): readonly string[] {
    return allSteps(workflows)
        .flatMap((located) => {
            const run = located.step.run ?? '';
            const findings: string[] = [];

            if (PIPE_TO_SHELL.test(run)) {
                findings.push(`piped-to-shell ${label(located)}`);
            }

            if (FLOATING_RELEASE_URL.test(run)) {
                findings.push(`floating-release ${label(located)}`);
            }

            return findings;
        })
        .sort();
}

// ---------------------------------------------------------------------------------------------------------
// Invariant 2 — the Maestro CLI is pinned by version AND verified by checksum.
//
// Narrower than invariant 1 on purpose. Invariant 1 forbids the *mechanism* that was in use; this one states
// the positive requirement for the one tool whose version our committed baselines are coupled to, so that
// swapping `curl | bash` for a direct download of `…/releases/latest/…` does not quietly satisfy the guard.
// ---------------------------------------------------------------------------------------------------------

/**
 * A step that fetches the Maestro CLI from upstream.
 *
 * Keyed on the two upstream SOURCES, not on the word "maestro": the sibling step that boots the
 * recipe-service tags its container `recipe-maestro` and curls a health endpoint, and a name-and-curl
 * heuristic reports it as an unpinned install — a false positive that would train the reader to ignore this
 * guard. (Measured: it did exactly that on the first run.)
 */
function isMaestroInstall(located: LocatedStep): boolean {
    const run = located.step.run ?? '';

    return /get\.maestro\.mobile\.dev|mobile-dev-inc\/maestro/i.test(run);
}

const SEMVER = /^\d+\.\d+\.\d+$/;
const SHA256_LITERAL = /\b[0-9a-f]{64}\b/;
const CHECKSUM_VERIFIED = /\b(?:sha256sum|shasum)\b[^\n]*(?:--check|\s-c\b)/;

function maestroInstallIsPinned(workflows: readonly Workflow[]): readonly string[] {
    return allSteps(workflows)
        .filter(isMaestroInstall)
        .flatMap((located) => {
            const run = located.step.run ?? '';
            const version = visibleEnv(located)['MAESTRO_VERSION'];
            const findings: string[] = [];

            // A `MAESTRO_VERSION` fed from an input, a variable or a secret is not a pin: it can change
            // without a diff to this repo, which is the whole failure being prevented.
            if (version === undefined || !SEMVER.test(version)) {
                findings.push(`maestro-unpinned ${label(located)} → no literal MAESTRO_VERSION`);
            }

            // The pin has to be the thing actually fetched. Declaring the version and then downloading
            // `latest` is how a pin rots into decoration.
            if (!/releases\/download\/cli-(?:\$\{?MAESTRO_VERSION\}?|\d+\.\d+\.\d+)/.test(run)) {
                findings.push(`maestro-unpinned ${label(located)} → no tagged release URL`);
            }

            // Integrity: a recorded digest, and an actual verification of it. Printing a digest is not
            // checking one, so both terms are required.
            if (!SHA256_LITERAL.test(run) && !SHA256_LITERAL.test(visibleEnv(located)['MAESTRO_SHA256'] ?? '')) {
                findings.push(`maestro-unverified ${label(located)} → no sha256 recorded`);
            }

            if (!CHECKSUM_VERIFIED.test(run)) {
                findings.push(`maestro-unverified ${label(located)} → no sha256 checked`);
            }

            return findings;
        })
        .sort();
}

// ---------------------------------------------------------------------------------------------------------
// Invariant 3 — a workflow that commits declares WHO commits.
//
// The real tree has no committing step, so this analyzer's job today is to stay armed for the first one.
// ---------------------------------------------------------------------------------------------------------

/** `git commit` in a `run:` body — the direct way a workflow authors a commit. */
const GIT_COMMIT = /\bgit\s+(?:-[^\s]+\s+)*commit\b/;

/**
 * Marketplace actions that author a commit on the caller's behalf. Each pairs with the inputs that carry an
 * explicit identity, because for these the identity is configured through `with:`, not `git config`.
 */
const COMMITTING_ACTIONS: readonly { readonly action: string; readonly identityInputs: readonly string[] }[] = [
    { action: 'stefanzweifel/git-auto-commit-action', identityInputs: ['commit_user_name', 'commit_user_email'] },
    { action: 'EndBug/add-and-commit', identityInputs: ['author_name', 'author_email', 'default_author'] },
    { action: 'peter-evans/create-pull-request', identityInputs: ['committer', 'author'] },
];

/** `git config … user.email <value>` — the value, however it is quoted. */
const GIT_CONFIG_EMAIL = /\bgit\s+config\b[^\n]*\buser\.email\b\s+["']?([^"'\s]+)/;
const GIT_CONFIG_NAME = /\bgit\s+config\b[^\n]*\buser\.name\b/;

/**
 * Addresses that name no accountable party. `github-actions@users.noreply.github.com` (issue #134) looks
 * like GitHub's actions bot but is not it — the real address carries the app's numeric id — so it links to
 * no GitHub account, and a commit bearing it is indistinguishable from a human's in `git shortlog`.
 */
const UNLINKED_IDENTITIES: readonly string[] = [
    'github-actions@users.noreply.github.com',
    'actions@github.com',
    'noreply@github.com',
];

/** Steps that author a commit, whether by shelling out to git or by delegating to an action. */
function committingSteps(workflows: readonly Workflow[]): readonly LocatedStep[] {
    return allSteps(workflows).filter((located) => {
        if (GIT_COMMIT.test(located.step.run ?? '')) {
            return true;
        }

        const uses = located.step.uses ?? '';

        return COMMITTING_ACTIONS.some(({ action }) => uses.startsWith(`${action}@`));
    });
}

function commitsCarryADeclaredIdentity(workflows: readonly Workflow[]): readonly string[] {
    return committingSteps(workflows)
        .flatMap((located) => {
            const findings: string[] = [];
            const uses = located.step.uses ?? '';
            const delegated = COMMITTING_ACTIONS.find(({ action }) => uses.startsWith(`${action}@`));

            if (delegated !== undefined) {
                const inputs = located.step.with ?? {};

                if (!delegated.identityInputs.some((input) => inputs[input] !== undefined)) {
                    findings.push(`unattributed-commit ${label(located)} → action sets no explicit author`);
                }

                for (const input of delegated.identityInputs) {
                    const value = String(inputs[input] ?? '');

                    if (UNLINKED_IDENTITIES.some((address) => value.includes(address))) {
                        findings.push(`unattributed-commit ${label(located)} → identity links to no account`);
                    }
                }

                return findings;
            }

            // A `run:` commit is configured by an earlier `git config` in the SAME job: a later step, or one
            // in another job, runs on a different checkout (or a different runner entirely).
            const job = located.workflow.doc.jobs?.[located.job];
            const earlier = (job?.steps ?? []).slice(0, located.index + 1).map((step) => step.run ?? '');
            const emails = earlier.flatMap((run) => GIT_CONFIG_EMAIL.exec(run)?.[1] ?? []);

            if (emails.length === 0 || !earlier.some((run) => GIT_CONFIG_NAME.test(run))) {
                findings.push(`unattributed-commit ${label(located)} → no git user.name/user.email in this job`);
            }

            for (const email of emails) {
                if (UNLINKED_IDENTITIES.some((address) => email.includes(address))) {
                    findings.push(`unattributed-commit ${label(located)} → identity links to no account`);
                }
            }

            return findings;
        })
        .sort();
}

// ---------------------------------------------------------------------------------------------------------

describe('workflow provenance — third-party tooling is pinned', () => {
    it('no workflow pipes a remote script into a shell, or downloads a floating release', () => {
        expect(pipesRemoteScriptIntoShell(realWorkflows())).toEqual([]);
    });

    it('flags both floating-tooling shapes, and leaves a pinned download alone', () => {
        const flagged = pipesRemoteScriptIntoShell(
            fixture({
                'piped.yml': [
                    'name: piped',
                    'on: push',
                    'jobs:',
                    '    tool:',
                    '        steps:',
                    '            - name: Install by pipe',
                    '              run: curl -Ls https://get.example.dev | bash',
                ].join('\n'),
                'piped-wget-sudo.yml': [
                    'name: wget',
                    'on: push',
                    'jobs:',
                    '    tool:',
                    '        steps:',
                    '            - name: Install by wget',
                    '              run: wget -qO- https://get.example.dev/install | sudo sh',
                ].join('\n'),
                'floating.yml': [
                    'name: floating',
                    'on: push',
                    'jobs:',
                    '    tool:',
                    '        steps:',
                    '            - name: Download newest',
                    '              run: curl -sSfL -o /tmp/t.zip https://github.com/o/r/releases/latest/download/t.zip',
                ].join('\n'),
                'pinned.yml': [
                    'name: pinned',
                    'on: push',
                    'jobs:',
                    '    tool:',
                    '        steps:',
                    '            - name: Download pinned',
                    '              run: curl -sSfL -o /tmp/t.zip https://github.com/o/r/releases/download/v1.2.3/t.zip',
                ].join('\n'),
            }),
        );

        expect(flagged).toEqual([
            'floating-release floating.yml::tool::Download newest',
            'piped-to-shell piped-wget-sudo.yml::tool::Install by wget',
            'piped-to-shell piped.yml::tool::Install by pipe',
        ]);
    });
});

describe('workflow provenance — the Maestro CLI is pinned and checksum-verified', () => {
    it('the real Maestro install names a version, fetches that tag, and verifies a digest', () => {
        expect(maestroInstallIsPinned(realWorkflows())).toEqual([]);
    });

    it('and there IS a Maestro install to have checked (the assertion above is not vacuous)', () => {
        expect(allSteps(realWorkflows()).filter(isMaestroInstall).map(label)).toEqual([
            '_ci-heavy.yml::e2e-mobile-maestro::Install Maestro CLI (pinned)',
        ]);
    });

    it('rejects every way a Maestro pin can be absent or decorative', () => {
        const digest = 'a'.repeat(64);
        const install = (body: string, env: readonly string[] = []): string =>
            [
                'name: maestro',
                'on: push',
                'jobs:',
                '    mobile:',
                '        steps:',
                '            - name: Install Maestro',
                ...(env.length > 0 ? ['              env:', ...env.map((line) => `                  ${line}`)] : []),
                '              run: |',
                ...body.split('\n').map((line) => `                  ${line}`),
            ].join('\n');

        const flagged = maestroInstallIsPinned(
            fixture({
                // No version anywhere: the defect issue #139 reported.
                'unpinned.yml': install('curl -Ls https://get.maestro.mobile.dev | bash'),
                // A version that can change without a diff here is not a pin.
                'version-expression-only.yml': install(
                    `curl -sSfL -o m.zip "https://github.com/mobile-dev-inc/maestro/releases/download/cli-\${MAESTRO_VERSION}/maestro.zip"\necho "${digest}  m.zip" | sha256sum --check -`,
                    ['MAESTRO_VERSION: ${{ inputs.maestro_version }}'],
                ),
                // Declared and then ignored — the way a pin rots.
                'pinned-but-latest-url.yml': install(
                    `curl -sSfL -o m.zip https://github.com/mobile-dev-inc/maestro/releases/latest/download/maestro.zip\necho "${digest}  m.zip" | sha256sum --check -`,
                    ["MAESTRO_VERSION: '2.6.1'"],
                ),
                // Pinned but unverified.
                'no-checksum.yml': install(
                    'curl -sSfL -o m.zip "https://github.com/mobile-dev-inc/maestro/releases/download/cli-${MAESTRO_VERSION}/maestro.zip"',
                    ["MAESTRO_VERSION: '2.6.1'"],
                ),
                // Printing a digest is not verifying one.
                'digest-printed-not-checked.yml': install(
                    `curl -sSfL -o m.zip "https://github.com/mobile-dev-inc/maestro/releases/download/cli-\${MAESTRO_VERSION}/maestro.zip"\nsha256sum m.zip\n# expected ${digest}`,
                    ["MAESTRO_VERSION: '2.6.1'"],
                ),
                // Negative control: pinned, fetched by tag, digest recorded in env and checked.
                'correct.yml': install(
                    'curl -sSfL -o m.zip "https://github.com/mobile-dev-inc/maestro/releases/download/cli-${MAESTRO_VERSION}/maestro.zip"\necho "${MAESTRO_SHA256}  m.zip" | sha256sum --check --strict -',
                    ["MAESTRO_VERSION: '2.6.1'", `MAESTRO_SHA256: '${digest}'`],
                ),
            }),
        );

        expect(flagged).toEqual([
            'maestro-unpinned pinned-but-latest-url.yml::mobile::Install Maestro → no tagged release URL',
            'maestro-unpinned unpinned.yml::mobile::Install Maestro → no literal MAESTRO_VERSION',
            'maestro-unpinned unpinned.yml::mobile::Install Maestro → no tagged release URL',
            'maestro-unpinned version-expression-only.yml::mobile::Install Maestro → no literal MAESTRO_VERSION',
            'maestro-unverified digest-printed-not-checked.yml::mobile::Install Maestro → no sha256 checked',
            'maestro-unverified no-checksum.yml::mobile::Install Maestro → no sha256 checked',
            'maestro-unverified no-checksum.yml::mobile::Install Maestro → no sha256 recorded',
            'maestro-unverified unpinned.yml::mobile::Install Maestro → no sha256 checked',
            'maestro-unverified unpinned.yml::mobile::Install Maestro → no sha256 recorded',
        ]);
    });
});

describe('workflow provenance — an automated commit names its author', () => {
    it('every committing step declares an identity that links to an account', () => {
        expect(commitsCarryADeclaredIdentity(realWorkflows())).toEqual([]);
    });

    it('records that NO workflow currently authors a commit', () => {
        // Issue #134's `github-actions@users.noreply.github.com` commits are NOT produced here: they came
        // from a repo-local `.git/config` on a developer clone. This assertion is the standing record of
        // that finding — if a committing step is ever added, this fails and whoever adds it must decide the
        // identity deliberately (and extend `UNLINKED_IDENTITIES`/`COMMITTING_ACTIONS` if needed) rather
        // than inheriting the runner's ambient one.
        expect(committingSteps(realWorkflows()).map(label)).toEqual([]);
    });

    it('flags an unattributed commit however it is authored, and accepts a declared identity', () => {
        const flagged = commitsCarryADeclaredIdentity(
            fixture({
                // Bare `git commit` with no identity configured.
                'bare.yml': [
                    'name: bare',
                    'on: push',
                    'jobs:',
                    '    write:',
                    '        steps:',
                    '            - name: Commit',
                    '              run: |',
                    '                  git add -A',
                    '                  git commit -m "chore: regenerate"',
                ].join('\n'),
                // The identity is set, but in a DIFFERENT job — a different runner and checkout.
                'identity-other-job.yml': [
                    'name: split',
                    'on: push',
                    'jobs:',
                    '    setup:',
                    '        steps:',
                    '            - run: git config user.name bot && git config user.email bot@example.com',
                    '    write:',
                    '        steps:',
                    '            - name: Commit',
                    '              run: git commit -m regenerate',
                ].join('\n'),
                // Issue #134's exact string: configured, but attributable to nobody.
                'bot-lookalike.yml': [
                    'name: lookalike',
                    'on: push',
                    'jobs:',
                    '    write:',
                    '        steps:',
                    '            - name: Commit',
                    '              run: |',
                    '                  git config user.name "Brandon"',
                    '                  git config user.email "github-actions@users.noreply.github.com"',
                    '                  git commit -m "chore: regenerate"',
                ].join('\n'),
                // Delegated to an action with no author input.
                'action-no-author.yml': [
                    'name: delegated',
                    'on: push',
                    'jobs:',
                    '    write:',
                    '        steps:',
                    '            - uses: stefanzweifel/git-auto-commit-action@v5',
                    '              with:',
                    '                  commit_message: "chore: regenerate"',
                ].join('\n'),
                // Negative control: a `run:` commit with a full, linked identity.
                'declared-run.yml': [
                    'name: declared',
                    'on: push',
                    'jobs:',
                    '    write:',
                    '        steps:',
                    '            - name: Commit',
                    '              run: |',
                    '                  git config user.name "commise-ci[bot]"',
                    '                  git config user.email "1234567+commise-ci[bot]@users.noreply.github.com"',
                    '                  git commit -m "chore: regenerate"',
                ].join('\n'),
                // Negative control: a delegated commit with an explicit author.
                'declared-action.yml': [
                    'name: declared-action',
                    'on: push',
                    'jobs:',
                    '    write:',
                    '        steps:',
                    '            - uses: stefanzweifel/git-auto-commit-action@v5',
                    '              with:',
                    '                  commit_user_name: "commise-ci[bot]"',
                    '                  commit_user_email: "1234567+commise-ci[bot]@users.noreply.github.com"',
                ].join('\n'),
            }),
        );

        expect(flagged).toEqual([
            'unattributed-commit action-no-author.yml::write::stefanzweifel/git-auto-commit-action@v5 → action sets no explicit author',
            'unattributed-commit bare.yml::write::Commit → no git user.name/user.email in this job',
            'unattributed-commit bot-lookalike.yml::write::Commit → identity links to no account',
            'unattributed-commit identity-other-job.yml::write::Commit → no git user.name/user.email in this job',
        ]);
    });
});
