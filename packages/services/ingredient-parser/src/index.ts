/**
 * What a caller of the CRF engine imports.
 *
 * Only the wire contract and its boundary. The engine's runtime is Python and lives in the deployed asset;
 * there is deliberately no TypeScript client here, because U22 owns how the two engines are invoked and a
 * client written before that decision would be a shape nobody asked for.
 */
export {
    MAX_LINES,
    MAX_LINE_CHARS,
    engineRequestSchema,
    engineResponseSchema,
    engineResultSchema,
    parseEngineResponse,
    type EngineRequest,
    type EngineResponse,
    type EngineResult,
} from './engine.schema.js';
