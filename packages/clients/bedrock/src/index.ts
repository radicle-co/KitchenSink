/**
 * `@kitchensink/bedrock-client` — the Amazon Bedrock `Converse` boundary for the ingredient verification gate
 * (plan U11, ADR-0024).
 *
 * External-API client only: no database, no HTTP server, no prompt, no domain rule. Consumed by
 * `@kitchensink/recipe-workers`, which holds the single Lambda execution role granted `bedrock:InvokeModel`
 * (ADR-0024 layer 4b) — recipe-service is deliberately NOT a caller and must not become one.
 *
 * Bedrock is a third-party API we do not serve, so this package validates the raw upstream shape at the
 * boundary with its own zod and declares its own types (ADR-0014 / GR-015 §15-d). No OpenAPI document is
 * written for it, and no `packages/schemas/*` copy exists.
 */
export {
    createBedrockConverseClient,
    createBedrockTransport,
    DEFAULT_REQUEST_TIMEOUT_MS,
} from './BedrockConverseClient.js';
export type {
    BedrockConverseClient,
    BedrockTransport,
    BedrockTransportConfig,
    ConverseOutcome,
    ConverseRequest,
    ConverseTransport,
} from './BedrockConverseClient.js';
export { converseOutputSchema, firstTextIn, usageSchema } from './schemas.js';
export type { BedrockTokenUsage } from './schemas.js';
export {
    BedrockAccessDeniedError,
    BedrockClientError,
    BedrockInvalidRequestError,
    BedrockThrottledError,
    BedrockTimeoutError,
    BedrockUnavailableError,
    isBedrockAccessDeniedError,
    isBedrockClientError,
    isBedrockInvalidRequestError,
    isBedrockThrottledError,
    isBedrockTimeoutError,
    isBedrockUnavailableError,
    type SpendSettlement,
} from './errors.js';
