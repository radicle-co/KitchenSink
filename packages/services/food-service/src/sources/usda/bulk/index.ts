/**
 * USDA **bulk download** ingest boundary (ingredient-search plan §2 Stage 1). Together with
 * `usda.adapter.ts` this is the only place USDA's native `fdc_id` is named (FR-IDN-2); everything it emits
 * is a source-agnostic `CanonicalCandidate`.
 */
export { isUsdaBulkFormatError, UsdaBulkFormatError } from './usdaBulk.errors.js';
export {
    BULK_ITEM_VERSION_PREFIX,
    bulkItemVersion,
    canonicalizeBulkUnit,
    mapBulkFoodToCanonical,
    type BulkVersionInput,
} from './usdaBulk.parser.js';
export {
    loadBulkLookups,
    streamBulkCandidates,
    streamBulkFoodBundles,
    type UsdaBulkReadOptions,
} from './usdaBulk.reader.js';
export {
    SEEDED_BULK_DATA_TYPES,
    type BulkFoodBundle,
    type BulkLookups,
    type BulkNutrientDefinition,
    type BulkNutrientRow,
    type BulkPortionRow,
    type SeededBulkDataType,
} from './usdaBulk.types.js';
