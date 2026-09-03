/**
 * ⛔ THE cdk-nag RULES THIS REPOSITORY HAS BURNED DOWN TO ZERO STILL REPORT ZERO — measured by running the
 * REAL rules over EVERY CDK app, not by trusting a number in a table.
 *
 * | Invariant                                                                     | Test                                                        |
 * | ----------------------------------------------------------------------------- | ----------------------------------------------------------- |
 * | Every discovered CDK app is synthesized, or named unsynthesizable with a reason | 'synthesizes every CDK app, or names the one it cannot'      |
 * | The rules ran at all, and against real resources                                | 'evaluates every queue and topic the repository declares'    |
 * | A rule held at zero reports NOTHING but `Compliant`, in any app                 | 'reports only Compliant rows for {rule}' (one per rule)      |
 * | …including a SUPPRESSION, which is not a fix                                    | (same test — `Suppressed` is not `Compliant`)               |
 * | The reader can SEE a violation (negative control, through the same path)        | 'reports the bare queue and topic of a fixture app as …'     |
 * | The reader reads the right COLUMN when a later one contains commas              | 'reads the Compliance column even when a later field …'      |
 *
 * ## What went wrong, and why a count is not a control
 *
 * ADR-0013's burn-down #1 table records `SQS4 / SNS3 no TLS-only policy | 13 | 0 | FIXED`, measured across
 * the seven prod apps on 2026-08-07. On 2026-09-03 that zero was found to be **2**: `RecipeParseQueue` and
 * `RecipeParseDlq` had shipped with no `enforceSSL` while their eight siblings in the same file had it.
 * cdk-nag saw it and reported `AwsSolutions-SQS4` against exactly those two — into the ADVISORY channel
 * ADR-0013 deliberately chose, where by construction nothing gates. **Nothing failed, and nothing was going
 * to.** A measured outcome written into a table with no mechanism re-checking it degrades silently the
 * moment the next queue is written, and the table's reader has no way to know whether its "0" is still true.
 *
 * The ADR's own residual, verbatim, was: *"nothing runs the SQS4 rule across all seven apps and asserts
 * zero."* This file is that. {@link RULES_AT_ZERO} is the register of rules whose burn-down has reached zero
 * and is now HELD there: a rule joins it when its count reaches zero, and from that moment the count is an
 * assertion rather than a measurement.
 *
 * ## ⛔ The premise this file overturned: "a synth-based reader cannot boot every app"
 *
 * `infrastructureManifest.test.ts` records — correctly, for the artifact it was judging — that "every
 * service app calls `ec2.Vpc.fromLookup` … so synth needs AWS credentials and an uncached context;
 * `RecipeWorkersStack` additionally throws unless the service has been BUILT; and each entrypoint requires
 * between one and nine environment variables." Both `transportSecurity.test.ts` and
 * `queueBaselineDeclarations.test.ts` then cited that as the reason a completeness claim could not be
 * discharged at rule level, and settled for one app and a source proxy respectively.
 *
 * Measured, the obstacle is smaller than it reads. `CDK_CONTEXT_JSON` pre-seeds the context-provider cache
 * so `Vpc.fromLookup` never calls AWS (the same trick `recipe-workers`' own app-synth spec already used);
 * `CDK_OUTDIR` sends the assembly to a temp directory; the environment variables are ONE shared block,
 * because the union across all eight entrypoints is about twenty keys and no two apps disagree on what one
 * means; and the build is the same `turbo run build` every deploy already runs. All eight apps then
 * synthesize, at prod, with **no AWS credentials and no network**, in about fifteen seconds total.
 *
 * ## Why ONE stage, and why that is not a hole
 *
 * Stacks are stage-conditional (`CostGuardrailsStack` and `EdgeStack` are prod-only; `SandboxSchedulerStack`
 * is not), so synthesizing at `prod` alone cannot claim to have seen every resource the repository can
 * build. It does not have to: the SECOND test compares the number of distinct resources the rules evaluated
 * against the number of construction sites `messagingConstructSites.ts` reads out of the SOURCE. A queue or
 * topic that only exists at another stage — or in the one app this file cannot synthesize — raises the
 * source census and not the rule census, and the comparison reds. Two independent derivations of the same
 * fact, which is the shape `natEgressConsumers.test.ts` uses for the NAT consumer list.
 *
 * ## ⚠️ The one app this cannot synthesize, and why that is stated rather than hidden
 *
 * `ingredient-parser` refuses to synthesize until `python3 -m pip` has downloaded ~90 MB of arm64 wheels
 * (ADR-0025). A repo-wide security guard must not take a network-and-Python dependency to run, so it is
 * named in {@link UNSYNTHESIZABLE} with that reason — and the census comparison above is what keeps the
 * exemption honest: the day a queue or topic lands in that package, this suite reds and the exemption has to
 * be re-argued rather than silently widened.
 *
 * ## What is real, and what is stubbed
 *
 * - **Real**: `turbo run build`, the real Lambda bundles, the real `bin/app.ts` of every app in a child
 *   process, real synthesis, the real `AwsSolutions` pack through `attachSecurityChecks`, and cdk-nag's own
 *   `AwsSolutions-…-NagReport.csv` compliance reports read off disk.
 * - **Stubbed**: the AWS account/region/VPC/database coordinates, and the context-provider cache. AWS is
 *   never contacted.
 *
 * DESIGN PATTERN: Specification — one predicate (`compliance === 'Compliant'`) over a subject set that is
 * DISCOVERED on both axes: the apps from {@link cdkApps}, the rules from {@link RULES_AT_ZERO}.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { App, Stack, aws_sns as sns, aws_sqs as sqs } from 'aws-cdk-lib';
import { beforeAll, describe, expect, it } from 'vitest';

import { cdkApps } from '../__tests__/cdkApps.js';
import { repositorySites } from '../__tests__/messagingConstructSites.js';
import { repoRoot } from '../__tests__/serviceSources.js';

/**
 * The cdk-nag rules this repository has burned down to zero, and now holds there.
 *
 * ⛔ A rule earns its place here by REACHING zero, never by aspiration — an entry whose count is not already
 * zero turns this suite permanently red and teaches the next reader to skip it. ADR-0013's remaining
 * backlog (`IAM4` 27, `IAM5` 20, …) is deliberately absent for exactly that reason; each joins the day its
 * burn-down lands, in the change that lands it.
 */
const RULES_AT_ZERO = ['AwsSolutions-SNS3', 'AwsSolutions-SQS4'] as const;

/**
 * The one compliance value a rule held at zero may report.
 *
 * ⚠️ `Suppressed` is NOT a pass. ADR-0013 requires every `NagSuppressions` entry to be "its own reviewed
 * change with its own diff", and it also records that a suppression WRITES `Metadata.cdk_nag` into the
 * CloudFormation resource — so suppressing a rule held at zero is how that zero becomes a fiction while
 * still reading as one, and it moves the prod template on the way. Measured: a suppression on a resource
 * that already COMPLIES changes nothing (cdk-nag still reports `Compliant`, which is correct — there was
 * nothing to hide); a suppression on one that does not turns the row `Suppressed`, and this predicate reds.
 * `UNKNOWN` (the rule threw) is not a pass either: a rule that could not evaluate has proven nothing.
 */
const COMPLIANT = 'Compliant';

/**
 * Apps this suite cannot synthesize, each with the prerequisite that makes it impossible — never a bare
 * exemption.
 *
 * The census assertion below is what stops this map from becoming a hiding place: an entry here is only safe
 * while the package declares no queue and no topic, and that is asserted, not assumed.
 */
const UNSYNTHESIZABLE: Readonly<Record<string, string>> = {
    'packages/services/ingredient-parser/infra/bin/app.ts':
        'IngredientParserStack refuses to synthesize until `bundle:lambda` has run `python3 -m pip` against ' +
        'PyPI for ~90 MB of arm64 wheels and a 1.6 MB CRF model (ADR-0025). A repo-wide security guard must ' +
        'not require Python and the network to run.',
};

/** Per-app deviations from the default preparation, which is `turbo run build` on the app's own package. */
interface Preparation {
    /** Why the package's own `build` must NOT be run — absent means run it. */
    readonly skipBuild?: string;
    /** Extra npm scripts to run in the app's package, after the build, in order. */
    readonly scripts?: readonly string[];
}

/** A syntactically-valid, obviously-fake PEM. Never a real key: this file is committed to a public repo. */
const EDGE_JWT_KEY = '-----BEGIN PUBLIC KEY-----\nNAG-RULES-AT-ZERO-FIXTURE-KEY\n-----END PUBLIC KEY-----';

const PREPARATION: Readonly<Record<string, Preparation>> = {
    // `EdgeStack` has NO placeholder bundle: a throwing stub at the edge is a total outage of every fronted
    // service and a pass-through stub collapses every caller onto one cache entry (ADR-0020), so it refuses
    // to synthesize without a real bundle built from the key synth was handed.
    'packages/infra/global/bin/app.ts': { scripts: ['bundle:lambda'] },
    'packages/apps/commise/web/infra/bin/app.ts': {
        skipBuild:
            "@commise/web's `build` is the Next.js PRODUCTION build, which requires live API origins and a " +
            'Clerk publishable key. The CDK app needs none of that — only the CloudFront Function bundle.',
        scripts: ['router:bundle'],
    },
};

const ACCOUNT = '123456789012';
const REGION = 'us-east-1';
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
 * The union of every environment variable any CDK entrypoint in this repository reads, with test values.
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
 * ⚠️ A consequence worth knowing before "fixing" it: `TMPDIR` is not passed through either, so the child's
 * own scratch files (notably `tsx`'s IPC pipe) land in the system temp directory rather than under this
 * run's `.tmp-test` root. The assembly itself IS confined — `CDK_OUTDIR` is a `mkdtemp` under that root.
 * Passing `TMPDIR` through would confine the pipe too and, in a deeply-nested checkout, push its path past
 * the 104-byte `sun_path` limit — the exact `listen EINVAL` failure `vitestTempRoot.test.ts` documents.
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
    IDENTITY_VPC_ID: VPC_ID,
    FOOD_VPC_ID: VPC_ID,
    RECIPE_VPC_ID: VPC_ID,
    RECIPE_LAMBDA_SG_ID: 'sg-12345678',
    RECIPE_DB_ENDPOINT: 'db.example.internal',
    RECIPE_DB_PORT: '5432',
    RECIPE_DB_INSTANCE_ID: 'db-EXAMPLERESOURCEID12345',
    RECIPE_DB_BASE_NAME: 'kitchensink_recipes',
    RECIPE_ARCHIVE_BUCKET: 'commise-versions-prod',
    RECIPE_MEDIA_BUCKET: 'commise-photos-prod',
    RECIPE_FOOD_SERVICE_URL: 'https://food.example.com',
    HANDLE_SYNC_TOPIC_ARN: `arn:aws:sns:${REGION}:${ACCOUNT}:kitchensink-handle-sync-prod`,
};

/** One row of a cdk-nag `AwsSolutions-…-NagReport.csv`. */
interface NagRow {
    /** Repo-relative entrypoint of the app whose synth produced it, or `'<fixture>'` for the control. */
    readonly app: string;
    /** e.g. `AwsSolutions-SQS4`. */
    readonly ruleId: string;
    /** The CONSTRUCT path, e.g. `RecipeWorkers-prod/RecipeParseQueue/Resource`. */
    readonly resourceId: string;
    /** `Compliant` | `Non-Compliant` | `Suppressed` | `UNKNOWN`. */
    readonly compliance: string;
}

/**
 * Parse one cdk-nag report.
 *
 * ⚠️ A real CSV reader rather than `split(',')`: cdk-nag quotes every field and a suppression `reason` (or a
 * rule's own `Rule Info` prose) routinely contains commas — this repository's accepted findings carry whole
 * paragraphs. Splitting on commas would shift `Compliance` into some other column's text and read every row
 * as neither compliant nor non-compliant, which is a silent pass on the only column that matters.
 *
 * @param app - The app this report came from, carried through for a readable failure.
 * @param text - The CSV file's contents, header row included.
 * @returns One entry per data row. Pure.
 */
function parseNagReport(app: string, text: string): readonly NagRow[] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let quoted = false;

    for (let index = 0; index < text.length; index += 1) {
        const character = text.charAt(index);

        if (quoted) {
            if (character !== '"') {
                field += character;
            } else if (text.charAt(index + 1) === '"') {
                field += '"';
                index += 1;
            } else {
                quoted = false;
            }
        } else if (character === '"') {
            quoted = true;
        } else if (character === ',') {
            row.push(field);
            field = '';
        } else if (character === '\n') {
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
        } else if (character !== '\r') {
            field += character;
        }
    }

    if (field !== '' || row.length > 0) {
        row.push(field);
        rows.push(row);
    }

    return rows
        .slice(1)
        .filter((cells) => cells.length >= 3)
        .map(([ruleId = '', resourceId = '', compliance = '']) => ({ app, ruleId, resourceId, compliance }));
}

/**
 * Every compliance row cdk-nag wrote into a synthesized cloud assembly.
 *
 * @param app - The app the assembly came from.
 * @param outdir - The assembly directory.
 * @returns Every row from every `*-NagReport.csv` in it. Impure.
 * @sideEffect Reads the assembly directory.
 */
function nagRows(app: string, outdir: string): readonly NagRow[] {
    return readdirSync(outdir)
        .filter((name) => name.endsWith('-NagReport.csv'))
        .flatMap((name) => parseNagReport(app, readFileSync(path.join(outdir, name), 'utf8')));
}

/** The workspace package an app entrypoint belongs to: its manifest `name` and repo-relative directory. */
function packageOf(app: string): { readonly name: string; readonly directory: string } {
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

/** The outcome of running one app's entrypoint. */
interface SynthOutcome {
    readonly app: string;
    /** `undefined` on success; the child's output tail otherwise. */
    readonly failure?: string;
    readonly reportCount: number;
}

const apps = cdkApps();
const synthesizable = apps.filter((app) => UNSYNTHESIZABLE[app] === undefined);

let outcomes: readonly SynthOutcome[] = [];
let rows: readonly NagRow[] = [];
let fixtureRows: readonly NagRow[] = [];

/**
 * Build what every app needs, then run each entrypoint and collect its compliance reports.
 *
 * @sideEffect Runs turbo, npm scripts and eight CDK entrypoints; writes build output and temp directories.
 */
beforeAll(async () => {
    const buildTargets = synthesizable
        .filter((app) => PREPARATION[app]?.skipBuild === undefined)
        .map((app) => packageOf(app).name);

    // ONE turbo invocation: it resolves the dependency graph, so each app's workspace dependencies (the
    // built `dist/` that `@kitchensink/infra-security` and every service Lambda asset are read from) are
    // built in order and cached between runs.
    execFileSync('npx', ['turbo', 'run', 'build', ...buildTargets.map((name) => `--filter=${name}`)], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: 'pipe',
    });

    for (const app of synthesizable) {
        const { directory } = packageOf(app);

        for (const script of PREPARATION[app]?.scripts ?? []) {
            execFileSync('npm', ['run', script, `--workspace=${directory}`], {
                cwd: repoRoot,
                encoding: 'utf8',
                stdio: 'pipe',
                env: { ...process.env, CLERK_JWT_KEY: EDGE_JWT_KEY },
            });
        }
    }

    const collected: SynthOutcome[] = [];
    const allRows: NagRow[] = [];

    for (const app of synthesizable) {
        const outdir = mkdtempSync(path.join(tmpdir(), 'nag-rules-at-zero-'));

        try {
            execFileSync('npx', ['tsx', path.join(repoRoot, app)], {
                cwd: path.join(repoRoot, packageOf(app).directory),
                encoding: 'utf8',
                stdio: 'pipe',
                env: { ...HERMETIC_ENV, CDK_OUTDIR: outdir },
            });
        } catch (error) {
            const { stderr, stdout, message } = error as { stderr?: string; stdout?: string; message: string };

            collected.push({ app, failure: `${stdout ?? ''}${stderr ?? message}`.slice(-1500), reportCount: 0 });
            continue;
        }

        const appRows = nagRows(app, outdir);

        allRows.push(...appRows);
        collected.push({
            app,
            reportCount: readdirSync(outdir).filter((name) => name.endsWith('-NagReport.csv')).length,
        });
    }

    outcomes = collected;
    rows = allRows;
    fixtureRows = await nonCompliantFixtureRows();
}, 900_000);

/**
 * The negative control: a fixture app whose queue and topic declare nothing, synthesized IN PROCESS through
 * the repository's own `attachSecurityChecks` and read back with the same {@link nagRows} reader.
 *
 * ⛔ This is what makes the assertions above worth anything. Without it, "no non-compliant SQS4 row" is
 * equally satisfied by a reader that finds no rows at all, a pack that never attached, and a rule that
 * silently stopped evaluating — which is the whole failure mode this file exists for, one level up.
 *
 * @returns Every compliance row the fixture produced. Impure.
 * @sideEffect Synthesizes into a temporary directory.
 */
async function nonCompliantFixtureRows(): Promise<readonly NagRow[]> {
    // Imported DYNAMICALLY, and only after `beforeAll` has built: `@kitchensink/infra-security` exports built
    // `dist/`, and this tier deliberately does not alias it to source the way the unit config does (see
    // `vitest.config.ts`) — a static import would therefore fail at COLLECTION on a clean checkout, before
    // the build that would satisfy it has run.
    const { attachSecurityChecks } = await import('@kitchensink/infra-security');
    const outdir = mkdtempSync(path.join(tmpdir(), 'nag-rules-at-zero-fixture-'));
    const app = new App({ outdir });

    attachSecurityChecks(app);

    const stack = new Stack(app, 'NagFixture', { env: { account: ACCOUNT, region: REGION } });

    new sqs.Queue(stack, 'BareQueue');
    new sns.Topic(stack, 'BareTopic');
    app.synth();

    return nagRows('<fixture>', outdir);
}

/** Rows for one rule, across every app. */
const rowsFor = (ruleId: string, source: readonly NagRow[] = rows): readonly NagRow[] =>
    source.filter((row) => row.ruleId === ruleId);

describe('cdk-nag rules held at zero, across every CDK app', () => {
    it('names every unsynthesizable app, and nothing that is not an app', () => {
        // A stale exemption is a silent widening of this suite's blind spot, so the map's keys are checked
        // against the DISCOVERED app set rather than trusted.
        expect(Object.keys(UNSYNTHESIZABLE).filter((app) => !apps.includes(app))).toEqual([]);
        expect(Object.keys(PREPARATION).filter((app) => !apps.includes(app))).toEqual([]);
        // Non-vacuity on the discovery itself: `cdkApps()` returning nothing would make everything below
        // trivially true.
        expect(apps.length).toBeGreaterThanOrEqual(8);
    });

    it('synthesizes every CDK app, or names the one it cannot', () => {
        expect(outcomes.filter((outcome) => outcome.failure !== undefined)).toEqual([]);
        // Every synthesized app produced at least one compliance report: a pack that failed to attach to one
        // app would otherwise contribute zero rows and read exactly like a clean app.
        expect(outcomes.filter((outcome) => outcome.reportCount === 0).map((outcome) => outcome.app)).toEqual([]);
    });

    it('evaluates every queue and topic the repository declares', () => {
        // ⛔ THE CROSS-CHECK, and the reason one stage and one exemption are safe. The rule census and the
        // SOURCE census are derived independently; a queue or topic that exists only at another stage, or
        // only inside the app this suite cannot synthesize, raises one and not the other.
        //
        // `>=` rather than `===` because the rule census is the one that may legitimately exceed: the same
        // stack synthesized at two stages would evaluate its queues twice. The direction that matters — a
        // declared resource no rule ever saw — is the direction this catches.
        const evaluated = (ruleId: string): number => new Set(rowsFor(ruleId).map((row) => row.resourceId)).size;

        expect(evaluated('AwsSolutions-SQS4')).toBeGreaterThanOrEqual(repositorySites('Queue').length);
        expect(evaluated('AwsSolutions-SNS3')).toBeGreaterThanOrEqual(repositorySites('Topic').length);
    });

    it.each([...RULES_AT_ZERO])('reports only Compliant rows for %s', (ruleId) => {
        expect(
            rowsFor(ruleId)
                .filter((row) => row.compliance !== COMPLIANT)
                .map((row) => `${row.compliance} ${row.resourceId} (${row.app})`),
        ).toEqual([]);
    });

    it('reports the bare queue and topic of a fixture app as non-compliant', () => {
        // The negative control, through the SAME synth → report → parse path the real apps take.
        expect(rowsFor('AwsSolutions-SQS4', fixtureRows).map((row) => `${row.compliance} ${row.resourceId}`)).toEqual([
            'Non-Compliant NagFixture/BareQueue/Resource',
        ]);
        expect(rowsFor('AwsSolutions-SNS3', fixtureRows).map((row) => `${row.compliance} ${row.resourceId}`)).toEqual([
            'Non-Compliant NagFixture/BareTopic/Resource',
        ]);
    });

    it('reads the Compliance column even when a later field contains commas', () => {
        // The parser's own control. `Rule Info` and an accepted finding's `Exception Reason` are prose, and
        // this repository's reasons are paragraphs; a naive `split(',')` reads the wrong column and reports
        // every row as neither compliant nor non-compliant — a silent pass.
        const [row] = parseNagReport(
            'fake',
            'Rule ID,Resource ID,Compliance,Exception Reason,Rule Level,Rule Info\n' +
                '"AwsSolutions-SQS4","Stack/Q/Resource","Non-Compliant","N/A","Error","Commas, quotes "" and prose."\n',
        );

        expect(row).toEqual({
            app: 'fake',
            ruleId: 'AwsSolutions-SQS4',
            resourceId: 'Stack/Q/Resource',
            compliance: 'Non-Compliant',
        });
    });
});
