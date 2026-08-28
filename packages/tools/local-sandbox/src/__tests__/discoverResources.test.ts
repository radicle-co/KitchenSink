import { describe, expect, it } from 'vitest';

import { discoverResources, summarizeRequirements } from '../discoverResources.js';
import { LOCAL_SUPPORT } from '../localSupport.js';

const template = (resources: Record<string, { Type: unknown }>): { Resources: typeof resources } => ({
    Resources: resources,
});

describe('discoverResources', () => {
    it('reduces a template to one entry per declared resource, carrying the stack', () => {
        const found = discoverResources('recipe-workers', template({ Q: { Type: 'AWS::SQS::Queue' } }));

        expect(found).toEqual([
            {
                stack: 'recipe-workers',
                logicalId: 'Q',
                type: 'AWS::SQS::Queue',
                support: { kind: 'localstack', service: 'sqs' },
            },
        ]);
    });

    it('SKIPS a resource with no usable Type rather than inventing one', () => {
        // ⚠️ A template this malformed is a CDK bug. Guessing a type would put a fictional resource in the
        // report, which is worse than the omission — someone would go looking for it.
        expect(discoverResources('s', template({ A: { Type: 42 }, B: { Type: 'AWS::SQS::Queue' } }))).toHaveLength(1);
    });

    it('reports an UNKNOWN type rather than dropping it', () => {
        const [found] = discoverResources('s', template({ X: { Type: 'AWS::Quantum::Entangler' } }));

        expect(found?.support).toBeUndefined();
    });
});

describe('summarizeRequirements', () => {
    const at = (type: string): { stack: string; logicalId: string; type: string; support: undefined } => ({
        stack: 's',
        logicalId: 'L',
        type,
        support: undefined,
    });

    it('folds localstack services and containers, de-duplicated and sorted', () => {
        const summary = summarizeRequirements(
            discoverResources(
                's',
                template({
                    A: { Type: 'AWS::SQS::Queue' },
                    B: { Type: 'AWS::SQS::Queue' },
                    C: { Type: 'AWS::S3::Bucket' },
                    D: { Type: 'AWS::RDS::DBInstance' },
                }),
            ),
        );

        expect(summary.localstackServices).toEqual(['s3', 'sqs']);
        expect(summary.containers).toEqual(['postgres:18']);
    });

    /**
     * ⛔ THE ASSERTION THE WHOLE MODULE EXISTS FOR. A type nobody has decided how to run locally must
     * SURFACE, not be silently skipped — otherwise a local sandbox quietly stops covering new
     * infrastructure and every run stays green while drifting further from what deploys.
     */
    it('surfaces a type the support table has never seen', () => {
        const summary = summarizeRequirements([at('AWS::Quantum::Entangler')]);

        expect(summary.undecided).toEqual(['AWS::Quantum::Entangler']);
    });

    it('carries the REASON a type cannot be emulated, so a local run never claims to cover it', () => {
        const summary = summarizeRequirements(
            discoverResources('s', template({ B: { Type: 'AWS::Bedrock::ApplicationInferenceProfile' } })),
        );

        expect(summary.unsupported).toHaveLength(1);
        expect(summary.unsupported[0]?.why).toContain('Bedrock');
    });

    it('asks for NOTHING for a resource with no local runtime behaviour', () => {
        const summary = summarizeRequirements(discoverResources('s', template({ R: { Type: 'AWS::IAM::Role' } })));

        expect(summary).toEqual({
            localstackServices: [],
            containers: [],
            services: [],
            migrations: [],
            unsupported: [],
            undecided: [],
        });
    });
});

describe('the support table itself', () => {
    it('is big enough to be a real table, not a stub', () => {
        // Anti-vacuity: an empty table would make every "undecided" assertion above pass for the wrong reason.
        expect(Object.keys(LOCAL_SUPPORT).length).toBeGreaterThan(15);
    });

    it('gives every unsupported and not-needed entry a written REASON', () => {
        // ⛔ A reader must be able to tell "we decided not to emulate this" from "nobody thought about it",
        // and only a written reason does that. An empty string would pass a presence check and say nothing.
        const unreasoned = Object.entries(LOCAL_SUPPORT).filter(([, support]) => {
            const needsWhy = support.kind === 'unsupported' || support.kind === 'not-needed';

            return needsWhy && (!('why' in support) || support.why.trim().length < 10);
        });

        expect(unreasoned.map(([type]) => type)).toEqual([]);
    });
});

describe('the kinds that carry per-resource detail', () => {
    /**
     * ⛔ Guards the fix for a field that lied. `AWS::ECS::TaskDefinition` used to map to
     * `{ kind: 'container', image: 'built-from-the-service-Dockerfile' }` — prose in a field typed as an
     * image, which the audit then printed under `containers:` as if it were a docker reference. Anything
     * that trusted the type would have tried to pull it.
     */
    it('collects OUR services as resources, not as an image string', () => {
        const summary = summarizeRequirements(
            discoverResources('recipe', template({ T: { Type: 'AWS::ECS::TaskDefinition' } })),
        );

        expect(summary.containers).toEqual([]);
        expect(summary.services).toEqual([
            { stack: 'recipe', logicalId: 'T', type: 'AWS::ECS::TaskDefinition', support: { kind: 'service' } },
        ]);
    });

    it('collects the ADR-0022 migration trigger separately, because it must run BEFORE services start', () => {
        const summary = summarizeRequirements(
            discoverResources('recipe', template({ M: { Type: 'Custom::Trigger' } })),
        );

        expect(summary.containers).toEqual([]);
        expect(summary.migrations.map((m) => m.logicalId)).toEqual(['M']);
    });

    it('every container image is a real, pullable reference — no prose', () => {
        // A pullable reference is `name[:tag]`, never a sentence. This is what makes the field trustworthy.
        for (const entry of Object.values(LOCAL_SUPPORT)) {
            if (entry.kind === 'container') {
                expect(entry.image).toMatch(/^[a-z0-9][a-z0-9._/-]*(:[\w.-]+)?$/u);
                expect(entry.image).not.toMatch(/\s/u);
            }
        }
    });
});
