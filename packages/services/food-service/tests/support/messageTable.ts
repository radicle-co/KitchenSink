/**
 * The message-substrate table, DERIVED FROM ONE SHARED SHAPE, for the integration tier (plan U5/U6).
 *
 * ## Why this does not transcribe the key schema
 *
 * The integration suite's whole claim is that the adapter and the infrastructure agree. Hand-copying
 * `PK`/`SK`/`ttl` into a `CreateTableCommand` here would make that claim circular: the test would create the
 * table the adapter expects and then discover, unsurprisingly, that the adapter can write to it. Renaming a
 * key in `FoodServiceStack` would leave every test green while production `PutItem`s failed with
 * `ValidationException: One of the required keys was not given a value`.
 *
 * ⚠️ It USED to synthesize the real stack and read the table out of the template, which kept the two in step
 * by construction. That is no longer possible — see the note below — so the anti-circularity property is
 * preserved by INVERSION instead: both this file and the stack read `messageTableShape` from
 * `@kitchensink/messaging`, and `FoodServiceStack.test.ts` asserts on the CDK side that the synthesized
 * table still matches it. A key rename fails there, next to the stack that caused it.
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
// ⛔ NO `aws-cdk-lib` AND NO STACK IMPORT. This file used to construct `FoodServiceStack` and read the
// table out of the synthesized template, which kept the two in step by construction. It cannot any more: a
// CDK app installs its own aws-cdk-lib under `infra/` so 149 MB of it stops shipping in the service image,
// so a workspace test synthesizing that stack holds a DIFFERENT instance than the stack it synthesizes —
// `FoodServiceStack is not assignable to Stack`.
//
// The anti-drift property is inverted rather than dropped: the shape is declared once in
// `@kitchensink/messaging`, both sides read it, and `FoodServiceStack.test.ts` — on the CDK side, where
// synthesis is legal — asserts the synthesized table still matches it.
import {
    MESSAGE_TABLE_ATTRIBUTE_DEFINITIONS,
    MESSAGE_TABLE_BILLING_MODE,
    MESSAGE_TABLE_KEY_SCHEMA,
    MESSAGE_TABLE_PARTITION_KEY,
    MESSAGE_TABLE_SORT_KEY,
    MESSAGE_TABLE_STREAM_VIEW_TYPE,
    MESSAGE_TABLE_TTL_ATTRIBUTE,
} from '@kitchensink/messaging';

/**
 * A pull-request number no real preview will ever use, so a stray table left by a crashed run can never
 * collide with — or be mistaken for — a stage someone is actually deploying.
 */
const INTEGRATION_STAGE = 'pr-4242';

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

/**
 * The substrate table's definition, built from the shape `@kitchensink/messaging` declares — the same
 * constants `FoodServiceStack` builds its table from. Pure.
 *
 * @returns The table definition the stack would deploy for a per-PR stage.
 * @throws {Error} When the stack synthesizes anything other than exactly one table, or when the table
 *   declares no TTL attribute — both of which would silently weaken every assertion built on this.
 */
export function messageTableDefinition(): MessageTableDefinition {
    // ⚠️ This suite CREATES the twin, so it names it. It does not need to agree with the deployed name:
    // the stack publishes that to SSM and injects it as `MESSAGE_TABLE_NAME`, and the worker reads the
    // env var rather than deriving anything. What must agree is the SHAPE, which both sides take from
    // `@kitchensink/messaging` below.
    const tableName = `kitchensink-messages-${INTEGRATION_STAGE}`;

    return {
        tableName,
        ttlAttribute: MESSAGE_TABLE_TTL_ATTRIBUTE,
        partitionKeyAttribute: MESSAGE_TABLE_PARTITION_KEY,
        sortKeyAttribute: MESSAGE_TABLE_SORT_KEY,
        createTableInput: {
            TableName: tableName,
            KeySchema: MESSAGE_TABLE_KEY_SCHEMA.map((entry) => ({ ...entry })) as KeySchemaElement[],
            AttributeDefinitions: MESSAGE_TABLE_ATTRIBUTE_DEFINITIONS.map((entry) => ({ ...entry })),
            BillingMode: MESSAGE_TABLE_BILLING_MODE as CreateTableCommandInput['BillingMode'],
            // CFN infers `StreamEnabled` from the presence of a view type; the API requires it stated.
            StreamSpecification: {
                StreamEnabled: true,
                StreamViewType: MESSAGE_TABLE_STREAM_VIEW_TYPE as StreamViewType,
            },
        },
    };
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
