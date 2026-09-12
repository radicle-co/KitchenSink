/**
 * `@kitchensink/messaging` — the durable per-group message substrate's PRODUCER half (R1, plan U4–U6).
 *
 * Producers depend on `publish` and never on a storage SDK. The contract is shared here; the adapters
 * stay local to each runtime (the `cdnInvalidation.ts` precedent), with the DynamoDB one in plan U6.
 *
 * @module
 */

export { GROUP_TYPES, outboundMessageSchema, parseOutboundMessage } from './OutboundMessage.js';
export type { GroupType, OutboundMessage } from './OutboundMessage.js';

export { publish } from './publish.js';
export type { MessagePublisher, PublishOptions } from './publish.js';

export { InMemoryPublisher } from './InMemoryPublisher.js';
export { ConsolePublisher } from './ConsolePublisher.js';
export {
    MESSAGE_TABLE_ATTRIBUTE_DEFINITIONS,
    MESSAGE_TABLE_BILLING_MODE,
    MESSAGE_TABLE_KEY_SCHEMA,
    MESSAGE_TABLE_PARTITION_KEY,
    MESSAGE_TABLE_SORT_KEY,
    MESSAGE_TABLE_STREAM_VIEW_TYPE,
    MESSAGE_TABLE_TTL_ATTRIBUTE,
    type MessageTableAttributeDefinition,
    type MessageTableKeySchemaEntry,
} from './messageTableShape.js';
