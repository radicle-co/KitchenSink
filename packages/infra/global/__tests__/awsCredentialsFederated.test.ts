// @vitest-environment node
/**
 * CI reaches AWS through ONE door, `.github/actions/awsAuth`, on one of the three OIDC roles ADR-0063 defines —
 * never with an access key.
 *
 * ## Why this is a guard and not a convention
 *
 * The repository secrets `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` hold a ROOT access key: no role, no scope,
 * replayable from anywhere until someone rotates it. Moving a workflow off it is easy; keeping every workflow off it is
 * not, because the key keeps working until the secrets are deleted, and a new job copied from an old one brings the key
 * back with no visible difference in its run. So the refusals are mechanical, over every workflow and composite action
 * in the git index, and each has a fixture below that breaks exactly that rule and nothing else.
 *
 * ## The rules
 *
 * - `static-key` — no `secrets.AWS_*KEY*` reference anywhere.
 * - `unfederated-sign-in` — `aws-actions/configure-aws-credentials` appears only inside `awsAuth`, and there only by
 *   role, never with a key input.
 * - `missing-id-token` — a job that runs `awsAuth` grants `id-token: write` at JOB level. Without it the action is red
 *   (`awsAuthPredicate.test.ts`), and a caller that does not grant it is `reusableWorkflowPermissions.test.ts`'s refusal.
 * - `workflow-id-token` — no workflow-level `id-token` grant: every job of that workflow could then mint a token.
 * - `tier-environment` — a `prod` sign-in only in a job bound to `Production`, a `prod-read` one only in a job bound to
 *   none, a `nonprod` one never in a job bound to `Production`. The trust policy would refuse the first two anyway; this
 *   makes the mistake a test failure instead of a red deploy. Tiers and environments that are EXPRESSIONS are evaluated
 *   over every combination of the inputs they read, so `deployInfra.yml`'s per-stage binding is judged, not exempted.
 * - `teardown-prod-tier` — a reclamation job (`reclamationJobs.ts`) signs in only as `nonprod`, the one role that
 *   carries `teardownGrants`.
 * - `cdk-bootstrap` — no `cdk bootstrap`, against ANY qualifier, from any workflow or script. The default qualifier's
 *   stack is shared with another application in the account, and a deploy job that re-runs it rewrites a stack it does
 *   not own. This repository's own qualifiers (ADR-0065) are bootstrapped by the owner with admin credentials, because
 *   a CI role that could bootstrap them could rewrite the trust and the execution policy that bound it.
 * - `unknown-tier` — the tier resolves to one of `GITHUB_OIDC_TIERS`. (Which ROLE each names is held to the stack by
 *   `awsAuthPredicate.test.ts`.)
 * - `missing-timeout` / `session-shorter-than-job` — a signing-in job states `timeout-minutes`, and the session it asks
 *   for lasts at least that long and at most the role's 180-minute ceiling. A deploy that outlives its session loses its
 *   credentials while CloudFormation is still working.
 * - `secrets-before-sign-in` — `load-secrets` reads Secrets Manager with the credentials `awsAuth` set, so a job that
 *   uses it signs in first.
 *
 * There is no exception list. Production signs in on the `prod` and `prod-read` roles like everything else.
 *
 * @pattern Specification — one pure verdict over the workflow graph, judged on the tree and on a fixture table
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import { GITHUB_OIDC_TIERS, PRODUCTION_ENVIRONMENT } from '../lib/platform/githubOidcTrust.js';
import { RECLAMATION_JOBS } from '@kitchensink/repo-guards/reclamationJobs';
import { repoRoot } from '@kitchensink/repo-guards/serviceSources';
import {
    evaluateCondition,
    selectedLiteral,
    tokenize,
    unwrap,
    type Truth,
} from '@kitchensink/repo-guards/workflowExpression';
import { scalarText } from '@kitchensink/repo-guards/workflowScalar';

const AWS_AUTH = './.github/actions/awsAuth';
const AWS_AUTH_ACTION = '.github/actions/awsAuth/action.yml';
const LOAD_SECRETS = './.github/actions/load-secrets';
const SIGN_IN_ACTION = 'aws-actions/configure-aws-credentials@';
const DEFAULT_SESSION_MINUTES = 60;
const MAX_SESSION_MINUTES = 180;

type RuleId =
    | 'static-key'
    | 'unfederated-sign-in'
    | 'missing-id-token'
    | 'workflow-id-token'
    | 'tier-environment'
    | 'teardown-prod-tier'
    | 'cdk-bootstrap'
    | 'unknown-tier'
    | 'missing-timeout'
    | 'session-shorter-than-job'
    | 'secrets-before-sign-in';

interface Violation {
    readonly rule: RuleId;
    readonly where: string;
    readonly detail: string;
}

interface Step {
    readonly name?: string;
    readonly id?: string;
    readonly if?: unknown;
    readonly uses?: string;
    readonly run?: unknown;
    readonly with?: Readonly<Record<string, unknown>>;
}

interface Job {
    readonly if?: unknown;
    readonly uses?: string;
    readonly environment?: unknown;
    readonly permissions?: unknown;
    readonly 'timeout-minutes'?: unknown;
    readonly steps?: readonly Step[];
}

interface Doc {
    readonly permissions?: unknown;
    readonly jobs?: Readonly<Record<string, Job>>;
    readonly runs?: { readonly steps?: readonly Step[] };
}

/** One file under `.github/`: a workflow, a composite action, or a script. */
interface Source {
    readonly file: string;
    readonly text: string;
}

const STATIC_KEY = /secrets\.AWS_[A-Z0-9_]*KEY[A-Z0-9_]*/u;
const BOOTSTRAP = /\bcdk\b[^\n]*\bbootstrap\b/u;

/** Text with `#` comment lines removed, so prose ABOUT a refused command does not trip the guard. */
const withoutCommentLines = (text: string): string =>
    text
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('#'))
        .join('\n');

const isSignIn = (step: Step): boolean => (step.uses ?? '').startsWith(SIGN_IN_ACTION);

/** A value an `environment:` key holds: a name, or `{ name, url }`. */
const environmentText = (environment: unknown): string | undefined => {
    if (environment === undefined || environment === null) {
        return undefined;
    }

    if (typeof environment === 'object') {
        return scalarText((environment as { readonly name?: unknown }).name);
    }

    return scalarText(environment);
};

const OPERATORS = new Set(['&&', '||', '!', '(', ')']);
const COMPARISON = /^([\w.[\]*'-]+?)\s*(==|!=)\s*'([^']*)'$/u;
const PATH = /^[A-Za-z_][\w.-]*$/u;
const OTHER = '\u0000other';

/**
 * Every assignment of the inputs these expressions read, as `path -> value`. A path compared to literals takes each
 * literal and one value equal to none; a path read bare takes true and false. Anything else is not enumerated, and an
 * atom over it evaluates to `'unknown'`.
 */
function assignments(expressions: readonly string[]): readonly Readonly<Record<string, string>>[] {
    const domains = new Map<string, Set<string>>();

    for (const expression of expressions) {
        for (const atom of tokenize(unwrap(expression))) {
            if (OPERATORS.has(atom)) {
                continue;
            }

            const comparison = COMPARISON.exec(atom);

            if (comparison !== null) {
                const [, key = '', , literal = ''] = comparison;
                domains.set(key, new Set([...(domains.get(key) ?? []), literal, OTHER]));
            } else if (PATH.test(atom) && atom !== 'true' && atom !== 'false') {
                domains.set(atom, new Set([...(domains.get(atom) ?? []), 'true', 'false']));
            }
        }
    }

    let all: Record<string, string>[] = [{}];

    for (const [key, values] of domains) {
        all = all.flatMap((partial) => [...values].map((value) => ({ ...partial, [key]: value })));

        if (all.length > 4096) {
            throw new Error(`too many input combinations to enumerate (${expressions.join(' | ')})`);
        }
    }

    return all;
}

const truthy = (value: string | undefined): boolean => value !== undefined && value !== '' && value !== 'false';

/** Resolve one atom under an assignment. */
const resolver =
    (assignment: Readonly<Record<string, string>>) =>
    (atom: string): Truth => {
        if (/^'[^']*'$/u.test(atom)) {
            return atom.length > 2 ? 'true' : 'false';
        }

        if (atom === 'true' || atom === 'false') {
            return atom;
        }

        const comparison = COMPARISON.exec(atom);

        if (comparison !== null) {
            const [, key = '', operator, literal] = comparison;
            const value = assignment[key];

            if (value === undefined) {
                return 'unknown';
            }

            return (value === literal) === (operator === '==') ? 'true' : 'false';
        }

        if (PATH.test(atom) && assignment[atom] !== undefined) {
            return truthy(assignment[atom]) ? 'true' : 'false';
        }

        return 'unknown';
    };

/** How one `awsAuth` step can run: the tier it asks for and the environment its job is bound to, per assignment. */
interface PossibleRun {
    readonly tier: string | undefined;
    readonly environment: string | undefined;
}

function possibleRuns(job: Job, step: Step): readonly PossibleRun[] {
    const tierText = scalarText(step.with?.['tier']);
    const environment = environmentText(job.environment);
    const conditions = [scalarText(job.if), scalarText(step.if)].filter((condition) => condition !== '');
    const runs: PossibleRun[] = [];

    for (const assignment of assignments([...conditions, tierText, environment ?? ''])) {
        const resolve = resolver(assignment);

        if (conditions.some((condition) => evaluateCondition(condition, resolve) === 'false')) {
            continue;
        }

        runs.push({
            tier: selectedLiteral(tierText, resolve),
            environment: environment === undefined ? '' : selectedLiteral(environment, resolve),
        });
    }

    return runs;
}

/** The environment each tier's trust requires: `undefined` means "anything but Production". */
const REQUIRED_ENVIRONMENT: Readonly<Record<string, string | undefined>> = {
    prod: PRODUCTION_ENVIRONMENT,
    'prod-read': '',
    nonprod: undefined,
};

const isTeardown = (file: string, jobId: string): boolean =>
    RECLAMATION_JOBS.some((job) => file === `.github/workflows/${job.workflow}` && job.job === jobId);

const jobKey = (file: string, jobId: string): string => `${path.posix.basename(file)}::${jobId}`;

/** Whether a `permissions:` block names `id-token: write`, at whichever level it was written. */
const permitsIdToken = (permissions: unknown): boolean =>
    typeof permissions === 'object' &&
    permissions !== null &&
    (permissions as Record<string, unknown>)['id-token'] === 'write';

/** Whether a job grants itself `id-token: write` at JOB level, the only grant `awsAuth` can sign in with. */
const grantsIdToken = (job: Job): boolean => permitsIdToken(job.permissions);

/** The `missing-timeout` rule: a job that signs in states a numeric `timeout-minutes`. */
const timeoutRule = (job: Job): readonly RuleHit[] =>
    typeof job['timeout-minutes'] === 'number'
        ? []
        : [['missing-timeout', 'runs awsAuth without a numeric `timeout-minutes`']];

/** The `session-shorter-than-job` rule for ONE sign-in step: a number, within the role's ceiling, that outlasts the job. */
function sessionRule(step: Step, timeout: unknown): readonly RuleHit[] {
    const sessionText = scalarText(step.with?.['session-minutes'], String(DEFAULT_SESSION_MINUTES));
    const session = /^\d+$/u.test(sessionText) ? Number(sessionText) : Number.NaN;

    if (Number.isNaN(session) || session > MAX_SESSION_MINUTES) {
        return [
            [
                'session-shorter-than-job',
                `session-minutes '${sessionText}' is not a number of at most ${MAX_SESSION_MINUTES}`,
            ],
        ];
    }

    return typeof timeout === 'number' && session < timeout
        ? [['session-shorter-than-job', `a ${session}-minute session cannot outlive a ${timeout}-minute job`]]
        : [];
}

/** The `unknown-tier`, `tier-environment` and `teardown-prod-tier` rules for ONE way a sign-in step can run. */
function runRules(file: string, jobId: string, run: PossibleRun): readonly RuleHit[] {
    if (run.tier === undefined || !(GITHUB_OIDC_TIERS as readonly string[]).includes(run.tier)) {
        return [['unknown-tier', `tier resolves to '${run.tier ?? '(an expression this guard cannot resolve)'}'`]];
    }

    const hits: RuleHit[] = [];
    const required = REQUIRED_ENVIRONMENT[run.tier];

    if (run.environment === undefined) {
        hits.push(['tier-environment', 'its environment is an expression this guard cannot resolve']);
    } else if (required === undefined ? run.environment === PRODUCTION_ENVIRONMENT : run.environment !== required) {
        hits.push(['tier-environment', `tier '${run.tier}' can run bound to environment '${run.environment}'`]);
    }

    if (isTeardown(file, jobId) && run.tier !== 'nonprod') {
        hits.push(['teardown-prod-tier', `a reclamation job signs in on tier '${run.tier}'`]);
    }

    return hits;
}

/** A rule a job breaks, and why: `[rule, detail]`. The caller adds where. */
type RuleHit = readonly [RuleId, string];

function jobViolations(file: string, jobId: string, job: Job): Violation[] {
    const where = `${file}::${jobId}`;
    const steps = job.steps ?? [];
    const signInIndexes = steps.flatMap((step, index) => (step.uses === AWS_AUTH ? [index] : []));
    const hits: RuleHit[] = [];

    if (STATIC_KEY.test(JSON.stringify(job))) {
        hits.push(['static-key', 'references an AWS access-key secret; sign in through awsAuth instead']);
    }

    if (steps.some(isSignIn)) {
        hits.push(['unfederated-sign-in', 'calls configure-aws-credentials directly; only awsAuth may']);
    }

    steps.forEach((step, index) => {
        if (step.uses === LOAD_SECRETS && !signInIndexes.some((signIn) => signIn < index)) {
            hits.push(['secrets-before-sign-in', `load-secrets at step ${index} has no awsAuth step before it`]);
        }
    });

    if (signInIndexes.length > 0) {
        if (!grantsIdToken(job)) {
            hits.push(['missing-id-token', 'runs awsAuth without a job-level `id-token: write`']);
        }

        hits.push(...timeoutRule(job));

        for (const index of signInIndexes) {
            const step = steps[index] as Step;

            hits.push(...sessionRule(step, job['timeout-minutes']));

            for (const run of possibleRuns(job, step)) {
                hits.push(...runRules(file, jobId, run));
            }
        }
    }

    return hits.map(([rule, detail]) => ({ rule, where, detail }));
}

const KEY_INPUTS = ['aws-access-key-id', 'aws-secret-access-key', 'aws-session-token'] as const;

/** The `cdk-bootstrap` rule over a shell script. */
function scriptBootstrapViolations(file: string, text: string): Violation[] {
    return BOOTSTRAP.test(withoutCommentLines(text))
        ? [{ rule: 'cdk-bootstrap', where: file, detail: 'a script runs cdk bootstrap' }]
        : [];
}

/** The `cdk-bootstrap` rule over every step of a workflow or action. */
function stepBootstrapViolations(file: string, doc: Doc): Violation[] {
    const steps = [...(doc.runs?.steps ?? []), ...Object.values(doc.jobs ?? {}).flatMap((job) => job.steps ?? [])];

    return steps
        .filter((step) => BOOTSTRAP.test(withoutCommentLines(scalarText(step.run))))
        .map((step) => ({
            rule: 'cdk-bootstrap',
            where: `${file}::${step.name ?? '(unnamed)'}`,
            detail: 'runs cdk bootstrap',
        }));
}

/** The `static-key` and `unfederated-sign-in` rules over a composite action. */
function actionViolations(file: string, text: string, steps: readonly Step[]): Violation[] {
    const violations: Violation[] = STATIC_KEY.test(text)
        ? [{ rule: 'static-key', where: file, detail: 'an action references an AWS access-key secret' }]
        : [];

    for (const step of steps) {
        const keyInput = KEY_INPUTS.some((key) => step.with?.[key] !== undefined);

        if (isSignIn(step) && (file !== AWS_AUTH_ACTION || keyInput)) {
            violations.push({
                rule: 'unfederated-sign-in',
                where: file,
                detail: keyInput ? 'signs in with a key input' : 'only awsAuth may call configure-aws-credentials',
            });
        }
    }

    return violations;
}

/** The `workflow-id-token` rule, and every job's own rules, over a workflow. */
function workflowViolations(file: string, doc: Doc): Violation[] {
    const permissions = doc.permissions;
    const grantsIdTokenToEveryJob = permissions === 'write-all' || permitsIdToken(permissions);

    return [
        ...(grantsIdTokenToEveryJob
            ? [{ rule: 'workflow-id-token' as const, where: file, detail: 'grants id-token at workflow level' }]
            : []),
        ...Object.entries(doc.jobs ?? {}).flatMap(([jobId, job]) => jobViolations(file, jobId, job)),
    ];
}

/** Every rule one file breaks. A script is judged for `cdk bootstrap` alone; an action and a workflow for the rest. */
function sourceViolations({ file, text }: Source): Violation[] {
    if (file.endsWith('.sh')) {
        return scriptBootstrapViolations(file, text);
    }

    const doc = (parse(text) ?? {}) as Doc;
    const rest =
        doc.runs === undefined ? workflowViolations(file, doc) : actionViolations(file, text, doc.runs.steps ?? []);

    return [...stepBootstrapViolations(file, doc), ...rest];
}

/** Every violation over the given sources, keyed and deduplicated. Pure. */
function violationsOf(sources: readonly Source[]): readonly Violation[] {
    const seen = new Set<string>();

    return sources.flatMap(sourceViolations).filter((violation) => {
        const key = `${violation.rule} ${violation.where} ${violation.detail}`;
        const fresh = !seen.has(key);
        seen.add(key);

        return fresh;
    });
}

/** Every workflow, composite action and script under `.github/` in the git index. */
function treeSources(): readonly Source[] {
    return execFileSync(
        'git',
        ['ls-files', '.github/workflows/*.yml', '.github/actions/*/action.yml', '.github/scripts/*.sh'],
        { cwd: repoRoot, encoding: 'utf8' },
    )
        .split('\n')
        .filter(Boolean)
        .map((file) => ({ file, text: readFileSync(path.join(repoRoot, file), 'utf8') }));
}

/** A workflow fixture, one job, signing in correctly. Each row below changes one thing. */
const workflow = (job: string, header = 'permissions:\n    contents: read\n'): Source => ({
    file: '.github/workflows/fixture.yml',
    text: `name: fixture\non: push\n${header}jobs:\n${job}`,
});

const SIGNED_IN_JOB = `    check:
        runs-on: ubuntu-latest
        timeout-minutes: 10
        permissions:
            contents: read
            id-token: write
        steps:
            - id: aws
              uses: ./.github/actions/awsAuth
              with:
                  tier: nonprod
                  account-id: \${{ vars.AWS_ACCOUNT_ID }}
                  region: \${{ vars.DEFAULT_AWS_REGION }}
`;

const DEPLOY_INFRA_ENVIRONMENT =
    "${{ inputs.deploy && inputs.stage == 'prod' && 'Production' || inputs.deploy && 'Sandbox' || '' }}";

/** `deployInfra.yml`'s tier: non-prod off the prod stage, `prod` for a prod deploy, `prod-read` for main's checks. */
const DEPLOY_INFRA_TIER = "${{ inputs.stage != 'prod' && 'nonprod' || inputs.deploy && 'prod' || 'prod-read' }}";

/** `food-loadtest.yml`'s shape: either of two inputs selects prod. Flat, because a grouped expression is not judged. */
const eitherProd = (literal: string, otherwise: string): string =>
    `\${{ inputs.base_stage == 'prod' && '${literal}' || inputs.target_stage == 'prod' && '${literal}' || '${otherwise}' }}`;

const signedIn = (tier: string, extra = '', stepExtra = ''): string =>
    SIGNED_IN_JOB.replace('tier: nonprod', `tier: ${tier}`)
        .replace('        steps:\n', `${extra}        steps:\n`)
        .replace('            - id: aws\n', `            - id: aws\n${stepExtra}`);

const FIXTURES: readonly {
    readonly shape: string;
    readonly sources: readonly Source[];
    readonly rule: RuleId | null;
}[] = [
    { shape: 'a correctly signed-in job', sources: [workflow(SIGNED_IN_JOB)], rule: null },
    {
        shape: 'a step that hands the access key to the AWS CLI through env',
        sources: [
            workflow(`    probe:
        runs-on: ubuntu-latest
        steps:
            - env:
                  AWS_ACCESS_KEY_ID: \${{ secrets.AWS_ACCESS_KEY_ID }}
              run: aws sts get-caller-identity
`),
        ],
        rule: 'static-key',
    },
    {
        shape: 'a caller that forwards the key to a reusable workflow',
        sources: [
            workflow(`    call:
        uses: ./.github/workflows/other.yml
        secrets:
            AWS_SECRET_ACCESS_KEY: \${{ secrets.AWS_SECRET_ACCESS_KEY }}
`),
        ],
        rule: 'static-key',
    },
    {
        shape: 'configure-aws-credentials called directly, even by role',
        sources: [
            workflow(`    direct:
        runs-on: ubuntu-latest
        steps:
            - uses: aws-actions/configure-aws-credentials@7474bc4690e29a8392af63c5b98e7449536d5c3a # v4.3.1
              with:
                  role-to-assume: arn:aws:iam::1:role/kitchensink-gha-nonprod
                  aws-region: us-east-1
`),
        ],
        rule: 'unfederated-sign-in',
    },
    {
        shape: 'a composite action other than awsAuth that signs in',
        sources: [
            {
                file: '.github/actions/other/action.yml',
                text: `name: other
runs:
    using: composite
    steps:
        - uses: aws-actions/configure-aws-credentials@7474bc4690e29a8392af63c5b98e7449536d5c3a # v4.3.1
          with:
              role-to-assume: arn:aws:iam::1:role/kitchensink-gha-nonprod
              aws-region: us-east-1
`,
            },
        ],
        rule: 'unfederated-sign-in',
    },
    {
        shape: 'awsAuth itself taking a key input',
        sources: [
            {
                file: AWS_AUTH_ACTION,
                text: `name: awsAuth
runs:
    using: composite
    steps:
        - uses: aws-actions/configure-aws-credentials@7474bc4690e29a8392af63c5b98e7449536d5c3a # v4.3.1
          with:
              aws-access-key-id: \${{ inputs.key }}
              aws-region: us-east-1
`,
            },
        ],
        rule: 'unfederated-sign-in',
    },
    {
        shape: 'an awsAuth job with no job-level id-token grant',
        sources: [workflow(SIGNED_IN_JOB.replace('            id-token: write\n', ''))],
        rule: 'missing-id-token',
    },
    {
        shape: 'an awsAuth job whose id-token grant is only read',
        sources: [workflow(SIGNED_IN_JOB.replace('id-token: write', 'id-token: read'))],
        rule: 'missing-id-token',
    },
    {
        shape: 'a workflow-level id-token grant',
        sources: [workflow(SIGNED_IN_JOB, 'permissions:\n    contents: read\n    id-token: write\n')],
        rule: 'workflow-id-token',
    },
    {
        shape: 'a workflow-level write-all',
        sources: [workflow(SIGNED_IN_JOB, 'permissions: write-all\n')],
        rule: 'workflow-id-token',
    },
    {
        shape: 'a prod sign-in in a job bound to no environment',
        sources: [workflow(signedIn('prod'))],
        rule: 'tier-environment',
    },
    {
        shape: 'a nonprod sign-in in a job bound to Production',
        sources: [workflow(signedIn('nonprod', '        environment: Production\n'))],
        rule: 'tier-environment',
    },
    {
        shape: 'a prod-read sign-in in a job bound to Sandbox',
        sources: [workflow(signedIn('prod-read', '        environment: Sandbox\n'))],
        rule: 'tier-environment',
    },
    {
        shape: "deployInfra's per-stage binding with a nonprod sign-in that can run at prod",
        sources: [workflow(signedIn('nonprod', `        environment: ${DEPLOY_INFRA_ENVIRONMENT}\n`))],
        rule: 'tier-environment',
    },
    {
        shape: "deployInfra's per-stage binding with the nonprod sign-in kept off the prod stage",
        sources: [
            workflow(
                signedIn(
                    'nonprod',
                    `        environment: ${DEPLOY_INFRA_ENVIRONMENT}\n`,
                    "              if: inputs.stage != 'prod'\n",
                ),
            ),
        ],
        rule: null,
    },
    {
        shape: 'a tier chosen by stage that pairs prod with Production',
        sources: [
            workflow(
                signedIn(
                    "${{ inputs.stage == 'prod' && 'prod' || 'nonprod' }}",
                    "        environment: ${{ inputs.stage == 'prod' && 'Production' || 'Sandbox' }}\n",
                ),
            ),
        ],
        rule: null,
    },
    {
        shape: "deployInfra's three-way tier under its per-stage binding",
        sources: [workflow(signedIn(DEPLOY_INFRA_TIER, `        environment: ${DEPLOY_INFRA_ENVIRONMENT}\n`))],
        rule: null,
    },
    {
        shape: "deployInfra's binding with prod and prod-read swapped",
        sources: [
            workflow(
                signedIn(
                    "${{ inputs.stage != 'prod' && 'nonprod' || inputs.deploy && 'prod-read' || 'prod' }}",
                    `        environment: ${DEPLOY_INFRA_ENVIRONMENT}\n`,
                ),
            ),
        ],
        rule: 'tier-environment',
    },
    {
        shape: "deployInfra's binding with a prod-read tier that can run on a non-prod stage",
        sources: [
            workflow(
                signedIn(
                    "${{ inputs.deploy && 'prod' || 'prod-read' }}",
                    `        environment: ${DEPLOY_INFRA_ENVIRONMENT}\n`,
                ),
            ),
        ],
        rule: 'tier-environment',
    },
    {
        shape: 'a manual run where either of two inputs selects prod and Production',
        sources: [
            workflow(signedIn(eitherProd('prod', 'nonprod'), `        environment: ${eitherProd('Production', '')}\n`)),
        ],
        rule: null,
    },
    {
        shape: 'a manual run whose Production binding reads only one of the two inputs that select prod',
        sources: [
            workflow(
                signedIn(
                    eitherProd('prod', 'nonprod'),
                    "        environment: ${{ inputs.target_stage == 'prod' && 'Production' || '' }}\n",
                ),
            ),
        ],
        rule: 'tier-environment',
    },
    {
        shape: 'a tier chosen by stage whose environment is chosen by a different input',
        sources: [
            workflow(
                signedIn(
                    "${{ inputs.stage == 'prod' && 'prod' || 'nonprod' }}",
                    "        environment: ${{ inputs.deploy && 'Production' || 'Sandbox' }}\n",
                ),
            ),
        ],
        rule: 'tier-environment',
    },
    {
        shape: 'an environment this guard cannot resolve',
        sources: [workflow(signedIn('nonprod', '        environment: ${{ needs.plan.outputs.environment }}\n'))],
        rule: 'tier-environment',
    },
    {
        shape: 'a reclamation job signing in on prod-read',
        sources: [{ ...workflow(signedIn('prod-read')), file: '.github/workflows/sandboxCleanup.yml' }].map(
            (source) => ({ ...source, text: source.text.replace('    check:\n', '    cleanup:\n') }),
        ),
        rule: 'teardown-prod-tier',
    },
    {
        shape: 'cdk bootstrap in a step',
        sources: [
            workflow(`    boot:
        runs-on: ubuntu-latest
        steps:
            - run: packages/infra/global/node_modules/.bin/cdk bootstrap "aws://1/us-east-1"
`),
        ],
        rule: 'cdk-bootstrap',
    },
    {
        shape: 'cdk bootstrap of an owned qualifier in a step',
        sources: [
            workflow(`    boot:
        runs-on: ubuntu-latest
        steps:
            - run: packages/infra/global/node_modules/.bin/cdk bootstrap --qualifier ksnonprod --toolkit-stack-name kitchensink-bootstrap-ksnonprod
`),
        ],
        rule: 'cdk-bootstrap',
    },
    {
        shape: 'cdk bootstrap against the default qualifier in a script',
        sources: [
            { file: '.github/scripts/boot.sh', text: '#!/usr/bin/env bash\nnpx cdk bootstrap --qualifier hnb659fds\n' },
        ],
        rule: 'cdk-bootstrap',
    },
    {
        shape: 'cdk bootstrap in a script',
        sources: [{ file: '.github/scripts/boot.sh', text: '#!/usr/bin/env bash\nnpx cdk bootstrap\n' }],
        rule: 'cdk-bootstrap',
    },
    {
        shape: 'a script that only MENTIONS cdk bootstrap in a comment',
        sources: [{ file: '.github/scripts/boot.sh', text: '#!/usr/bin/env bash\n# never run cdk bootstrap here\n' }],
        rule: null,
    },
    { shape: 'a tier the stack does not define', sources: [workflow(signedIn('production'))], rule: 'unknown-tier' },
    {
        shape: 'a tier read from a step output',
        sources: [workflow(signedIn('${{ steps.plan.outputs.tier }}'))],
        rule: 'unknown-tier',
    },
    {
        shape: 'an awsAuth job with no timeout',
        sources: [workflow(SIGNED_IN_JOB.replace('        timeout-minutes: 10\n', ''))],
        rule: 'missing-timeout',
    },
    {
        shape: 'a 90-minute job on the default one-hour session',
        sources: [workflow(SIGNED_IN_JOB.replace('timeout-minutes: 10', 'timeout-minutes: 90'))],
        rule: 'session-shorter-than-job',
    },
    {
        shape: 'a 90-minute job that asks for a 90-minute session',
        sources: [
            workflow(
                SIGNED_IN_JOB.replace('timeout-minutes: 10', 'timeout-minutes: 90').replace(
                    '                  tier: nonprod\n',
                    "                  tier: nonprod\n                  session-minutes: '90'\n",
                ),
            ),
        ],
        rule: null,
    },
    {
        shape: "a session longer than the role's ceiling",
        sources: [
            workflow(
                SIGNED_IN_JOB.replace(
                    '                  tier: nonprod\n',
                    "                  tier: nonprod\n                  session-minutes: '240'\n",
                ),
            ),
        ],
        rule: 'session-shorter-than-job',
    },
    {
        shape: 'load-secrets before the sign-in',
        sources: [
            workflow(
                SIGNED_IN_JOB.replace(
                    '            - id: aws\n',
                    '            - uses: ./.github/actions/load-secrets\n              with:\n                  stage: sandbox\n            - id: aws\n',
                ),
            ),
        ],
        rule: 'secrets-before-sign-in',
    },
    {
        shape: 'load-secrets after the sign-in',
        sources: [
            workflow(
                `${SIGNED_IN_JOB}            - uses: ./.github/actions/load-secrets\n              with:\n                  stage: sandbox\n`,
            ),
        ],
        rule: null,
    },
];

describe('the guard refuses each shape it names, and only that rule', () => {
    for (const fixture of FIXTURES) {
        it(`${fixture.shape} → ${fixture.rule ?? 'clean'}`, () => {
            const rules = [...new Set(violationsOf(fixture.sources).map((violation) => violation.rule))];

            expect(rules).toEqual(fixture.rule === null ? [] : [fixture.rule]);
        });
    }

    // The shape every production job had before the move, kept as the case both key rules exist for.
    it('refuses the old production sign-in on both key rules', () => {
        const keyed = workflow(`    deploy:
        runs-on: ubuntu-latest
        environment: Production
        steps:
            - uses: aws-actions/configure-aws-credentials@7474bc4690e29a8392af63c5b98e7449536d5c3a # v4.3.1
              with:
                  aws-access-key-id: \${{ secrets.AWS_ACCESS_KEY_ID }}
                  aws-secret-access-key: \${{ secrets.AWS_SECRET_ACCESS_KEY }}
                  aws-region: us-east-1
`);

        expect(
            violationsOf([keyed])
                .map((violation) => violation.rule)
                .sort(),
        ).toEqual(['static-key', 'unfederated-sign-in']);
    });
});

describe('the tree signs in to AWS only through awsAuth', () => {
    const sources = treeSources();

    it('is not vacuous: it reads awsAuth, load-secrets and the jobs that sign in', () => {
        const files = sources.map((source) => source.file);

        expect(files).toContain(AWS_AUTH_ACTION);
        expect(files).toContain('.github/actions/load-secrets/action.yml');

        const signingIn = sources
            .filter((source) => source.file.startsWith('.github/workflows/'))
            .flatMap((source) =>
                Object.entries(((parse(source.text) ?? {}) as Doc).jobs ?? {})
                    .filter(([, job]) => (job.steps ?? []).some((step) => step.uses === AWS_AUTH))
                    .map(([jobId]) => jobKey(source.file, jobId)),
            );

        expect(signingIn).toEqual(expect.arrayContaining(['sandboxCleanup.yml::cleanup', 'sandboxUp.yml::start']));
        expect(signingIn.length).toBeGreaterThan(30);
    });

    it('breaks none of the rules', () => {
        expect(violationsOf(sources)).toEqual([]);
    });

    it('signs in on every production tier somewhere: prod deploys, and prod-read checks on main', () => {
        const tiers = sources
            .filter((source) => source.file.startsWith('.github/workflows/'))
            .flatMap((source) =>
                Object.values(((parse(source.text) ?? {}) as Doc).jobs ?? {}).flatMap((job) =>
                    (job.steps ?? [])
                        .filter((step) => step.uses === AWS_AUTH)
                        .flatMap((step) => possibleRuns(job, step).map((run) => run.tier)),
                ),
            );

        expect(new Set(tiers)).toEqual(new Set(GITHUB_OIDC_TIERS));
    });
});
