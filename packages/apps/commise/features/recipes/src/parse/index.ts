/**
 * @module @commise/features-recipes/parse — the paste-and-review ingredient parse surface (plan U9).
 *
 * The copy, the pure projections, the platform-neutral prop contracts, and the two leaves each platform
 * renders. Everything that DECIDES anything is in `model.ts`, which is why the web and native leaves cannot
 * drift on what a job's state is, what a line's measure reads, or which control a cook is offered.
 *
 * ⚠️ ONE specifier per leaf, resolved per platform. `./ParseJobReview.js` is the web `.tsx` under a
 * bundler and the `.native.tsx` twin under Metro, which prefers a `.native` sibling — the same mechanism
 * `RecipeList` and every other cross-platform block in this package relies on, and the one
 * `vitest.native.config.ts`'s `preferNativeLeaves` plugin replicates for the test run. Naming both here
 * would drag `react-native` into a web bundle.
 */
export { ParseJobReview } from './ParseJobReview.js';
export { ParsePasteForm } from './ParsePasteForm.js';
export { recipeParseMessages } from './messages.js';
export type { ParseLineCountLabels, RecipeParseMessages } from './messages.js';
export {
    PARSE_JOB_STALL_BOUND_MS,
    formatParseLineCount,
    toParseJobProgress,
    toParseJobViewState,
    toParseLineModel,
    toParseSubmissionModel,
} from './model.js';
export type {
    ParseCountLabels,
    ParseJobProgress,
    ParseJobViewState,
    ParseJobViewStateInput,
    ParseLineModel,
    ParseLineTone,
    ParseSubmissionModel,
} from './model.js';
export type {
    ParseJobReviewProps,
    ParseLineCorrectionRenderer,
    ParseLineEditControl,
    ParseLineRowProps,
    ParsePasteFormProps,
    ParseRetryControl,
} from './props.js';
