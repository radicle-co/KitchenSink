import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { SandboxRouterStack } from '../lib/SandboxRouterStack.js';

// The entrypoint's `App` is not exported (deliberately — its six siblings do not export theirs either), and
// the only handle on it from outside is the argument it already hands to `stampCommitProvenance`. Spying
// there reaches the REAL tree `bin/app.ts` builds, instead of this file re-assembling a lookalike whose
// tagging could then agree with itself while the entrypoint's drifted.
//
// `importOriginal` keeps every other export genuine and still calls through: `SandboxRouterStack` itself
// imports `acceptNagFindings` from this package, so a bare factory mock would break the suite above.
// That the call site EXISTS is not assumed here — `packages/infra/global/__tests__/commitProvenanceCoverage
// .test.ts` asserts it from the AST for every CDK app in the repository, so this seam cannot silently
// vanish and leave these assertions unreachable.
const { capturedApps } = vi.hoisted(() => ({ capturedApps: [] as App[] }));

vi.mock('@kitchensink/infra-security', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@kitchensink/infra-security')>();

    return {
        ...actual,
        stampCommitProvenance: (app: App): void => {
            capturedApps.push(app);
            actual.stampCommitProvenance(app);
        },
    };
});

const here = path.dirname(fileURLToPath(import.meta.url));
const bundleDir = path.join(here, '../../router/dist');
const bundlePath = path.join(bundleDir, 'router.cff.js');

let template: Template;

beforeAll(() => {
    // The stack inlines the esbuild-bundled function; stub it so synth doesn't require a real bundle.
    mkdirSync(bundleDir, { recursive: true });
    writeFileSync(bundlePath, 'async function handler(event) { return event.request; }');

    const app = new App();
    const stack = new SandboxRouterStack(app, 'TestRouter', {
        env: { account: '123456789012', region: 'us-east-1' },
        stage: 'sandbox',
        domainName: 'commise.app',
    });

    template = Template.fromStack(stack);
});

afterAll(() => {
    rmSync(bundleDir, { recursive: true, force: true });
});

describe('SandboxRouterStack', () => {
    it('creates a CloudFront KeyValueStore', () => {
        template.resourceCountIs('AWS::CloudFront::KeyValueStore', 1);
    });

    it('creates a CloudFront Function on the JS 2.0 runtime', () => {
        template.hasResourceProperties('AWS::CloudFront::Function', {
            FunctionConfig: { Runtime: 'cloudfront-js-2.0' },
        });
    });

    it('serves sandbox.commise.app with caching disabled and a viewer-request function', () => {
        const dists = template.findResources('AWS::CloudFront::Distribution');
        const config = Object.values(dists)[0]!.Properties.DistributionConfig;

        expect(config.Aliases).toContain('sandbox.commise.app');
        // CACHING_DISABLED managed policy id.
        expect(config.DefaultCacheBehavior.CachePolicyId).toBe('4135ea2d-6df8-44a3-9df3-4b5a84be39ad');
        expect(config.DefaultCacheBehavior.FunctionAssociations[0].EventType).toBe('viewer-request');
    });

    it('ALSO serves *.sandbox.commise.app so per-PR SUBDOMAINS reach the singleton router (ADR-0001 GO)', () => {
        // The subdomain migration adds a wildcard alias to the SAME distribution (not a new one). The
        // deployed cert already carries `*.sandbox.commise.app` (domain-stack SAN), so this is covered.
        // The CFF resolves the PR from the Host's `pr-{N}` label; both apex (path) and subdomain requests
        // land here. Fails if the wildcard alias is dropped — subdomain previews would then 502 on cert.
        const dists = template.findResources('AWS::CloudFront::Distribution');
        const config = Object.values(dists)[0]!.Properties.DistributionConfig;

        expect(config.Aliases).toContain('*.sandbox.commise.app');
    });

    it('creates a Route53 alias record for the sandbox subdomain', () => {
        template.hasResourceProperties('AWS::Route53::RecordSet', {
            Type: 'A',
            Name: 'sandbox.commise.app.',
        });
    });

    it('creates a WILDCARD Route53 alias record so pr-{N}.sandbox.commise.app resolves to the router', () => {
        template.hasResourceProperties('AWS::Route53::RecordSet', {
            Type: 'A',
            Name: '*.sandbox.commise.app.',
        });
    });

    // ── ADR-0001 load-bearing invariants (path-based routing, singleton router) ──
    // Each assertion below must FAIL if the design regresses: a second distribution appears
    // (per-PR subdomains), the Function or KVS is dropped, the runtime downgrades, the origin
    // stops dropping the Host header, or the CI-consumed output disappears.

    it('provisions EXACTLY ONE CloudFront distribution — the singleton router, never one-per-PR', () => {
        // The whole ADR-0001 point: all previews share one origin (sandbox.commise.app). A second
        // distribution here means someone reintroduced per-PR fronting → Clerk azp 401s every preview.
        template.resourceCountIs('AWS::CloudFront::Distribution', 1);
    });

    it('provisions EXACTLY ONE CloudFront Function and ONE KeyValueStore (the edge router + its store)', () => {
        template.resourceCountIs('AWS::CloudFront::Function', 1);
        template.resourceCountIs('AWS::CloudFront::KeyValueStore', 1);
    });

    it('wires the JS-2.0 Function to the KeyValueStore (per-PR host + Vercel-bypass edge lookups)', () => {
        // The function reads the per-PR origin host and the `vercel-bypass` secret from the KVS; without
        // the association the edge `kvs.get(...)` calls fail and every route 404s/503s. Reference the KVS
        // by its synthesized logical id so the assertion tracks the real store, not a literal ARN.
        const kvsId = Object.keys(template.findResources('AWS::CloudFront::KeyValueStore'))[0]!;

        template.hasResourceProperties('AWS::CloudFront::Function', {
            FunctionConfig: {
                Runtime: 'cloudfront-js-2.0',
                KeyValueStoreAssociations: [{ KeyValueStoreARN: { 'Fn::GetAtt': [kvsId, 'Arn'] } }],
            },
        });
    });

    it('binds the singleton distribution to that Function as its viewer-request hook', () => {
        // Ties the distribution to THE router function (not some other/stray function) at viewer-request —
        // the only phase where updateRequestOrigin can host-swap. Fails if the association is dropped or
        // moved to another event type.
        const fnId = Object.keys(template.findResources('AWS::CloudFront::Function'))[0]!;

        template.hasResourceProperties('AWS::CloudFront::Distribution', {
            DistributionConfig: Match.objectLike({
                DefaultCacheBehavior: Match.objectLike({
                    FunctionAssociations: [
                        { EventType: 'viewer-request', FunctionARN: { 'Fn::GetAtt': [fnId, 'FunctionARN'] } },
                    ],
                }),
            }),
        });
    });

    it('forwards ALL_VIEWER_EXCEPT_HOST_HEADER so the host-swapped origin drives Host/SNI (not ALL_VIEWER)', () => {
        // ADR-0001: the function swaps the origin to a DIFFERENT host (the per-PR Vercel deployment), so the
        // origin's own domain must set the Host header + TLS SNI. ALL_VIEWER would forward the viewer Host
        // (sandbox.commise.app) as SNI → origin cert mismatch → every routed request 502s. This pins the
        // managed AllViewerExceptHostHeader policy id; a swap back to ALL_VIEWER changes it and fails here.
        const dists = template.findResources('AWS::CloudFront::Distribution');
        const behavior = Object.values(dists)[0]!.Properties.DistributionConfig.DefaultCacheBehavior;

        expect(behavior.OriginRequestPolicyId).toBe('b689b0a8-53d0-40ab-baf2-68738e2966ac');
    });

    it('exports the KVS ARN as the RouterKvsArn output the CI route-registration pipeline reads', () => {
        // sandbox-router-deploy.yml / sandbox-web-preview.yml query Outputs[?OutputKey=='RouterKvsArn'] to
        // seed per-PR routes + the bypass key. The output key AND the cross-stack export name are both a
        // consumed contract — renaming/removing either silently breaks preview route registration.
        const kvsId = Object.keys(template.findResources('AWS::CloudFront::KeyValueStore'))[0]!;

        template.hasOutput('RouterKvsArn', {
            Value: { 'Fn::GetAtt': [kvsId, 'Arn'] },
            Export: { Name: 'kitchensink-sandbox-router-sandbox:KvsArn' },
        });
    });
});

/**
 * ⛔ ADR-0005: the `Environment` tag is the PRIMARY teardown signal, and this app was the only one of the
 * repository's eight CDK apps that set none.
 *
 * `teardown-sandbox-pr.sh` deletes a closed PR's resources with NO denylist. It decides ownership two ways —
 * a `pr-{N}` NAME (a delimiter-aware PREFIX rule, `pr-scope.sh`) or an `Environment=pr-{N}` TAG — and the
 * tag is the only one of those that generalises: §2 reads it back per stack from `describe-stacks`, and §3
 * sweeps `resourcegroupstaggingapi get-resources` for anything tagged `Environment=$PR` that no stack owned.
 * An untagged app is invisible to BOTH halves of that, which is a defect in both directions: nothing would
 * reclaim a per-PR router, and nothing states in the account that the singleton is persistent.
 *
 * ## Why `global`, and why it is DERIVED rather than written down
 *
 * `sandbox-router-deploy.yml` — the ONLY deployer of this app — pins `STAGE: sandbox`, so the tag's value at
 * every real deploy is `global`, which is correct: this is a persistent SINGLETON. Its out-of-band deletion
 * once left `sandbox.commise.app` NXDOMAIN for ~3 weeks with every web preview broken, which is exactly the
 * outcome a PR-close sweep must never be able to cause.
 *
 * The value is still resolved FROM the stage, matching the four feature apps that can run per-PR, because
 * the stage is a parameter (`--context stage=` / `STAGE`) rather than a constant, and the two ways of being
 * wrong are not symmetric. A hardcoded `global` on a per-PR deploy would make that stack IMMORTAL — and the
 * name rule could not save it, since `kitchensink-sandbox-router-pr-{N}` does not START with `pr-{N}` and so
 * is not matched by `pr_scope_belongs`, leaving the tag as the only signal that could ever reclaim it.
 *
 * ## Why `Tags.of(app)` here, when the commit stamp beside it is forbidden from using it
 *
 * That prohibition is about VOLATILITY, not about the aspect form: `CommitSha` changes on every commit, so
 * the aspect form would rewrite every taggable resource's template on every deploy and breach the
 * ADR-0002/ADR-0008 no-prod-diff line for a fact about the build. `Environment` is invariant for a given
 * stack — it can only change when the stage does, which is a different stack — so it costs one bounded,
 * one-time template change and never moves again. This app also synthesizes only the sandbox router and no
 * prod stack at all, so that line is not on this path. And the aspect form is REQUIRED, not merely
 * tolerated: `stack.tags.setTag` alone would leave individual resources untagged and therefore invisible to
 * the §3 tag sweep.
 */
describe('the sandbox router CDK app (infra/bin/app.ts) — ADR-0005 Environment tag', () => {
    /**
     * Import the real entrypoint for a stage and hand back the stack it synthesizes.
     *
     * @param stage - The `STAGE` the deploy runs under.
     * @returns The synthesized stack artifact's tags and template.
     * @sideEffect Resets the module registry, stubs the environment and synthesizes a CDK app.
     */
    async function synthesizeEntrypoint(stage: string): Promise<{
        readonly tags: Readonly<Record<string, string>>;
        readonly template: Template;
    }> {
        vi.resetModules();
        capturedApps.length = 0;
        vi.stubEnv('STAGE', stage);
        vi.stubEnv('DOMAIN_NAME', 'commise.app');
        vi.stubEnv('CDK_DEFAULT_ACCOUNT', '123456789012');

        await import('../bin/app.js');

        const app = capturedApps.at(-1);

        if (app === undefined) {
            throw new Error('infra/bin/app.ts did not hand its App to stampCommitProvenance — the spy saw nothing');
        }

        // By DEPLOYED stack name, not by construct id: that is the identity `describe-stacks` reports and
        // `teardown-sandbox-pr.sh` matches on, so looking it up this way pins the name convention too.
        const artifact = app.synth().getStackByName(`kitchensink-sandbox-router-${stage}`);

        return { tags: artifact.tags, template: Template.fromJSON(artifact.template) };
    }

    afterAll(() => {
        vi.unstubAllEnvs();
        vi.resetModules();
    });

    it('tags the deployed router Environment=global — the value every real deploy produces', async () => {
        // `sandbox-router-deploy.yml` sets STAGE: sandbox, so this is the tag that actually reaches the
        // account. `global` is what keeps the singleton out of every per-PR teardown match (ADR-0005).
        const { tags } = await synthesizeEntrypoint('sandbox');

        expect(tags['Environment']).toBe('global');
    });

    it('DERIVES the tag from the stage, so a pr-{N} deploy is reclaimable rather than immortal', async () => {
        // The negative direction, and the reason the value is not a literal. Nothing else could reclaim such
        // a stack: `kitchensink-sandbox-router-pr-9` does not start with `pr-9`, so the name rule misses it.
        const { tags } = await synthesizeEntrypoint('pr-9');

        expect(tags['Environment']).toBe('pr-9');
    });

    it('tags the RESOURCES too, not just the stack — what the §3 resourcegroupstaggingapi sweep reads', async () => {
        // Distinguishes `Tags.of(app)` from `stack.tags.setTag`. The commit stamp uses the latter (it must:
        // its value changes every commit); this tag must use the former, or a per-PR deploy's resources
        // would be untagged and survive a sweep that found nothing to delete.
        const { template } = await synthesizeEntrypoint('sandbox');

        template.hasResourceProperties('AWS::CloudFront::Distribution', {
            Tags: Match.arrayWith([{ Key: 'Environment', Value: 'global' }]),
        });
    });
});
