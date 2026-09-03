// @vitest-environment node
/**
 * Repo-wide guard: the documentation site is published PUBLICLY, on purpose, with the one control that
 * makes that safe — and it keeps exactly one address.
 *
 * ## ⛔ THIS FILE WAS REWRITTEN. What it used to assert is now FALSE.
 *
 * The previous version of this file asserted the opposite posture: that `docs.yml` refused to publish
 * unless the Vercel API reported `ssoProtection.deploymentType == "all"`, and that an unauthenticated
 * request to the published site was REFUSED — a `200` being the failure it existed to catch. Three of
 * its cases (`flags a deploy with no pre-flight protection assertion`, `flags a protection assertion
 * that runs AFTER the corpus is already published`, `flags a probe that would report success on a page
 * it was actually served`) asserted a guarantee that does not exist.
 *
 * That protection is **not available on this team's Vercel plan, and it fails OPEN**: measured
 * 2026-09-02, the API ACCEPTS the `ssoProtection` setting and does not enforce it, and a real preview
 * deployment served real content to an anonymous request. So the old gate was reporting a guarantee
 * nobody held — the worst possible state for a security control, and strictly worse than none, because
 * it is what everyone downstream was relying on.
 *
 * The owner's ruling is therefore: **publish publicly**, and move the control from "nobody can read it"
 * to "there is nothing in it worth reading". The coverage those three cases carried did not vanish, it
 * MOVED, and this file follows it:
 *
 *  | Old assertion                                     | Where its job went now                                    |
 *  | ------------------------------------------------- | --------------------------------------------------------- |
 *  | `ssoProtection` is `all` before the deploy         | DELETED — the API answer was not evidence of anything      |
 *  | that assertion runs BEFORE the publish             | DELETED with it                                            |
 *  | an unauthenticated request is REFUSED              | INVERTED → {@link findPublicationGaps}: it must be SERVED  |
 *  | (nothing)                                          | NEW → {@link findAccountIdScanGaps}: the corpus is scanned |
 *  | no custom domain is ever attached                  | KEPT → {@link findDomainAttachments}, re-justified below   |
 *  | an unconfigured deploy fails loudly                | KEPT → {@link findSilentSkips}, unchanged                  |
 *
 * ## The two failures this file now exists to catch
 *
 *  1. **The corpus regains an AWS account id and nobody notices.** Confidentiality is no longer access
 *     control; it is the absence of the thing. `docs.yml` must scan the BUILT output before the artifact
 *     is uploaded — before a deploy is even possible, and on pull requests too, so the offending document
 *     is red before it merges. Deleting that step, moving it after the upload, or gating it behind an
 *     `if:` that skips pull requests each restores the leak with every check green.
 *  2. **The site silently stops serving.** With protection gone, the failure mode flipped: the danger is
 *     no longer "a stranger reads it" but "nobody can, and the workflow says it deployed". A CLI that
 *     exits 0 having aliased a broken build, a production alias never moved (exactly what ADR-0001
 *     recorded for the web previews, where PR #73 served a stale build for days), or protection getting
 *     switched on by hand all look identical to success from inside the job. So the probe must demand a
 *     `200` **carrying this site's own generator tag** — Vercel's error and login pages are perfectly
 *     healthy `200`s from a different origin.
 *
 * And one that did not change: **the project must keep exactly one address.** The old justification was
 * that a custom domain is exempt from deployment protection; there is no protection now, so that reason
 * is gone. Two independent ones remain, and they are why the analyzer survived the rewrite rather than
 * being deleted with the posture it was written for: ADR-0001 item 2 MEASURED that a Vercel branch
 * domain resolves to the WRONG deployment (so a second address would sometimes serve a stale corpus
 * while the probe reported the fresh one healthy), and nothing needs one.
 *
 * ## Why the analyzers are pure, and why the fixtures are the real evidence
 *
 * Each analyzer takes a parsed workflow and returns sorted violation IDs. Two callers exercise every
 * one: the REAL `docs.yml` (must be clean) and deliberately broken FIXTURES (must be flagged), each
 * paired with a negative control that must NOT be flagged. This is the shape `workflowInvariants.test.ts`
 * established, for the reason stated there: a `toEqual([])` against a tree that happens to be clean
 * passes just as well when the analyzer is broken.
 *
 * The negative controls are not decoration. {@link findDomainAttachments} has to tell a step that
 * ATTACHES a domain from the step that merely READS the project's `alias[]` to check it — both contain
 * the word `alias`, and one of those steps is the check itself, so an over-eager matcher would force the
 * removal of the very assertion this file requires.
 *
 * ## Mutation evidence — every one of these was APPLIED and watched fail
 *
 * Two rounds, both driven by a harness that restores after each case and re-verifies the restore with
 * `md5sum -c`. ⛔ It restores by COPY, never `git checkout`: the working tree is ahead of `HEAD` while
 * this lands, and a `git checkout --` restore silently reverts the change under test along with the
 * mutation. That was tried once, and it destroyed both edited files.
 *
 * **Round 1 — break the ANALYZER, watch its own fixtures go red.** (Without this round, every predicate
 * below could be `if (false)` and the real-tree round would still be green, because the real workflow is
 * clean.)
 *
 *   • `FORBIDDEN_DOMAIN_PATTERNS` emptied → `flags a step that binds a custom domain`. This is what
 *     `it('is not vacuous', …)` and the per-pattern fixtures exist for.
 *   • `scanIndex > uploadIndex` → `if (false)` → `flags a scan that runs AFTER the artifact is uploaded`.
 *   • `scan?.if !== undefined` → `if (false)` → `flags a scan gated behind an if:`.
 *   • `SCRUB_SCRIPT` widened to `/(?:)/` → `flags an artifact produced without any account-id scan`.
 *   • the `200`-arm direction check → `if (false)` → `flags the RETIRED private-site probe`.
 *   • the `content="Docusaurus` term → `if (false)` → `flags a probe that would accept a Vercel error
 *     page as a healthy site`.
 *   • `testsForAbsence && !/exit\s+1/` → `if (false)` → `flags a step that notices the missing
 *     configuration and carries on`.
 *   • `REQUIRED_CONFIG.test(definition.if …)` → `if (false)` → `flags a job that greys itself out`.
 *
 * **Round 2 — break the REAL `docs.yml`, watch the real-tree assertions go red.**
 *
 *   • Deleting the `Assert the built site carries no AWS account id` step →
 *     `build -> nothing scans the built site for an AWS account id`.
 *   • Adding `if: github.event_name != 'pull_request'` to that step →
 *     `build::Assert the built site carries no AWS account id -> the account-id scan is skipped on pull
 *     requests`. ⚠️ THE MUTATION MOST LIKELY TO BE MADE IN GOOD FAITH — every neighbouring step carries
 *     exactly that `if:`.
 *   • Moving the scan below the upload → `build -> the account-id scan runs AFTER the artifact is
 *     uploaded`.
 *   • Replacing the probe's `content="Docusaurus` arm with `*)` → `deploy -> the probe accepts any 200,
 *     not only this site`.
 *   • Adding `failed="${failed} served the content"` to the probe's `200)` arm → `deploy -> the probe
 *     treats a served page as a FAILURE, which is the retired private-site posture`.
 *   • Changing the deploy job's `if:` to `vars.DOCS_VERCEL_PROJECT_ID != ''` → `deploy -> skips instead
 *     of failing when configuration is absent`, AND the structural `if:` assertion at the foot of this
 *     file — two independent detections of one edit.
 *   • Adding a `curl -X POST …/v10/projects/$P/domains` step to the deploy job →
 *     `deploy::Attach the docs domain -> adds a project-domain to the docs project`.
 *
 * ⚠️ **A HOLE CARRIED FORWARD FROM THE OLD FILE, because the lesson outlived the posture.** Its
 * protection predicate originally asked only for `'all'` ANYWHERE in the step body, and an `if false`
 * mutation walked straight past it — the step's own `::error::` message contained the words "not 'all'".
 * A guard satisfied by PROSE is satisfied by a step that checks nothing. Every predicate here therefore
 * matches a SHAPE that cannot appear in an error message: the exact string `content="Docusaurus` (the
 * step's failure message says "a Docusaurus page", which does NOT match), a `200)` case arm, and a
 * script path. Do not relax any of them to a bare word.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import { repoRoot } from './serviceSources.js';

const WORKFLOW_PATH = join(repoRoot, '.github/workflows/docs.yml');

/** The job that performs the outward publish. Named here once so every analyzer agrees. */
const DEPLOY_JOB = 'deploy';

/** The job that renders the site and produces the artifact everything downstream consumes. */
const BUILD_JOB = 'build';

interface WorkflowStep {
    readonly name?: string;
    readonly id?: string;
    readonly run?: string;
    readonly uses?: string;
    readonly if?: string;
    readonly with?: Readonly<Record<string, unknown>>;
    readonly env?: Readonly<Record<string, unknown>>;
    readonly 'continue-on-error'?: boolean;
}

interface WorkflowJob {
    readonly needs?: string | readonly string[];
    readonly if?: string;
    readonly environment?: unknown;
    readonly steps?: readonly WorkflowStep[];
    readonly 'continue-on-error'?: boolean;
}

interface Workflow {
    readonly on?: Readonly<Record<string, unknown>>;
    readonly jobs?: Readonly<Record<string, WorkflowJob>>;
}

/** The real `docs.yml`, parsed. */
function realWorkflow(): Workflow {
    return parse(readFileSync(WORKFLOW_PATH, 'utf8')) as Workflow;
}

/**
 * Parse a YAML body written for a test.
 *
 * @sideEffect Writes to a temp directory. The real workflow is never touched.
 */
function fixture(body: string): Workflow {
    const directory = mkdtempSync(join(tmpdir(), 'docs-deploy-guards-'));
    const file = join(directory, 'fixture.yml');

    writeFileSync(file, body);

    return parse(readFileSync(file, 'utf8')) as Workflow;
}

/** Everything a step can carry that could name an outward action, as one searchable string. */
function stepText(step: WorkflowStep): string {
    return [step.uses ?? '', step.run ?? '', JSON.stringify(step.with ?? {}), JSON.stringify(step.env ?? {})].join(
        '\n',
    );
}

function stepLabel(step: WorkflowStep): string {
    return step.name ?? step.uses ?? (step.run ?? '').split('\n')[0]?.trim() ?? '(unnamed)';
}

// ---------------------------------------------------------------------------------------------------------
// Analyzer 1 — nothing here may give the docs project a second address
// ---------------------------------------------------------------------------------------------------------

/**
 * The ways a Vercel project acquires an address other than its own generated `*.vercel.app`.
 *
 * Each is a real mechanism this repository already uses for the WEB app (`createPreviewDomain.ts`,
 * `teardownPreviewDomain.ts`, ADR-0001/#94) and must never acquire for the docs project:
 *
 *  - a project-domain binding (`…/projects/{id}/domains`, `vercel domains add`)
 *  - a deployment alias (`…/deployments/{id}/aliases`, `vercel alias`)
 *  - a Vercel BRANCH domain — ADR-0001 item 2 MEASURED that `gitBranch` resolves to the wrong
 *    deployment, which would let a stale corpus be served from one address while the probe reports the
 *    fresh one healthy
 *  - DNS that resolves a name to Vercel at all (`cname.vercel-dns.com`, Route 53)
 */
const FORBIDDEN_DOMAIN_PATTERNS: readonly { readonly id: string; readonly pattern: RegExp }[] = [
    { id: 'project-domain', pattern: /projects\/[^\s'"]*\/domains|vercel\s+domains\b/ },
    { id: 'deployment-alias', pattern: /deployments\/[^\s'"]*\/aliases|vercel\s+alias\b/ },
    { id: 'branch-domain', pattern: /\bgitBranch\b/ },
    { id: 'vercel-dns', pattern: /cname\.vercel-dns\.com/ },
    { id: 'route53', pattern: /route53|change-resource-record-sets|ResourceRecordSet/ },
    { id: 'preview-domain-script', pattern: /(create|teardown)PreviewDomain/ },
];

/** Steps that would give the docs project an address other than its generated Vercel one. */
function findDomainAttachments(workflow: Workflow): readonly string[] {
    const violations: string[] = [];

    for (const [job, definition] of Object.entries(workflow.jobs ?? {})) {
        for (const step of definition.steps ?? []) {
            const text = stepText(step);

            for (const { id, pattern } of FORBIDDEN_DOMAIN_PATTERNS) {
                if (pattern.test(text)) {
                    violations.push(`${job}::${stepLabel(step)} -> adds a ${id} to the docs project`);
                }
            }
        }
    }

    return [...violations].sort();
}

// ---------------------------------------------------------------------------------------------------------
// Analyzer 2 — the corpus is scanned for an AWS account id before it can be published
// ---------------------------------------------------------------------------------------------------------

/**
 * The gate that replaced deployment protection.
 *
 * Matched by SCRIPT PATH rather than by a word like "account": the script is the one authoritative
 * implementation (it DERIVES the ids from the repository's own ARNs rather than hardcoding one), and a
 * path cannot be satisfied by an error message that happens to mention accounts.
 */
const SCRUB_SCRIPT = /scripts\/assertNoAwsAccountIds\.mjs/;

/** The step that hands the rendered bytes to everything downstream. */
function uploadStepIndex(steps: readonly WorkflowStep[]): number {
    return steps.findIndex((step) => /actions\/upload-artifact/.test(step.uses ?? ''));
}

/**
 * Failures of the scan-before-publish contract in the job that produces the artifact.
 *
 * Three separate ways to reintroduce the leak with every check green, so three separate violations:
 * not scanning at all, scanning after the bytes have already left the job, and gating the scan behind
 * an `if:` that skips the pull requests where an author would actually see it.
 */
function findAccountIdScanGaps(workflow: Workflow): readonly string[] {
    const violations: string[] = [];

    for (const [job, definition] of Object.entries(workflow.jobs ?? {})) {
        const steps = definition.steps ?? [];
        const uploadIndex = uploadStepIndex(steps);

        if (uploadIndex === -1) {
            continue;
        }

        const scanIndex = steps.findIndex((step) => SCRUB_SCRIPT.test(step.run ?? ''));

        if (scanIndex === -1) {
            violations.push(`${job} -> nothing scans the built site for an AWS account id`);

            continue;
        }

        // ⛔ ORDER IS THE PROPERTY. A scan after the upload cannot stop the artifact existing, and the
        // artifact is the only thing the deploy job consumes.
        if (scanIndex > uploadIndex) {
            violations.push(`${job} -> the account-id scan runs AFTER the artifact is uploaded`);
        }

        const scan = steps[scanIndex];

        // ⚠️ The good-faith mutation. Every neighbouring step carries this `if:` because it only makes
        // sense on a run that can deploy — copying it onto the scan is the natural thing to do, and it
        // is precisely what removes the gate from the pull request where the document is being written.
        if (scan?.if !== undefined) {
            violations.push(`${job}::${stepLabel(scan)} -> the account-id scan is skipped on pull requests`);
        }
    }

    return [...violations].sort();
}

// ---------------------------------------------------------------------------------------------------------
// Analyzer 3 — the published site is proved to SERVE, and to be this site
// ---------------------------------------------------------------------------------------------------------

/** Index of the step that performs the outward publish, or `-1`. */
function deployStepIndex(steps: readonly WorkflowStep[]): number {
    return steps.findIndex((step) => /vercel[^\n]*\bdeploy\b|\bdeploy\b[^\n]*--prebuilt/.test(step.run ?? ''));
}

/**
 * The body of a `case` arm, from its pattern to the `;;` that ends it.
 *
 * Pure. Used to read the DIRECTION of the `200` arm — which term is the one a mutation would flip while
 * leaving every keyword this analyzer looks for still present in the file.
 */
function caseArmBody(run: string, arm: string): string | undefined {
    const start = run.indexOf(arm);

    if (start === -1) {
        return undefined;
    }

    const end = run.indexOf(';;', start);

    return run.slice(start + arm.length, end === -1 ? undefined : end);
}

/**
 * Failures of the post-deploy contract in the deploying job.
 *
 * The site is PUBLIC, so a served page is the pass. What must hold:
 *
 *  - something probes the published address AFTER the publish (a configuration check is not evidence);
 *  - the `200` arm treats a served page as SUCCESS — the retired private-site probe failed on exactly
 *    that arm, and re-adding it would take the site dark while reporting green;
 *  - a status other than `200` ends the run, rather than being logged;
 *  - a `200` is not enough on its own: the body must carry this site's own generator tag, because
 *    Vercel's error and login pages are healthy `200`s from a different origin.
 */
function findPublicationGaps(workflow: Workflow): readonly string[] {
    const violations: string[] = [];

    for (const [job, definition] of Object.entries(workflow.jobs ?? {})) {
        const steps = definition.steps ?? [];
        const deployIndex = deployStepIndex(steps);

        if (deployIndex === -1) {
            continue;
        }

        const probes = steps.filter((step, index) => index > deployIndex && /\bcurl\b/.test(step.run ?? ''));

        if (probes.length === 0) {
            violations.push(`${job} -> nothing probes the published site after the deploy`);

            continue;
        }

        const bodies = probes.map((step) => step.run ?? '');

        if (!bodies.some((run) => /exit\s+1/.test(run))) {
            violations.push(`${job} -> the probe never fails, whatever the published site answers`);
        }

        // The retired posture, structurally: a `200` arm that records a failure.
        if (bodies.some((run) => /(?:failed=|exit\s+1)/.test(caseArmBody(run, '200)') ?? ''))) {
            violations.push(
                `${job} -> the probe treats a served page as a FAILURE, which is the retired private-site posture`,
            );
        }

        // ⛔ The EXACT marker string, not the word "Docusaurus" — the step's own failure message says
        // "a Docusaurus page", so a bare word match would be satisfied by prose while the check that
        // discriminates this site from a Vercel login page had been deleted.
        if (!bodies.some((run) => run.includes('content="Docusaurus'))) {
            violations.push(`${job} -> the probe accepts any 200, not only this site`);
        }
    }

    return [...violations].sort();
}

// ---------------------------------------------------------------------------------------------------------
// Analyzer 4 — an unconfigured deploy fails LOUDLY; it never skips
// ---------------------------------------------------------------------------------------------------------

/** Environment names whose absence must stop the deploy rather than quietly disable it. */
const REQUIRED_CONFIG = /VERCEL_TOKEN|VERCEL_TEAM_ID|DOCS_VERCEL_PROJECT_ID|DOCS_SITE_URL/;

/**
 * Places where missing configuration would produce a green run that published nothing.
 *
 * Two shapes, both of which have shipped in this repository before: a job-level `if:` that consults a
 * secret or variable (so the whole job greys out), and a step that tests for emptiness and then only
 * `echo`es (so the run is green and the deploy silently did not happen).
 */
function findSilentSkips(workflow: Workflow): readonly string[] {
    const violations: string[] = [];

    for (const [job, definition] of Object.entries(workflow.jobs ?? {})) {
        if (definition['continue-on-error'] === true) {
            violations.push(`${job} -> continue-on-error hides a failed deploy`);
        }

        if (REQUIRED_CONFIG.test(definition.if ?? '')) {
            violations.push(`${job} -> skips instead of failing when configuration is absent`);
        }

        for (const step of definition.steps ?? []) {
            if (step['continue-on-error'] === true) {
                violations.push(`${job}::${stepLabel(step)} -> continue-on-error hides a failed deploy`);
            }

            if (REQUIRED_CONFIG.test(step.if ?? '')) {
                violations.push(`${job}::${stepLabel(step)} -> skips instead of failing when configuration is absent`);
            }

            const run = step.run ?? '';
            // `-z "${VAR}"` is the emptiness test; whatever it guards must end the run.
            const testsForAbsence = /-z\s+"?\$\{?[A-Z_]*(?:VERCEL|DOCS)[A-Z_]*\}?"?/.test(run);

            if (testsForAbsence && !/exit\s+1/.test(run)) {
                violations.push(`${job}::${stepLabel(step)} -> notices missing configuration without failing`);
            }
        }
    }

    return [...violations].sort();
}

// ---------------------------------------------------------------------------------------------------------
// Analyzer 1 — fixtures
// ---------------------------------------------------------------------------------------------------------

const jobHeader = [
    'name: fixture',
    'on: [push]',
    'jobs:',
    '    deploy:',
    '        runs-on: ubuntu-latest',
    '        steps:',
];

function stepsFixture(...steps: readonly string[]): Workflow {
    return fixture([...jobHeader, ...steps, ''].join('\n'));
}

describe('the docs site never acquires a second address', () => {
    it('is not vacuous: every forbidden mechanism has its own pattern', () => {
        // A pattern list that shrank silently is the way this guard rots into decoration.
        expect(FORBIDDEN_DOMAIN_PATTERNS.map((entry) => entry.id)).toEqual([
            'project-domain',
            'deployment-alias',
            'branch-domain',
            'vercel-dns',
            'route53',
            'preview-domain-script',
        ]);
    });

    it('flags a step that binds a custom domain to the project', () => {
        const found = findDomainAttachments(
            stepsFixture(
                '            - name: Attach the docs domain',
                '              run: curl -X POST "https://api.vercel.com/v10/projects/$P/domains" -d name=docs.commise.app',
            ),
        );

        expect(found).toEqual(['deploy::Attach the docs domain -> adds a project-domain to the docs project']);
    });

    it('flags a step that aliases a deployment', () => {
        const found = findDomainAttachments(
            stepsFixture('            - name: Alias it', '              run: npx vercel alias "$URL" docs.commise.app'),
        );

        expect(found).toEqual(['deploy::Alias it -> adds a deployment-alias to the docs project']);
    });

    it('flags a Vercel branch domain, which ADR-0001 measured resolves to the wrong deployment', () => {
        const found = findDomainAttachments(
            stepsFixture(
                '            - name: Branch domain',
                '              run: |',
                '                  curl -X PATCH "$API" -d \'{"gitBranch": "main"}\'',
            ),
        );

        expect(found).toEqual(['deploy::Branch domain -> adds a branch-domain to the docs project']);
    });

    it('flags DNS that would resolve a name of ours to Vercel', () => {
        const found = findDomainAttachments(
            stepsFixture(
                '            - name: Publish DNS',
                '              run: aws route53 change-resource-record-sets --hosted-zone-id Z1 --change-batch "$B"',
            ),
        );

        expect(found).toEqual(['deploy::Publish DNS -> adds a route53 to the docs project']);
    });

    it('flags reuse of the web app preview-domain scripts', () => {
        const found = findDomainAttachments(
            stepsFixture(
                '            - name: Reuse the web scripts',
                '              run: npx tsx packages/apps/commise/web/scripts/createPreviewDomain.ts',
            ),
        );

        expect(found).toEqual(['deploy::Reuse the web scripts -> adds a preview-domain-script to the docs project']);
    });

    it('does NOT flag reading the project alias list, which is how the address check finds what to look at', () => {
        // The discriminating negative control. This step contains "alias" and talks to the Vercel API,
        // and it is the step that ASSERTS the project has one address — a matcher that flagged it would
        // force the removal of the assertion.
        const found = findDomainAttachments(
            stepsFixture(
                '            - name: Assert the docs project has no second address',
                '              run: |',
                '                  curl -sS "https://api.vercel.com/v9/projects/$P?teamId=$T" | jq -r \'.alias[]?.domain\'',
            ),
        );

        expect(found).toEqual([]);
    });

    it('the real docs.yml attaches no domain, no alias and no DNS', () => {
        expect(findDomainAttachments(realWorkflow())).toEqual([]);
    });
});

// ---------------------------------------------------------------------------------------------------------
// Analyzer 2 — fixtures
// ---------------------------------------------------------------------------------------------------------

const SCAN_STEP = [
    '            - name: Assert the built site carries no AWS account id',
    '              run: node scripts/assertNoAwsAccountIds.mjs packages/tools/docs-site/build',
];

const UPLOAD_STEP = [
    '            - name: Upload the built site',
    '              uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2',
    '              with:',
    '                  name: docs-site',
];

function buildFixture(...steps: readonly string[]): Workflow {
    return fixture(
        [
            'name: fixture',
            'on: [push]',
            'jobs:',
            '    build:',
            '        runs-on: ubuntu-latest',
            '        steps:',
            ...steps,
            '',
        ].join('\n'),
    );
}

describe('the corpus is scanned for an AWS account id before it can be published', () => {
    it('flags an artifact produced without any account-id scan', () => {
        // ⛔ The whole ruling rests on this step existing. The site is public; nothing else stops an
        // account id reaching the internet.
        expect(findAccountIdScanGaps(buildFixture(...UPLOAD_STEP))).toEqual([
            'build -> nothing scans the built site for an AWS account id',
        ]);
    });

    it('flags a scan that runs AFTER the artifact is uploaded', () => {
        // Order is the property: the artifact is the only thing the deploy job consumes, so a scan
        // after the upload cannot stop the bytes existing.
        expect(findAccountIdScanGaps(buildFixture(...UPLOAD_STEP, ...SCAN_STEP))).toEqual([
            'build -> the account-id scan runs AFTER the artifact is uploaded',
        ]);
    });

    it('flags a scan gated behind an `if:`, which is the mutation most likely to be made in good faith', () => {
        // Every neighbouring step carries `if: github.event_name != 'pull_request'` because it only
        // makes sense on a run that can deploy. Copying it onto the scan removes the gate from exactly
        // the pull request where the offending document is being written.
        const found = findAccountIdScanGaps(
            buildFixture(
                '            - name: Assert the built site carries no AWS account id',
                "              if: github.event_name != 'pull_request'",
                '              run: node scripts/assertNoAwsAccountIds.mjs packages/tools/docs-site/build',
                ...UPLOAD_STEP,
            ),
        );

        expect(found).toEqual([
            'build::Assert the built site carries no AWS account id -> the account-id scan is skipped on pull requests',
        ]);
    });

    it('does NOT flag a scan that gates the upload', () => {
        expect(findAccountIdScanGaps(buildFixture(...SCAN_STEP, ...UPLOAD_STEP))).toEqual([]);
    });

    it('the real docs.yml scans the built site before uploading it, on every event', () => {
        const workflow = realWorkflow();

        // Anti-vacuity: the analyzer only says anything about a job that actually produces an artifact.
        expect(uploadStepIndex(workflow.jobs?.[BUILD_JOB]?.steps ?? [])).toBeGreaterThan(-1);
        expect(findAccountIdScanGaps(workflow)).toEqual([]);
    });
});

// ---------------------------------------------------------------------------------------------------------
// Analyzer 3 — fixtures
// ---------------------------------------------------------------------------------------------------------

const DEPLOY_STEP = [
    '            - name: Deploy to Vercel',
    '              run: npx vercel deploy --prebuilt --prod --token "$T"',
];

const PROBE_STEP = [
    '            - name: Verify the published site actually serves',
    '              run: |',
    '                  code=$(curl -o response.html -w "%{http_code}" "$URL")',
    '                  body=$(cat response.html)',
    '                  case "$code" in',
    '                    200)',
    '                      case "$body" in',
    '                        *\'name="generator" content="Docusaurus\'*) echo ok ;;',
    '                        *) failed="wrong site" ;;',
    '                      esac ;;',
    '                    *) failed="$code" ;;',
    '                  esac',
    '                  if [ -n "$failed" ]; then echo "::error::not serving"; exit 1; fi',
];

describe('the published docs site is proved to serve, and to be this site', () => {
    it('flags a deploy that is never probed from outside', () => {
        const found = findPublicationGaps(stepsFixture(...DEPLOY_STEP));

        expect(found).toEqual(['deploy -> nothing probes the published site after the deploy']);
    });

    it('flags a probe that reports whatever it got and carries on', () => {
        const weak = [
            '            - name: Verify',
            '              run: |',
            '                  code=$(curl -o /dev/null -w "%{http_code}" "$URL")',
            '                  echo "got $code"',
        ];
        const found = findPublicationGaps(stepsFixture(...DEPLOY_STEP, ...weak));

        expect(found).toEqual([
            'deploy -> the probe accepts any 200, not only this site',
            'deploy -> the probe never fails, whatever the published site answers',
        ]);
    });

    it('flags the RETIRED private-site probe, which fails on a served page', () => {
        // ⛔ THE REGRESSION THIS ANALYZER EXISTS FOR. The owner ruled the site public; a probe that
        // fails on a `200` would take it dark while every check stayed green, and it is the shape this
        // very file used to require.
        const retired = [
            '            - name: Verify an unauthenticated request cannot read the site',
            '              run: |',
            '                  code=$(curl -o /dev/null -w "%{http_code}" "$URL")',
            '                  case "$code" in',
            '                    401|403) echo "  refused" ;;',
            '                    200) failed="served the content" ;;',
            '                    *) failed="unrecognised" ;;',
            '                  esac',
            '                  if [ -n "$failed" ]; then echo "::error::not private"; exit 1; fi',
        ];
        const found = findPublicationGaps(stepsFixture(...DEPLOY_STEP, ...retired));

        expect(found).toEqual([
            'deploy -> the probe accepts any 200, not only this site',
            'deploy -> the probe treats a served page as a FAILURE, which is the retired private-site posture',
        ]);
    });

    it('flags a probe that would accept a Vercel error page as a healthy site', () => {
        const anyTwoHundred = [
            '            - name: Verify',
            '              run: |',
            '                  code=$(curl -o /dev/null -w "%{http_code}" "$URL")',
            '                  case "$code" in',
            '                    200) echo ok ;;',
            '                    *) echo "::error::down"; exit 1 ;;',
            '                  esac',
        ];
        const found = findPublicationGaps(stepsFixture(...DEPLOY_STEP, ...anyTwoHundred));

        expect(found).toEqual(['deploy -> the probe accepts any 200, not only this site']);
    });

    it('does NOT flag a probe that demands a 200 carrying this site', () => {
        expect(findPublicationGaps(stepsFixture(...DEPLOY_STEP, ...PROBE_STEP))).toEqual([]);
    });

    it('the real docs.yml proves the site serves after publishing it', () => {
        const workflow = realWorkflow();

        // Anti-vacuity: the analyzer only says anything about a job that actually deploys.
        expect(deployStepIndex(workflow.jobs?.[DEPLOY_JOB]?.steps ?? [])).toBeGreaterThan(-1);
        expect(findPublicationGaps(workflow)).toEqual([]);
    });
});

// ---------------------------------------------------------------------------------------------------------
// Analyzer 4 — fixtures
// ---------------------------------------------------------------------------------------------------------

describe('an unconfigured docs deploy fails loudly instead of skipping', () => {
    it('flags a job that greys itself out when a variable is unset', () => {
        const found = findSilentSkips(
            fixture(
                [
                    'name: fixture',
                    'on: [push]',
                    'jobs:',
                    '    deploy:',
                    "        if: vars.DOCS_VERCEL_PROJECT_ID != ''",
                    '        runs-on: ubuntu-latest',
                    '        steps:',
                    '            - run: echo deploy',
                    '',
                ].join('\n'),
            ),
        );

        expect(found).toEqual(['deploy -> skips instead of failing when configuration is absent']);
    });

    it('flags a step that notices the missing configuration and carries on', () => {
        const found = findSilentSkips(
            stepsFixture(
                '            - name: Preflight',
                '              run: |',
                '                  if [ -z "${VERCEL_TOKEN}" ]; then echo "not configured, skipping"; fi',
            ),
        );

        expect(found).toEqual(['deploy::Preflight -> notices missing configuration without failing']);
    });

    it('flags continue-on-error on the deploying step', () => {
        const found = findSilentSkips(
            stepsFixture(
                '            - name: Deploy to Vercel',
                '              continue-on-error: true',
                '              run: npx vercel deploy --prebuilt --prod',
            ),
        );

        expect(found).toEqual(['deploy::Deploy to Vercel -> continue-on-error hides a failed deploy']);
    });

    it('does NOT flag a preflight that fails on missing configuration', () => {
        const found = findSilentSkips(
            stepsFixture(
                '            - name: Preflight',
                '              run: |',
                '                  if [ -z "${VERCEL_TOKEN}" ]; then echo "::error::missing"; exit 1; fi',
            ),
        );

        expect(found).toEqual([]);
    });

    it('the real docs.yml never skips on missing configuration', () => {
        expect(findSilentSkips(realWorkflow())).toEqual([]);
    });
});

// ---------------------------------------------------------------------------------------------------------
// Structural claims about the real workflow that no analyzer generalises
// ---------------------------------------------------------------------------------------------------------

describe('docs.yml structure', () => {
    it('publishes only what the build job already proved', () => {
        const workflow = realWorkflow();
        const deploy = workflow.jobs?.[DEPLOY_JOB];
        const needs = typeof deploy?.needs === 'string' ? [deploy.needs] : (deploy?.needs ?? []);

        expect(needs).toContain('build');
    });

    it('never deploys from a pull request, so an unrelated PR pays no outward action', () => {
        expect(realWorkflow().jobs?.[DEPLOY_JOB]?.if).toBe("github.event_name != 'pull_request'");
    });

    it("targets its OWN Vercel project, never the web app's", () => {
        // ⛔ `VERCEL_PROJECT_ID` is the web app, whose project carries the product's custom domains and
        // its own deployment history. A second content source inside it would put the documentation on
        // the product's addresses.
        const body = readFileSync(WORKFLOW_PATH, 'utf8');

        expect(body).toMatch(/vars\.DOCS_VERCEL_PROJECT_ID/);

        // The web app's id may only appear where it is compared AGAINST, never as a deploy target.
        for (const line of body.split('\n').filter((candidate) => /vars\.VERCEL_PROJECT_ID/.test(candidate))) {
            expect(line).toMatch(/WEB_VERCEL_PROJECT_ID/);
        }
    });

    it('names nothing `pr-{N}`, which the sandbox teardown deletes by tag OR name', () => {
        // ADR-0005 / #94: `.github/scripts/teardown-sandbox-pr.sh` has no denylist. Its safety depends
        // entirely on no persistent resource ever being named `pr-{N}`, and `previewDomainScope.ts`
        // reclaims any first-label `pr-{N}` in the sandbox zone. Nothing this workflow creates may
        // collide with either.
        expect(readFileSync(WORKFLOW_PATH, 'utf8')).not.toMatch(/pr-\$\{|pr-\d|PR_NUMBER/);
    });

    it('binds the Vercel token to a named deployment environment', () => {
        expect(realWorkflow().jobs?.[DEPLOY_JOB]?.environment).toBe('Docs');
    });

    it('says in its own header that the site is PUBLIC', () => {
        // ⛔ The single most consequential fact about this pipeline, and the one a future reader will
        // assume the opposite of — every other deploying workflow here fronts something authenticated.
        // Somebody widening `CONTENT_SOURCES` needs to meet this sentence before they meet the filter.
        const header = readFileSync(WORKFLOW_PATH, 'utf8').split('\nname: Docs site')[0] ?? '';

        expect(header).toMatch(/THIS SITE IS PUBLIC/);
        expect(header).toMatch(/contentRegistry\.ts/);
    });

    it('hardcodes no AWS account id, which is the naive way to write the gate it runs', () => {
        // ⛔ The gate this workflow invokes DERIVES the ids it searches for. Spelling one out here — in
        // a file read far more often than the document it was scrubbed out of — would publish the value
        // in order to assert that it must not be published.
        expect(readFileSync(WORKFLOW_PATH, 'utf8')).not.toMatch(/\d{12}/);
    });
});
