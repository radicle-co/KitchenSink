/**
 * Synthesizes every CDK app at the stages each qualifier serves and writes what the stacks actually contain:
 * `manifests/cfnResourceTypes.<qualifier>.json`.
 *
 * ## Why this exists
 *
 * The execution policy is the privilege (ADR-0065): it is what CloudFormation uses to create every resource.
 * Writing its service list by hand drifts the day a construct adds a resource type. So the list is DERIVED from
 * the templates the apps really synthesize, committed, and compared in both directions by
 * `__tests__/manifestCoverage.test.ts`.
 *
 * ## What is derived
 *
 * - `resourceTypes` — every `Resources.*.Type`.
 * - `roleActions` — every IAM action written into a role's inline policy, a standalone `AWS::IAM::Policy` or a
 *   `AWS::IAM::ManagedPolicy` (the boundary must allow the union).
 * - `rolePassedToServices` — every service principal a created role trusts (what `iam:PassRole` must admit).
 * - `awsManagedPolicies` — AWS-managed policy ARNs attached to roles (their actions are not in the template).
 * - `stackNames` — every stack name, so the deploy role's stack patterns can be checked against reality.
 * - `dockerImageAssets` — whether any `*.assets.json` carries a docker image. The CI roles do not get the
 *   image-publishing role, so an app that starts producing one must fail a guard rather than a deploy.
 *
 * ## How it runs
 *
 * Each app is a real entrypoint (`bin/app.ts`), run under `tsx` with `CDK_OUTDIR` pointing at a scratch directory
 * and placeholder environment. The VPC/hosted-zone ids are placeholders that `cdk.context.json` or the dummy-value
 * provider answers, so no AWS call is made. An app that fails to synthesize fails the script: a manifest that
 * silently omitted an app would be a guard that passes over it.
 *
 * Heavier than a unit test (it boots ten apps), so it is a SCRIPT whose output is committed; the guard test reads
 * the committed JSON, and `--check` re-derives and diffs for anyone who wants the full proof.
 *
 * @sideEffect Spawns child processes, writes a scratch directory under the OS temp dir and the manifests.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { QUALIFIERS, type QualifierName } from '../src/qualifiers.js';

/** The stages that stand for each stage-bearing qualifier. `pr-1` stands for every `pr-{N}`. */
const STAGES_BY_QUALIFIER: Readonly<Record<'ksnonprod' | 'ksprod', readonly string[]>> = {
    ksnonprod: ['sandbox', 'pr-1'],
    ksprod: ['prod'],
};

const here = path.dirname(fileURLToPath(import.meta.url));
export const BOOTSTRAP_ROOT = path.resolve(here, '..');
export const REPO_ROOT = path.resolve(BOOTSTRAP_ROOT, '../../..');

/**
 * The CDK entrypoints, discovered rather than listed. A new `infra/bin/app.ts` is covered the day it lands.
 * The stage-less account app is the one entrypoint that is not a stage app.
 */
export function discoverStageApps(repoRoot: string): readonly string[] {
    const apps: string[] = [];
    const services = path.join(repoRoot, 'packages/services');

    for (const entry of readdirSync(services, { withFileTypes: true })) {
        const candidate = path.join(services, entry.name, 'infra/bin/app.ts');

        if (entry.isDirectory() && existsSync(candidate)) {
            apps.push(path.relative(repoRoot, candidate));
        }
    }

    for (const fixed of ['packages/infra/global/bin/app.ts', 'packages/apps/commise/web/infra/bin/app.ts']) {
        if (existsSync(path.join(repoRoot, fixed))) {
            apps.push(fixed);
        }
    }

    return apps.sort();
}

export const ACCOUNT_APP = 'packages/infra/global/bin/account.ts';

/**
 * The global app's Lambda@Edge bundle inlines the Clerk key at BUILD time and `EdgeStack` refuses a bundle built
 * with a different key than synth was given, so the one bundle whose content depends on this script's placeholder
 * environment is built here, with it. The other apps' bundles do not depend on the environment and are a
 * prerequisite (`npm run bundle:lambda` in each package, as CI's build step does).
 *
 * @sideEffect Writes `packages/infra/global/dist-edge` and `dist-lambda` (ignored build output).
 */
export function buildGlobalBundles(): void {
    const result = spawnSync('node', ['esbuild.mjs'], {
        cwd: path.join(REPO_ROOT, 'packages/infra/global'),
        env: placeholderEnvironment('prod', ''),
        encoding: 'utf8',
    });

    if (result.status !== 0) {
        throw new Error(`global bundle failed:\n${result.stderr.slice(-2000)}`);
    }
}

/** Placeholder environment that lets every app synthesize offline. Never a real id. */
export function placeholderEnvironment(stage: string, outdir: string): NodeJS.ProcessEnv {
    return {
        ...process.env,
        CDK_OUTDIR: outdir,
        STAGE: stage,
        DOMAIN_NAME: 'commise.app',
        CDK_DEFAULT_ACCOUNT: '123456789012',
        AWS_ACCOUNT_ID: '123456789012',
        CDK_DEFAULT_REGION: 'us-east-1',
        IDENTITY_VPC_ID: 'vpc-12345678',
        FOOD_VPC_ID: 'vpc-12345678',
        RECIPE_VPC_ID: 'vpc-12345678',
        ALARMS_ENABLED: 'true',
        COST_ALERT_EMAIL: 'ci@example.com',
        LOG_FORWARDER_ARN: 'arn:aws:lambda:us-east-1:123456789012:function:placeholder',
        IDENTITY_IMAGE_TAG: 'placeholder',
        FOOD_IMAGE_TAG: 'placeholder',
        RECIPE_IMAGE_TAG: 'placeholder',
        RECIPE_FOOD_SERVICE_URL: 'https://food.commise.app',
        CLERK_AUTHORIZED_PARTIES: 'https://commise.app',
        CLERK_AZP_PATTERN: '^https://pr-[0-9]+\\.sandbox\\.commise\\.app$',
        CLERK_AZP_PREVIEW_MODE: 'strict',
        PAID_FEATURES_GATE: 'off',
        CLERK_JWT_KEY:
            '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAfixture\n-----END PUBLIC KEY-----',
        RECIPE_LAMBDA_SG_ID: 'sg-12345678',
        RECIPE_DB_ENDPOINT: 'db.placeholder.us-east-1.rds.amazonaws.com',
        RECIPE_DB_INSTANCE_ID: 'db-PLACEHOLDER',
        RECIPE_ARCHIVE_BUCKET: 'kitchensink-placeholder-archive',
        RECIPE_MEDIA_BUCKET: 'kitchensink-placeholder-media',
        HANDLE_SYNC_TOPIC_ARN: 'arn:aws:sns:us-east-1:123456789012:placeholder',
    };
}

interface CfnResource {
    readonly Type: string;
    readonly Properties?: Record<string, unknown>;
}

interface Template {
    readonly Resources?: Record<string, CfnResource>;
}

export interface Derived {
    readonly resourceTypes: Set<string>;
    readonly roleActions: Set<string>;
    readonly awsManagedPolicies: Set<string>;
    readonly rolePassedToServices: Set<string>;
    readonly stackNames: Set<string>;
    dockerImageAssets: boolean;
}

export const emptyDerived = (): Derived => ({
    resourceTypes: new Set(),
    roleActions: new Set(),
    awsManagedPolicies: new Set(),
    rolePassedToServices: new Set(),
    stackNames: new Set(),
    dockerImageAssets: false,
});

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : value === undefined ? [] : [value]);

/** Collects the IAM actions of one policy document (a `Statement` list or a single statement). */
function collectActions(document: unknown, into: Set<string>): void {
    if (typeof document !== 'object' || document === null) {
        return;
    }

    for (const statement of asArray((document as { Statement?: unknown }).Statement)) {
        if ((statement as { Effect?: string }).Effect === 'Deny') {
            continue;
        }

        for (const action of asArray((statement as { Action?: unknown }).Action)) {
            if (typeof action === 'string') {
                into.add(action);
            }
        }
    }
}

/** Collects the service principals one role trust document names. */
function collectTrustServices(document: unknown, into: Set<string>): void {
    if (typeof document !== 'object' || document === null) {
        return;
    }

    for (const statement of asArray((document as { Statement?: unknown }).Statement)) {
        const principal = (statement as { Principal?: { Service?: unknown } }).Principal;

        for (const service of asArray(principal?.Service)) {
            if (typeof service === 'string') {
                into.add(service);
            }
        }
    }
}

/** Folds one synthesized `cdk.out` directory into `into`. Pure of anything but the directory it reads. */
export function foldCloudAssembly(outdir: string, into: Derived): void {
    const assembly = JSON.parse(readFileSync(path.join(outdir, 'manifest.json'), 'utf8')) as {
        artifacts?: Record<string, { type: string; properties?: { stackName?: string } }>;
    };

    // The CloudFormation stack name is the artifact's `stackName`, or its id when none is set. The template file
    // name is the construct id, which is NOT the stack name (`IdentityService-sandbox` deploys as
    // `kitchensink-identity-service-sandbox`), so the manifest is the only honest source. Nested stacks have no
    // artifact of their own and are not top-level deploy targets.
    for (const [id, artifact] of Object.entries(assembly.artifacts ?? {})) {
        if (artifact.type === 'aws:cloudformation:stack') {
            into.stackNames.add(artifact.properties?.stackName ?? id);
        }
    }

    for (const file of readdirSync(outdir)) {
        const full = path.join(outdir, file);

        if (file.endsWith('.assets.json')) {
            const assets = JSON.parse(readFileSync(full, 'utf8')) as { dockerImages?: Record<string, unknown> };

            if (Object.keys(assets.dockerImages ?? {}).length > 0) {
                into.dockerImageAssets = true;
            }

            continue;
        }

        if (!file.endsWith('.template.json')) {
            continue;
        }

        const template = JSON.parse(readFileSync(full, 'utf8')) as Template;

        for (const resource of Object.values(template.Resources ?? {})) {
            into.resourceTypes.add(resource.Type);
            const properties = resource.Properties ?? {};

            if (resource.Type === 'AWS::IAM::Role') {
                collectTrustServices(properties['AssumeRolePolicyDocument'], into.rolePassedToServices);

                for (const inline of asArray(properties['Policies'])) {
                    collectActions((inline as { PolicyDocument?: unknown }).PolicyDocument, into.roleActions);
                }

                for (const arn of asArray(properties['ManagedPolicyArns'])) {
                    const rendered = JSON.stringify(arn);
                    const match = /policy\/([^"\\]+)"/u.exec(rendered);

                    if (match?.[1] !== undefined) {
                        into.awsManagedPolicies.add(match[1]);
                    }
                }
            } else if (resource.Type === 'AWS::IAM::Policy' || resource.Type === 'AWS::IAM::ManagedPolicy') {
                collectActions(properties['PolicyDocument'], into.roleActions);
            }
        }
    }
}

/**
 * An app may REFUSE a stage on purpose (the food service has no persistent `sandbox` instance). That refusal is
 * the app's own guard speaking, so it is the one failure that is not an error. Anything else is.
 */
const DELIBERATE_REFUSAL = /Refusing to (?:deploy|synthesize)/u;

/**
 * Runs one app at one stage and folds its cloud assembly.
 *
 * @returns True when the app synthesized, false when it deliberately refused the stage.
 * @throws When the app fails for any other reason: a manifest that skipped an app would be a guard that passes over it.
 */
function synthesize(app: string, stage: string, into: Derived, scratch: string): boolean {
    const outdir = mkdtempSync(path.join(scratch, 'out-'));
    const cwd = path.join(REPO_ROOT, path.dirname(path.dirname(app)));
    const result = spawnSync('npx', ['tsx', path.join(REPO_ROOT, app)], {
        cwd,
        env: placeholderEnvironment(stage, outdir),
        encoding: 'utf8',
        timeout: 280_000,
    });

    if (result.status !== 0) {
        if (DELIBERATE_REFUSAL.test(result.stderr)) {
            return false;
        }

        throw new Error(`${app} @ ${stage} failed to synthesize:\n${result.stderr.slice(-2000)}`);
    }

    foldCloudAssembly(outdir, into);

    return true;
}

/** The serialisable manifest: sorted so a regeneration is byte-stable. */
export function toManifest(qualifier: QualifierName, derived: Derived): Record<string, unknown> {
    const sorted = (set: Set<string>): string[] => [...set].sort();

    return {
        qualifier,
        resourceTypes: sorted(derived.resourceTypes),
        roleActions: sorted(derived.roleActions),
        rolePassedToServices: sorted(derived.rolePassedToServices),
        awsManagedPolicies: sorted(derived.awsManagedPolicies),
        stackNames: sorted(derived.stackNames),
        dockerImageAssets: derived.dockerImageAssets,
    };
}

/** @sideEffect Synthesizes every app; writes the manifests (or, with `--check`, only compares). */
function main(): void {
    const check = process.argv.includes('--check');
    // `KS_DERIVE_KEEP=<dir>` keeps the synthesized cloud assemblies for inspection (a policy author's tool).
    const keep = process.env['KS_DERIVE_KEEP'];
    const scratch = keep ?? mkdtempSync(path.join(tmpdir(), 'ksDerive-'));

    try {
        buildGlobalBundles();
        const stageApps = discoverStageApps(REPO_ROOT);
        const manifests = new Map<QualifierName, Derived>();
        const synthesizedAnywhere = new Map<string, boolean>();

        for (const qualifier of ['ksnonprod', 'ksprod'] as const) {
            const derived = emptyDerived();

            for (const app of stageApps) {
                const synthesized = STAGES_BY_QUALIFIER[qualifier].map((stage) =>
                    synthesize(app, stage, derived, scratch),
                );

                // An app that deploys through this qualifier must synthesize at one of its stages at least.
                // (An app may exist only in the other tier; the check below is per run, across both tiers.)
                synthesizedAnywhere.set(app, (synthesizedAnywhere.get(app) ?? false) || synthesized.some(Boolean));
            }

            manifests.set(qualifier, derived);
        }

        for (const [app, ok] of synthesizedAnywhere) {
            if (!ok) {
                throw new Error(`${app} refused every stage it was asked to synthesize at`);
            }
        }

        const account = emptyDerived();
        synthesize(ACCOUNT_APP, 'account', account, scratch);
        manifests.set(QUALIFIERS.account, account);

        mkdirSync(path.join(BOOTSTRAP_ROOT, 'manifests'), { recursive: true });
        let drift = false;

        for (const [qualifier, derived] of manifests) {
            const target = path.join(BOOTSTRAP_ROOT, 'manifests', `cfnResourceTypes.${qualifier}.json`);
            const text = `${JSON.stringify(toManifest(qualifier, derived), null, 4)}\n`;

            if (check) {
                drift ||= !existsSync(target) || readFileSync(target, 'utf8') !== text;
            } else {
                writeFileSync(target, text);
            }
        }

        if (drift) {
            throw new Error(
                'manifests are stale: run `npm run bootstrap:derive --workspace=@kitchensink/cdk-bootstrap`',
            );
        }
    } finally {
        if (keep === undefined) {
            rmSync(scratch, { recursive: true, force: true });
        }
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main();
}
