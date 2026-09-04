// @vitest-environment node
/**
 * ⛔ THE REAPER IS SANDBOX-ONLY, AND THAT IS ASSERTED IN BOTH DIRECTIONS (ADR-0030).
 *
 * `PerPrDatabaseReaperFunction` connects to the shared RDS as the MASTER user and issues `DROP DATABASE`.
 * ADR-0030's whole argument for accepting a prod/sandbox template divergence — which ADR-0028 otherwise
 * argues against — is that production has no per-PR logical databases at all (ADR-0006 grants its
 * `food_app`/`recipe_app` roles no `CREATEDB`), so in prod the function would be dead code carrying a live
 * risk. That argument is only worth anything if the guard actually holds, so it is a test rather than a
 * comment:
 *
 *  - **prod synthesizes NO reaper** — no function, no output, no grant. A regression here is not a tidiness
 *    problem, it is a master-credentialed `DROP DATABASE` capability in production.
 *  - **every non-prod stage DOES synthesize one.** The other direction matters just as much: a guard that
 *    only checked prod would pass a change that removed the reaper everywhere, which is how the recipe
 *    drop door came to exist and never be called.
 *
 * ⚠️ The nag census (`nagRulesAtZero.integration.test.ts`) synthesizes every app under `STAGE=prod`, so it
 * cannot see this function at all — which is exactly why the IAM4 findings ADR-0013 records do not move.
 * That is a real coverage hole for every sandbox-only construct (`SandboxSchedulerStack` sits in it too),
 * recorded in ADR-0030 rather than papered over; this file is the coverage that is available.
 */
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';

import { DataStack } from '../lib/platform/DataStack.js';
import { NetworkStack } from '../lib/platform/NetworkStack.js';

const env = { account: '123456789012', region: 'us-east-1' };

/**
 * How the reaper is identified in a template.
 *
 * ⚠️ By DESCRIPTION, not by `Handler`. `DataStack` renders a loud inline stub when `dist-lambda/` is absent
 * (a bare `cdk synth`, and every unit run), so the handler string is a function of whether a bundle happens
 * to exist — the same reasoning `DataStack.test.ts` already applies to the two bootstrap functions. That the
 * handler string and the esbuild entry point AGREE is a different claim, asserted from the sources in
 * `globalBootstrapBundle.test.ts`.
 */
const REAPER_DESCRIPTION = /per-PR logical databases/;

const dataTemplate = (stage: string): Template => {
    const app = new App();
    const network = new NetworkStack(app, `Net-${stage}`, { env, stage });

    return Template.fromStack(new DataStack(app, `Data-${stage}`, { env, network, stage }));
};

/** Every Lambda in the template that is the reaper, whatever CDK named the resource. */
const reaperFunctions = (template: Template): readonly unknown[] =>
    Object.values(template.findResources('AWS::Lambda::Function')).filter((resource) =>
        REAPER_DESCRIPTION.test(
            String((resource as { Properties?: { Description?: string } }).Properties?.Description ?? ''),
        ),
    );

describe('the per-PR database reaper is NEVER synthesized for prod (ADR-0030)', () => {
    const prod = dataTemplate('prod');

    it('creates no function carrying the reaper handler', () => {
        expect(reaperFunctions(prod)).toEqual([]);
    });

    it('publishes no reaper output for anything to invoke', () => {
        expect(Object.keys(prod.findOutputs('*'))).not.toContain('PerPrDatabaseReaperFunctionName');
    });

    it('names the reaper nowhere in the prod template at all', () => {
        // The broadest form of the claim, and the one that survives a rename of either the construct or the
        // output: prod's template must not mention this capability in any shape. `ADR-0030` rather than the
        // handler path, because the handler is the inline stub whenever `dist-lambda/` is absent.
        expect(JSON.stringify(prod.toJSON())).not.toContain('ADR-0030');
        expect(JSON.stringify(prod.toJSON())).not.toContain('PerPrDatabaseReaper');
    });
});

describe('every non-prod stage DOES get a reaper (ADR-0030)', () => {
    it.each(['sandbox', 'dev', 'test'])('%s synthesizes exactly one', (stage) => {
        expect(reaperFunctions(dataTemplate(stage))).toHaveLength(1);
    });

    it('publishes the function name, so teardown can invoke it without knowing CDK’s logical id', () => {
        // The export is `{stackName}:PerPrDatabaseReaperFunctionName`. This app does not pass a `stackName`,
        // so the prefix is CDK's construct id rather than `kitchensink-data-sandbox`; what matters, and what
        // the teardown reads, is the SUFFIX.
        const output = dataTemplate('sandbox').findOutputs('PerPrDatabaseReaperFunctionName');

        expect(Object.keys(output)).toHaveLength(1);
        expect(String(output['PerPrDatabaseReaperFunctionName']?.Export?.Name)).toMatch(
            /:PerPrDatabaseReaperFunctionName$/,
        );
    });

    it('is VPC-attached, because the RDS is PRIVATE_ISOLATED', () => {
        // Without this the function resolves the endpoint and times out — the same failure mode ADR-0004
        // records for every other DB-bound Lambda. It also makes the reaper a NAT consumer, which ADR-0004's
        // table must name (asserted by `natEgressConsumers.test.ts`).
        const [reaper] = reaperFunctions(dataTemplate('sandbox')) as [{ Properties: { VpcConfig?: unknown } }];

        // Both halves: the shared lambda SG, and one private-app subnet per AZ.
        expect(reaper.Properties.VpcConfig).toEqual(
            expect.objectContaining({
                SecurityGroupIds: expect.any(Array),
                SubnetIds: expect.any(Array),
            }),
        );
        expect((reaper.Properties.VpcConfig as { SubnetIds: unknown[] }).SubnetIds).toHaveLength(2);
    });

    it('carries its own STAGE, which is what the handler’s runtime prod refusal reads', () => {
        const [reaper] = reaperFunctions(dataTemplate('sandbox')) as [
            { Properties: { Environment: { Variables: Record<string, unknown> } } },
        ];

        expect(reaper.Properties.Environment.Variables['STAGE']).toBe('sandbox');
    });

    it('is pointed at the shared instance and the master credentials secret', () => {
        const [reaper] = reaperFunctions(dataTemplate('sandbox')) as [
            { Properties: { Environment: { Variables: Record<string, unknown> } } },
        ];
        const variables = reaper.Properties.Environment.Variables;

        // A `Ref` to the secret this stack owns, never a literal ARN — the same assertion
        // `DataStack.test.ts` makes of the bootstrap functions.
        expect(variables['DB_SECRET_ARN']).toEqual({
            Ref: expect.stringMatching(/^DatabaseCredentialsSecret[0-9A-F]{8}$/),
        });
        expect(variables['DB_ENDPOINT']).toBeDefined();
        expect(variables['DB_PORT']).toBeDefined();
    });

    it('⛔ does NOT publish a `*MigrationFunctionName` output — it is not a per-service drop door', () => {
        // `perPrDatabaseDropDoors.test.ts` discovers migration runners by that exact shape. A reaper output
        // that matched it would be counted as a service's own door and would confuse both guards.
        const outputs = Object.keys(dataTemplate('sandbox').findOutputs('*'));

        expect(outputs.filter((key) => /MigrationFunctionName$/.test(key))).toEqual([]);
    });
});
