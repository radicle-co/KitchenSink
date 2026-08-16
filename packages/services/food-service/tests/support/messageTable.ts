/**
 * The message-substrate table, DERIVED FROM THE CDK TEMPLATE, for the integration tier (plan U5/U6).
 *
 * ## Why this synthesizes instead of transcribing the key schema
 *
 * The integration suite's whole claim is that the adapter and the infrastructure agree. Hand-copying
 * `PK`/`SK`/`ttl` into a `CreateTableCommand` here would make that claim circular: the test would create the
 * table the adapter expects and then discover, unsurprisingly, that the adapter can write to it. Renaming a
 * key in `FoodServiceStack` would leave every test green while production `PutItem`s failed with
 * `ValidationException: One of the required keys was not given a value`.
 *
 * So the table is built from the **synthesized `AWS::DynamoDB::Table` resource** of the real stack. The key
 * schema under test is the one CloudFormation would create, and a CDK-side rename turns this suite red.
 *
 * ## The one place a translation is unavoidable
 *
 * CloudFormation folds TTL into the table resource (`TimeToLiveSpecification`); the DynamoDB *API* does not
 * — `CreateTable` has no such parameter and TTL is a separate `UpdateTimeToLive` call. `StreamSpecification`
 * differs too: CFN infers `StreamEnabled` from the presence of a view type, the API demands it explicitly.
 * Both translations are mechanical and are done here, once, rather than in each spec.
 *
 * @module
 */
import {
    CreateTableCommand,
    DeleteTableCommand,
    DescribeTableCommand,
    DynamoDBClient,
    ResourceNotFoundException,
    UpdateTimeToLiveCommand,
    waitUntilTableExists,
    waitUntilTableNotExists,
    type CreateTableCommandInput,
    type KeySchemaElement,
    type StreamViewType,
    type TableDescription,
} from '@aws-sdk/client-dynamodb';
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';

import { FoodServiceStack } from '../../infra/lib/FoodServiceStack.js';

/**
 * A pull-request number no real preview will ever use, so a stray table left by a crashed run can never
 * collide with — or be mistaken for — a stage someone is actually deploying.
 */
const INTEGRATION_STAGE = 'pr-4242';

/** The platform stage the synthesized preview rides. Only the per-PR branch creates a table (U5). */
const INTEGRATION_BASE_STAGE = 'sandbox';

/**
 * `Vpc.fromLookup` context, so synthesizing the stack never calls AWS.
 *
 * Duplicated from `infra/__tests__/FoodServiceStack.test.ts` on purpose: it is inert fixture data, not
 * knowledge — nothing about the substrate changes if it drifts, and the alternative is a shared module that
 * couples the unit and integration tiers' setup so a change to one breaks the other.
 */
const VPC_LOOKUP_CONTEXT = {
    'vpc-provider:account=123456789012:filter.vpc-id=vpc-12345678:region=us-east-1:returnAsymmetricSubnets=true': {
        vpcId: 'vpc-12345678',
        vpcCidrBlock: '10.0.0.0/16',
        ownerAccountId: '123456789012',
        availabilityZones: [],
        subnetGroups: [
            {
                name: 'Public',
                type: 'Public',
                subnets: [
                    {
                        subnetId: 'subnet-public-1',
                        availabilityZone: 'us-east-1a',
                        routeTableId: 'rtb-public-1',
                        cidr: '10.0.0.0/24',
                    },
                ],
            },
            {
                name: 'Private',
                type: 'Private',
                subnets: [
                    {
                        subnetId: 'subnet-private-1',
                        availabilityZone: 'us-east-1a',
                        routeTableId: 'rtb-private-1',
                        cidr: '10.0.1.0/24',
                    },
                ],
            },
        ],
    },
};

/** The substrate table as CloudFormation would create it, reduced to what the DynamoDB API accepts. */
export interface MessageTableDefinition {
    /** The table name the stack assigns for this stage. */
    readonly tableName: string;
    /** `CreateTable` input carrying the synthesized key schema, attribute types and billing mode. */
    readonly createTableInput: CreateTableCommandInput;
    /** The attribute name the stack's `TimeToLiveSpecification` points at (`ttl`, unless CDK changed). */
    readonly ttlAttribute: string;
    /** The partition-key attribute name, read off the synthesized `KeySchema`. */
    readonly partitionKeyAttribute: string;
    /** The sort-key attribute name, read off the synthesized `KeySchema`. */
    readonly sortKeyAttribute: string;
}

/** The synthesized shape of a CFN `AWS::DynamoDB::Table`, narrowed to the properties this module reads. */
interface SynthesizedTableProperties {
    readonly TableName: string;
    readonly KeySchema: readonly KeySchemaElement[];
    readonly AttributeDefinitions: CreateTableCommandInput['AttributeDefinitions'];
    readonly BillingMode?: string;
    readonly TimeToLiveSpecification?: { readonly AttributeName: string; readonly Enabled: boolean };
    readonly StreamSpecification?: { readonly StreamViewType: string };
}

/**
 * Read the substrate table out of the real `FoodServiceStack` template. Pure.
 *
 * @returns The table definition the stack would deploy for a per-PR stage.
 * @throws {Error} When the stack synthesizes anything other than exactly one table, or when the table
 *   declares no TTL attribute — both of which would silently weaken every assertion built on this.
 */
export function messageTableDefinition(): MessageTableDefinition {
    const app = new App({ context: { ...VPC_LOOKUP_CONTEXT } });
    const stack = new FoodServiceStack(app, `Food-${INTEGRATION_STAGE}`, {
        env: { account: '123456789012', region: 'us-east-1' },
        stage: INTEGRATION_STAGE,
        baseStage: INTEGRATION_BASE_STAGE,
        domainName: 'example.com',
        imageTag: 'test',
        desiredCount: 1,
        workerDesiredCount: 1,
        vpcId: 'vpc-12345678',
    });

    const tables = Template.fromStack(stack).findResources('AWS::DynamoDB::Table');
    const found = Object.values(tables);

    if (found.length !== 1) {
        throw new Error(
            `Expected FoodServiceStack(${INTEGRATION_STAGE}) to synthesize exactly one substrate table, got ${found.length}.`,
        );
    }

    const properties = found[0]?.['Properties'] as SynthesizedTableProperties;

    if (properties.TimeToLiveSpecification === undefined) {
        throw new Error('The synthesized substrate table declares no TimeToLiveSpecification.');
    }

    const partitionKeyAttribute = keyAttributeOfType(properties.KeySchema, 'HASH');
    const sortKeyAttribute = keyAttributeOfType(properties.KeySchema, 'RANGE');

    return {
        tableName: properties.TableName,
        ttlAttribute: properties.TimeToLiveSpecification.AttributeName,
        partitionKeyAttribute,
        sortKeyAttribute,
        createTableInput: {
            TableName: properties.TableName,
            KeySchema: [...properties.KeySchema],
            AttributeDefinitions: properties.AttributeDefinitions,
            BillingMode: properties.BillingMode as CreateTableCommandInput['BillingMode'],
            // CFN infers `StreamEnabled` from the presence of a view type; the API requires it stated.
            ...(properties.StreamSpecification === undefined
                ? {}
                : {
                      StreamSpecification: {
                          StreamEnabled: true,
                          StreamViewType: properties.StreamSpecification.StreamViewType as StreamViewType,
                      },
                  }),
        },
    };
}

/**
 * Find the attribute backing one key role in a synthesized key schema. Pure.
 *
 * @param keySchema - The synthesized `KeySchema`.
 * @param keyType - `HASH` or `RANGE`.
 * @returns The attribute name.
 * @throws {Error} When the role is absent — a table with no sort key would make every ordering assertion
 *   in this suite vacuously true rather than failing.
 */
function keyAttributeOfType(keySchema: readonly KeySchemaElement[], keyType: 'HASH' | 'RANGE'): string {
    const element = keySchema.find((candidate) => candidate.KeyType === keyType);

    if (element?.AttributeName === undefined) {
        throw new Error(`The synthesized substrate table has no ${keyType} key.`);
    }

    return element.AttributeName;
}

/**
 * Build a DynamoDB client pointed at the local harness.
 *
 * Credentials are the LocalStack constants: `test`/`test` is not a secret, it is the fixed pair LocalStack
 * accepts and namespaces its account under. They are stated rather than read from the environment so the
 * suite can never accidentally authenticate against a real account and create a real table.
 *
 * @returns A client bound to `AWS_ENDPOINT_URL` (default `http://localhost:4566`).
 */
export function localDynamoClient(): DynamoDBClient {
    return new DynamoDBClient({
        endpoint: process.env['AWS_ENDPOINT_URL'] ?? 'http://localhost:4566',
        region: process.env['AWS_REGION'] ?? 'us-east-1',
        credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    });
}

/**
 * Ensure the substrate table exists with the synthesized key schema and TTL enabled.
 *
 * ## Why this REUSES a matching table instead of recreating one
 *
 * The obvious `DeleteTable` → `CreateTable` setup is racy, and measurably so: it failed 2 runs in 5 with
 * `ResourceInUseException: Table already exists`. `DeleteTable` is asynchronous **by AWS contract** — the
 * table sits in `DELETING` until the deletion completes — and the SDK's `waitUntilTableNotExists` waiter
 * finishes as soon as `DescribeTable` reports `ResourceNotFoundException`, which the local stack does
 * while the name is still claimed. Retrying the create would only paper over that window.
 *
 * So the happy path never deletes: a table whose key schema already matches is reused, which is safe
 * because every spec writes under a freshly-generated `groupId` and queries only that group. The table is
 * dropped and rebuilt **only** when the synthesized schema no longer matches what is there — a CDK change,
 * not a per-run event — and that is the one path where the wait is needed and worth its cost.
 *
 * @param client - The DynamoDB client.
 * @param definition - The synthesized table definition.
 * @sideEffect Creates (or replaces) the table and enables its TTL.
 */
export async function ensureMessageTable(client: DynamoDBClient, definition: MessageTableDefinition): Promise<void> {
    const existing = await describeMessageTable(client, definition.tableName);

    if (existing !== undefined && !matchesDefinition(existing, definition)) {
        await dropMessageTable(client, definition);
    }

    if (existing === undefined || !matchesDefinition(existing, definition)) {
        await client.send(new CreateTableCommand(definition.createTableInput));
        await waitUntilTableExists({ client, maxWaitTime: 60 }, { TableName: definition.tableName });
    }

    // Separate call by necessity: `CreateTable` has no TTL parameter. This is also the assertion's anchor —
    // `DescribeTimeToLive` later reports the attribute name the ADAPTER must be writing. Idempotent, so it
    // runs whether the table was just created or reused.
    await client.send(
        new UpdateTimeToLiveCommand({
            TableName: definition.tableName,
            TimeToLiveSpecification: { AttributeName: definition.ttlAttribute, Enabled: true },
        }),
    );
}

/**
 * Describe the table, treating "absent" as a value rather than an exception.
 *
 * @param client - The DynamoDB client.
 * @param tableName - The table to describe.
 * @returns The live description, or `undefined` when the table does not exist.
 * @sideEffect Calls DynamoDB.
 */
async function describeMessageTable(client: DynamoDBClient, tableName: string): Promise<TableDescription | undefined> {
    try {
        return (await client.send(new DescribeTableCommand({ TableName: tableName }))).Table;
    } catch (error) {
        if (error instanceof ResourceNotFoundException) {
            return undefined;
        }

        throw error;
    }
}

/**
 * Whether a live table already carries the synthesized key schema. Pure.
 *
 * Only the KEY schema is compared, because it is the only part that is immutable after creation and the
 * only part every assertion in the suite depends on. TTL is re-applied unconditionally, and billing mode
 * changes do not affect a single item's shape.
 *
 * @param live - The live table description.
 * @param definition - The synthesized table definition.
 * @returns `true` when the live key schema matches.
 */
function matchesDefinition(live: TableDescription, definition: MessageTableDefinition): boolean {
    const liveKeys = (live.KeySchema ?? []).map((key) => `${key.KeyType}:${key.AttributeName}`).sort();
    const wantedKeys = (definition.createTableInput.KeySchema ?? [])
        .map((key) => `${key.KeyType}:${key.AttributeName}`)
        .sort();

    return liveKeys.length === wantedKeys.length && liveKeys.every((key, index) => key === wantedKeys[index]);
}

/**
 * Delete the substrate table if it exists.
 *
 * @param client - The DynamoDB client.
 * @param definition - The synthesized table definition.
 * @sideEffect Destroys the table and everything in it.
 */
export async function dropMessageTable(client: DynamoDBClient, definition: MessageTableDefinition): Promise<void> {
    try {
        await client.send(new DeleteTableCommand({ TableName: definition.tableName }));
        await waitUntilTableNotExists({ client, maxWaitTime: 60 }, { TableName: definition.tableName });
    } catch (error) {
        if (!(error instanceof ResourceNotFoundException)) {
            throw error;
        }
    }
}
