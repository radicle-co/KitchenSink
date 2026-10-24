/**
 * The message substrate table's SHAPE, as data — one authoritative representation read by both the CDK stack
 * that creates the table and the integration tier that stands up a local twin of it.
 *
 * ## Why this is not simply read off the synthesized stack
 *
 * It used to be. `food-service/tests/support/messageTable.ts` constructed `FoodServiceStack`, synthesized it,
 * and pulled the `AWS::DynamoDB::Table` properties out of the template — which kept the two in step by
 * construction and was the right call while the stack and the tests shared one `aws-cdk-lib`.
 *
 * They no longer do. A service's CDK app installs its own `aws-cdk-lib` under `infra/`, deliberately outside
 * the npm workspace, so 149 MB of it stops shipping inside the service's container image. A workspace test
 * that synthesizes that stack therefore holds a DIFFERENT aws-cdk-lib instance than the stack it is
 * synthesizing, and TypeScript says so outright: `FoodServiceStack` is not assignable to `Stack`.
 *
 * ⛔ The anti-drift property is NOT abandoned, it is inverted. Rather than the test deriving the shape from
 * the stack, both derive it from here — and `FoodServiceStack.test.ts`, which lives on the CDK side of the
 * boundary where synthesis is legal, asserts that the synthesized table still matches. Drift fails there,
 * next to the stack that caused it.
 *
 * ⚠️ `ttl` is written as a NUMBER at write time (U6). A string TTL is SILENTLY ignored by DynamoDB — nothing
 * expires, nothing errors, and a per-PR table grows without bound.
 */

/** The partition-key attribute, `S`-typed. */
export const MESSAGE_TABLE_PARTITION_KEY = 'PK';

/** The sort-key attribute, `S`-typed. */
export const MESSAGE_TABLE_SORT_KEY = 'SK';

/** The attribute DynamoDB's TTL points at. Written as a number; see the note above. */
export const MESSAGE_TABLE_TTL_ATTRIBUTE = 'ttl';

/** The stream view type the substrate publishes. */
export const MESSAGE_TABLE_STREAM_VIEW_TYPE = 'KEYS_ONLY';

/** On-demand billing — a per-PR table's traffic is bursty and mostly zero. */
export const MESSAGE_TABLE_BILLING_MODE = 'PAY_PER_REQUEST';

/** A DynamoDB key-schema entry, in the wire shape both the CDK template and the SDK use. */
export interface MessageTableKeySchemaEntry {
    readonly AttributeName: string;
    readonly KeyType: 'HASH' | 'RANGE';
}

/** A DynamoDB attribute definition, in the wire shape both the CDK template and the SDK use. */
export interface MessageTableAttributeDefinition {
    readonly AttributeName: string;
    readonly AttributeType: 'S';
}

/** The table's key schema: partition key then sort key, in DynamoDB's declared order. */
export const MESSAGE_TABLE_KEY_SCHEMA: readonly MessageTableKeySchemaEntry[] = [
    { AttributeName: MESSAGE_TABLE_PARTITION_KEY, KeyType: 'HASH' },
    { AttributeName: MESSAGE_TABLE_SORT_KEY, KeyType: 'RANGE' },
];

/** The attribute definitions the key schema requires. Only keys are declared; DynamoDB is schemaless. */
export const MESSAGE_TABLE_ATTRIBUTE_DEFINITIONS: readonly MessageTableAttributeDefinition[] = [
    { AttributeName: MESSAGE_TABLE_PARTITION_KEY, AttributeType: 'S' },
    { AttributeName: MESSAGE_TABLE_SORT_KEY, AttributeType: 'S' },
];
