/**
 * ADR-0064: the owner-only stack that holds every permissions boundary and CloudFormation execution policy.
 *
 * The stack is a RENDERING of `@kitchensink/cdk-bootstrap`'s policy modules, never a second statement of them:
 * each synthesized managed policy must equal the module's output for that policy name, so a change to a module
 * reaches the account only through this stack and a hand-edit of the stack cannot widen anything unnoticed.
 */
import { CliCredentialsStackSynthesizer } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { buildBoundary } from '@kitchensink/cdk-bootstrap/boundary';
import { buildExecutionPolicy } from '@kitchensink/cdk-bootstrap/executionPolicy';
import { MANAGED_POLICY_LIMIT, managedPolicySize, renderDocument } from '@kitchensink/cdk-bootstrap/policyDocument';
import {
    QUALIFIERS,
    STACK_NAME_PATTERNS,
    boundaryPolicyName,
    type QualifierName,
} from '@kitchensink/cdk-bootstrap/qualifiers';
import { describe, expect, it } from 'vitest';

import {
    CI_POLICIES_STACK_NAME,
    CiExecutionPolicyStack,
    boundaryPolicyArn,
    executionPolicyArns,
} from '../lib/platform/CiExecutionPolicyStack.js';
import { iamResourceMatches } from './iamGlob.js';
import { testApp } from './testApp.js';

const env = { account: '123456789012', region: 'us-east-1' };
const context = { account: env.account, region: env.region };
const qualifiers = Object.values(QUALIFIERS) as readonly QualifierName[];

type Json = Record<string, unknown>;

const stack = new CiExecutionPolicyStack(testApp(), 'CiExecutionPolicy', { env, stackName: CI_POLICIES_STACK_NAME });
const template = Template.fromStack(stack);

const synthesized: Record<string, Json> = Object.fromEntries(
    Object.values(template.findResources('AWS::IAM::ManagedPolicy')).map((resource) => {
        const props = resource['Properties'] as Json;

        return [props['ManagedPolicyName'] as string, props];
    }),
);

/**
 * CloudFormation (via CDK's `PolicyDocument`) writes a one-element list as its element. The two spell the same
 * policy, so both sides are compared in one canonical form. Nothing else is normalised: order, effect, resource
 * and condition must match exactly.
 */
const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) {
        const items = value.map(canonical);

        return items.length === 1 ? items[0] : items;
    }

    if (value !== null && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, canonical(entry)]));
    }

    return value;
};

const expected = qualifiers.flatMap((qualifier) => [
    { name: boundaryPolicyName(qualifier), document: buildBoundary(qualifier) },
    ...buildExecutionPolicy(qualifier).map((part) => ({ name: part.policyName, document: part.document })),
]);

describe('CiExecutionPolicyStack', () => {
    it('holds exactly the boundary and execution policies of the three qualifiers, and nothing else', () => {
        expect(expected.length).toBeGreaterThan(15);
        expect(Object.keys(synthesized).sort()).toEqual(expected.map((policy) => policy.name).sort());
        expect(Object.keys(template.toJSON()['Resources'] as Json)).toHaveLength(expected.length);
    });

    it.each(expected)('$name: the synthesized document equals the module output', ({ name, document }) => {
        expect(canonical(synthesized[name]?.['PolicyDocument'])).toEqual(canonical(renderDocument(document, context)));
    });

    it.each(expected)('$name: is within IAM managed-policy size', ({ name }) => {
        const size = managedPolicySize(synthesized[name]?.['PolicyDocument'] as never);

        expect(size).toBeGreaterThan(0);
        expect(size).toBeLessThan(MANAGED_POLICY_LIMIT);
    });

    it('sets no path, so the ARNs the runbook passes to `cdk bootstrap` are predictable', () => {
        for (const props of Object.values(synthesized)) {
            expect(props['Path'] ?? '/').toBe('/');
        }
    });

    it.each(qualifiers)('%s: the ARN helpers name the synthesized policies', (qualifier) => {
        const arns = executionPolicyArns(qualifier, env.account);

        expect(arns.length).toBe(buildExecutionPolicy(qualifier).length);
        // A role takes at most 10 managed policies by default; the bootstrap execution role is that role.
        expect(arns.length).toBeLessThanOrEqual(10);

        for (const arn of arns) {
            expect(arn).toMatch(/^arn:aws:iam::123456789012:policy\/kitchensink-ci-exec-/u);
            expect(Object.keys(synthesized)).toContain(arn.split('/').at(-1));
        }

        expect(boundaryPolicyArn(qualifier, env.account)).toBe(
            `arn:aws:iam::123456789012:policy/${boundaryPolicyName(qualifier)}`,
        );
        expect(Object.keys(synthesized)).toContain(boundaryPolicyName(qualifier));
    });

    it('is created with the deploying CLI credentials, not through a bootstrap role', () => {
        expect(stack.synthesizer).toBeInstanceOf(CliCredentialsStackSynthesizer);
    });

    it('is deployable by NO qualifier: no deploy role may reach a stack of this name', () => {
        expect(CI_POLICIES_STACK_NAME).toMatch(/^kitchensink-[a-z-]+$/u);

        for (const qualifier of qualifiers) {
            for (const pattern of STACK_NAME_PATTERNS[qualifier]) {
                expect(iamResourceMatches(pattern, CI_POLICIES_STACK_NAME)).toBe(false);
            }
        }
    });
});
