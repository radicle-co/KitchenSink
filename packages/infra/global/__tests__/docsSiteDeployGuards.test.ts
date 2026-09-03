// @vitest-environment node
/**
 * Repo-wide guard: the documentation site is published PRIVATELY, and stays that way.
 *
 * ## The failure this catches
 *
 * `.github/workflows/docs.yml` publishes `packages/tools/docs-site` — a rendering of `docs/**` that
 * includes the AWS account id, the `azp` trust-boundary reasoning behind ADR-0001, and eighteen files
 * that discuss credential handling. The owner's ruling is: deploy PROTECTED, with NO custom domain.
 *
 * That ruling is one Vercel setting and one absent step away from being false, and BOTH failure modes
 * are silent. ADR-0001 records the measurement that makes the domain half a security rule rather than
 * a preference:
 *
 * > "A registered custom domain is exempt from deployment protection."
 *
 * So attaching a domain to the docs project — the single most natural "improvement" anyone would make
 * to a docs deploy, and one this repository already has scripts for — would publish the whole corpus
 * to the internet, with every check still green. The other half is Vercel's own default: "Standard
 * Protection" leaves PRODUCTION domains (including the project's `<name>.vercel.app`) public, and
 * only the `all` scope closes that.
 *
 * ## Why the analyzers are pure, and why the fixtures are the real evidence
 *
 * Each analyzer takes a parsed workflow and returns sorted violation IDs. Two callers exercise every
 * one: the REAL `docs.yml` (must be clean) and deliberately broken FIXTURES (must be flagged), each
 * paired with a negative control that must NOT be flagged. This is the shape `workflowInvariants.test.ts`
 * established, for the reason stated there: a `toEqual([])` against a tree that happens to be clean
 * passes just as well when the analyzer is broken.
 *
 * The negative controls are not decoration. `findDomainAttachments` has to tell a step that ATTACHES
 * a domain from the step that merely READS the project's `alias[]` to probe it — both contain the
 * word `alias`, and the probe is the thing proving the site is private, so an over-eager matcher would
 * force the removal of the very check this file exists to require.
 *
 * ## Mutation evidence (every assertion below has been watched fail)
 *
 * Analyzer mutations, then transient edits to the REAL workflow (restored and re-verified with
 * `git status --porcelain` + a re-run):
 *
 *   1. **Domain attachment** — `FORBIDDEN_DOMAIN_PATTERNS` emptied → every positive fixture passes and
 *      the real-tree assertion passes vacuously, which is why `it('is not vacuous', …)` pins the
 *      pattern list and each pattern is exercised by its own fixture. Real tree: adding a
 *      `curl -X POST …/v10/projects/$P/domains` step to `docs.yml`'s deploy job produced
 *      `deploy::Attach the docs domain -> adds a project-domain to the docs project`.
 *   2. **Protection ordering** — dropping the `index < deployIndex` comparison lets the
 *      posture-after-deploy fixture pass, i.e. a project whose protection is only checked AFTER the
 *      corpus is already published. Deleting the probe term lets the never-probed fixture pass. Real
 *      tree: replacing the posture step's `if [ "${scope}" != "all" ]` with `if false` produced
 *      `deploy -> nothing asserts ssoProtection is 'all' before the deploy`; deleting the `200)` case
 *      from the probe produced `deploy -> the unauthenticated probe does not treat a 200 as a
 *      failure`.
 *      ⚠️ **A HOLE THIS RUN FOUND, recorded because it is the whole argument for doing it.** The
 *      first version of the posture predicate asked only for `'all'` ANYWHERE in the step body, and
 *      the `if false` mutation walked straight past it — the step's own `::error::` message contains
 *      the words "not 'all'". The guard was being satisfied by PROSE while the check it was guarding
 *      did nothing. It now requires the COMPARISON (`[!=]= "all"`). Do not relax that back to a bare
 *      token match.
 *   3. **Loud-when-unconfigured** — deleting the `exit 1` requirement lets the notice-and-carry-on
 *      fixture pass; deleting the job-`if` term lets the greyed-out-job fixture pass. Real tree:
 *      changing the deploy job's `if:` to `vars.DOCS_VERCEL_PROJECT_ID != ''` produced
 *      `deploy -> skips instead of failing when configuration is absent` (and reds the structural
 *      `if:` assertion at the foot of this file too — two independent detections of one edit).
 *
 * The four real-tree edits were applied by a scripted harness that restores the file after each case
 * and verifies the restore with `md5sum -c`; the workflow was byte-identical afterwards.
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
// Analyzer 1 — nothing here may give the docs project a second, protection-exempt address
// ---------------------------------------------------------------------------------------------------------

/**
 * The ways a Vercel project acquires an address other than its own generated `*.vercel.app`.
 *
 * Each is a real mechanism this repository already uses for the WEB app (`createPreviewDomain.ts`,
 * `teardownPreviewDomain.ts`, ADR-0001/#94) and must never acquire for the docs project:
 *
 *  - a project-domain binding (`…/projects/{id}/domains`, `vercel domains add`)
 *  - a deployment alias (`…/deployments/{id}/aliases`, `vercel alias`)
 *  - a Vercel BRANCH domain — ADR-0001 item 2 measured that `gitBranch` re-enables protection but then
 *    resolves to the wrong deployment, so it is forbidden here for the same reason it is forbidden
 *    there
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
// Analyzer 2 — protection is asserted before publishing, and PROVED after
// ---------------------------------------------------------------------------------------------------------

/** Index of the step that performs the outward publish, or `-1`. */
function deployStepIndex(steps: readonly WorkflowStep[]): number {
    return steps.findIndex((step) => /vercel[^\n]*\bdeploy\b|\bdeploy\b[^\n]*--prebuilt/.test(step.run ?? ''));
}

/**
 * Failures of the two-sided protection contract in the deploying job.
 *
 * BEFORE the publish: something must read the project's `ssoProtection` and refuse anything but the
 * `all` scope — the pre-condition is what prevents an exposure window, because a check that only runs
 * afterwards discovers the leak by causing it.
 *
 * AFTER the publish: something must make an UNAUTHENTICATED request and treat a `200` as a failure —
 * the only evidence that is about behaviour rather than configuration.
 */
function findProtectionGaps(workflow: Workflow): readonly string[] {
    const violations: string[] = [];

    for (const [job, definition] of Object.entries(workflow.jobs ?? {})) {
        const steps = definition.steps ?? [];
        const deployIndex = deployStepIndex(steps);

        if (deployIndex === -1) {
            continue;
        }

        const postureIndex = steps.findIndex(
            (step, index) =>
                index < deployIndex &&
                /ssoProtection/.test(step.run ?? '') &&
                // ⚠️ The COMPARISON, not the word. The first version of this asked only for `'all'`
                // anywhere in the body, and a mutation that replaced the real test with `if false`
                // sailed past it — because the step's own error message says "not 'all'". A guard
                // satisfied by prose is satisfied by a step that checks nothing.
                /[!=]=\s*["']all["']/.test(step.run ?? '') &&
                /exit\s+1/.test(step.run ?? ''),
        );

        if (postureIndex === -1) {
            violations.push(`${job} -> nothing asserts ssoProtection is 'all' before the deploy`);
        }

        const probes = steps.filter((step, index) => index > deployIndex && /\bcurl\b/.test(step.run ?? ''));

        if (probes.length === 0) {
            violations.push(`${job} -> nothing probes the published site after the deploy`);
            continue;
        }

        // `200)` is the case arm; the point is that a served page is a FAILURE, not a success.
        if (!probes.some((step) => /200\)/.test(step.run ?? '') && /exit\s+1/.test(step.run ?? ''))) {
            violations.push(`${job} -> the unauthenticated probe does not treat a 200 as a failure`);
        }
    }

    return [...violations].sort();
}

// ---------------------------------------------------------------------------------------------------------
// Analyzer 3 — an unconfigured deploy fails LOUDLY; it never skips
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

describe('the docs site never acquires a protection-exempt address', () => {
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

    it('does NOT flag reading the project alias list, which is how the probe finds what to check', () => {
        // The discriminating negative control. This step contains "alias" and talks to the Vercel API,
        // and it is the step that PROVES the site is private — a matcher that flagged it would force
        // the removal of the guarantee.
        const found = findDomainAttachments(
            stepsFixture(
                '            - name: Verify the site is private',
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

const POSTURE_STEP = [
    '            - name: Assert private',
    '              run: |',
    '                  scope=$(jq -r .ssoProtection.deploymentType <<< "$P")',
    '                  if [ "$scope" != "all" ]; then echo "::error::open"; exit 1; fi',
];

const DEPLOY_STEP = [
    '            - name: Deploy to Vercel',
    '              run: npx vercel deploy --prebuilt --prod --token "$T"',
];

const PROBE_STEP = [
    '            - name: Verify unauthenticated',
    '              run: |',
    '                  code=$(curl -o /dev/null -w "%{http_code}" "$URL")',
    '                  case "$code" in',
    '                    401|403) echo ok ;;',
    '                    200) echo "::error::served"; exit 1 ;;',
    '                    *) echo "::error::unknown"; exit 1 ;;',
    '                  esac',
];

describe('the docs deploy is fenced by a protection assertion on both sides', () => {
    it('flags a deploy with no pre-flight protection assertion', () => {
        const found = findProtectionGaps(stepsFixture(...DEPLOY_STEP, ...PROBE_STEP));

        expect(found).toEqual(["deploy -> nothing asserts ssoProtection is 'all' before the deploy"]);
    });

    it('flags a protection assertion that runs AFTER the corpus is already published', () => {
        // The ordering IS the safety property: a check that only runs afterwards discovers the leak by
        // causing it.
        const found = findProtectionGaps(stepsFixture(...DEPLOY_STEP, ...POSTURE_STEP, ...PROBE_STEP));

        expect(found).toEqual(["deploy -> nothing asserts ssoProtection is 'all' before the deploy"]);
    });

    it('flags a deploy that is never probed from outside', () => {
        const found = findProtectionGaps(stepsFixture(...POSTURE_STEP, ...DEPLOY_STEP));

        expect(found).toEqual(['deploy -> nothing probes the published site after the deploy']);
    });

    it('flags a probe that would report success on a page it was actually served', () => {
        const weak = [
            '            - name: Verify unauthenticated',
            '              run: |',
            '                  code=$(curl -o /dev/null -w "%{http_code}" "$URL")',
            '                  echo "got $code"',
        ];
        const found = findProtectionGaps(stepsFixture(...POSTURE_STEP, ...DEPLOY_STEP, ...weak));

        expect(found).toEqual(['deploy -> the unauthenticated probe does not treat a 200 as a failure']);
    });

    it('does NOT flag a correctly fenced deploy', () => {
        expect(findProtectionGaps(stepsFixture(...POSTURE_STEP, ...DEPLOY_STEP, ...PROBE_STEP))).toEqual([]);
    });

    it('the real docs.yml asserts protection before publishing and proves it afterwards', () => {
        const workflow = realWorkflow();

        // Anti-vacuity: the analyzer only says anything about a job that actually deploys.
        expect(deployStepIndex(workflow.jobs?.[DEPLOY_JOB]?.steps ?? [])).toBeGreaterThan(-1);
        expect(findProtectionGaps(workflow)).toEqual([]);
    });
});

// ---------------------------------------------------------------------------------------------------------
// Analyzer 3 — fixtures
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
        // ⛔ `VERCEL_PROJECT_ID` is the web app, whose project carries the product's custom domains —
        // and ADR-0001 measured that a registered custom domain is exempt from deployment protection.
        // Publishing this corpus there would defeat the whole ruling in one variable.
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
});
