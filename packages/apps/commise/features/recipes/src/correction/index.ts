/**
 * @module @commise/features-recipes/correction — the ingredient-correction affordance's shared surface
 * (plan U14 / R19, R20).
 *
 * Barrel only: the copy, the client-side state union, and the two pure projections both platform leaves
 * render through. There is no component here — the control's markup is each platform's, and everything that
 * DECIDES anything is in `model.ts`, which is why the two leaves cannot drift on what a correction did.
 */
export { recipeCorrectionMessages } from './messages.js';
export type { RecipeCorrectionMessages } from './messages.js';
export { toCorrectionNoticeModel, toCorrectionViewState } from './model.js';
export type {
    CorrectionNoOutcome,
    CorrectionNoticeModel,
    CorrectionNoticeTone,
    CorrectionScope,
    CorrectionViewState,
} from './model.js';
