/**
 * Integration suite for U9: a REAL `cdk synth`, through the actual CDK CLI, with cdk-nag attached.
 *
 * | Invariant                                                              | Test                                                     |
 * | ---------------------------------------------------------------------- | -------------------------------------------------------- |
 * | `cdk synth` exits 0 at prod despite open findings (ADVISORY, not gate)  | 'synthesizes the prod platform app successfully'          |
 * | The CLI actually surfaces the findings                                  | 'reports AwsSolutions findings as CLI warnings'           |
 * | No finding reaches the CLI as an error (that is what exits 1)           | 'never reports an AwsSolutions finding as a CLI error'    |
 * | A non-prod stage synthesizes too                                        | 'synthesizes the sandbox platform app successfully'       |
 * | The CLI emits only the reviewed suppressions, in READABLE form           | 'emits only the reviewed suppressions, with readable …'    |
 * | The COMPILED entrypoint can load the security package under plain node  | 'synthesizes from the compiled entrypoint …'              |
 *
 * ## Why this tier exists on top of the unit suites
 *
 * `cdkNagTemplateParity.test.ts` proves the no-mutation property in-process. It CANNOT prove the two
 * things that actually break a deploy:
 *
 * 1. The CDK **CLI** exits 1 when any error-level annotation is present, and the stock
 *    `AwsSolutionsChecks` raises errors. Only driving the real binary shows that the advisory wrapper
 *    keeps `cdk synth` — and therefore `cdk deploy` — green. Measured: the stock pack over a single
 *    default S3 bucket makes `cdk synth` exit 1; the advisory wrapper exits 0 with the same findings.
 * 2. Prod deploys run the **compiled** entrypoint under plain `node`
 *    (`cdk deploy --app "node packages/infra/global/dist/bin/app.js"`). The first version of
 *    `@kitchensink/infra-security` followed the other shared packages and exported `./src/index.ts`;
 *    that typechecked, passed every unit suite, and synthesized fine under `tsx` — then failed the real
 *    deploy path with `ERR_MODULE_NOT_FOUND`, because node type-strips `index.ts` but cannot resolve its
 *    `./x.js` relative imports with no built `.js` beside them. The last test below is that bug's
 *    regression guard: it builds and runs the compiled artifact, which is the only way to see it.
 *
 * ## What is real, and what is stubbed
 *
 * - **Real**: the `cdk` CLI as a child process, the real `bin/app.ts` entrypoint, the real `tsc` build and
 *   the real compiled `dist/bin/app.js` under plain `node`, real synthesis to a real output directory, and
 *   the real committed `cdk.context.json`.
 * - **Stubbed**: nothing. AWS is never contacted — `--lookups false` forces every context value to come
 *   from the committed `cdk.context.json`, which is exactly why this runs with no credentials in CI.
 *
 * It lives in `__tests__/` beside the package's other suites because `@kitchensink/infra-global` has a
 * single test tier (`vitest run` over `__tests__/**`) and this spec needs no external service — the same
 * reasoning `deployGate.integration.test.ts` records.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, it, expect } from 'vitest';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// .../packages/infra/global/tests → repo root is four levels up.
const repoRoot = path.resolve(packageDir, '../../..');

/**
 * The account / region / domain the committed context was captured for. Read from the file rather than
 * hardcoded so the suite follows the context instead of drifting from it — and so no value is duplicated.
 */
function contextCoordinates(): { account: string; region: string; domainName: string } {
    const context = JSON.parse(readFileSync(path.join(packageDir, 'cdk.context.json'), 'utf8')) as Record<
        string,
        unknown
    >;
    const key = Object.keys(context).find((candidate) => candidate.startsWith('hosted-zone:'));
    const match = key?.match(
        /^hosted-zone:account=(?<account>\d+):domainName=(?<domainName>[^:]+):region=(?<region>.+)$/,
    );

    if (!match?.groups) {
        throw new Error(
            `No hosted-zone entry in ${path.join(packageDir, 'cdk.context.json')} — cannot synth without AWS lookups.`,
        );
    }

    return {
        account: match.groups['account'] as string,
        region: match.groups['region'] as string,
        domainName: match.groups['domainName'] as string,
    };
}

interface SynthResult {
    readonly status: number | null;
    readonly output: string;
    readonly templates: Record<string, string>;
}

/**
 * The Clerk verification key the edge bundle is built with, and synthesized against, in this suite.
 *
 * ⚠️ Obviously a fixture, on purpose. `EdgeStack` refuses any bundle whose inlined key differs from the one
 * synth was handed, so a `dist-edge/` left behind by a test run makes a later manual prod deploy fail LOUDLY
 * rather than ship a verifier that rejects every request. The name is part of that signal.
 */
const EDGE_TEST_KEY = '-----BEGIN PUBLIC KEY-----\nINTEGRATION-TEST-KEY-NOT-A-REAL-CLERK-KEY\n-----END PUBLIC KEY-----';

/** Runs the real CDK CLI against the given `--app` command for one stage and reads back what it emitted. */
function synthWith(app: string, stage: string, options: { readonly edgeKey?: string | null } = {}): SynthResult {
    const { account, region, domainName } = contextCoordinates();
    const outdir = mkdtempSync(path.join(tmpdir(), `cdk-nag-synth-${stage}-`));
    const edgeKey = options.edgeKey === undefined ? EDGE_TEST_KEY : options.edgeKey;

    const result = spawnSync('npx', ['cdk', 'synth', '--app', app, '--output', outdir, '--lookups', 'false'], {
        cwd: packageDir,
        encoding: 'utf8',
        env: {
            ...process.env,
            STAGE: stage,
            DOMAIN_NAME: domainName,
            CDK_DEFAULT_ACCOUNT: account,
            CDK_DEFAULT_REGION: region,
            COST_ALERT_EMAIL: 'alerts@example.com',
            // ADR-0020 trap 6: Lambda@Edge cannot read environment variables, so the key is a BUILD-TIME
            // input CI exports from SSM before synth. `null` removes it, to exercise the fail-loud path.
            ...(edgeKey === null ? { CLERK_JWT_KEY: undefined } : { CLERK_JWT_KEY: edgeKey }),
        },
    });

    const templates = Object.fromEntries(
        readdirSync(outdir)
            .filter((name) => name.endsWith('.template.json'))
            .map((name) => [name, readFileSync(path.join(outdir, name), 'utf8')]),
    );

    return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}`, templates };
}

/** The `--app` the deploy workflows use for local/source runs. */
const synth = (stage: string): SynthResult => synthWith('npx tsx bin/app.ts', stage);

/**
 * Bundles the package's Lambda handlers, exactly as every deploying workflow does before `cdk deploy`.
 *
 * REQUIRED here for a reason the other synths do not have: `EdgeStack` has NO placeholder. A throwing stub
 * at the edge is a total outage of every fronted service and a pass-through stub collapses every caller onto
 * one cache entry (ADR-0020 trap 1), so it refuses to synthesize without a real bundle built from the key it
 * was handed. That makes this suite the only tier that proves the bundle → synth handshake at all.
 *
 * @sideEffect writes `dist-lambda/` and `dist-edge/`.
 */
function bundleHandlers(): { status: number | null; tail: string } {
    const result = spawnSync('npm', ['run', 'bundle:lambda'], {
        cwd: packageDir,
        encoding: 'utf8',
        env: { ...process.env, CLERK_JWT_KEY: EDGE_TEST_KEY },
    });

    return { status: result.status, tail: `${result.stdout ?? ''}${result.stderr ?? ''}`.slice(-1500) };
}

/**
 * Builds this package and its workspace dependencies, exactly as the deploy workflows do.
 *
 * REQUIRED before any child-process synth, and not just for the compiled entrypoint: the app resolves
 * `@kitchensink/infra-security` through its `exports` map, which points at `dist/` — so BOTH the `tsx` and
 * the `node` paths would otherwise run whatever was last built. Without this, an edit to the Aspect could
 * leave every assertion below passing against a stale artifact.
 *
 * @sideEffect writes build output; turbo caches it, so repeat runs are ~instant.
 */
function buildWorkspace(): { status: number | null; tail: string } {
    const result = spawnSync('npx', ['turbo', 'run', 'build', '--filter=@kitchensink/infra-global'], {
        cwd: repoRoot,
        encoding: 'utf8',
    });

    return { status: result.status, tail: `${result.stdout ?? ''}${result.stderr ?? ''}`.slice(-1500) };
}

let build: { status: number | null; tail: string };
let bundle: { status: number | null; tail: string };
let prod: SynthResult;
let sandbox: SynthResult;

// A real build, a real bundle, plus two real CLI synths of the whole platform app; each synth spawns
// `npx tsx` and walks every construct twice (tags, then nag), so give them room on a loaded CI runner.
beforeAll(() => {
    build = buildWorkspace();
    bundle = bundleHandlers();
    prod = synth('prod');
    sandbox = synth('sandbox');
}, 600_000);

describe('cdk synth with cdk-nag attached (advisory mode)', () => {
    it('builds the workspace, so every synth below runs the CURRENT security package', () => {
        expect(build).toMatchObject({ status: 0 });
    });

    it('bundles the Lambda handlers, including the edge verifier, before any synth', () => {
        expect(bundle).toMatchObject({ status: 0 });
        expect(bundle.tail).toContain('Lambda@Edge verifier');
    });

    it('synthesizes the prod platform app successfully', () => {
        // The whole point of advisory mode: open findings must not fail the build.
        expect({ status: prod.status, tail: prod.output.slice(-1500) }).toMatchObject({ status: 0 });
        expect(Object.keys(prod.templates).length).toBeGreaterThan(0);
    });

    it('reports AwsSolutions findings as CLI warnings', () => {
        // Guards against a silent pass: exit 0 because nothing ran would satisfy the test above.
        expect(prod.output).toMatch(/^WARNING AwsSolutions-/m);
    });

    it('never reports an AwsSolutions finding as a CLI error', () => {
        // An error-level annotation is precisely what makes the CLI exit 1.
        expect(prod.output).not.toMatch(/^ERROR AwsSolutions-/m);
    });

    it('synthesizes the sandbox platform app successfully', () => {
        expect({ status: sandbox.status, tail: sandbox.output.slice(-1500) }).toMatchObject({ status: 0 });
        expect(sandbox.output).toMatch(/^WARNING AwsSolutions-/m);
        expect(sandbox.output).not.toMatch(/^ERROR AwsSolutions-/m);
    });

    it('emits only the reviewed suppressions, with readable justifications', () => {
        // Changed by issue #143: this asserted that NO emitted template contained `cdk_nag`. That contract
        // could only survive the burn-down by being deleted, so it became an allowlist instead — see
        // `cdkNagTemplateParity.test.ts` for the full rationale and the authoritative inventory.
        //
        // This tier adds what in-process synthesis cannot see: that the CDK **CLI** writes the suppression
        // into the template it would actually deploy, and writes it in READABLE form. cdk-nag base64-encodes
        // any reason containing a codepoint above 255, which would make the justification opaque in exactly
        // the artifact a human reviews before a prod deploy.
        const emitted = Object.entries({ ...prod.templates, ...sandbox.templates }).flatMap(([name, json]) => {
            const template = JSON.parse(json) as {
                Resources?: Record<
                    string,
                    {
                        Metadata?: {
                            cdk_nag?: {
                                rules_to_suppress?: Array<{ id: string; reason: string; is_reason_encoded?: boolean }>;
                            };
                        };
                    }
                >;
            };

            return Object.entries(template.Resources ?? {}).flatMap(([logicalId, resource]) =>
                (resource.Metadata?.cdk_nag?.rules_to_suppress ?? []).map((rule) => ({
                    where: `${name}/${logicalId}`,
                    ...rule,
                })),
            );
        });

        // EC23 on the shared ALB's SG (ADR-0003) and SMG4 on the non-credential MigrationPlanSecret, in
        // BOTH stages — hence two of each. Plus CFR1 + CFR2 on each of `EdgeStack`'s three production
        // distributions (owner triage 2026-09-03, ADR-0013), which appear ONCE each rather than twice
        // because `EdgeStack` is prod-only.
        //
        // ⚠️ Ids only, so this cannot distinguish three suppressions on three distributions from three on
        // one. That is deliberate division of labour, not an oversight: `cdkNagTemplateParity.test.ts` pins
        // resource-and-rule for prod and `EdgeStack.test.ts` pins the resource TYPE and the per-distribution
        // spread. What THIS tier adds is that the CDK **CLI** emits them at all, and readably.
        expect(emitted.map((entry) => entry.id).sort()).toEqual([
            'AwsSolutions-CFR1',
            'AwsSolutions-CFR1',
            'AwsSolutions-CFR1',
            'AwsSolutions-CFR2',
            'AwsSolutions-CFR2',
            'AwsSolutions-CFR2',
            'AwsSolutions-EC23',
            'AwsSolutions-EC23',
            'AwsSolutions-SMG4',
            'AwsSolutions-SMG4',
        ]);

        for (const entry of emitted) {
            expect(entry.is_reason_encoded, `${entry.where} ${entry.id}: reason is base64, not readable`).not.toBe(
                true,
            );
            expect(entry.reason.length, `${entry.where} ${entry.id}: reason too short`).toBeGreaterThan(80);
        }
    });

    it('synthesizes from the compiled entrypoint under plain node (the real prod-deploy path)', () => {
        // `cdk deploy --app "node packages/infra/global/dist/bin/app.js"` is literally what
        // prod-deploy.yml runs. Every other tier in this repo drives the app through `tsx`, which
        // transparently resolves TypeScript across workspace boundaries — so a security package that
        // only works under `tsx` passes everything else and fails ONLY here, at deploy time, with
        // ERR_MODULE_NOT_FOUND. That happened; this is the guard. (`beforeAll` already built.)
        const compiled = synthWith('node dist/bin/app.js', 'prod');

        expect({ status: compiled.status, tail: compiled.output.slice(-2000) }).toMatchObject({ status: 0 });
        // …and the Aspect is genuinely attached on that path, not merely loadable.
        expect(compiled.output).toMatch(/^WARNING AwsSolutions-/m);
        expect(compiled.output).not.toMatch(/^ERROR AwsSolutions-/m);
    }, 600_000);
});

/**
 * The CloudFront edge (plan U16 / ADR-0020), through the real CLI.
 *
 * The unit tier synthesizes `EdgeStack` in-process with a fixture bundle; only this tier can see that
 * `bin/app.ts` really creates it at prod and really does not at sandbox, and that the build-time key
 * requirement fails the CLI — which is what a deploy would actually hit.
 */
describe('the production CloudFront edge, through the real CLI', () => {
    // CDK names the emitted artifact after the CONSTRUCT id (`Edge`), not the `stackName` — the same reason
    // the platform stacks appear as `GlobalprodDataprod….template.json` above.
    const EDGE_TEMPLATE = 'Edge.template.json';

    it('appears in the prod app', () => {
        expect(Object.keys(prod.templates)).toContain(EDGE_TEMPLATE);
    });

    it('appears in NO non-prod app — a distribution cannot be reclaimed inside a PR lifetime', () => {
        // ADR-0005 teardown and ADR-0010's ensure-exists gate both assume a preview's infrastructure can be
        // created and deleted inside a PR's life; a distribution takes 5–15 minutes to deploy and cannot be
        // deleted without first disabling it and waiting for propagation.
        expect(Object.keys(sandbox.templates).filter((name) => /edge/iu.test(name))).toEqual([]);
    });

    it('fronts each service from its own internal origin, with the verifier attached', () => {
        interface DistributionResource {
            readonly Type: string;
            readonly Properties?: {
                readonly DistributionConfig?: { readonly Origins?: readonly { readonly DomainName: string }[] };
            };
        }

        const template = JSON.parse(prod.templates[EDGE_TEMPLATE] as string) as {
            Resources: Record<string, DistributionResource>;
        };
        const origins = Object.values(template.Resources)
            .filter((resource) => resource.Type === 'AWS::CloudFront::Distribution')
            .flatMap((resource) =>
                (resource.Properties?.DistributionConfig?.Origins ?? []).map((origin) => origin.DomainName),
            );

        expect(origins.sort()).toEqual([
            'food.internal.commise.app',
            'identity.internal.commise.app',
            'recipe.internal.commise.app',
        ]);
        expect(prod.templates[EDGE_TEMPLATE]).toContain('viewer-request');
    });

    it('FAILS the synth when the build-time key is absent, instead of shipping a keyless verifier', () => {
        // A stage that silently shipped a verifier with no key would reject every request. This is the only
        // tier that can prove the failure reaches the CLI as a non-zero exit — which is what stops a deploy.
        const keyless = synthWith('npx tsx bin/app.ts', 'prod', { edgeKey: null });

        expect(keyless.status).not.toBe(0);
        expect(keyless.output).toContain('CLERK_JWT_KEY');
    }, 600_000);
});
