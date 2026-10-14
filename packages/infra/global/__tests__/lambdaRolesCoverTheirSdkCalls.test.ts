/**
 * ⛔ EVERY AWS CALL A SCHEDULER-STACK FUNCTION MAKES IS ONE ITS ROLE ALLOWS — AND THE ROLE ALLOWS NOTHING ELSE.
 *
 * The midnight reclaim (ADR-0061) never worked: on its first night its role was denied `cloudformation:ListStacks`
 * three times and it deleted nothing. Its code calls `DescribeStacks` with no `StackName`, which AWS also authorizes
 * as `ListStacks`, and the role's set-equality test held the role to a list a person wrote, not to what the code
 * calls. So this reads the calls out of the handler's source ({@link sdkPermissionsReachedFrom}) and holds the
 * SYNTHESIZED role to them, in both directions:
 *
 *   - every call is admitted ({@link policyAdmits}, conditions ignored), on the resource AWS evaluates when that is
 *     known and otherwise on some resource the role grants the action on;
 *   - every action the role allows is one the code reaches, so a grant the code stopped using is a red test.
 *
 * Which function runs which handler is the one thing written here, and the synthesized stack is held to it: a third
 * function fails until it is added.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Stack, aws_sns as sns, type App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';

import { SandboxSchedulerStack } from '../lib/platform/SandboxSchedulerStack.js';
import { policyAdmits, type PolicyStatementJson } from './iamGlob.js';
import { packageProgram, sdkPermissionsReachedFrom, type RequiredPermission } from './sdkCommandReach.js';
import { testApp } from './testApp.js';

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { account: '123456789012', region: 'us-east-1' };

/**
 * Each function's logical-id prefix and the handler module it runs. The synthesized Handler cannot say: without the
 * bundle it is the placeholder's `index.handler`.
 */
const HANDLER_OF: Readonly<Record<string, string>> = {
    SandboxReclaimFunction: 'src/sandbox-scheduler/reclaimHandler.ts',
    SandboxSchedulerFunction: 'src/sandbox-scheduler/handler.ts',
};

const alarmTopicIn = (app: App): sns.ITopic =>
    sns.Topic.fromTopicArn(
        new Stack(app, 'AlarmTopicHost', { env }),
        'AlarmTopic',
        'arn:aws:sns:us-east-1:123456789012:kitchensink-alarms-sandbox',
    );

const template = ((app) =>
    Template.fromStack(
        new SandboxSchedulerStack(app, 'SandboxScheduler-sandbox', {
            env,
            stage: 'sandbox',
            alarmsEnabled: false,
            alarmTopic: alarmTopicIn(app),
        }),
    ))(testApp());

/** A template value as a string: pseudo-parameters filled in, any other reference left as a named placeholder. */
function resolved(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }

    const record = value as Record<string, unknown>;
    const ref = record['Ref'];

    if (ref === 'AWS::Partition') {
        return 'aws';
    }

    if (ref === 'AWS::Region') {
        return env.region;
    }

    if (ref === 'AWS::AccountId') {
        return env.account;
    }

    const join = record['Fn::Join'] as [string, unknown[]] | undefined;

    if (join !== undefined) {
        return join[1].map(resolved).join(join[0]);
    }

    return `<${JSON.stringify(value)}>`;
}

const listOf = <T>(value: T | readonly T[] | undefined): readonly T[] =>
    value === undefined ? [] : Array.isArray(value) ? value : [value as T];

/** The statements on one function's role, every resource resolved to a string. */
function roleStatements(functionId: string): readonly PolicyStatementJson[] {
    const roleId = (
        template.findResources('AWS::Lambda::Function')[functionId]?.['Properties']?.['Role'] as
            { 'Fn::GetAtt': [string, string] } | undefined
    )?.['Fn::GetAtt'][0];

    if (roleId === undefined) {
        throw new Error(`${functionId} has no execution role`);
    }

    return Object.values(template.findResources('AWS::IAM::Policy'))
        .filter((policy) =>
            listOf(policy['Properties']['Roles'] as { Ref: string }[]).some((role) => role.Ref === roleId),
        )
        .flatMap((policy) => listOf(policy['Properties']['PolicyDocument']['Statement'] as PolicyStatementJson[]))
        .map((statement) => ({
            ...statement,
            ...(statement.Resource === undefined
                ? {}
                : { Resource: listOf(statement.Resource as unknown).map(resolved) }),
        }));
}

/** Whether the statements admit one required permission. Pure. */
function admits(statements: readonly PolicyStatementJson[], permission: RequiredPermission): boolean {
    if (permission.evaluatedOn !== undefined) {
        const resource = permission.evaluatedOn.replace('{region}', env.region).replace('{account}', env.account);

        return policyAdmits(statements, permission.action, resource);
    }

    // No resource is known for the call, so it is enough that the role lets the action reach SOMETHING it names.
    return statements
        .filter((statement) => statement.Effect === 'Allow')
        .flatMap((statement) => listOf(statement.Resource))
        .some((resource) => policyAdmits(statements, permission.action, resource));
}

const functionIds = Object.keys(template.findResources('AWS::Lambda::Function'));

const functionIdOf = (prefix: string): string => {
    const id = functionIds.find((candidate) => candidate.startsWith(prefix));

    if (id === undefined) {
        throw new Error(`no ${prefix} in the synthesized stack — this guard has gone blind`);
    }

    return id;
};

const reached = (handler: string): readonly RequiredPermission[] => {
    const entry = path.join(PACKAGE_DIR, handler);

    return sdkPermissionsReachedFrom(packageProgram(PACKAGE_DIR, [entry]), entry, PACKAGE_DIR);
};

describe('every function in the scheduler stack has a handler named here', () => {
    it('names exactly the functions the stack synthesizes', () => {
        expect(
            functionIds.map((id) => Object.keys(HANDLER_OF).find((prefix) => id.startsWith(prefix)) ?? id).sort(),
        ).toEqual(Object.keys(HANDLER_OF).sort());
    });
});

describe.each(Object.entries(HANDLER_OF))('%s', (prefix, handler) => {
    const statements = roleStatements(functionIdOf(prefix));
    const permissions = reached(handler);

    it('reaches some SDK calls, so the checks below are not vacuous', () => {
        expect(permissions.length).toBeGreaterThan(0);
    });

    it('⛔ its role admits every AWS call its code makes', () => {
        expect(
            permissions
                .filter((permission) => !admits(statements, permission))
                .map(
                    (permission) =>
                        `${permission.action}${permission.evaluatedOn === undefined ? '' : ` on ${permission.evaluatedOn}`} (${permission.site})`,
                ),
            `${prefix}'s role is missing these; the function will be denied at run time`,
        ).toEqual([]);
    });

    it('its role allows no action its code does not reach', () => {
        const used = new Set(permissions.map((permission) => permission.action.toLowerCase()));

        expect(
            statements
                .filter((statement) => statement.Effect === 'Allow')
                .flatMap((statement) => listOf(statement.Action))
                .filter((action) => !used.has(action.toLowerCase())),
            `${prefix}'s role grants actions its handler never calls; remove the grant or say why it is needed`,
        ).toEqual([]);
    });
});

describe('sdkPermissionsReachedFrom reads the calls a handler can make', () => {
    const FIXTURE_DIR = path.join(PACKAGE_DIR, 'src', '__sdkReachFixture__');
    const entry = path.join(FIXTURE_DIR, 'handler.ts');

    const factoryModule = path.join(FIXTURE_DIR, 'ports.ts');

    /**
     * The actions reached from a handler beside the fixture's port factory module (a separate module, as the real
     * adapters are), with `evaluatedOn` where the table supplies one.
     */
    const actionsReachedBy = (source: string): readonly string[] =>
        sdkPermissionsReachedFrom(
            packageProgram(PACKAGE_DIR, [entry], { [entry]: source, [factoryModule]: RDS_FACTORY }),
            entry,
            PACKAGE_DIR,
        ).map(
            (permission) =>
                `${permission.action}${permission.evaluatedOn === undefined ? '' : ` @ ${permission.evaluatedOn}`}`,
        );

    const CFN = "import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';\n";
    const RDS = "import { DescribeDBInstancesCommand, RDSClient, StopDBInstanceCommand } from '@aws-sdk/client-rds';\n";
    const RDS_FACTORY = `${RDS}
const client = new RDSClient({});
function describeAll(): Promise<unknown> { return client.send(new DescribeDBInstancesCommand({})); }
export function createApi() {
    return {
        async list(): Promise<unknown> { return describeAll(); },
        async stop(): Promise<unknown> { return client.send(new StopDBInstanceCommand({ DBInstanceIdentifier: 'x' })); },
    };
}
`;

    it.each<readonly [string, string, readonly string[]]>([
        [
            'DescribeStacks with no StackName also needs ListStacks, on stack/*/*',
            `${CFN}export const handler = () => new CloudFormationClient({}).send(new DescribeStacksCommand({ NextToken: undefined }));`,
            [
                'cloudformation:DescribeStacks',
                'cloudformation:ListStacks @ arn:aws:cloudformation:{region}:{account}:stack/*/*',
            ],
        ],
        [
            'DescribeStacks that names its stack needs DescribeStacks only',
            `${CFN}export const handler = () => new CloudFormationClient({}).send(new DescribeStacksCommand({ StackName: 'a' }));`,
            ['cloudformation:DescribeStacks'],
        ],
        [
            'a factory used through a port that names one method reaches that method, and its helper, only',
            `import { createApi } from './ports.js';\nconst port: { list(): Promise<unknown> } = createApi();\nexport const handler = () => port.list();`,
            ['rds:DescribeDBInstances'],
        ],
        [
            'the same factory used whole reaches every method',
            `import { createApi } from './ports.js';\nexport const handler = () => createApi();`,
            ['rds:DescribeDBInstances', 'rds:StopDBInstance'],
        ],
        [
            'a command destructured from a lazy import is found, under its own service prefix',
            `export async function handler(): Promise<void> {
    const { SFNClient, StartExecutionCommand } = await import('@aws-sdk/client-sfn');
    await new SFNClient({}).send(new StartExecutionCommand({ stateMachineArn: 'arn' }));
}`,
            ['states:StartExecution'],
        ],
        ['a client constructor is not a call', `${RDS}export const handler = () => new RDSClient({});`, []],
    ])('%s', (_label, source, expected) => {
        expect(actionsReachedBy(source)).toEqual(expected);
    });

    it('refuses a client whose IAM prefix it does not know, rather than guessing one', () => {
        expect(() =>
            actionsReachedBy(
                "import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';\n" +
                    "export const handler = () => new SecretsManagerClient({}).send(new GetSecretValueCommand({ SecretId: 'a' }));",
            ),
        ).toThrow(/client-secrets-manager has no IAM service prefix/u);
    });
});
