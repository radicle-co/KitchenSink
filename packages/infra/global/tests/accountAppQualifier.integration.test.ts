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
});
