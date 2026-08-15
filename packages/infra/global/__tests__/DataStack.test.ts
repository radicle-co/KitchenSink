/**
 * ADR-0007 per-stage RDS right-sizing: prod keeps db.t4g.small (unchanged → no prod diff), every
 * non-prod stage runs db.t4g.micro.
 *
 * ADR-0008 per-stage RDS storage type: prod stays on the default gp2 (unchanged → no prod diff),
 * every non-prod stage uses gp3 with NO provisioned IOPS/throughput (free 3,000-IOPS baseline).
 */
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, it, expect } from 'vitest';

import { DataStack } from '../lib/platform/DataStack.js';
import { NetworkStack } from '../lib/platform/NetworkStack.js';

const env = { account: '123456789012', region: 'us-east-1' };

const dataTemplate = (stage: string): Template => {
    const app = new App();
    const network = new NetworkStack(app, `Net-${stage}`, { env, stage });
    const data = new DataStack(app, `Data-${stage}`, { env, network, stage });

    return Template.fromStack(data);
};

describe('DataStack handle-sync topic (W8-a.2)', () => {
    it('creates the global handle-sync SNS topic + exports its ARN for producers/subscribers', () => {
        const template = dataTemplate('sandbox');
        template.hasResourceProperties('AWS::SNS::Topic', {
            TopicName: 'kitchensink-handle-sync-sandbox',
        });
        template.hasOutput('HandleSyncTopicArn', {});
    });
});

describe('DataStack per-stage RDS instance class (ADR-0007)', () => {
    it('prod stays on db.t4g.small (unchanged sizing → no prod diff)', () => {
        dataTemplate('prod').hasResourceProperties('AWS::RDS::DBInstance', {
            DBInstanceClass: 'db.t4g.small',
        });
    });

    it('sandbox is right-sized down to db.t4g.micro', () => {
        dataTemplate('sandbox').hasResourceProperties('AWS::RDS::DBInstance', {
            DBInstanceClass: 'db.t4g.micro',
        });
    });

    it('an unspecified/dev stage also uses the smaller db.t4g.micro', () => {
        dataTemplate('dev').hasResourceProperties('AWS::RDS::DBInstance', {
            DBInstanceClass: 'db.t4g.micro',
        });
    });

    it('does not downsize prod when sandbox does (independent per-stage synths)', () => {
        const prodClasses = Object.values(dataTemplate('prod').findResources('AWS::RDS::DBInstance')).map(
            (resource: any) => resource.Properties.DBInstanceClass,
        );

        expect(prodClasses).toEqual(['db.t4g.small']);
    });
});

describe('DataStack per-stage RDS storage type (ADR-0008)', () => {
    it('prod stays on the default gp2 storage (unchanged → no prod diff)', () => {
        dataTemplate('prod').hasResourceProperties('AWS::RDS::DBInstance', {
            StorageType: 'gp2',
        });
    });

    it('sandbox uses cheaper gp3 storage', () => {
        dataTemplate('sandbox').hasResourceProperties('AWS::RDS::DBInstance', {
            StorageType: 'gp3',
        });
    });

    it('an unspecified/dev stage also uses gp3', () => {
        dataTemplate('dev').hasResourceProperties('AWS::RDS::DBInstance', {
            StorageType: 'gp3',
        });
    });

    it('sets NO provisioned IOPS or throughput on gp3 (100 GB uses the free baseline)', () => {
        const instance = Object.values(dataTemplate('sandbox').findResources('AWS::RDS::DBInstance'))[0] as any;

        expect(instance.Properties.StorageType).toBe('gp3');
        expect(instance.Properties.Iops).toBeUndefined();
        expect(instance.Properties.StorageThroughput).toBeUndefined();
    });
});

describe('DataStack RDS teardown policy (ADR-0002: DESTROY, no snapshot)', () => {
    // The instance is `removalPolicy: DESTROY` on purpose (per-stage ephemeral RDS, no orphaned prod
    // snapshot). A regression to RETAIN/SNAPSHOT would silently leave paid resources behind on cleanup.
    it.each(['prod', 'sandbox'])('deletes the RDS instance on stack removal (no snapshot) — %s', (stage) => {
        dataTemplate(stage).hasResource('AWS::RDS::DBInstance', {
            DeletionPolicy: 'Delete',
            UpdateReplacePolicy: 'Delete',
        });
    });
});

/**
 * Cross-stack contract: identity-service, identity-webhooks and food-service all
 * `Fn.importValue('kitchensink-data-${stage}:<suffix>')`. Dropping/renaming any of these exports breaks
 * a downstream synth at deploy time, not here — so this stack must be the guard. (In test the stack id
 * is `Data-${stage}`, not `kitchensink-data-${stage}`, so assert on the export-name SUFFIX, exactly as
 * the pre-existing DatabaseResourceId test does.)
 */
const CONSUMED_DATA_EXPORT_SUFFIXES = [
    'DatabaseEndpoint',
    'DatabasePort',
    'DatabaseName',
    'DatabaseSecretArn',
    'SecretArn',
    'MigrationPlanSecretArn',
    'FoodDatabaseName',
    'DatabaseResourceId',
    'DeletionQueueArn',
    'MediaBucketName',
    'ArchiveBucketName',
] as const;

const outputByExportSuffix = (template: Template, suffix: string): { Value: any; Export?: { Name?: string } } => {
    const match = Object.values(template.findOutputs('*')).find((output: any) =>
        String(output.Export?.Name ?? '').endsWith(`:${suffix}`),
    ) as any;

    return match;
};

describe('DataStack cross-stack CfnOutput exports (consumer contract)', () => {
    it.each(CONSUMED_DATA_EXPORT_SUFFIXES)('produces the %s export consumers import', (suffix) => {
        // The stack id under test is `Data-prod` and exportName is `${this.stackName}:<suffix>` (no
        // `stackName` override in DataStackProps), so the full export name is deterministic.
        expect(outputByExportSuffix(dataTemplate('prod'), suffix)).toMatchObject({
            Export: { Name: `Data-prod:${suffix}` },
        });
    });

    // A recent bug came from a consumer mis-handling the suffix-LESS Clerk auth-secret ARN. These two
    // groups MUST resolve differently and the test must fail if either flips:
    //   • DatabaseSecretArn / MigrationPlanSecretArn are CDK-CREATED secrets → export is a Ref to the
    //     secret resource, i.e. the FULL ARN including the random 6-char suffix (secretCompleteArn).
    //   • SecretArn is imported by NAME (fromSecretNameV2) → export is a by-name Fn::Join ARN with NO
    //     suffix (secretPartialArn). Consumers must NOT treat it as a complete ARN.
    it.each(['DatabaseSecretArn', 'MigrationPlanSecretArn'])(
        '%s exports the full ARN of a CDK-created secret (Ref, suffix-ful)',
        (suffix) => {
            const template = dataTemplate('prod');
            const output = outputByExportSuffix(template, suffix);
            const refTarget = output.Value?.Ref;

            // The Ref's logical id is CDK's own construct-id + 8-char hash convention, so it must be a
            // Ref to THIS suffix's specific secret construct (`DatabaseCredentialsSecret` /
            // `MigrationPlanSecret`), not merely "some" defined value.
            const constructIdBySuffix: Record<string, string> = {
                DatabaseSecretArn: 'DatabaseCredentialsSecret',
                MigrationPlanSecretArn: 'MigrationPlanSecret',
            };
            expect(refTarget).toMatch(new RegExp(`^${constructIdBySuffix[suffix]}[0-9A-F]{8}$`));
            expect(output.Value['Fn::Join']).toBeUndefined();
            // The Ref must point at a Secret resource this stack owns (a real complete ARN with suffix).
            expect(Object.keys(template.findResources('AWS::SecretsManager::Secret'))).toContain(refTarget);
        },
    );

    it('SecretArn exports the suffix-LESS by-name ARN of the imported Clerk auth secret (not a Ref)', () => {
        const output = outputByExportSuffix(dataTemplate('sandbox'), 'SecretArn');

        // by-name (fromSecretNameV2) form: an Fn::Join, never a Ref to an owned Secret resource.
        expect(output.Value.Ref).toBeUndefined();
        expect(output.Value['Fn::Join']).toEqual([
            '',
            [
                'arn:',
                { Ref: 'AWS::Partition' },
                ':secretsmanager:us-east-1:123456789012:secret:kitchensink/sandbox/identity/keys',
            ],
        ]);
        // Ends at the plain secret NAME — no `-<6char>` Secrets Manager suffix appended.
        expect(JSON.stringify(output.Value)).toContain(':secret:kitchensink/sandbox/identity/keys');
        expect(JSON.stringify(output.Value)).not.toMatch(/kitchensink\/sandbox\/identity\/keys-[A-Za-z0-9]{6}/);
    });
});

describe('Food DB IAM auth + role/database bootstrap (feature 003, ADR-0006)', () => {
    it('enables RDS IAM database authentication on the shared instance', () => {
        const instance = Object.values(dataTemplate('sandbox').findResources('AWS::RDS::DBInstance'))[0] as any;

        expect(instance.Properties.EnableIAMDatabaseAuthentication).toBe(true);
    });

    it('provisions a VPC-attached master-connected bootstrap lambda for the food_app role', () => {
        const template = dataTemplate('sandbox');
        const fns = template.findResources('AWS::Lambda::Function');
        const bootstrap = Object.values(fns).find((fn: any) =>
            String(fn.Properties.Description ?? '').includes('Bootstrap food_app role'),
        ) as any;

        expect(bootstrap.Properties.Description).toBe('Bootstrap food_app role + base database (sandbox)');
        // Connects as master (reads the instance credentials secret) and targets the base food database.
        expect(bootstrap.Properties.Environment.Variables.FOOD_DATABASE_NAME).toBe('kitchensink_food');
        // The env var is wired to the master credentials secret this stack owns (a Ref, not a literal ARN).
        expect(bootstrap.Properties.Environment.Variables.DB_SECRET_ARN).toEqual({
            Ref: expect.stringMatching(/^DatabaseCredentialsSecret[0-9A-F]{8}$/),
        });
        // Must be VPC-attached to reach the PRIVATE_ISOLATED RDS: the shared lambda SG plus both
        // private-app subnets (one per AZ).
        expect(bootstrap.Properties.VpcConfig.SecurityGroupIds).toHaveLength(1);
        expect(bootstrap.Properties.VpcConfig.SubnetIds).toHaveLength(2);
    });

    it('grants the bootstrap lambda read on the master credentials secret', () => {
        const json = JSON.stringify(dataTemplate('sandbox').toJSON());

        expect(json).toContain('secretsmanager:GetSecretValue');
    });

    it('exports the RDS resource id (for food_app rds-db:connect scoping) and no food DB password secret', () => {
        const template = dataTemplate('sandbox');
        const outputs = template.findOutputs('*');
        const exportNames = Object.values(outputs).map((o: any) => o.Export?.Name ?? '');

        expect(exportNames.some((n: string) => n.endsWith(':DatabaseResourceId'))).toBe(true);
        // The password-based food secret + its bootstrap-SQL plan secret are gone (IAM auth, no password).
        expect(exportNames.some((n: string) => n.endsWith(':FoodDbSecretArn'))).toBe(false);
        expect(exportNames.some((n: string) => n.endsWith(':FoodMigrationPlanSecretArn'))).toBe(false);
    });
});

describe('Food DB bootstrap on prod (safety of the merge-time change)', () => {
    it('enables IAM auth and provisions the bootstrap on prod too (STAGE=prod, no CREATEDB at runtime)', () => {
        const template = dataTemplate('prod');

        const instance = Object.values(template.findResources('AWS::RDS::DBInstance'))[0] as any;
        expect(instance.Properties.EnableIAMDatabaseAuthentication).toBe(true);

        const fns = template.findResources('AWS::Lambda::Function');
        const bootstrap = Object.values(fns).find((fn: any) =>
            String(fn.Properties.Description ?? '').includes('Bootstrap food_app role'),
        ) as any;
        expect(bootstrap.Properties.Description).toBe('Bootstrap food_app role + base database (prod)');
        // STAGE=prod is what makes the runtime bootstrap skip the CREATEDB grant (asserted in the
        // handler unit test); per-PR databases never exist on prod.
        expect(bootstrap.Properties.Environment.Variables.STAGE).toBe('prod');
    });
});

describe('RDS deletion protection (owner ruling 2026-08-08)', () => {
    /**
     * Deletion protection is ON for every stage. It costs nothing, and it is the only thing standing between
     * an accidental `cdk destroy`/replacement and total data loss on an instance that has NO Multi-AZ standby
     * and NO safety snapshot (`removalPolicy: DESTROY`, ruled deliberate in feature 003 T-196: one cluster,
     * one AZ, one region until the product makes money).
     *
     * The specific hazard it closes is recorded in ADR-0002: changing the prod VPC CIDR — or any construct id
     * feeding the VPC — REPLACES the prod VPC and its RDS, with no snapshot taken. Deletion protection turns
     * that from silent data loss into a loud CloudFormation failure.
     *
     * SANDBOX IS INCLUDED ON PURPOSE. It is not disposable: it hosts the single shared identity service every
     * PR preview signs in against, and the repo's teardown rules state the shared RDS must never be torn down.
     * Per-PR cleanup works on LOGICAL databases inside this instance and on `Environment=pr-{N}` resources, so
     * protecting the instance cannot block it.
     *
     * ⚠️ CONSEQUENCE, deliberate: with protection on and `removalPolicy: DESTROY` retained, a genuine teardown
     * FAILS until someone disables protection first. That extra step is the feature, not a defect — it is what
     * makes destroying a database an explicit act rather than a side effect of a rename.
     */
    it('enables deletionProtection on the DB instance in EVERY stage', () => {
        for (const stage of ['prod', 'sandbox', 'dev']) {
            dataTemplate(stage).hasResourceProperties('AWS::RDS::DBInstance', {
                DeletionProtection: true,
            });
        }
    });

    it('keeps Multi-AZ off, so protection is not mistaken for redundancy', () => {
        // T-196 closed Multi-AZ as WON'T DO. Deletion protection guards against deletion, not an AZ failure;
        // recovery from a zone loss is still restore-from-snapshot. Pinning both together keeps the pair of
        // facts in one place rather than letting someone read "protected" as "highly available".
        for (const stage of ['prod', 'sandbox']) {
            dataTemplate(stage).hasResourceProperties('AWS::RDS::DBInstance', {
                DeletionProtection: true,
                MultiAZ: false,
            });
        }
    });
});
