/**
 * Fixtures for the cdk-nag advisory-mode suites (U9).
 *
 * `makeNonCompliantStack` is deliberately non-compliant: every resource here trips at least one
 * ERROR-level `AwsSolutions` rule, so a suite that expects findings cannot pass vacuously (e.g. because
 * the Aspect silently never ran). It is intentionally NOT a copy of any real stack — the real prod
 * stacks are exercised by `@kitchensink/infra-global`'s template-parity suite.
 */
import { Duration, Stack, type StackProps } from 'aws-cdk-lib';
import { Effect, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Code, Function as LambdaFunction, Runtime } from 'aws-cdk-lib/aws-lambda';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import type { Construct } from 'constructs';

/**
 * A stack whose every resource violates at least one AwsSolutions rule:
 * S3 without access logs or an SSL-only policy, SQS without SSE or a DLQ, an IAM role holding a
 * wildcard permission, and a Lambda on a runtime the pack flags.
 */
export const makeNonCompliantStack = (scope: Construct, id: string, props?: StackProps): Stack => {
    const stack = new Stack(scope, id, props);

    new Bucket(stack, 'NoLogsBucket');
    new Queue(stack, 'NoDlqQueue', { visibilityTimeout: Duration.seconds(30) });

    const role = new Role(stack, 'WildcardRole', { assumedBy: new ServicePrincipal('lambda.amazonaws.com') });

    role.addToPolicy(new PolicyStatement({ effect: Effect.ALLOW, actions: ['s3:*'], resources: ['*'] }));

    new LambdaFunction(stack, 'PlainFunction', {
        runtime: Runtime.NODEJS_18_X,
        handler: 'index.handler',
        code: Code.fromInline('exports.handler = async () => ({});'),
        role,
    });

    return stack;
};
