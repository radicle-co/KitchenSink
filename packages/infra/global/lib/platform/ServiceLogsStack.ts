import { CfnOutput, Stack, type StackProps } from 'aws-cdk-lib';
import * as logs from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';

/**
 * Log groups that must OUTLIVE the stack whose containers write to them.
 *
 * ## Why a stack exists for this
 *
 * A CloudFormation stack is the unit of create-and-delete, so "this resource must survive that stack" is a
 * statement about stack boundaries — not a detail to tuck inside whichever stack happens to use it. That is
 * the whole reason this is separate rather than a log group hidden in `NetworkStack`.
 *
 * ADR-0028's 2026-08-30 amendment made `kitchensink-identity-service-{stage}` RECLAIMABLE: deleted when the
 * last sandbox expires, rebuilt by the button, so the shared ALB it pins can be released. The identity
 * service owned its own ECS log group and exported the name; `WebhooksStack` — which must SURVIVE, because
 * `e2e-web`'s Clerk fixture blocks on that webhook — imported it to hang a log-drain `SubscriptionFilter`.
 *
 * CloudFormation refuses that outright, and said so on the first real reclaim:
 *
 *     Delete canceled. Cannot delete export
 *       kitchensink-identity-service-sandbox:IdentityServiceLogGroupName
 *     as it is in use by kitchensink-identity-webhooks-sandbox.
 *
 * A persistent stack was importing from a reclaimable one. Moving the group here fixes the DIRECTION rather
 * than the symptom: both consumers now import from a stack that outlives them both.
 *
 * ⛔ Why HERE and not the other way round. The obvious alternative is to invert the import — let the identity
 * stack create the `SubscriptionFilter`, importing the forwarder Lambda ARN from `WebhooksStack`. That
 * reverses the prod deploy order of two stacks, and ADR-0022 is explicit that reordering that pipeline
 * trades schema skew for message-contract skew on the right-to-erasure path. This stack is a child of
 * `GlobalStack`, which already deploys before both consumers, so the existing order is untouched.
 *
 * ⛔ And why not simply give the group a literal name both sides hard-code. That removes the CloudFormation
 * edge but not the problem: the group would still be DELETED with the identity service, leaving the
 * surviving `SubscriptionFilter` pointing at nothing and the drain silently dead after the first reap.
 *
 * ## The name is explicit on purpose
 *
 * A CDK-generated log group name embeds the creating stack's logical id, which is precisely the coupling
 * being removed. A stable `/kitchensink/{service}/{stage}` path also means log history survives a sandbox
 * teardown, which the amendment had listed as an accepted loss and no longer is.
 */
export interface ServiceLogsStackProps extends StackProps {
    /** Deployment stage — `prod`, `sandbox`, … */
    readonly stage: string;
}

/**
 * The log group path for a service's container logs at a given stage.
 *
 * @param service - Service slug, e.g. `identity-service`.
 * @param stage - Deployment stage.
 * @returns The CloudWatch log group name. Pure.
 */
export function serviceLogGroupName(service: string, stage: string): string {
    return `/kitchensink/${service}/${stage}`;
}

/** Log groups shared between a reclaimable writer and a persistent drain. */
export class ServiceLogsStack extends Stack {
    /** The identity service's ECS container log group. */
    public readonly identityServiceLogGroup: logs.LogGroup;

    public constructor(scope: Construct, id: string, props: ServiceLogsStackProps) {
        super(scope, id, props);

        const { stage } = props;

        this.identityServiceLogGroup = new logs.LogGroup(this, 'IdentityServiceLogGroup', {
            logGroupName: serviceLogGroupName('identity-service', stage),
            // Unchanged from the group this replaces — this stack moves ownership, not policy.
            retention: logs.RetentionDays.ONE_MONTH,
        });

        new CfnOutput(this, 'IdentityServiceLogGroupName', {
            value: this.identityServiceLogGroup.logGroupName,
            exportName: `${this.stackName}:IdentityServiceLogGroupName`,
        });
    }
}
