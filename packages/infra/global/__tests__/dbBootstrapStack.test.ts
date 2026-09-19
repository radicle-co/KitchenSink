// @vitest-environment node
/**
 * `DataStack`'s database bootstrap after the role split: ONE master-connected function, THREE custom resources —
 * identity, food, recipe — serialized, each re-run when the role model it applies changes.
 *
 * Why each assertion is here:
 *
 * - **one function** — the two per-service bootstraps (`food-db-bootstrap`, `recipe-db-bootstrap`) were the same code
 *   twice, and identity had none; ADR-0004's NAT-consumer table counts exactly one.
 * - **serialized** — every pass rewrites the cluster-wide role catalog as the master; two at once race on it.
 * - **after the instance** — `GRANT rds_iam` needs the instance's IAM-auth setting applied first.
 * - **`roleModelDigest`** — CloudFormation re-invokes a custom resource only when its properties change, so a changed
 *   statement list must change a property or the new model never reaches a deployed stage.
 * - **600 s** — BELOW the provider framework's own 900 s, so the framework never times out first and lets Lambda's
 *   async retry start a second pass beside a live one; the armed pass drops, recreates and re-owns in seconds.
 */
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';

import { DataStack } from '../lib/platform/DataStack.js';
import { NetworkStack } from '../lib/platform/NetworkStack.js';
import { testApp } from './testApp.js';

const env = { account: '123456789012', region: 'us-east-1' };

const dataTemplate = (stage: string): Template => {
    const app = testApp();
    const network = new NetworkStack(app, `Net-${stage}`, { env, stage });

    return Template.fromStack(new DataStack(app, `Data-${stage}`, { env, network, stage }));
};

type Resource = {
    readonly Type: string;
    readonly Properties: Record<string, unknown>;
    readonly DependsOn?: string | readonly string[];
};

const dependsOn = (resource: Resource): readonly string[] => ([] as string[]).concat(resource.DependsOn ?? []);

/** The three bootstrap custom resources, keyed by the service they name. */
function bootstrapResources(template: Template): Record<string, { readonly id: string; readonly resource: Resource }> {
    const entries = Object.entries(template.toJSON().Resources as Record<string, Resource>).filter(
        ([, resource]) => resource.Type === 'AWS::CloudFormation::CustomResource' && 'service' in resource.Properties,
    );

    return Object.fromEntries(
        entries.map(([id, resource]) => [String(resource.Properties['service']), { id, resource }]),
    );
}

describe.each(['sandbox', 'prod'])('the %s database bootstrap', (stage) => {
    const template = dataTemplate(stage);
    const resources = bootstrapResources(template);

    it('is ONE VPC-attached function connected as the master, with 600 s to finish', () => {
        const functions = Object.values(template.findResources('AWS::Lambda::Function')).filter((fn) =>
            String(fn.Properties.Description ?? '').startsWith('Bootstrap the database role model'),
        );

        expect(functions).toHaveLength(1);

        const fn = functions[0]!;

        expect(fn.Properties.Description).toBe(`Bootstrap the database role model (${stage})`);
        expect(fn.Properties.Timeout).toBe(600);
        expect(fn.Properties.Environment.Variables.STAGE).toBe(stage);
        expect(fn.Properties.Environment.Variables.DB_SECRET_ARN).toEqual({
            Ref: expect.stringMatching(/^DatabaseCredentialsSecret[0-9A-F]{8}$/u),
        });
        expect(fn.Properties.VpcConfig.SubnetIds).toHaveLength(2);
    });

    it('declares the two per-service bootstraps no more', () => {
        const ids = Object.keys(template.toJSON().Resources as object);

        expect(ids.filter((id) => /^(Food|Recipe)DbBootstrap/u.test(id))).toEqual([]);
    });

    it('has one custom resource per database, naming its service and database', () => {
        expect(
            Object.fromEntries(
                Object.entries(resources).map(([service, { resource }]) => [service, resource.Properties['database']]),
            ),
        ).toEqual({ identity: 'kitchensink_identity', food: 'kitchensink_food', recipe: 'kitchensink_recipes' });
    });

    it('runs them one at a time — identity, then food, then recipe — each after the instance', () => {
        const instance = Object.keys(template.findResources('AWS::RDS::DBInstance'))[0]!;
        const { identity, food, recipe } = resources;

        expect(dependsOn(identity!.resource)).toContain(instance);
        expect(dependsOn(food!.resource)).toEqual(expect.arrayContaining([instance, identity!.id]));
        expect(dependsOn(recipe!.resource)).toEqual(expect.arrayContaining([instance, food!.id]));
    });

    it('stamps a roleModelDigest on each, so a changed statement list re-runs it', () => {
        expect(Object.keys(resources)).toHaveLength(3);

        for (const { resource } of Object.values(resources)) {
            expect(resource.Properties['roleModelDigest']).toMatch(/^[0-9a-f]{64}$/u);
        }
    });
});

describe('roleModelDigest', () => {
    it('differs between prod and sandbox — the two stages apply different statements', () => {
        const sandbox = bootstrapResources(dataTemplate('sandbox'));
        const prod = bootstrapResources(dataTemplate('prod'));

        expect(prod['food']!.resource.Properties['roleModelDigest']).not.toBe(
            sandbox['food']!.resource.Properties['roleModelDigest'],
        );
    });

    it('differs between services — each database has its own roles', () => {
        const sandbox = bootstrapResources(dataTemplate('sandbox'));
        const digests = new Set(Object.values(sandbox).map(({ resource }) => resource.Properties['roleModelDigest']));

        expect(digests.size).toBe(3);
    });
});
