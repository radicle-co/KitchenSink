/**
 * Integration suite for ADR-0065: the stage-less ACCOUNT app, really synthesized, deploys through the `ksaccount`
 * bootstrap qualifier and nothing else.
 *
 * | Invariant                                                                    | Test                                              |
 * | ---------------------------------------------------------------------------- | ------------------------------------------------- |
 * | No manifest or asset manifest routes through the default qualifier            | 'never routes a deploy or an asset through …'      |
 * | Every stack deploys through the ksaccount deploy and execution roles          | 'deploys every stack through the ksaccount roles'  |
 * | Every file asset is published through the ksaccount bucket and role           | 'publishes every asset through ksaccount'          |
 * | Every IAM role the app creates carries the ksaccount boundary                 | 'puts every role under the ksaccount boundary'     |
 * | The owner-only policy stack still synthesizes with NO bootstrap role in path  | 'keeps the owner-only stack off every bootstrap role' |
 *
 * WHY a real synthesis: `cdkQualifierCoverage.test.ts` reads the entrypoint's text, which proves we ASKED for the
 * qualifier. Only the cloud assembly proves what the CDK did with it: the role ARNs it wrote into the manifest, the
 * bucket in the asset manifest, and the boundary on each role. A bare `new App()` synthesizes cleanly too, against
 * the default bootstrap (another application's AdministratorAccess), so a template-only check cannot tell.
 *
 * Nothing is stubbed and AWS is never contacted.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createRequire } from 'node:module';

import { buildBoundary } from '@kitchensink/cdk-bootstrap/boundary';
import { iamLike } from '@kitchensink/cdk-bootstrap/iamPattern';
import { renderDocument, type PolicyDocument, type Statement } from '@kitchensink/cdk-bootstrap/policyDocument';
import { boundaryPolicyName } from '@kitchensink/cdk-bootstrap/qualifiers';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULT_QUALIFIER = 'hnb659fds';
const ACCOUNT = '123456789012';

interface ManifestArtifact {
    readonly type: string;
    readonly properties?: Record<string, unknown>;
}

interface Assembly {
    readonly outdir: string;
    readonly artifacts: Readonly<Record<string, ManifestArtifact>>;
    readonly files: readonly string[];
}

/** Synthesizes `bin/account.ts` through the deploy's own runner (`tsx`) and reads the assembly back. */
function synthesize(context: Record<string, string>): Assembly {
    const outdir = mkdtempSync(path.join(tmpdir(), 'ksAccountApp-'));
    const result = spawnSync('npx', ['tsx', 'bin/account.ts'], {
        cwd: packageDir,
        env: {
            ...process.env,
            CDK_OUTDIR: outdir,
            CDK_CONTEXT_JSON: JSON.stringify(context),
            CDK_DEFAULT_ACCOUNT: ACCOUNT,
            CDK_DEFAULT_REGION: 'us-east-1',
            COST_ALERT_EMAIL: 'ci@example.com',
        },
        encoding: 'utf8',
        timeout: 110_000,
    });

    if (result.status !== 0) {
        throw new Error(`account app failed to synthesize:\n${result.stderr.slice(-2000)}`);
    }

    const manifest = JSON.parse(readFileSync(path.join(outdir, 'manifest.json'), 'utf8')) as {
        artifacts?: Record<string, ManifestArtifact>;
    };

    return { outdir, artifacts: manifest.artifacts ?? {}, files: readdirSync(outdir) };
}

const stackArtifacts = (assembly: Assembly): [string, ManifestArtifact][] =>
    Object.entries(assembly.artifacts).filter(([, artifact]) => artifact.type === 'aws:cloudformation:stack');

const read = (assembly: Assembly, file: string): string => readFileSync(path.join(assembly.outdir, file), 'utf8');

const assemblies: Assembly[] = [];
let deployable: Assembly;
let ownerOnly: Assembly;

beforeAll(() => {
    deployable = synthesize({});
    ownerOnly = synthesize({ ciPoliciesOwnerDeploy: 'true' });
    assemblies.push(deployable, ownerOnly);
});

afterAll(() => {
    for (const assembly of assemblies) {
        rmSync(assembly.outdir, { recursive: true, force: true });
    }
});

describe('the account app deploys through ksaccount (ADR-0065)', () => {
    it('synthesizes the stacks it is supposed to (a vacuous pass here would hide every rule below)', () => {
        expect(stackArtifacts(deployable).length).toBeGreaterThanOrEqual(2);
    });

    it('never routes a deploy or an asset through the default qualifier', () => {
        // Templates may NAME it: the CI roles carry an explicit Deny on `cdk-hnb659fds-*`. The deploy path is the
        // manifest and the asset manifests.
        const routing = deployable.files.filter((file) => file === 'manifest.json' || file.endsWith('.assets.json'));
        const offenders = routing.filter((file) => read(deployable, file).includes(DEFAULT_QUALIFIER));

        expect(routing.length).toBeGreaterThan(1);
        expect(offenders).toEqual([]);
    });

    it('deploys every stack through the ksaccount roles', () => {
        for (const [id, artifact] of stackArtifacts(deployable)) {
            const properties = artifact.properties ?? {};

            expect(properties['assumeRoleArn'], id).toContain('cdk-ksaccount-deploy-role-');
            expect(properties['cloudFormationExecutionRoleArn'], id).toContain('cdk-ksaccount-cfn-exec-role-');
            expect(properties['lookupRole'], id).toBeDefined();
            expect(JSON.stringify(properties['lookupRole']), id).toContain('cdk-ksaccount-lookup-role-');
            expect(properties['bootstrapStackVersionSsmParameter'], id).toBe('/cdk-bootstrap/ksaccount/version');
        }
    });

    it('publishes every asset through ksaccount', () => {
        const manifests = deployable.files.filter((file) => file.endsWith('.assets.json'));

        expect(manifests.length).toBeGreaterThan(0);

        for (const file of manifests) {
            const destinations = Object.values(
                (JSON.parse(read(deployable, file)) as { files?: Record<string, { destinations: object }> }).files ??
                    {},
            ).flatMap((asset) => Object.values(asset.destinations) as { bucketName: string; assumeRoleArn: string }[]);

            for (const destination of destinations) {
                expect(destination.bucketName, file).toContain('cdk-ksaccount-assets-');
                expect(destination.assumeRoleArn, file).toContain('cdk-ksaccount-file-publishing-role-');
            }
        }
    });

    it('puts every role under the ksaccount boundary', () => {
        const templates = deployable.files.filter((file) => file.endsWith('.template.json'));
        let roles = 0;

        for (const file of templates) {
            const resources = (JSON.parse(read(deployable, file)) as { Resources?: Record<string, { Type: string }> })
                .Resources;

            for (const [logicalId, resource] of Object.entries(resources ?? {})) {
                if (resource.Type !== 'AWS::IAM::Role') {
                    continue;
                }

                roles += 1;
                const rendered = JSON.stringify(
                    (resource as { Properties?: { PermissionsBoundary?: unknown } }).Properties?.PermissionsBoundary,
                );

                expect(rendered, `${file}#${logicalId}`).toContain(`policy/${boundaryPolicyName('ksaccount')}`);
            }
        }

        // The GitHub OIDC roles are in this app; zero roles would mean the loop above judged nothing.
        expect(roles).toBeGreaterThanOrEqual(3);
    });

    it('keeps the owner-only stack off every bootstrap role', () => {
        const names = stackArtifacts(ownerOnly).map(([, artifact]) => String(artifact.properties?.['stackName']));

        expect(names).toContain('kitchensink-ci-policies');

        for (const [id, artifact] of stackArtifacts(ownerOnly)) {
            if (artifact.properties?.['stackName'] !== 'kitchensink-ci-policies') {
                continue;
            }

            // CliCredentialsStackSynthesizer: the owner's admin session deploys it directly.
            expect(artifact.properties?.['assumeRoleArn'], id).toBeUndefined();
            expect(artifact.properties?.['cloudFormationExecutionRoleArn'], id).toBeUndefined();
        }
    });

    // Its template is over CloudFormation's 51,200-byte inline limit, so the CLI uploads it to a bucket first. The
    // ksaccount bucket cannot be that bucket: the ksaccount bootstrap attaches policies this stack creates, so it does
    // not exist yet on the first deploy. The template goes to the default bootstrap's assets bucket, written with the
    // owner's own credentials (no role assumed); nothing else of the default bootstrap is used.
    it('uploads the owner-only template to the default assets bucket with the owner credentials', () => {
        const assetFiles = ownerOnly.files.filter(
            (file) => file.includes('kitchensink-ci-policies') || file.includes('CiExecutionPolicy'),
        );
        const manifests = assetFiles.filter((file) => file.endsWith('.assets.json'));

        expect(manifests.length).toBe(1);

        const assets = JSON.parse(read(ownerOnly, manifests[0] ?? '')) as {
            files?: Record<string, { destinations: Record<string, { bucketName: string; assumeRoleArn?: string }> }>;
        };
        const destinations = Object.values(assets.files ?? {}).flatMap((file) => Object.values(file.destinations));

        expect(destinations.length).toBeGreaterThan(0);

        for (const destination of destinations) {
            expect(destination.bucketName).toContain(`cdk-${DEFAULT_QUALIFIER}-assets-`);
            expect(destination.assumeRoleArn).toBeUndefined();
        }
    });
});

/**
 * The ksaccount boundary is a CEILING over what the account app's roles are granted, not a mirror of it.
 *
 * `puts every role under the ksaccount boundary` proves the boundary is ATTACHED. A role's permissions are the
 * intersection of its policy and its boundary, so a boundary that does not admit a grant silently removes it: the
 * CI roles gained the boundary and dozens of their grants (stack deletes, log-group deletes, DNS changes, ...) would
 * have been denied, found only by simulating after the diff. This reads every Allow of every policy the synthesized
 * app attaches to a role, expands wildcard actions against the Service Authorization Reference snapshot, and requires
 * each (action, resource) pair to be admitted by the RENDERED boundary.
 *
 * Modelled as IAM does it, so far as the boundary uses it: an Allow admits a pair when the action matches, the
 * resource is CONTAINED (the role's own wildcards count as plain characters), and the action's service is the resource's
 * service; no Deny covers it; a stack-name tag condition is taken as satisfied, because every resource a stack makes
 * carries the tag (the boundary's own comment states the same assumption). Pairs on the default qualifier's bootstrap
 * roles are the one expected refusal.
 */
describe('the ksaccount boundary is a ceiling over the roles of the account app', () => {
    interface CatalogueEntry {
        readonly actions: readonly string[];
    }
    const catalogue = JSON.parse(
        readFileSync(createRequire(import.meta.url).resolve('@kitchensink/cdk-bootstrap/iamCatalogue'), 'utf8'),
    ) as { services: Record<string, CatalogueEntry> };

    type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

    const ARN_SERVICE_OF_PREFIX: Readonly<Record<string, string>> = {
        'cloudfront-keyvaluestore': 'cloudfront',
        sts: 'iam',
    };

    /** Resolves the intrinsics a synthesized ARN uses; a GetAtt (an id CloudFormation assigns) has no ARN to judge. */
    function resolveArn(value: Json | undefined): string | undefined {
        if (typeof value === 'string') {
            return value;
        }

        if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) {
            return undefined;
        }

        const join = value['Fn::Join'];

        if (Array.isArray(join) && Array.isArray(join[1])) {
            const parts = (join[1] as Json[]).map(resolveArn);

            return parts.includes(undefined) ? undefined : parts.join(typeof join[0] === 'string' ? join[0] : '');
        }

        const names: Record<string, string> = {
            'AWS::Partition': 'aws',
            'AWS::Region': 'us-east-1',
            'AWS::AccountId': ACCOUNT,
        };

        return names[typeof value['Ref'] === 'string' ? value['Ref'] : ''];
    }

    interface Grant {
        readonly where: string;
        readonly action: string;
        readonly resource: string;
    }

    /** Every (action, resource) an Allow of a role-attached policy grants, wildcard actions expanded. */
    function grantsOf(assembly: Assembly): Grant[] {
        const grants: Grant[] = [];

        const take = (where: string, document: Json | undefined): void => {
            const raw = (document as { Statement?: Json } | undefined)?.Statement;
            const statements = (Array.isArray(raw) ? raw : []) as Record<string, Json>[];

            for (const statement of statements) {
                if (statement['Effect'] !== 'Allow') {
                    continue;
                }

                const actions = ([] as Json[]).concat(statement['Action'] ?? []) as string[];
                const resources = ([] as Json[]).concat(statement['Resource'] ?? '*').map(resolveArn);

                for (const action of actions) {
                    const [service = '', name = ''] = action.split(':');
                    const known = catalogue.services[service.toLowerCase()];

                    if (/[*?]/u.test(name) && known === undefined) {
                        throw new Error(`${where}: no catalogue entry for "${action}"; run bootstrap:catalogue`);
                    }

                    const concrete = /[*?]/u.test(name)
                        ? (known?.actions ?? [])
                              .filter((candidate) => iamLike(name.toLowerCase(), candidate.toLowerCase()))
                              .map((candidate) => `${service}:${candidate}`)
                        : [action];

                    for (const resource of resources) {
                        if (resource !== undefined) {
                            concrete.forEach((each) => grants.push({ where, action: each, resource }));
                        }
                    }
                }
            }
        };

        for (const file of assembly.files.filter((candidate) => candidate.endsWith('.template.json'))) {
            const resources = (
                JSON.parse(read(assembly, file)) as {
                    Resources?: Record<string, { Type: string; Properties?: Record<string, Json> }>;
                }
            ).Resources;

            for (const [logicalId, resource] of Object.entries(resources ?? {})) {
                const where = `${file}#${logicalId}`;
                const properties = resource.Properties ?? {};

                if (resource.Type === 'AWS::IAM::Policy' || resource.Type === 'AWS::IAM::ManagedPolicy') {
                    take(where, properties['PolicyDocument']);
                }

                if (resource.Type === 'AWS::IAM::Role') {
                    const inline = properties['Policies'];

                    (Array.isArray(inline) ? (inline as Record<string, Json>[]) : []).forEach((policy) =>
                        take(where, policy['PolicyDocument']),
                    );
                }
            }
        }

        return grants;
    }

    const rendered = (): PolicyDocument =>
        renderDocument(buildBoundary('ksaccount'), { account: ACCOUNT, region: 'us-east-1' });

    const serviceMatches = (action: string, pattern: string): boolean => {
        const prefix = action.split(':')[0]?.toLowerCase() ?? '';

        return !pattern.startsWith('arn:') || pattern.split(':')[2] === (ARN_SERVICE_OF_PREFIX[prefix] ?? prefix);
    };

    function admits(boundary: PolicyDocument, grant: Grant): boolean {
        const applies = (statement: Statement): boolean =>
            statement.Action.some((pattern) => iamLike(pattern.toLowerCase(), grant.action.toLowerCase())) &&
            statement.Resource.some(
                (pattern) =>
                    serviceMatches(grant.action, pattern) &&
                    // A ceiling must CONTAIN the role's resource: the role's own wildcards are matched as plain characters, so
                    // `log-group:*` is inside `log-group:*` but not inside `log-group:kitchensink-*`.
                    iamLike(pattern, grant.resource),
            );

        return (
            boundary.Statement.some(
                (statement) =>
                    statement.Effect === 'Allow' &&
                    applies(statement) &&
                    // A resource-tag condition is taken as satisfied; any other condition is not modelled.
                    Object.entries(statement.Condition ?? {}).every(
                        ([operator, keys]) =>
                            operator === 'StringLike' && Object.keys(keys).every((key) => key.includes('ResourceTag')),
                    ),
            ) && !boundary.Statement.some((statement) => statement.Effect === 'Deny' && applies(statement))
        );
    }

    const legacy = (grant: Grant): boolean => grant.resource.includes(`role/cdk-${DEFAULT_QUALIFIER}-`);

    const refused = (boundary: PolicyDocument, grants: readonly Grant[]): string[] =>
        grants
            .filter((grant) => !legacy(grant) && !admits(boundary, grant))
            .map((grant) => `${grant.action} on ${grant.resource}`);

    it('judges a real number of grants (a vacuous pass here would hide every rule below)', () => {
        expect(grantsOf(deployable).length).toBeGreaterThan(100);
    });

    it('admits every grant of every role of the account app', () => {
        expect([...new Set(refused(rendered(), grantsOf(deployable)))].sort()).toEqual([]);
    });

    it('refuses assuming the default qualifier roles, which stays an explicit Deny', () => {
        const old = grantsOf(deployable).filter(legacy);

        expect(old.length).toBeGreaterThan(0);
        expect(old.filter((grant) => admits(rendered(), grant))).toEqual([]);
    });

    it('fails when a ceiling line is dropped (the guard can see a missing grant)', () => {
        const boundary = rendered();
        const without = (needle: string): PolicyDocument => ({
            ...boundary,
            Statement: boundary.Statement.map((statement) => ({
                ...statement,
                Resource: statement.Resource.filter((resource) => !resource.includes(needle)),
            })),
        });

        for (const needle of ['stack/kitchensink-', 'hostedzone/', ':repository/', 'parameter/kitchensink/']) {
            expect(refused(without(needle), grantsOf(deployable)).length, needle).toBeGreaterThan(0);
        }
    });
});
