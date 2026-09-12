/**
 * @module __tests__/prodDeployEnvironment — the environment the PRODUCTION pipeline synthesizes prod with.
 *
 * ## Why this is derived rather than written down
 *
 * `prod-deploy.yml` is the authority for what production actually deploys with: it is the only thing that
 * runs `cdk deploy` against the prod account. Any guard that reasons about "the prod template" is reasoning
 * about the template THAT workflow produces, and a second copy of its environment inside a test is a fact
 * with two representations — one of which nobody updates. That is the exact failure ADR-0013's burn-down
 * table already paid for once (a measured number, recorded, re-checked by nothing).
 *
 * ## The rule: a LITERAL is posture, an EXPRESSION is a coordinate
 *
 * The workflow's `env:` blocks already encode the distinction a hermetic synth needs, and it is not a
 * heuristic — it is why the split exists:
 *
 * - A `${{ … }}` value is a **coordinate**, resolved at deploy time from a repository variable, a secret or
 *   a live `describe` (`IDENTITY_VPC_ID`, `RECIPE_DB_ENDPOINT`, `CDK_DEFAULT_ACCOUNT`). A test cannot know
 *   it, must not contact AWS to learn it, and does not need to: it names *where* a resource lives, not
 *   *which* resources are declared.
 * - A **literal** value is a **posture decision** the pipeline states outright (`STAGE: prod`,
 *   `EDGE_CUTOVER_SERVICES: food,recipe,identity`). Those select between *different templates*, so a synth
 *   that stubs them is not synthesizing the deployed shape at all.
 *
 * ⚠️ **The measured consequence of getting this wrong.** `nagRulesAtZero.integration.test.ts` spawned its
 * synth with a minimal child environment, so `EDGE_CUTOVER_SERVICES` was unset. `publicRecordOwnerFor` reads
 * unset as "nobody has cut over" — the correct default for a deploy, and the wrong one for a census — so
 * `EdgeStack` omitted `domainNames`/`certificate` from all three distributions and CloudFront's DEFAULT
 * certificate applied, which forces `MinimumProtocolVersion: TLSv1`. cdk-nag reported three
 * `AwsSolutions-CFR4` findings, they were written into ADR-0013's table as production's posture, and they
 * were an artifact of the measurement. The live distributions all carry an alias and `TLSv1.2_2021`.
 *
 * ⛔ Note the shape of that hole, because it is the general case and not a one-off: an environment variable
 * with a SAFE DEFAULT is invisible to `HERMETIC_ENV`'s "an app that starts reading a key nobody supplies
 * fails LOUDLY" mechanism. It does not fail — it silently synthesizes the other branch. Deriving every
 * literal, rather than naming the one key we know about, is what closes that for the next flag as well as
 * this one.
 *
 * ## Scope, and why step-level `env:` is excluded
 *
 * Workflow-level `env:` and each job's `env:` are in scope for every step of that job, including the `cdk
 * deploy` steps. A STEP's own `env:` is in scope for that step alone — `SENTRY_ORG` on the source-map upload
 * is not part of any synth — and a YAML parse excludes it structurally rather than by an indentation rule.
 *
 * DESIGN PATTERN: Repository — one read-only reading of the production deploy environment, shared by every
 * specification that judges the production template. Parsing is delegated to `yaml`; nothing here hand-rolls
 * a scanner.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { parse } from 'yaml';

import { repoRoot } from './serviceSources.js';

/** The one workflow that deploys production. */
export const PROD_DEPLOY_WORKFLOW = '.github/workflows/prod-deploy.yml';

/** The GitHub Actions expression marker. A value containing one is resolved at deploy time, not here. */
const EXPRESSION = '${{';

/** The subset of a workflow document this module reads. */
interface WorkflowDocument {
    readonly env?: Record<string, unknown>;
    readonly jobs?: Record<string, { readonly env?: Record<string, unknown> }>;
}

/**
 * Keep the entries whose values are literal — no `${{ … }}` anywhere in them.
 *
 * A non-string scalar (`NODE_VERSION: 24` parses as a number) is still a literal; it is stringified, because
 * an environment variable is a string by the time a process reads it.
 *
 * @param block - One `env:` mapping, or `undefined` when the scope declares none.
 * @returns The literal entries, stringified. Pure.
 */
function literalsOf(block: Record<string, unknown> | undefined): Readonly<Record<string, string>> {
    return Object.fromEntries(
        Object.entries(block ?? {})
            .filter(([, value]) => value !== null && value !== undefined && typeof value !== 'object')
            .map(([key, value]) => [key, String(value)])
            .filter(([, value]) => !(value ?? '').includes(EXPRESSION)),
    );
}

/**
 * Every literal environment value the production deploy workflow declares at workflow or job scope.
 *
 * ⛔ Two jobs disagreeing on one key THROWS rather than resolving to whichever was parsed last. There is one
 * deploying job today, so the case is hypothetical — but a silent last-write-wins would hand a caller a
 * value no step actually runs under, which is the same class of quiet wrongness this module exists to end.
 *
 * @returns The merged literal environment, ready to overlay onto a synth's stubs. Impure.
 * @sideEffect Reads the workflow from disk.
 * @throws When two jobs declare the same key with different literal values.
 */
export function prodDeployLiteralEnvironment(): Readonly<Record<string, string>> {
    const document = parse(readFileSync(path.join(repoRoot, PROD_DEPLOY_WORKFLOW), 'utf8')) as WorkflowDocument;
    const merged: Record<string, string> = { ...literalsOf(document.env) };

    for (const [job, { env }] of Object.entries(document.jobs ?? {})) {
        for (const [key, value] of Object.entries(literalsOf(env))) {
            const existing = merged[key];

            if (existing !== undefined && existing !== value) {
                throw new Error(
                    `${PROD_DEPLOY_WORKFLOW} declares ${key} twice with different literal values ` +
                        `(${JSON.stringify(existing)} and ${JSON.stringify(value)} in job '${job}'). ` +
                        'A caller cannot be handed one environment when two steps run under different ones.',
                );
            }

            merged[key] = value;
        }
    }

    return merged;
}
