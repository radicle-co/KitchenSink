/**
 * ⛔ EVERY AWS CALL A SCHEDULER-STACK FUNCTION MAKES IS ONE ITS ROLE ALLOWS — AND THE ROLE ALLOWS NOTHING ELSE.
 *
 * The midnight reclaim (ADR-0061) never worked: on its first night its role was denied `cloudformation:ListStacks`
 * three times and it deleted nothing. Its code calls `DescribeStacks` with no `StackName`, which AWS also authorizes
 * as `ListStacks`, and the role's set-equality test held the role to a list a person wrote, not to what the code
 * calls. So this reads the calls out of the handler's source ({@link sdkPermissionsReachedFrom}) and holds the
 * SYNTHESIZED role to them, in both directions:
 *
 *   - every call is admitted (`policyAdmits`, conditions ignored), on the resource AWS evaluates when that is
 *     known and otherwise on some resource the role grants the action on;
 *   - every action the role allows is one the code reaches, so a grant the code stopped using is a red test.
 *
 * Which function runs which handler is the one thing written here, and the synthesized stack is held to it: a third
 * function fails until it is added.
 *
 * ⚠️ This file is the scheduler stack ONLY, in BOTH directions, and is also where the reader itself is pinned (the
 * fixture tables below). EVERY OTHER stack in the repository is held to the first direction by
 * `tests/lambdaRolesCoverTheirSdkCalls.integration.test.ts`, which synthesizes each CDK app in its own process and
 * discovers the functions from the templates instead of listing them.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Stack, aws_sns as sns, type App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';

import { SandboxSchedulerStack } from '../lib/platform/SandboxSchedulerStack.js';
import type { PolicyStatementJson } from './iamGlob.js';
import { lambdaFunctionsOf, listOf, missingFrom, type CfnTemplate } from './lambdaRoleReach.js';
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

/** The statements on one function's role, every resource resolved to a string. */
function roleStatements(functionId: string): readonly PolicyStatementJson[] {
    const found = lambdaFunctionsOf(template.toJSON() as CfnTemplate, env).find((fn) => fn.logicalId === functionId);

    if (found === undefined) {
        throw new Error(`${functionId} is not in the synthesized stack`);
    }

    return found.statements;
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
            missingFrom(statements, permissions, env),
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
        [
            'S3 HeadObject and ListObjectsV2 are authorized as GetObject and ListBucket, not as their own names',
            `import { HeadObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
export const handler = async () => {
    const s3 = new S3Client({});
    await s3.send(new HeadObjectCommand({ Bucket: 'b', Key: 'k' }));
    await s3.send(new ListObjectsV2Command({ Bucket: 'b' }));
};`,
            ['s3:GetObject', 's3:ListBucket'],
        ],
        [
            'S3 CopyObject needs read on the source and write on the destination',
            `import { CopyObjectCommand, S3Client } from '@aws-sdk/client-s3';
export const handler = () => new S3Client({}).send(new CopyObjectCommand({ Bucket: 'b', Key: 'k', CopySource: 's' }));`,
            ['s3:GetObject', 's3:PutObject'],
        ],
        [
            'the SQS batch calls and lambda Invoke are authorized as the single-message and InvokeFunction actions',
            `import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { DeleteMessageBatchCommand, SQSClient, SendMessageBatchCommand } from '@aws-sdk/client-sqs';
export const handler = async () => {
    const sqs = new SQSClient({});
    await sqs.send(new SendMessageBatchCommand({ QueueUrl: 'q', Entries: [] }));
    await sqs.send(new DeleteMessageBatchCommand({ QueueUrl: 'q', Entries: [] }));
    await new LambdaClient({}).send(new InvokeCommand({ FunctionName: 'f' }));
};`,
            ['lambda:InvokeFunction', 'sqs:DeleteMessage', 'sqs:SendMessage'],
        ],
        [
            'a Bedrock Converse call is authorized as InvokeModel',
            `import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
export const handler = () => new BedrockRuntimeClient({}).send(new ConverseCommand({ modelId: 'm' }));`,
            ['bedrock:InvokeModel'],
        ],
    ])('%s', (_label, source, expected) => {
        expect(actionsReachedBy(source)).toEqual(expected);
    });

    it('refuses a client whose IAM prefix it does not know, rather than guessing one', () => {
        expect(() =>
            actionsReachedBy(
                "import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';\n" +
                    "export const handler = () => new DynamoDBClient({}).send(new GetItemCommand({ TableName: 't', Key: {} }));",
            ),
        ).toThrow(/client-dynamodb has no IAM service prefix/u);
    });

    it('refuses a document-client command, whose authorization it has not been taught', () => {
        expect(() =>
            actionsReachedBy(
                "import { PutCommand } from '@aws-sdk/lib-dynamodb';\n" +
                    "export const handler = () => new PutCommand({ TableName: 't', Item: {} });",
            ),
        ).toThrow(/PutCommand comes from @aws-sdk\/lib-dynamodb, which is not a plain client/u);
    });

    it('refuses a Command whose SDK import does not resolve, rather than reading it as no call', () => {
        expect(() =>
            actionsReachedBy(
                "import { GetThingCommand } from '@aws-sdk/client-not-installed-anywhere';\n" +
                    'export const handler = () => new GetThingCommand({});',
            ),
        ).toThrow(/GetThingCommand does not resolve/u);
    });
});
