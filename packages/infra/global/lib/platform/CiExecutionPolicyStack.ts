/**
 * The managed policies that cap what CI can do through KitchenSink's own CDK bootstrap qualifiers (ADR-0064).
 *
 * ## What it holds
 *
 * For each of the three qualifiers (`ksnonprod`, `ksprod`, `ksaccount`): one permissions-boundary policy and the
 * managed policies that together are the CloudFormation EXECUTION role's permissions. They must exist BEFORE
 * `cdk bootstrap` (the bootstrap template attaches them by ARN), which is why they cannot live in a stack that a
 * bootstrapped role deploys.
 *
 * ## ⛔ OWNER-ONLY — no workflow deploys this stack, and no CI role can
 *
 * A role that could deploy this stack could rewrite its own execution policy and boundary, which is exactly the
 * privilege the policies exist to remove. Three structural properties keep it out of CI's reach:
 *
 * - it uses {@link CliCredentialsStackSynthesizer}: the owner's own admin session creates it, with no bootstrap
 *   role in the path (so it does not even depend on the shared default bootstrap another application owns);
 * - `bin/account.ts` constructs it ONLY under the CDK context flag `ciPoliciesOwnerDeploy`, which no workflow
 *   passes, so `accountDeploy.yml`'s `cdk deploy --all` cannot see it;
 * - {@link CI_POLICIES_STACK_NAME} matches no qualifier's `STACK_NAME_PATTERNS`, so not even `ksaccount`'s deploy
 *   role may touch it. `ciPolicyStackOwnerOnly.test.ts` asserts all three.
 *
 * ## One source of truth
 *
 * Nothing here states a permission. Every document is rendered from `@kitchensink/cdk-bootstrap`'s
 * `buildBoundary` / `buildExecutionPolicy`, and `CiExecutionPolicyStack.test.ts` holds the synthesized result
 * equal to those modules' output.
 *
 * @pattern Adapter — renders the bootstrap package's policy tables as CloudFormation managed policies
 */
import { CliCredentialsStackSynthesizer, Stack, type StackProps, aws_iam as iam } from 'aws-cdk-lib';
import type { Construct } from 'constructs';

import { buildBoundary } from '@kitchensink/cdk-bootstrap/boundary';
import { buildExecutionPolicy } from '@kitchensink/cdk-bootstrap/executionPolicy';
import { renderDocument, type PolicyDocument } from '@kitchensink/cdk-bootstrap/policyDocument';
import { QUALIFIERS, boundaryPolicyName, type QualifierName } from '@kitchensink/cdk-bootstrap/qualifiers';

/**
 * The CloudFormation stack name. ⛔ A rename is safe only while it still matches NO qualifier's
 * `STACK_NAME_PATTERNS` (asserted); never name it `kitchensink-*-prod`, `-sandbox` or `-pr-N`.
 */
export const CI_POLICIES_STACK_NAME = 'kitchensink-ci-policies';

/** The CDK context flag under which `bin/account.ts` constructs this stack. No workflow sets it. */
export const CI_POLICIES_CONTEXT_FLAG = 'ciPoliciesOwnerDeploy';

const QUALIFIER_LIST = Object.values(QUALIFIERS);

const policyArn = (account: string, policyName: string): string => `arn:aws:iam::${account}:policy/${policyName}`;

/**
 * The ARNs of the managed policies that make up one qualifier's execution role, in the order
 * `--cloudformation-execution-policies` should list them.
 *
 * @returns The ARNs. Pure.
 */
export function executionPolicyArns(qualifier: QualifierName, account: string): readonly string[] {
    return buildExecutionPolicy(qualifier).map((part) => policyArn(account, part.policyName));
}

/**
 * The ARN of one qualifier's permissions boundary.
 *
 * @returns The ARN. Pure.
 */
export function boundaryPolicyArn(qualifier: QualifierName, account: string): string {
    return policyArn(account, boundaryPolicyName(qualifier));
}

/** The owner-only stack of boundary and execution managed policies for every KitchenSink bootstrap qualifier. */
export class CiExecutionPolicyStack extends Stack {
    public constructor(scope: Construct, id: string, props: StackProps = {}) {
        super(scope, id, { ...props, synthesizer: new CliCredentialsStackSynthesizer() });

        const context = { account: this.account, region: this.region };
        const render = (document: PolicyDocument): iam.PolicyDocument =>
            iam.PolicyDocument.fromJson(renderDocument(document, context));

        for (const qualifier of QUALIFIER_LIST) {
            new iam.ManagedPolicy(this, `Boundary-${qualifier}`, {
                managedPolicyName: boundaryPolicyName(qualifier),
                description: `Permissions boundary for every role a ${qualifier} stack creates (ADR-0064).`,
                document: render(buildBoundary(qualifier)),
            });

            for (const part of buildExecutionPolicy(qualifier)) {
                new iam.ManagedPolicy(this, `Exec-${qualifier}-${part.name}`, {
                    managedPolicyName: part.policyName,
                    description: `CloudFormation execution policy (${part.name}) for the ${qualifier} bootstrap (ADR-0064).`,
                    document: render(part.document),
                });
            }
        }
    }
}
