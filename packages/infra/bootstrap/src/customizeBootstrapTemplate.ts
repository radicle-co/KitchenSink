/**
 * @module customizeBootstrapTemplate — the stock CDK bootstrap template, narrowed for KitchenSink (ADR-0065).
 *
 * The stock template (`cdk bootstrap --show-template`, vendored verbatim as `stockTemplate.yaml`) cannot express
 * what closes the shared-account finding, so this pure transform makes four edits and nothing else:
 *
 * - **(a) Trust.** The deploy, file-publishing, image-publishing and lookup roles trust the account root, so any
 *   principal in the account with an IAM Allow can assume them, the other application's included. They now also
 *   require `ArnEquals aws:PrincipalArn` over the named CI roles (`BOOTSTRAP_TRUST`). The CI roles are matched by
 *   ARN CONDITION rather than named as principals: a principal that names a role by ARN is stored as its
 *   unique id, so a recreated role silently stops matching, and a role that does not exist yet is rejected.
 *   The `TrustedAccounts` statements are removed, so no parameter can widen the trust.
 * - **(b) Deploy-role stack scope.** Its CloudFormation actions were on `*`; they are limited to the qualifier's
 *   stack-name patterns (`STACK_NAME_PATTERNS`). The CloudFormation read-only managed policy, which can read the
 *   template and outputs of every stack in the account, is replaced by the same reads on those stacks only.
 * - **(c) Lookup role.** `ReadOnlyAccess` (which includes `lambda:GetFunction*` and `ecs:DescribeTaskDefinition`,
 *   i.e. other applications' environment variables) is replaced by the context-provider reads the apps use.
 * - **(d) Execution role.** CloudFormation's trust gets `aws:SourceAccount`, and the fallback to
 *   `AdministratorAccess` when no execution policy is passed is removed: an empty list now fails the deploy of the
 *   bootstrap stack instead of producing an administrator.
 *
 * The transform throws, naming the missing piece, when the stock template no longer has the shape it edits. A CDK
 * upgrade that moves the template is therefore a loud failure here, never a silently skipped edit.
 *
 * @pattern Template Method — a fixed sequence of named edits over a vendored base, pinned by golden files
 * @pattern Pure transform — parsed document in, new document out; the input is never mutated
 */
import { isRecord, type Json, type JsonObject } from './json.js';
import { ASSUMABLE_ROLE_KINDS, BOOTSTRAP_TRUST, STACK_NAME_PATTERNS, ciRoleArn } from './qualifiers.js';
import type { AssumableRoleKind, QualifierName } from './qualifiers.js';

/** The CloudFormation Sub-token for the deploying account: no account id is ever committed (`assertNoAwsAccountIds`). */
const ACCOUNT_TOKEN = '${AWS::AccountId}';

/** The template resource id of each assumable bootstrap role. */
const ROLE_RESOURCE_IDS: Readonly<Record<AssumableRoleKind, string>> = {
    deploy: 'DeploymentActionRole',
    'file-publishing': 'FilePublishingRole',
    'image-publishing': 'ImagePublishingRole',
    lookup: 'LookupRole',
};

/**
 * What the lookup role may do: exactly the context providers the apps use.
 *
 * - `Vpc.fromLookup` (every service) -> the four VPC describes.
 * - AZ lookup -> `DescribeAvailabilityZones`.
 * - `HostedZone.fromLookup` (`DomainStack`) -> the two Route 53 reads.
 * - the bootstrap-version parameter (the CLI checks it before a lookup).
 */
export const LOOKUP_ROLE_ACTIONS: readonly string[] = [
    'ec2:DescribeAvailabilityZones',
    'ec2:DescribeRouteTables',
    'ec2:DescribeSubnets',
    'ec2:DescribeVpcs',
    'ec2:DescribeVpnGateways',
    'route53:GetHostedZone',
    'route53:ListHostedZonesByName',
    'ssm:GetParameter',
];

const expectObject = (value: Json | undefined, what: string): JsonObject => {
    if (!isRecord(value)) {
        throw new Error(
            `customizeBootstrapTemplate: expected ${what} to be an object — the stock template changed shape`,
        );
    }

    return value;
};

const expectArray = (value: Json | undefined, what: string): Json[] => {
    if (!Array.isArray(value)) {
        throw new Error(
            `customizeBootstrapTemplate: expected ${what} to be an array — the stock template changed shape`,
        );
    }

    return value;
};

const resourceOf = (template: JsonObject, id: string): JsonObject =>
    expectObject(expectObject(template['Resources'], 'Resources')[id], `Resources.${id}`);

const propertiesOf = (template: JsonObject, id: string): JsonObject =>
    expectObject(resourceOf(template, id)['Properties'], `Resources.${id}.Properties`);

const sub = (value: string): Json => ({ 'Fn::Sub': value });

const stackArn = (pattern: string): Json =>
    sub(`arn:\${AWS::Partition}:cloudformation:\${AWS::Region}:${ACCOUNT_TOKEN}:stack/${pattern}/*`);

/** The stock external-id refusal, kept beside the principal condition. */
const EXTERNAL_ID_NULL: JsonObject = { Null: { 'sts:ExternalId': 'true' } };

/** Edit (a): the principal condition on one role's trust. */
function narrowTrust(template: JsonObject, kind: AssumableRoleKind, qualifier: QualifierName): void {
    const principal: JsonObject = { AWS: { Ref: 'AWS::AccountId' } };
    const callers: Json[] = BOOTSTRAP_TRUST[qualifier][kind].map((tier) => sub(ciRoleArn(ACCOUNT_TOKEN, tier)));
    const arnEquals: JsonObject = { ArnEquals: { 'aws:PrincipalArn': callers } };
    // The stock AssumeRole statement refuses a call carrying an ExternalId (confused-deputy hygiene) when
    // `DenyExternalId` is true. It is kept, with the principal condition merged beside it.
    const assumeCondition: JsonObject = {
        'Fn::If': ['ShouldDenyExternalId', { ...expectObject(EXTERNAL_ID_NULL, 'null'), ...arnEquals }, arnEquals],
    };

    const properties = propertiesOf(template, ROLE_RESOURCE_IDS[kind]);
    expectObject(properties['AssumeRolePolicyDocument'], `${ROLE_RESOURCE_IDS[kind]} trust`);

    properties['AssumeRolePolicyDocument'] = {
        Statement: [
            { Action: 'sts:AssumeRole', Effect: 'Allow', Principal: principal, Condition: assumeCondition },
            { Action: 'sts:TagSession', Effect: 'Allow', Principal: principal, Condition: arnEquals },
        ],
        Version: '2012-10-17',
    };
}

/** Edit (b): the deploy role's CloudFormation reach, and its reads. */
function scopeDeployRole(template: JsonObject, qualifier: QualifierName): void {
    const properties = propertiesOf(template, 'DeploymentActionRole');
    const stacks = STACK_NAME_PATTERNS[qualifier].map(stackArn);
    const policies = expectArray(properties['Policies'], 'DeploymentActionRole.Policies');
    const document = expectObject(
        expectObject(policies[0], 'DeploymentActionRole policy')['PolicyDocument'],
        'document',
    );
    const statements = expectArray(document['Statement'], 'DeploymentActionRole statements').map((s, index) =>
        expectObject(s, `DeploymentActionRole statement ${index}`),
    );

    const find = (sid: string): JsonObject => {
        const statement = statements.find((candidate) => candidate['Sid'] === sid);

        if (statement === undefined) {
            throw new Error(
                `customizeBootstrapTemplate: the deploy role has no ${sid} statement — the stock template changed shape`,
            );
        }

        return statement;
    };

    find('DeployPermissions')['Resource'] = stacks;
    find('Refactor')['Resource'] = stacks;

    const cli = find('CliPermissions');
    const cliActions = expectArray(cli['Action'], 'CliPermissions actions').filter(
        (a) => a !== 'sts:GetCallerIdentity',
    );
    cli['Action'] = cliActions;
    cli['Resource'] = stacks;
    // `sts:GetCallerIdentity` takes no resource type: it stays on `*`, in a statement of its own.
    const identity: JsonObject = {
        Sid: 'CallerIdentity',
        Effect: 'Allow',
        Action: ['sts:GetCallerIdentity'],
        Resource: '*',
    };
    // Replaces the CloudFormation read-only managed policy, which reads every stack in the account.
    const reads: JsonObject = {
        Sid: 'ReadOwnStacks',
        Effect: 'Allow',
        Action: ['cloudformation:Describe*', 'cloudformation:Get*', 'cloudformation:List*'],
        Resource: stacks,
    };

    document['Statement'] = [...statements, identity, reads];
    delete properties['ManagedPolicyArns'];
}

/** Edit (c): the lookup role's reads. */
function scopeLookupRole(template: JsonObject): void {
    const properties = propertiesOf(template, 'LookupRole');
    delete properties['ManagedPolicyArns'];

    const policies = expectArray(properties['Policies'], 'LookupRole.Policies');
    const document = expectObject(
        expectObject(policies[0], 'LookupRole policy')['PolicyDocument'],
        'LookupRole document',
    );
    const statements = expectArray(document['Statement'], 'LookupRole statements');

    const versionParameter = sub(
        'arn:${AWS::Partition}:ssm:${AWS::Region}:' + `${ACCOUNT_TOKEN}:parameter\${CdkBootstrapVersion}`,
    );

    document['Statement'] = [
        ...statements,
        {
            Sid: 'VpcAndZoneContextProviders',
            Effect: 'Allow',
            Action: LOOKUP_ROLE_ACTIONS.filter((a) => !a.startsWith('ssm:') && !a.startsWith('route53:')),
            Resource: '*',
        },
        {
            Sid: 'HostedZoneContextProvider',
            Effect: 'Allow',
            Action: LOOKUP_ROLE_ACTIONS.filter((a) => a.startsWith('route53:')),
            Resource: '*',
        },
        {
            Sid: 'ReadBootstrapVersion',
            Effect: 'Allow',
            Action: ['ssm:GetParameter'],
            Resource: versionParameter,
        },
    ];
}

/** Edit (d): the execution role. */
function narrowExecutionRole(template: JsonObject): void {
    const properties = propertiesOf(template, 'CloudFormationExecutionRole');
    const trust = expectObject(properties['AssumeRolePolicyDocument'], 'execution role trust');
    const statements = expectArray(trust['Statement'], 'execution role trust statements');

    if (statements.length === 0) {
        throw new Error('customizeBootstrapTemplate: the execution role trust has no statement');
    }

    trust['Statement'] = statements.map((statement) => ({
        ...expectObject(statement, 'execution role trust statement'),
        Condition: { StringEquals: { 'aws:SourceAccount': { Ref: 'AWS::AccountId' } } },
    }));
    // No fallback to AdministratorAccess: an empty list fails the stack, which is the only safe empty.
    properties['ManagedPolicyArns'] = { Ref: 'CloudFormationExecutionPolicies' };
}

/** The identity of the stack: its qualifier and a variant of its own. */
function stampIdentity(template: JsonObject, qualifier: QualifierName): void {
    const parameters = expectObject(template['Parameters'], 'Parameters');
    expectObject(parameters['Qualifier'], 'Parameters.Qualifier')['Default'] = qualifier;
    expectObject(parameters['BootstrapVariant'], 'Parameters.BootstrapVariant')['Default'] =
        'KitchenSink: scoped bootstrap (ADR-0065)';
}

/**
 * Narrows the stock bootstrap template for one qualifier.
 *
 * @param stock - The parsed stock template. Never mutated.
 * @param qualifier - The qualifier the result is for.
 * @returns A new template document. Pure.
 * @throws When the stock template no longer has a piece the edits need.
 */
export function customizeBootstrapTemplate(stock: Json, qualifier: QualifierName): Json {
    const template = structuredClone(stock);
    const root = expectObject(template, 'template');

    for (const kind of ASSUMABLE_ROLE_KINDS) {
        narrowTrust(root, kind, qualifier);
    }

    scopeDeployRole(root, qualifier);
    scopeLookupRole(root);
    narrowExecutionRole(root);
    stampIdentity(root, qualifier);

    return template;
}
