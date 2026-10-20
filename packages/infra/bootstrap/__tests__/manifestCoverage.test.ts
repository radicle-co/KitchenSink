/**
 * The committed manifests are the contract between what the apps synthesize and what the policies allow, so this
 * file holds both ends of that contract still:
 *
 * - the DERIVATION folds a cloud assembly correctly (a fixture assembly with known contents), and finds every app
 *   (a fixture tree with an app the script was never told about);
 * - the COMMITTED manifests are internally consistent with the qualifiers (stack names fall in exactly one tier's
 *   patterns, no docker image asset exists, the managed policies are the four the boundary and the execution
 *   policy know).
 *
 * ⚠️ What this file CANNOT do cheaply is re-synthesize ten apps: that is `npm run bootstrap:derive -- --check`
 * (minutes, needs the built Lambda bundles). It is a script on purpose; the reviewer who changes a construct runs it,
 * and the diff of `manifests/` is the review of what the change grants.
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { AWS_MANAGED_POLICY_ACTIONS } from '../src/boundary.js';
import { ATTACHABLE_AWS_POLICIES } from '../src/executionPolicy.js';
import { iamLike } from '../src/iamPattern.js';
import { QUALIFIERS, STACK_NAME_PATTERNS, type QualifierName } from '../src/qualifiers.js';
import {
    ACCOUNT_APP,
    discoverStageApps,
    emptyDerived,
    foldCloudAssembly,
    toManifest,
} from '../scripts/deriveResourceTypes.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');

interface Manifest {
    readonly qualifier: string;
    readonly resourceTypes: readonly string[];
    readonly stackNames: readonly string[];
    readonly awsManagedPolicies: readonly string[];
    readonly dockerImageAssets: boolean;
}

const manifest = (qualifier: QualifierName): Manifest =>
    JSON.parse(readFileSync(path.join(here, `../manifests/cfnResourceTypes.${qualifier}.json`), 'utf8')) as Manifest;

const scratch: string[] = [];

afterEach(() => {
    for (const directory of scratch.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

const makeDirectory = (): string => {
    const directory = mkdtempSync(path.join(tmpdir(), 'ksManifest-'));
    scratch.push(directory);

    return directory;
};

/** Writes a cloud assembly with one stack whose template is `resources`. */
function writeAssembly(
    directory: string,
    stackId: string,
    resources: object,
    options: { stackName?: string; docker?: boolean } = {},
): void {
    writeFileSync(
        path.join(directory, 'manifest.json'),
        JSON.stringify({
            version: '1.0.0',
            artifacts: {
                [stackId]: {
                    type: 'aws:cloudformation:stack',
                    ...(options.stackName === undefined ? {} : { properties: { stackName: options.stackName } }),
                },
                [`${stackId}.assets`]: { type: 'cdk:asset-manifest' },
            },
        }),
    );
    writeFileSync(path.join(directory, `${stackId}.template.json`), JSON.stringify({ Resources: resources }));
    writeFileSync(
        path.join(directory, `${stackId}.assets.json`),
        JSON.stringify({ files: {}, dockerImages: options.docker === true ? { abc: { source: {} } } : {} }),
    );
}

describe('foldCloudAssembly', () => {
    const resources = {
        Role: {
            Type: 'AWS::IAM::Role',
            Properties: {
                AssumeRolePolicyDocument: {
                    Statement: [{ Principal: { Service: ['lambda.amazonaws.com', 'states.amazonaws.com'] } }],
                },
                ManagedPolicyArns: [
                    {
                        'Fn::Join': [
                            '',
                            [
                                'arn:',
                                { Ref: 'AWS::Partition' },
                                ':iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
                            ],
                        ],
                    },
                ],
                Policies: [
                    {
                        PolicyDocument: {
                            Statement: [
                                { Effect: 'Allow', Action: ['s3:GetObject*', 'sqs:SendMessage'], Resource: '*' },
                                { Effect: 'Deny', Action: 'dynamodb:DeleteTable', Resource: '*' },
                            ],
                        },
                    },
                ],
            },
        },
        Standalone: {
            Type: 'AWS::IAM::Policy',
            Properties: {
                PolicyDocument: { Statement: { Effect: 'Allow', Action: 'ssm:GetParameter', Resource: '*' } },
            },
        },
        Queue: { Type: 'AWS::SQS::Queue' },
    };

    it('collects types, Allow actions, trusted services and AWS-managed policies, and not Deny actions', () => {
        const directory = makeDirectory();
        writeAssembly(directory, 'Stack', resources, { stackName: 'kitchensink-x-sandbox' });
        const derived = emptyDerived();

        foldCloudAssembly(directory, derived);

        expect([...derived.resourceTypes].sort()).toEqual(['AWS::IAM::Policy', 'AWS::IAM::Role', 'AWS::SQS::Queue']);
        expect([...derived.roleActions].sort()).toEqual(['s3:GetObject*', 'sqs:SendMessage', 'ssm:GetParameter']);
        expect([...derived.rolePassedToServices].sort()).toEqual(['lambda.amazonaws.com', 'states.amazonaws.com']);
        expect([...derived.awsManagedPolicies]).toEqual(['service-role/AWSLambdaBasicExecutionRole']);
        expect(derived.dockerImageAssets).toBe(false);
    });

    it('names a stack by its stackName, or by its artifact id when none is set (never the template file)', () => {
        const named = makeDirectory();
        writeAssembly(named, 'IdentityService-sandbox', resources, {
            stackName: 'kitchensink-identity-service-sandbox',
        });
        const unnamed = makeDirectory();
        writeAssembly(unnamed, 'kitchensink-identity-schema-sandbox', resources);
        const derived = emptyDerived();

        foldCloudAssembly(named, derived);
        foldCloudAssembly(unnamed, derived);

        expect([...derived.stackNames].sort()).toEqual([
            'kitchensink-identity-schema-sandbox',
            'kitchensink-identity-service-sandbox',
        ]);
    });

    it('notices a docker image asset, which no CI role is allowed to publish', () => {
        const directory = makeDirectory();
        writeAssembly(directory, 'Stack', resources, { docker: true });
        const derived = emptyDerived();

        foldCloudAssembly(directory, derived);

        expect(derived.dockerImageAssets).toBe(true);
    });

    it('serializes sorted, so a regeneration is byte-stable', () => {
        const directory = makeDirectory();
        writeAssembly(directory, 'Stack', resources);
        const derived = emptyDerived();
        foldCloudAssembly(directory, derived);

        const manifestOut = toManifest('ksprod', derived) as { resourceTypes: string[] };

        expect(manifestOut.resourceTypes).toEqual([...manifestOut.resourceTypes].sort());
    });
});

describe('discoverStageApps', () => {
    it('finds an app in a service the script was never told about', () => {
        const root = makeDirectory();

        for (const app of ['packages/services/alpha/infra/bin/app.ts', 'packages/services/beta/infra/bin/app.ts']) {
            mkdirSync(path.join(root, path.dirname(app)), { recursive: true });
            writeFileSync(path.join(root, app), 'new App();');
        }

        mkdirSync(path.join(root, 'packages/services/gamma/src'), { recursive: true });

        expect(discoverStageApps(root)).toEqual([
            'packages/services/alpha/infra/bin/app.ts',
            'packages/services/beta/infra/bin/app.ts',
        ]);
    });

    it('finds, in this repository, every file that constructs a CDK App except the account app', () => {
        const constructing: string[] = [];

        const walk = (directory: string): void => {
            // `withFileTypes` types each entry in the same read that lists it, so no path is `stat`ed and then read
            // after it may have changed.
            for (const entry of readdirSync(directory, { withFileTypes: true })) {
                if (
                    ['node_modules', 'dist', 'dist-lambda', 'dist-edge', 'build', 'cdk.out', '.next'].includes(
                        entry.name,
                    )
                ) {
                    continue;
                }

                const full = path.join(directory, entry.name);

                if (entry.isDirectory()) {
                    walk(full);
                } else if (/\/bin\/[A-Za-z]+\.ts$/u.test(full) && /new App\(/u.test(readFileSync(full, 'utf8'))) {
                    constructing.push(path.relative(repoRoot, full));
                }
            }
        };

        walk(path.join(repoRoot, 'packages'));

        expect(constructing.filter((file) => file !== ACCOUNT_APP).sort()).toEqual([...discoverStageApps(repoRoot)]);
        expect(constructing).toContain(ACCOUNT_APP);
    });
});

describe.each(Object.values(QUALIFIERS))('manifests/cfnResourceTypes.%s.json', (qualifier) => {
    const committed = manifest(qualifier);

    it('belongs to its qualifier', () => {
        expect(committed.qualifier).toBe(qualifier);
    });

    it('records no docker image asset (the CI roles cannot assume the image-publishing role)', () => {
        expect(committed.dockerImageAssets).toBe(false);
    });

    it('lists only AWS-managed policies the boundary and the execution policy know', () => {
        for (const policy of committed.awsManagedPolicies) {
            expect(Object.keys(AWS_MANAGED_POLICY_ACTIONS)).toContain(policy);
            expect(ATTACHABLE_AWS_POLICIES).toContain(policy);
        }
    });

    it('is not empty: a manifest that derived nothing would make every guard pass vacuously', () => {
        expect(committed.resourceTypes.length).toBeGreaterThan(5);
        expect(committed.stackNames.length).toBeGreaterThan(1);
    });
});

describe('stack names against the qualifier patterns', () => {
    const matches = (qualifier: QualifierName, name: string): boolean =>
        STACK_NAME_PATTERNS[qualifier].some((pattern) => iamLike(pattern, name));

    it.each(Object.values(QUALIFIERS))(
        'every stack %s deploys is inside its own patterns and outside the others',
        (qualifier) => {
            for (const name of manifest(qualifier).stackNames) {
                expect(matches(qualifier, name), `${name} must match ${qualifier}`).toBe(true);

                for (const other of Object.values(QUALIFIERS).filter((candidate) => candidate !== qualifier)) {
                    expect(matches(other, name), `${name} must not match ${other}`).toBe(false);
                }
            }
        },
    );

    it.each([
        ['kitchensink-data-prod', 'ksprod'],
        ['kitchensink-sandbox-router-prod', 'ksprod'],
        ['kitchensink-data-sandbox', 'ksnonprod'],
        ['kitchensink-food-service-pr-91', 'ksnonprod'],
        ['kitchensink-sandbox-router-pr-91', 'ksnonprod'],
        ['kitchensink-sandbox-scheduler-sandbox', 'ksnonprod'],
        ['kitchensink-cost-guardrails', 'ksaccount'],
        ['kitchensink-github-actions-access', 'ksaccount'],
    ] as const)('%s belongs to %s alone', (name, owner) => {
        for (const qualifier of Object.values(QUALIFIERS)) {
            expect(matches(qualifier, name), `${name} vs ${qualifier}`).toBe(qualifier === owner);
        }
    });

    it.each(['kitchensink-bootstrap-ksprod', 'CDKToolkit', 'kitchensink-prod', 'armoury-prod', 'kitchensink--prod-x'])(
        '%s belongs to no qualifier',
        (name) => {
            for (const qualifier of Object.values(QUALIFIERS)) {
                expect(matches(qualifier, name), `${name} vs ${qualifier}`).toBe(false);
            }
        },
    );
});
