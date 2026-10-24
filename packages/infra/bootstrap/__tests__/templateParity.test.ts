/**
 * The comparator behind the template-parity proof. The proof is only worth anything if it FAILS when a template
 * moves in a way the qualifier move must not cause, so every case below is a way a deploy could silently replace
 * a resource (a changed logical id, a changed replacement-causing property, a dropped RETAIN) or lose a guard
 * (a role without its boundary, a docker image asset).
 *
 * The expected differences are exactly two: the qualifier token (bootstrap parameter and rule, asset bucket,
 * lookup and deploy role ARNs) and the permissions boundary on roles. Everything else must be identical.
 */
import { describe, expect, it } from 'vitest';

import { compareCaptures, type Capture } from '../src/templateParity.js';

const BOUNDARY = (qualifier: string): unknown => ({
    'Fn::Join': [
        '',
        ['arn:', { Ref: 'AWS::Partition' }, `:iam::123456789012:policy/kitchensink-ci-boundary-${qualifier}`],
    ],
});

/** A template shaped like a real stage template: bootstrap rule, an asset-backed Lambda, a role, a retained bucket. */
function template(qualifier: string, options: { boundary?: unknown } = {}): Record<string, unknown> {
    return {
        Parameters: {
            BootstrapVersion: {
                Type: 'AWS::SSM::Parameter::Value<String>',
                Default: `/cdk-bootstrap/${qualifier}/version`,
            },
        },
        Rules: {
            CheckBootstrapVersion: { Assertions: [{ Assert: 'x', AssertDescription: `bootstrap ${qualifier}` }] },
        },
        Resources: {
            Role1: {
                Type: 'AWS::IAM::Role',
                Properties: {
                    AssumeRolePolicyDocument: { Statement: [] },
                    ...(options.boundary === undefined ? {} : { PermissionsBoundary: options.boundary }),
                },
            },
            Fn1: {
                Type: 'AWS::Lambda::Function',
                Properties: {
                    Code: { S3Bucket: `cdk-${qualifier}-assets-123456789012-us-east-1`, S3Key: 'abc.zip' },
                    Role: { 'Fn::GetAtt': ['Role1', 'Arn'] },
                },
            },
            Bucket1: {
                Type: 'AWS::S3::Bucket',
                DeletionPolicy: 'Retain',
                Properties: { BucketName: 'kitchensink-media' },
            },
        },
    };
}

/** How CDK varies asset identity with the bootstrap: the template asset hash and the destination id both move. */
const fileAsset = (qualifier: string, templateHash: string): Record<string, unknown> => {
    const destinationSuffix = qualifier === 'hnb659fds' ? '11111111' : '22222222';
    const bucketName = `cdk-${qualifier}-assets-123456789012-us-east-1`;

    return {
        [templateHash]: {
            source: { path: 'Stack.template.json', packaging: 'file' },
            destinations: {
                [`123456789012-us-east-1-${destinationSuffix}`]: { bucketName, objectKey: `${templateHash}.json` },
            },
        },
        abc: {
            source: { path: 'asset.abc', packaging: 'zip' },
            destinations: {
                [`123456789012-us-east-1-${destinationSuffix}`]: { bucketName, objectKey: 'abc.zip' },
            },
        },
    };
};

/** The template hash a qualifier's synthesis produces (a content hash, so it moves with the template). */
const templateHashFor = (qualifier: string): string => (qualifier === 'hnb659fds' ? 'a' : 'b').repeat(64);

const assets = (qualifier: string, dockerImages: Record<string, unknown> = {}): Record<string, unknown> => ({
    version: '1',
    files: fileAsset(qualifier, templateHashFor(qualifier)),
    dockerImages,
});

const manifest = (qualifier: string): Record<string, unknown> => ({
    version: '1',
    artifacts: {
        Stack: {
            properties: {
                stackTemplateAssetObjectUrl: `s3://cdk-${qualifier}-assets-123456789012-us-east-1/${templateHashFor(qualifier)}.json`,
                lookupRole: {
                    arn: `arn:aws:iam::123456789012:role/cdk-${qualifier}-lookup-role-123456789012-us-east-1`,
                },
            },
        },
    },
});

function capture(
    qualifier: string,
    options: {
        boundary?: unknown;
        stage?: string;
        docker?: boolean;
        mutate?: (t: Record<string, unknown>) => void;
    } = {},
): Capture {
    const t = template(qualifier, { boundary: options.boundary ?? BOUNDARY(qualifier) });
    options.mutate?.(t);

    return {
        [`pkg/${options.stage ?? 'sandbox'}`]: {
            'Stack.template.json': t,
            'Stack.assets.json': assets(qualifier, options.docker === true ? { img: {} } : {}),
            'manifest.json': manifest(qualifier),
        },
    };
}

const base = (stage = 'sandbox'): Capture => ({
    [`pkg/${stage}`]: {
        'Stack.template.json': template('hnb659fds'),
        'Stack.assets.json': assets('hnb659fds'),
        'manifest.json': manifest('hnb659fds'),
    },
});

describe('compareCaptures', () => {
    it('finds no difference when only the qualifier and the role boundary moved', () => {
        expect(compareCaptures(base(), capture('ksnonprod')).differences).toEqual([]);
    });

    it('expects the prod qualifier at the prod stage and the nonprod qualifier at every other stage', () => {
        expect(compareCaptures(base('prod'), capture('ksprod', { stage: 'prod' })).differences).toEqual([]);
        expect(compareCaptures(base('pr-1'), capture('ksnonprod', { stage: 'pr-1' })).differences).toEqual([]);
    });

    it('fails when a prod stage was synthesized through the nonprod qualifier', () => {
        const report = compareCaptures(base('prod'), capture('ksnonprod', { stage: 'prod' }));

        expect(report.differences.length).toBeGreaterThan(0);
    });

    it('fails when a role lacks the boundary', () => {
        const head = capture('ksnonprod', {
            boundary: undefined,
            mutate: (t) =>
                delete ((t['Resources'] as Record<string, any>)['Role1'].Properties as Record<string, unknown>)[
                    'PermissionsBoundary'
                ],
        });

        expect(compareCaptures(base(), head).differences.join('\n')).toMatch(/Role1.*boundary/u);
    });

    it('fails when a role carries the OTHER tier boundary', () => {
        const head = capture('ksnonprod', { boundary: BOUNDARY('ksprod') });

        expect(compareCaptures(base(), head).differences.join('\n')).toMatch(/Role1.*boundary/u);
    });

    it('fails when a logical id changed, because that replaces the resource', () => {
        const head = capture('ksnonprod', {
            mutate: (t) => {
                const resources = t['Resources'] as Record<string, unknown>;
                resources['Bucket2'] = resources['Bucket1'];
                delete resources['Bucket1'];
            },
        });
        const text = compareCaptures(base(), head).differences.join('\n');

        expect(text).toMatch(/Bucket1/u);
        expect(text).toMatch(/Bucket2/u);
    });

    it('fails when a replacement-causing property changed', () => {
        const head = capture('ksnonprod', {
            mutate: (t) =>
                (((t['Resources'] as Record<string, any>)['Bucket1'].Properties as Record<string, unknown>)[
                    'BucketName'
                ] = 'other'),
        });

        expect(compareCaptures(base(), head).differences.join('\n')).toMatch(/Bucket1\.Properties\.BucketName/u);
    });

    it('fails when a RETAIN policy was dropped', () => {
        const head = capture('ksnonprod', {
            mutate: (t) => delete (t['Resources'] as Record<string, any>)['Bucket1'].DeletionPolicy,
        });

        expect(compareCaptures(base(), head).differences.join('\n')).toMatch(/Bucket1\.DeletionPolicy/u);
    });

    it('fails when the default qualifier survives in a head template', () => {
        const head = capture('ksnonprod', {
            mutate: (t) =>
                (((t['Resources'] as Record<string, any>)['Fn1'].Properties.Code as Record<string, unknown>)[
                    'S3Bucket'
                ] = 'cdk-hnb659fds-assets-123456789012-us-east-1'),
        });

        expect(compareCaptures(base(), head).differences.join('\n')).toMatch(/Fn1\.Properties\.Code\.S3Bucket/u);
    });

    it('fails when a file is missing from the head capture, so an unsynthesized app cannot pass', () => {
        const head = capture('ksnonprod');
        delete head['pkg/sandbox']?.['Stack.template.json'];

        expect(compareCaptures(base(), head).differences.join('\n')).toMatch(/Stack\.template\.json/u);
    });

    it('fails when an app/stage is missing from the head capture', () => {
        expect(compareCaptures(base(), {}).differences.join('\n')).toMatch(/pkg\/sandbox/u);
    });

    it('fails when the head produces a docker image asset', () => {
        expect(compareCaptures(base(), capture('ksnonprod', { docker: true })).differences.join('\n')).toMatch(
            /docker/iu,
        );
    });

    it('leaves the account capture alone: no qualifier move and no boundary is expected there', () => {
        const same: Capture = {
            'account/account': { 'A.template.json': { Resources: { R: { Type: 'AWS::IAM::Role', Properties: {} } } } },
        };

        expect(compareCaptures(same, structuredClone(same)).differences).toEqual([]);
    });

    it('reports a summary line per app and stage', () => {
        expect(compareCaptures(base(), capture('ksnonprod')).summary.join('\n')).toMatch(/pkg\/sandbox/u);
    });
    it('does not mistake a logical id that merely contains the qualifier text for the qualifier', () => {
        // `IdentityWebhooksprod...` contains `ksprod`. Rewriting it would invent a logical-id difference.
        const withId = (t: Record<string, unknown>): void => {
            (t['Resources'] as Record<string, unknown>)['IdentityWebhooksprodPermission'] = {
                Type: 'AWS::Lambda::Permission',
            };
        };

        const baseCapture = base('prod');
        withId(baseCapture['pkg/prod']!['Stack.template.json'] as Record<string, unknown>);

        expect(compareCaptures(baseCapture, capture('ksprod', { stage: 'prod', mutate: withId })).differences).toEqual(
            [],
        );
    });

    it('fails when a code asset changed, because that is a different build and not the qualifier move', () => {
        const head = capture('ksnonprod');
        const files = (head['pkg/sandbox']!['Stack.assets.json'] as { files: Record<string, unknown> }).files;
        files['def'] = files['abc'];
        delete files['abc'];

        expect(compareCaptures(base(), head).differences.join('\n')).toMatch(/abc|def/u);
    });

    const VERSION_ID = (hash: string): string => `FnCurrentVersionAB12CD34${hash.repeat(32)}`;

    const withVersion = (hash: string) => (t: Record<string, unknown>) => {
        const resources = t['Resources'] as Record<string, unknown>;
        resources[VERSION_ID(hash)] = { Type: 'AWS::Lambda::Version', Properties: { FunctionName: { Ref: 'Fn1' } } };
        resources['Alias1'] = {
            Type: 'AWS::Lambda::Alias',
            Properties: { FunctionVersion: { 'Fn::GetAtt': [VERSION_ID(hash), 'Version'] } },
        };
    };

    it('tolerates and COUNTS a Lambda version whose logical-id hash moved with the code bucket', () => {
        const baseCapture = base();
        withVersion('a')(baseCapture['pkg/sandbox']!['Stack.template.json'] as Record<string, unknown>);
        const report = compareCaptures(baseCapture, capture('ksnonprod', { mutate: withVersion('b') }));

        expect(report.differences).toEqual([]);
        expect(report.summary.join('\n')).toMatch(/1 Lambda version/u);
    });

    it('fails when a Lambda version is added or dropped, not merely re-hashed', () => {
        const baseCapture = base();
        withVersion('a')(baseCapture['pkg/sandbox']!['Stack.template.json'] as Record<string, unknown>);

        expect(compareCaptures(baseCapture, capture('ksnonprod')).differences.length).toBeGreaterThan(0);
    });

    it('fails when a resource that is not a Lambda version has a re-hashed logical id', () => {
        const hashed = (hash: string) => (t: Record<string, unknown>) => {
            (t['Resources'] as Record<string, unknown>)[`Db1AB12CD34${hash.repeat(32)}`] = {
                Type: 'AWS::RDS::DBInstance',
            };
        };

        const baseCapture = base();
        hashed('a')(baseCapture['pkg/sandbox']!['Stack.template.json'] as Record<string, unknown>);

        expect(
            compareCaptures(baseCapture, capture('ksnonprod', { mutate: hashed('b') })).differences.join('\n'),
        ).toMatch(/Db1/u);
    });
});
