// @vitest-environment node
/**
 * Guard: **the RDS master credential is read by exactly two functions** — `DataStack`'s role-model bootstrap and
 * its (non-prod) per-PR reaper.
 *
 * ## Why
 *
 * The master (`identity_app`) is a member of `rds_superuser`: whoever holds its password can drop every database on
 * the instance. Before the role split (ADR-0039) the identity ECS service, five identity-webhooks Lambdas and the
 * identity migration runner all logged in as it — a SQL injection anywhere in them reached every database. They
 * now log in as their own roles by RDS IAM, and the password is the bootstrap's and the reaper's alone. This guard
 * keeps it that way from both sides:
 *
 * - **the template**: every IAM statement that can read the master secret belongs to a role one of those two
 *   functions runs as — by exact equality, so a third reader fails and a reader that disappeared does too;
 * - **the source**: no stack outside `DataStack` imports the `DatabaseSecretArn` export, and no production file
 *   outside `packages/infra/global/src` reads `DB_SECRET_ARN`.
 */
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';

import { DataStack } from '../lib/platform/DataStack.js';
import { NetworkStack } from '../lib/platform/NetworkStack.js';
import { productionSources, readSource, withoutTsComments } from './roleSplitSources.js';
import { testApp } from './testApp.js';

const env = { account: '123456789012', region: 'us-east-1' };

type Resource = { readonly Type: string; readonly Properties: Record<string, unknown> };

/** The logical ids of the functions whose execution role may read the master secret. */
function masterSecretReaders(stage: string): readonly string[] {
    const app = testApp();
    const network = new NetworkStack(app, `Net-${stage}`, { env, stage });
    const resources = Template.fromStack(new DataStack(app, `Data-${stage}`, { env, network, stage })).toJSON()
        .Resources as Record<string, Resource>;
    const secretId = Object.keys(resources).find((id) => /^DatabaseCredentialsSecret[0-9A-F]{8}$/u.test(id));

    expect(secretId, 'the master credentials secret must be discoverable').toBeDefined();

    const readerRoles = Object.values(resources)
        .filter((resource) => resource.Type === 'AWS::IAM::Policy')
        .filter((policy) =>
            JSON.stringify((policy.Properties['PolicyDocument'] as { Statement: unknown }).Statement).includes(
                `"Ref":"${secretId}"`,
            ),
        )
        .flatMap((policy) => (policy.Properties['Roles'] as { Ref: string }[]).map((role) => role.Ref));

    return Object.entries(resources)
        .filter(([, resource]) => resource.Type === 'AWS::Lambda::Function')
        .filter(([, fn]) =>
            readerRoles.includes((fn.Properties['Role'] as { 'Fn::GetAtt': [string] })['Fn::GetAtt'][0]),
        )
        .map(([id]) => id.replace(/[0-9A-F]{8}$/u, ''))
        .sort();
}

describe('who may read the RDS master credential', () => {
    it('sandbox: the role-model bootstrap and the per-PR reaper, and nothing else', () => {
        expect(masterSecretReaders('sandbox')).toEqual(['DbBootstrapFunction', 'PerPrDatabaseReaperFunction']);
    });

    it('prod: the role-model bootstrap alone (the reaper is non-prod only, ADR-0031)', () => {
        expect(masterSecretReaders('prod')).toEqual(['DbBootstrapFunction']);
    });

    it('no stack outside DataStack imports the master secret export', () => {
        const importers = productionSources()
            .filter((path) => path !== 'packages/infra/global/lib/platform/DataStack.ts')
            .filter((path) => /:DatabaseSecretArn\b/u.test(withoutTsComments(readSource(path))));

        expect(importers).toEqual([]);
    });

    it('no production file outside the global infra handlers reads DB_SECRET_ARN', () => {
        const readers = productionSources()
            .filter((path) => !path.startsWith('packages/infra/global/'))
            .filter((path) => /\bDB_SECRET_ARN\b/u.test(withoutTsComments(readSource(path))));

        expect(readers).toEqual([]);
    });
});
