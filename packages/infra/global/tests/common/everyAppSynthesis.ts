/**
 * @module everyAppSynthesis — the ONE way this package's integration tier synthesizes EVERY CDK app offline.
 *
 * Two suites ask a question of the same synthesized assemblies: `nagRulesAtZero.integration.test.ts` reads
 * cdk-nag's compliance reports, and `prodAlarmPosture.integration.test.ts` reads the CloudFormation templates. They
 * differ only in the environment they synthesize under (the second sets `ALARMS_ENABLED=true`, because the first's
 * environment creates no alarm at all), so the harness lives here once. A second copy of "how to boot every app
 * with no AWS" is the artefact that drifts: one suite starts needing a variable and the other keeps passing.
 *
 * Everything the nag suite's docstring records about WHY this is hermetic still holds, because the code did not
 * change when it moved: `CDK_CONTEXT_JSON` pre-seeds the context-provider cache, `CDK_OUTDIR` redirects the
 * assembly, the environment is one shared block overlaid with `prod-deploy.yml`'s literal posture, and the
 * workspace is prepared exactly as `deployInfra.yml` prepares it.
 *
 * @pattern Repository — one read-only reading of "every app, synthesized", shared by the specifications that judge it
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { parse as parseYaml } from 'yaml';

import { cdkApps } from '../../__tests__/cdkApps.js';
import { prodDeployLiteralEnvironment } from '../../__tests__/prodDeployEnvironment.js';
import { repoRoot } from '../../__tests__/serviceSources.js';
import { scalarText } from '../../__tests__/workflowScalar.js';

/**
 * Apps this suite cannot synthesize, each with the prerequisite that makes it impossible — never a bare
 * exemption.
 *
 * The census assertion below is what stops this map from becoming a hiding place: an entry here is only safe
 * while the package declares no queue and no topic, and that is asserted, not assumed.
 */
export const UNSYNTHESIZABLE: Readonly<Record<string, string>> = {
    'packages/services/ingredient-parser/infra/bin/app.ts':
        'IngredientParserStack refuses to synthesize until `bundle:lambda` has run `python3 -m pip` against ' +
        'PyPI for ~90 MB of arm64 wheels and a 1.6 MB CRF model (ADR-0025). A repo-wide security guard must ' +
        'not require Python and the network to run.',
};

/**
 * Per-app preparation BEYOND what the deploy itself does to the workspace (see {@link deployPreparation}).
 *
 * ⚠️ Each script names the directory it runs in. `--workspace=<the app's package>` is an npm error ("No
 * workspaces found") because the CDK apps are not workspace members — and `router:bundle` is not the infra
 * package's script at all, it is `@commise/web`'s.
 */
export interface Preparation {
    /** npm scripts to run, in order, each in the repo-relative directory that declares it. */
    readonly scripts: readonly { readonly script: string; readonly in: string }[];
}

/** A syntactically-valid, obviously-fake PEM. Never a real key: this file is committed to a public repo. */
export const EDGE_JWT_KEY = '-----BEGIN PUBLIC KEY-----\nNAG-RULES-AT-ZERO-FIXTURE-KEY\n-----END PUBLIC KEY-----';

/** The parties the edge's 401 admits (ADR-0047). Compiled into the bundle and checked again at synth. */
export const EDGE_AUTHORIZED_PARTIES = 'https://commise.app';

export const PREPARATION: Readonly<Record<string, Preparation>> = {
    // `EdgeStack` has NO placeholder bundle: a throwing stub at the edge is a total outage of every fronted
    // service and a pass-through stub collapses every caller onto one cache entry (ADR-0020), so it refuses
    // to synthesize without a real bundle built from the key synth was handed.
    'packages/infra/global/bin/app.ts': { scripts: [{ script: 'bundle:lambda', in: 'packages/infra/global' }] },
    // Only the CloudFront Function bundle — NOT `@commise/web`'s `build`, which is the Next.js production
    // build and needs live API origins and a Clerk publishable key the CDK app has no use for.
    'packages/apps/commise/web/infra/bin/app.ts': {
        scripts: [{ script: 'router:bundle', in: 'packages/apps/commise/web' }],
    },
    // The search function's bundle (`dist-lambda/`): its stack refuses to synthesize a function with no code.
    'packages/services/remote-search/infra/bin/app.ts': {
        scripts: [{ script: 'bundle:lambda', in: 'packages/services/remote-search' }],
    },
};

/** Where the deploy prepares an app's workspace from: the infra jobs' `infra-package` inputs. */
const DEPLOY_INFRA_WORKFLOW = path.join(repoRoot, '.github/workflows/deployInfra.yml');

/** What the deploy builds before synthesizing one infra directory. */
interface DeployPreparation {
    /** Workspace packages built with `turbo run build --filter=<name>`. */
    readonly packages: ReadonlySet<string>;
    /** Workspace directories that also get `docker:prepare` + `bundle:lambda` (the containerized services). */
    readonly containerized: ReadonlySet<string>;
}

/**
 * The workspace preparation the DEPLOY performs per infra directory, read from `deployInfra.yml`.
 *
 * ⛔ READ, NOT RESTATED. `.github/actions/infra-package` builds `workspace-package` with turbo before synth,
 * and for a job with an `ecr-repo` also runs `docker:prepare` and `bundle:lambda` in `workspace-dir` — that
 * is what makes a service's Lambda and container assets exist. A census that claims to synthesize "the shape
 * production DEPLOYS" has to prepare the workspace the same way, and a second list here would be the copy
 * that drifts. Asking turbo to build each app's OWN package means nothing now the CDK apps sit outside the
 * workspace: turbo answers "No package found" and the whole suite fails in `beforeAll`.
 *
 * @returns Infra directory → what the deploy builds for it. Impure.
 * @sideEffect Reads the workflow.
 */
function deployPreparation(): ReadonlyMap<string, DeployPreparation> {
    const doc = parseYaml(readFileSync(DEPLOY_INFRA_WORKFLOW, 'utf8')) as {
        jobs: Record<string, { steps?: { uses?: string; with?: Record<string, unknown> }[] }>;
    };
    const byDirectory = new Map<string, { packages: Set<string>; containerized: Set<string> }>();

    for (const job of Object.values(doc.jobs)) {
        for (const step of job.steps ?? []) {
            if (step.uses !== './.github/actions/infra-package') {
                continue;
            }

            const input = (name: string): string => scalarText(step.with?.[name]);
            const entry = byDirectory.get(input('directory')) ?? { packages: new Set(), containerized: new Set() };

            if (input('workspace-package') !== '') {
                entry.packages.add(input('workspace-package'));
            }

            if (input('ecr-repo') !== '' && input('workspace-dir') !== '') {
                entry.containerized.add(input('workspace-dir'));
            }

            byDirectory.set(input('directory'), entry);
        }
    }

    return byDirectory;
}

export const ACCOUNT = '123456789012';
export const REGION = 'us-east-1';
const VPC_ID = 'vpc-12345678';
const DOMAIN = 'example.com';

/**
 * The context-provider cache, pre-seeded so `Vpc.fromLookup` and `HostedZone.fromLookup` resolve locally.
 *
 * The key shapes are CDK's own; a mismatch surfaces as a live lookup attempt (which fails with no
 * credentials) rather than as a silent pass.
 */
const HERMETIC_CONTEXT = JSON.stringify({
    [`vpc-provider:account=${ACCOUNT}:filter.vpc-id=${VPC_ID}:region=${REGION}:returnAsymmetricSubnets=true`]: {
        vpcId: VPC_ID,
        vpcCidrBlock: '10.0.0.0/16',
        ownerAccountId: ACCOUNT,
        availabilityZones: [],
        subnetGroups: [
            {
                name: 'Private',
                type: 'Private',
                subnets: [
                    {
                        subnetId: 'subnet-private-1',
                        availabilityZone: `${REGION}a`,
                        routeTableId: 'rtb-private-1',
                        cidr: '10.0.1.0/24',
                    },
                    {
                        subnetId: 'subnet-private-2',
                        availabilityZone: `${REGION}b`,
                        routeTableId: 'rtb-private-2',
                        cidr: '10.0.2.0/24',
                    },
                ],
            },
            {
                name: 'Public',
                type: 'Public',
                subnets: [
                    {
                        subnetId: 'subnet-public-1',
                        availabilityZone: `${REGION}a`,
                        routeTableId: 'rtb-public-1',
                        cidr: '10.0.3.0/24',
                    },
                    {
                        subnetId: 'subnet-public-2',
                        availabilityZone: `${REGION}b`,
                        routeTableId: 'rtb-public-2',
                        cidr: '10.0.4.0/24',
                    },
                ],
            },
        ],
    },
    [`hosted-zone:account=${ACCOUNT}:domainName=${DOMAIN}:region=${REGION}`]: {
        Id: '/hostedzone/ZEXAMPLENAGRULES',
        Name: `${DOMAIN}.`,
    },
});

/**
 * The COORDINATES every CDK entrypoint in this repository reads: account, region, VPC, database and bucket
 * names, stubbed so synthesis is hermetic.
 *
 * ONE block rather than one per app, deliberately: no two entrypoints disagree about what a key means (they
 * share `IDENTITY_VPC_ID`/`FOOD_VPC_ID`/`RECIPE_VPC_ID` as fallbacks for each other), so a per-app map would
 * be a list to keep in step for no gain. An app that starts reading a key nobody supplies fails LOUDLY here,
 * naming the variable, which is the failure this shape wants.
 *
 * ⛔ Deliberately MINIMAL — no ambient AWS credentials are inherited, so a regression that reintroduces a
 * live lookup fails here rather than quietly succeeding on a developer's machine. This is the same shape
 * `recipe-workers`' `workersAppSynth.integration.test.ts` uses, and for the same reason.
 *
 * ⛔ STUBS ONLY. Anything the production pipeline states as a LITERAL is POSTURE, not a coordinate, and is
 * overlaid from `prod-deploy.yml` in {@link SYNTH_ENV} — see {@link prodDeployLiteralEnvironment} for why
 * that distinction is the workflow's own and not a heuristic. Adding such a value here instead would put it
 * in two places, and the copy in this file is the one nobody updates.
 *
 * ⚠️ `TMPDIR` is deliberately not passed through either. The child's own scratch files (notably `tsx`'s IPC
 * pipe) therefore land in the system temp directory, which is where they belong: a redirected `TMPDIR` in a
 * deeply-nested checkout pushes that pipe's path past the 104-byte `sun_path` limit and every `tsx` spawn
 * dies with `listen EINVAL`. The synth assembly is separate — `CDK_OUTDIR` is a directory this file removes
 * in `afterAll`.
 */
const HERMETIC_ENV: Readonly<Record<string, string>> = {
    PATH: process.env['PATH'] ?? '',
    HOME: process.env['HOME'] ?? '',
    CDK_CONTEXT_JSON: HERMETIC_CONTEXT,
    CDK_DEFAULT_ACCOUNT: ACCOUNT,
    CDK_DEFAULT_REGION: REGION,
    AWS_ACCOUNT_ID: ACCOUNT,
    DEFAULT_AWS_REGION: REGION,
    STAGE: 'prod',
    DOMAIN_NAME: DOMAIN,
    COST_ALERT_EMAIL: 'alerts@example.com',
    CLERK_JWT_KEY: EDGE_JWT_KEY,
    CLERK_AUTHORIZED_PARTIES: EDGE_AUTHORIZED_PARTIES,
    IDENTITY_VPC_ID: VPC_ID,
    FOOD_VPC_ID: VPC_ID,
    RECIPE_VPC_ID: VPC_ID,
    RECIPE_LAMBDA_SG_ID: 'sg-12345678',
    RECIPE_DB_ENDPOINT: 'db.example.internal',
    RECIPE_DB_PORT: '5432',
    RECIPE_DB_INSTANCE_ID: 'db-EXAMPLERESOURCEID12345',
    RECIPE_ARCHIVE_BUCKET: 'commise-versions-prod',
    RECIPE_MEDIA_BUCKET: 'commise-photos-prod',
    RECIPE_FOOD_SERVICE_URL: 'https://food.example.com',
    HANDLE_SYNC_TOPIC_ARN: `arn:aws:sns:${REGION}:${ACCOUNT}:kitchensink-handle-sync-prod`,
};

/**
 * The environment every app is synthesized under: hermetic coordinates, overlaid with the production
 * pipeline's own literal posture.
 *
 * ⛔ THE MEASUREMENT DEFECT THIS FIXES, and it is the reason a census must synthesize the DEPLOYED shape
 * rather than a plausible one. With only {@link HERMETIC_ENV}, `EDGE_CUTOVER_SERVICES` was unset;
 * `publicRecordOwnerFor` reads unset as "nobody has cut over" — right for a deploy that was never told to
 * move anything, wrong for a census — so `EdgeStack` omitted `domainNames`/`certificate` from all three
 * distributions, CloudFront's DEFAULT certificate applied, and that certificate forces
 * `MinimumProtocolVersion: TLSv1`. cdk-nag reported three `AwsSolutions-CFR4` findings, and they went into
 * ADR-0013's table as production's posture. They were an artifact: the live distributions carry their alias
 * and `TLSv1.2_2021`.
 *
 * ⚠️ The workflow WINS on a key this file also stubs. That is the whole point — a stub that contradicts the
 * pipeline is a template nobody deploys. A literal coordinate added to the workflow would therefore break
 * the hermetic seal, and it would break it LOUDLY, as a synth failure naming the app, which is the same
 * failure mode {@link HERMETIC_ENV} already documents for a key nobody supplies.
 */
export const SYNTH_ENV: Readonly<Record<string, string>> = { ...HERMETIC_ENV, ...prodDeployLiteralEnvironment() };

/** The workspace package an app entrypoint belongs to: its manifest `name` and repo-relative directory. */
export function packageOf(app: string): { readonly name: string; readonly directory: string } {
    for (let directory = path.posix.dirname(app); directory !== '.'; directory = path.posix.dirname(directory)) {
        const manifest = path.join(repoRoot, directory, 'package.json');

        if (existsSync(manifest)) {
            const { name } = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string };

            if (name !== undefined) {
                return { name, directory };
            }
        }
    }

    throw new Error(`No package.json above ${app}`);
}

/** Every CDK app the repository defines, discovered. */
export const apps = cdkApps();

/** The apps this harness can synthesize: every discovered app not named in {@link UNSYNTHESIZABLE}. */
export const synthesizable = apps.filter((app) => UNSYNTHESIZABLE[app] === undefined);

/** One app's synthesis: where its assembly landed, or the tail of why it did not. */
export interface AppSynthesis {
    /** Repo-relative entrypoint. */
    readonly app: string;
    /** The cloud assembly directory. Present whether or not the synthesis succeeded. */
    readonly outdir: string;
    /** `undefined` on success; the child's output tail otherwise. */
    readonly failure?: string;
}

/** Scratch directories this module created, removed by {@link removeSynthesisScratch}. */
const scratchDirectories: string[] = [];

/**
 * Build what every app needs: the workspace packages the deploy builds, the containerized services' Lambda
 * assets, and each app's own preparation script.
 *
 * @sideEffect Runs turbo and npm scripts; writes build output.
 */
export function prepareWorkspace(): void {
    const deploy = deployPreparation();
    const prepared = synthesizable.map((app) => deploy.get(packageOf(app).directory));
    const buildTargets = [...new Set(prepared.flatMap((entry) => [...(entry?.packages ?? [])]))];
    const containerized = [...new Set(prepared.flatMap((entry) => [...(entry?.containerized ?? [])]))];

    // ONE turbo invocation over the WORKSPACE packages the deploy builds for these apps: turbo resolves their
    // dependency graph, so every service Lambda asset each app reads is built in order and cached between runs.
    if (buildTargets.length > 0) {
        execFileSync('npx', ['turbo', 'run', 'build', ...buildTargets.map((name) => `--filter=${name}`)], {
            cwd: repoRoot,
            encoding: 'utf8',
            stdio: 'pipe',
        });
    }

    // The containerized services, as the deploy prepares them: the migration Lambda's bundle is referenced
    // by the SCHEMA stack, and a missing asset fails synth with `CannotFindAsset`.
    for (const directory of containerized) {
        for (const script of ['docker:prepare', 'bundle:lambda']) {
            execFileSync('npm', ['run', script, `--workspace=${directory}`], {
                cwd: repoRoot,
                encoding: 'utf8',
                stdio: 'pipe',
            });
        }
    }

    for (const app of synthesizable) {
        for (const { script, in: directory } of PREPARATION[app]?.scripts ?? []) {
            execFileSync('npm', ['run', script], {
                cwd: path.join(repoRoot, directory),
                encoding: 'utf8',
                stdio: 'pipe',
                env: { ...process.env, CLERK_JWT_KEY: EDGE_JWT_KEY, CLERK_AUTHORIZED_PARTIES: EDGE_AUTHORIZED_PARTIES },
            });
        }
    }
}

/**
 * Synthesize every synthesizable app, in a child process each, under {@link SYNTH_ENV} plus `overrides`.
 *
 * ⚠️ `overrides` WINS over the workflow's literals, which is the point of passing one: a suite asking a different
 * question (alarms ON) states the one variable it changes, and everything else stays the deployed shape.
 *
 * @param overrides - Environment variables layered over {@link SYNTH_ENV}.
 * @returns One entry per synthesizable app. Impure.
 * @sideEffect Runs one CDK entrypoint per app and writes a temp directory for each (see {@link removeSynthesisScratch}).
 */
export function synthesizeEveryApp(overrides: Readonly<Record<string, string>> = {}): readonly AppSynthesis[] {
    return synthesizable.map((app) => {
        const outdir = mkdtempSync(path.join(tmpdir(), 'every-app-synthesis-'));

        scratchDirectories.push(outdir);

        try {
            execFileSync('npx', ['tsx', path.join(repoRoot, app)], {
                cwd: path.join(repoRoot, packageOf(app).directory),
                encoding: 'utf8',
                stdio: 'pipe',
                env: { ...SYNTH_ENV, ...overrides, CDK_OUTDIR: outdir },
            });
        } catch (error) {
            const { stderr, stdout, message } = error as { stderr?: string; stdout?: string; message: string };

            return { app, outdir, failure: `${stdout ?? ''}${stderr ?? message}`.slice(-1500) };
        }

        return { app, outdir };
    });
}

/**
 * A scratch directory the caller also wants removed with the rest (a fixture synth, say).
 *
 * @returns A fresh temp directory path. Impure.
 * @sideEffect Creates a directory.
 */
export function makeSynthesisScratch(prefix: string): string {
    const directory = mkdtempSync(path.join(tmpdir(), prefix));

    scratchDirectories.push(directory);

    return directory;
}

/**
 * Remove every scratch directory, so a FAILING test still cleans up.
 *
 * @sideEffect Deletes directories.
 */
export function removeSynthesisScratch(): void {
    for (const directory of scratchDirectories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
}

/**
 * The `*.template.json` of every stack in an assembly, parsed.
 *
 * @param outdir - A cloud assembly directory.
 * @returns Stack name (the file name without `.template.json`) to its template. Impure.
 * @sideEffect Reads the assembly directory.
 */
export function stackTemplates(outdir: string): ReadonlyMap<string, unknown> {
    return new Map(
        readdirSync(outdir)
            .filter((name) => name.endsWith('.template.json'))
            .map((name) => [
                name.replace(/\.template\.json$/u, ''),
                JSON.parse(readFileSync(path.join(outdir, name), 'utf8')),
            ]),
    );
}
