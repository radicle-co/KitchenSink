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
 * - `roleStatements` — every Allow of every role policy as (actions, resources) with the resources RENDERED to ARNs
 *   (intrinsics, cross-stack imports and SSM references followed), so the boundary can be judged on RESOURCES too.
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

import { z } from 'zod';

import { isRecord, toList, type Json } from '../src/json.js';
import { QUALIFIERS, type QualifierName } from '../src/qualifiers.js';
import {
    buildWorld,
    renderRoleStatements,
    statementsOf,
    type RoleStatement,
    type StackTemplate,
    type TemplateResource,
} from '../src/roleStatements.js';

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

export interface Derived {
    readonly resourceTypes: Set<string>;
    readonly roleActions: Set<string>;
    readonly awsManagedPolicies: Set<string>;
    readonly rolePassedToServices: Set<string>;
    readonly stackNames: Set<string>;
    /** Every parsed template, kept so resources can be rendered across stacks once all apps are folded. */
    readonly stacks: StackTemplate[];
    readonly roleStatements: RoleStatement[];
    dockerImageAssets: boolean;
}

export const emptyDerived = (): Derived => ({
    resourceTypes: new Set(),
    roleActions: new Set(),
    awsManagedPolicies: new Set(),
    rolePassedToServices: new Set(),
    stackNames: new Set(),
    stacks: [],
    roleStatements: [],
    dockerImageAssets: false,
});

/** What a cloud assembly's `manifest.json` carries that this script reads. */
const manifestSchema = z.object({
    artifacts: z
        .record(
            z.string(),
            z.object({
                type: z.string(),
                properties: z
                    .object({ stackName: z.string().optional(), templateFile: z.string().optional() })
                    .optional(),
            }),
        )
        .optional(),
});

/** What an `*.assets.json` carries that this script reads. */
const assetsSchema = z.object({ dockerImages: z.record(z.string(), z.unknown()).optional() });

/** A synthesized template, as far as the derivation reads it (the shape `roleStatements` renders). */
const templateSchema = z.object({
    Resources: z
        .record(z.string(), z.object({ Type: z.string(), Properties: z.record(z.string(), z.json()).optional() }))
        .optional(),
    Parameters: z
        .record(z.string(), z.object({ Type: z.string().optional(), Default: z.json().optional() }))
        .optional(),
    Outputs: z
        .record(
            z.string(),
            z.object({
                Value: z.json().optional(),
                Export: z.object({ Name: z.json().optional() }).optional(),
            }),
        )
        .optional(),
});

const readJson = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'));

/** Collects the actions of every non-Deny statement of one resource's policy documents. */
function collectActions(resource: TemplateResource, into: Set<string>): void {
    for (const statement of statementsOf(resource)) {
        if (!isRecord(statement) || statement['Effect'] === 'Deny') {
            continue;
        }

        for (const action of toList(statement['Action'])) {
            if (typeof action === 'string') {
                into.add(action);
            }
        }
    }
}

/** Collects the service principals one role trust document names. */
function collectTrustServices(document: Json | undefined, into: Set<string>): void {
    if (!isRecord(document)) {
        return;
    }

    for (const statement of toList(document['Statement'])) {
        const principal = isRecord(statement) ? statement['Principal'] : undefined;

        for (const service of toList(isRecord(principal) ? principal['Service'] : undefined)) {
            if (typeof service === 'string') {
                into.add(service);
            }
        }
    }
}

/** Collects the AWS-managed policy names (`policy/<name>`) one role attaches. */
function collectManagedPolicies(properties: Readonly<Record<string, Json>>, into: Set<string>): void {
    for (const arn of toList(properties['ManagedPolicyArns'])) {
        const match = /policy\/([^"\\]+)"/u.exec(JSON.stringify(arn));

        if (match?.[1] !== undefined) {
            into.add(match[1]);
        }
    }
}

/** Folds one resource: its type, its policy actions and, for a role, the services it trusts and the managed policies. */
function foldResource(resource: TemplateResource, into: Derived): void {
    into.resourceTypes.add(resource.Type);

    if (resource.Type === 'AWS::IAM::Role') {
        collectTrustServices(resource.Properties?.['AssumeRolePolicyDocument'], into.rolePassedToServices);
        collectManagedPolicies(resource.Properties ?? {}, into.awsManagedPolicies);
    }

    collectActions(resource, into.roleActions);
}

/**
 * Records every stack name of the assembly and answers the stack name of each template file.
 *
 * The CloudFormation stack name is the artifact's `stackName`, or its id when none is set. The template file name is
 * the construct id, which is NOT the stack name (`IdentityService-sandbox` deploys as
 * `kitchensink-identity-service-sandbox`), so the manifest is the only honest source. Nested stacks have no artifact
 * of their own and are not top-level deploy targets.
 */
function readStackNames(outdir: string, into: Derived): ReadonlyMap<string, string> {
    const manifest = manifestSchema.parse(readJson(path.join(outdir, 'manifest.json')));
    const stackNameByTemplate = new Map<string, string>();

    for (const [id, artifact] of Object.entries(manifest.artifacts ?? {})) {
        if (artifact.type === 'aws:cloudformation:stack') {
            const stackName = artifact.properties?.stackName ?? id;

            into.stackNames.add(stackName);
            stackNameByTemplate.set(artifact.properties?.templateFile ?? `${id}.template.json`, stackName);
        }
    }

    return stackNameByTemplate;
}

/** Folds one `*.template.json`. A nested stack is named after its file so its statements are still rendered. */
function foldTemplateFile(
    file: string,
    stackNameByTemplate: ReadonlyMap<string, string>,
    text: unknown,
    into: Derived,
): void {
    const template = templateSchema.parse(text);

    into.stacks.push({
        stackName: stackNameByTemplate.get(file) ?? `kitchensink-nested-${file.replace('.template.json', '')}`,
        template,
    });

    for (const resource of Object.values(template.Resources ?? {})) {
        foldResource(resource, into);
    }
}

/** Folds one synthesized `cdk.out` directory into `into`. Pure of anything but the directory it reads. */
export function foldCloudAssembly(outdir: string, into: Derived): void {
    const stackNameByTemplate = readStackNames(outdir, into);

    for (const file of readdirSync(outdir)) {
        if (file.endsWith('.assets.json')) {
            if (Object.keys(assetsSchema.parse(readJson(path.join(outdir, file))).dockerImages ?? {}).length > 0) {
                into.dockerImageAssets = true;
            }
        } else if (file.endsWith('.template.json')) {
            foldTemplateFile(file, stackNameByTemplate, readJson(path.join(outdir, file)), into);
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

/**
 * Renders every Allow of every folded stack against the whole world of folded stacks (an import or SSM reference
 * follows into the stack that writes it), and records them. Call once, after every app of a qualifier is folded.
 */
export function finalizeRoleStatements(derived: Derived): void {
    const world = buildWorld(derived.stacks);
    const unique = new Map<string, RoleStatement>();

    for (const stack of derived.stacks) {
        for (const statement of renderRoleStatements(world, stack)) {
            unique.set(JSON.stringify(statement), statement);
        }
    }

    derived.roleStatements.splice(0, derived.roleStatements.length, ...unique.values());
}

/** The serialisable manifest: sorted so a regeneration is byte-stable. */
export function toManifest(qualifier: QualifierName, derived: Derived): Record<string, unknown> {
    const sorted = (set: Set<string>): string[] => [...set].sort();

    return {
        qualifier,
        resourceTypes: sorted(derived.resourceTypes),
        roleActions: sorted(derived.roleActions),
        roleStatements: [...derived.roleStatements].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
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

            finalizeRoleStatements(derived);
            manifests.set(qualifier, derived);
        }

        for (const [app, ok] of synthesizedAnywhere) {
            if (!ok) {
                throw new Error(`${app} refused every stage it was asked to synthesize at`);
            }
        }

        const account = emptyDerived();
        synthesize(ACCOUNT_APP, 'account', account, scratch);
        finalizeRoleStatements(account);
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
