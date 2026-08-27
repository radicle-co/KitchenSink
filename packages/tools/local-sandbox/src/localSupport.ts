/**
 * @module localSupport — which CloudFormation resource types a local sandbox can stand in for.
 *
 * ⛔ THE TABLE IS THE KNOWLEDGE, AND IT IS TOTAL OVER WHAT WE DEPLOY. Every entry says how a type is
 * emulated locally, or states plainly that it cannot be — and "cannot be" is a first-class answer, not a
 * gap. A local sandbox that silently omits a resource class is worse than one that refuses to claim it: the
 * first produces a green local run against infrastructure that does not exist, the second sends you to CI.
 *
 * ⚠️ It is keyed on the CFN TYPE rather than on a service name, because the type is what a synthesised
 * template actually carries. Deriving the inventory from the template is the whole point — a hand-kept list
 * of "the services we have" is the thing that rots, and this repo has the scars: `natEgressConsumers` was
 * written around four Lambdas and had grown to seventeen before anyone noticed.
 */

/** How a deployed resource type is (or is not) stood up locally. */
export type LocalSupport =
    /** LocalStack emulates it. The string is the `SERVICES` entry that must be enabled. */
    | { readonly kind: 'localstack'; readonly service: string }
    /** A container stands in for it. */
    | { readonly kind: 'container'; readonly image: string }
    /** Nothing local is needed — the resource has no runtime behaviour to emulate. */
    | { readonly kind: 'not-needed'; readonly why: string }
    /** It cannot be emulated. Stated, never silently skipped. */
    | { readonly kind: 'unsupported'; readonly why: string };

/**
 * ⛔ EXPLICIT, and every "unsupported" carries its reason. A reader must be able to tell "we chose not to
 * emulate this" from "nobody thought about it", and only a written reason does that.
 */
export const LOCAL_SUPPORT: Readonly<Record<string, LocalSupport>> = Object.freeze({
    'AWS::S3::Bucket': { kind: 'localstack', service: 's3' },
    'AWS::SQS::Queue': { kind: 'localstack', service: 'sqs' },
    'AWS::SNS::Topic': { kind: 'localstack', service: 'sns' },
    'AWS::SSM::Parameter': { kind: 'localstack', service: 'ssm' },
    'AWS::SecretsManager::Secret': { kind: 'localstack', service: 'secretsmanager' },
    'AWS::Events::Rule': { kind: 'localstack', service: 'events' },
    'AWS::Logs::LogGroup': { kind: 'localstack', service: 'logs' },
    'AWS::DynamoDB::Table': { kind: 'localstack', service: 'dynamodb' },
    'AWS::RDS::DBInstance': { kind: 'container', image: 'postgres:18' },
    'AWS::Lambda::Function': { kind: 'localstack', service: 'lambda' },
    'AWS::ECS::Service': { kind: 'container', image: 'built-from-the-service-Dockerfile' },

    // ⚠️ NOT NEEDED rather than unsupported: these shape a deployed network or an identity, and a local
    // process reaches localhost directly. Emulating them would add ceremony that proves nothing.
    'AWS::IAM::Role': { kind: 'not-needed', why: 'a local process is not authorised by IAM' },
    'AWS::IAM::Policy': { kind: 'not-needed', why: 'a local process is not authorised by IAM' },
    'AWS::EC2::VPC': { kind: 'not-needed', why: 'local processes reach each other over localhost' },
    'AWS::EC2::Subnet': { kind: 'not-needed', why: 'local processes reach each other over localhost' },
    'AWS::EC2::SecurityGroup': { kind: 'not-needed', why: 'nothing is filtering localhost' },
    'AWS::ElasticLoadBalancingV2::Listener': { kind: 'not-needed', why: 'services bind their own local port' },
    'AWS::Route53::RecordSet': { kind: 'not-needed', why: 'localhost needs no DNS' },
    'AWS::CertificateManager::Certificate': { kind: 'not-needed', why: 'local traffic is plain HTTP' },

    // ⛔ THE MIGRATION TRIGGER IS THE ONE CUSTOM RESOURCE THAT MATTERS. ADR-0022 puts a
    // `aws-cdk-lib/triggers` Trigger in every stack that touches the database, ordered ahead of the service
    // it protects, so the schema is migrated BEFORE the new image serves traffic. Locally there is no
    // deploy to order against — the equivalent is applying the same ordered SQL before anything starts, and
    // a sandbox that skipped it would serve the new code against an empty database.
    'Custom::Trigger': { kind: 'container', image: 'apply-ordered-migrations-before-services-start' },

    // The task definition is where a service's image and environment are declared, so it is what says WHAT
    // to run locally. The cluster around it is a scheduling concept with no local counterpart.
    'AWS::ECS::TaskDefinition': { kind: 'container', image: 'built-from-the-service-Dockerfile' },
    'AWS::ECS::Cluster': { kind: 'not-needed', why: 'a local container is not scheduled onto a cluster' },

    'AWS::Events::EventBus': { kind: 'localstack', service: 'events' },

    // ⚠️ Deploy-time and operational shapes. Each has real production behaviour and NONE of it is behaviour
    // a local sandbox can exercise: there is no capacity to scale, no alarm to fire at, no listener to route
    // through, and no published version to pin.
    'AWS::ApplicationAutoScaling::ScalableTarget': {
        kind: 'not-needed',
        why: 'a single local container has no capacity to scale',
    },
    'AWS::ApplicationAutoScaling::ScalingPolicy': {
        kind: 'not-needed',
        why: 'a single local container has no capacity to scale',
    },
    'AWS::CloudWatch::Alarm': {
        kind: 'not-needed',
        why: 'alarms observe deployed metrics; locally nothing emits or pages',
    },
    'AWS::CloudWatch::Dashboard': {
        kind: 'not-needed',
        why: 'a dashboard renders deployed metrics and has no runtime behaviour',
    },
    'AWS::EC2::SecurityGroupIngress': { kind: 'not-needed', why: 'nothing is filtering localhost' },
    'AWS::ElasticLoadBalancingV2::ListenerRule': {
        kind: 'not-needed',
        why: 'host-based routing is replaced by a distinct local port per service',
    },
    'AWS::ElasticLoadBalancingV2::TargetGroup': {
        kind: 'not-needed',
        why: 'a local service is reached directly, not through a target group',
    },
    'AWS::Lambda::Version': {
        kind: 'not-needed',
        why: 'a published version is a deploy artefact; local invocation uses the current code',
    },
    'AWS::SNS::TopicPolicy': {
        kind: 'not-needed',
        why: 'a resource policy authorises deployed principals; LocalStack does not enforce it',
    },
    'AWS::CDK::Metadata': { kind: 'not-needed', why: 'CDK bookkeeping, not infrastructure' },

    // ⛔ THE ONES THAT CANNOT BE FAKED, named so a local run never claims to cover them.
    'AWS::Bedrock::ApplicationInferenceProfile': {
        kind: 'unsupported',
        why: 'LocalStack does not emulate Bedrock inference; the LLM parse leg must call the real API or be stubbed at the port',
    },
    'AWS::CloudFront::Distribution': {
        kind: 'unsupported',
        why: 'edge behaviour (the router, KVS, viewer headers) has no local equivalent — ADR-0001 turns on exactly that',
    },
});

/**
 * How a resource type is stood up locally.
 *
 * @param type - A CloudFormation resource type, as a synthesised template spells it.
 * @returns Its support entry, or `undefined` when the type is not in the table. Pure.
 */
export function localSupportFor(type: string): LocalSupport | undefined {
    return LOCAL_SUPPORT[type];
}
