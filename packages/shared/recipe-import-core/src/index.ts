export { sanitizeToPlainText } from './contentSanitizer.js';
export { millilitresPerUnit } from './historicalUnits.js';
export type { MeasureSystem } from './historicalUnits.js';
export { corruptsStatedValue, parseIngredientLine, roundToQuantityStorageScale } from './ingredientLine.js';
export type { IngredientReviewReason, ParsedIngredientLine } from './ingredientLine.js';
export { projectToIngredientLine } from './parsedLine.js';
export type {
    ParsedFacts,
    ParsedFood,
    ParsedLine,
    ParseEngine,
    ParseFactSource,
    ParseProvenance,
} from './parsedLine.js';
export { promoteCrfReading } from './domain/promoteCrfReading.js';
export type { CrfReading } from './domain/promoteCrfReading.js';
export { promoteLlmParse } from './domain/promoteLlmParse.js';
export { dropTrailingInstruction, segmentClause } from './domain/clauseSegmentation.js';
export { measuresNoSubstance } from './domain/notAFoodLexicon.js';
export type { ClauseSegment } from './domain/clauseSegmentation.js';
export { compareParses } from './domain/parseComparator.js';
export type {
    ComparedFact,
    EngineAnswer,
    EngineAnswers,
    EngineUnavailable,
    ParseAgreement,
    ParseComparison,
    ResolvedAgreement,
} from './domain/parseComparator.js';
export { normalizeQuantity } from './normalizeQuantity.js';
export type { NormalizedQuantity } from './normalizeQuantity.js';
export { splitMeasurement } from './splitMeasurement.js';
export type { SplitMeasurement } from './splitMeasurement.js';
export { findQuantityPhrases } from './quantityPhrases.js';
export type { QuantityPhraseSpan } from './quantityPhrases.js';
export { normalizeDurationToMinutes, normalizeServings } from './valueNormalizers.js';
export type { NormalizedMinutes, NormalizedServings, ValueReviewReason } from './valueNormalizers.js';
