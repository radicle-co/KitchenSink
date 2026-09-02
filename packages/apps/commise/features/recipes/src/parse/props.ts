/**
 * @module @commise/features-recipes/parse/props — the PLATFORM-NEUTRAL prop contracts for the paste and
 * review leaves.
 *
 * One contract, two renderers (`*.tsx` / `*.native.tsx`), the shape every other cross-platform block in
 * this package uses. Keeping the contract in its own module is what makes "web and native cannot drift"
 * enforceable by `tsc` rather than by review: a prop added for one platform fails to compile on the other.
 *
 * Every leaf here is PRESENTATIONAL — `props → JSX`. None fetches, none mutates, none owns a job id.
 * Orchestration (the query, the three mutations, the clock) lives in `../hooks/useParseJobReview.ts`, and
 * the apps own only routing.
 */
import type { ReactNode } from 'react';

import type { ParseJobLineView } from '@kitchensink/recipe-service-client';

import type { ParseJobViewState, ParseSubmissionModel } from './model.js';

// ── The paste surface ─────────────────────────────────────────────────────────────────────────────

/** What the paste form renders and reports. Fully controlled — it holds no state of its own. */
export interface ParsePasteFormProps {
    /** The pasted text. */
    readonly value: string;
    /** Report a keystroke. */
    readonly onChange: (value: string) => void;
    /**
     * The admission projection for `value` — line count and localized refusals.
     *
     * ⛔ Passed IN rather than derived here, so the control that decides whether submission may proceed and
     * the sentence explaining why are provably the same judgement. A leaf re-running the splitter could
     * disable the button for one reason and display another.
     */
    readonly submission: ParseSubmissionModel;
    /** Submit the paste. Only ever called when `submission.canSubmit` and not `submitting`. */
    readonly onSubmit: () => void;
    /** Whether the create request is in flight. */
    readonly submitting: boolean;
    /** A localized failure sentence for a create that did not go through, or `undefined`. */
    readonly errorNotice: string | undefined;
    /**
     * ⛔ Leave the parse surface. REQUIRED, and rendered on both platforms.
     *
     * Optional would have been the easy choice and the wrong one: web hosts this inside `AppShell`, whose
     * nav is always an exit, so a web-only reading says "not needed here". Mobile pushes it over a stack
     * with no chrome, where its absence left a cook with no way off the screen but to kill the app — and an
     * optional prop is exactly how that asymmetry gets reintroduced.
     */
    readonly onBack: () => void;
}

// ── The review surface ────────────────────────────────────────────────────────────────────────────

/** The retry command, as a leaf sees it. */
export interface ParseRetryControl {
    /** Re-drive exactly the lines that did not go through. */
    readonly run: () => void;
    /** Whether a retry is in flight. */
    readonly busy: boolean;
    /** A localized sentence for a retry that was refused or failed, or `undefined`. */
    readonly notice: string | undefined;
}

/** The line-edit command, as a leaf sees it. */
export interface ParseLineEditControl {
    /**
     * Replace one line's text, re-driving its own parse.
     *
     * @param lineIndex - The WIRE index (0-based), never the number shown to the cook.
     * @param sourceLine - The replacement text.
     */
    readonly submit: (lineIndex: number, sourceLine: string) => void;
    /** Which line's edit is in flight, or `undefined`. Not a boolean: two rows must not both look busy. */
    readonly busyLineIndex: number | undefined;
    /** A localized sentence for an edit that was refused or failed, or `undefined`. */
    readonly notice: string | undefined;
}

/**
 * ⛔⛔ THE PER-LINE CORRECTION SEAM — a RENDERING SLOT, deliberately NOT a data contract.
 *
 * A cook looking at a wrong parse needs a way to say so, and `ingredient_parse_corrections` is the table
 * that would hold it. At the time this surface was written the WRITE route for that table did not exist —
 * a sibling change is adding it, mirroring `POST /api/v1/ingredients/corrections`.
 *
 * ⚠️ SO THIS SEAM CARRIES NO PAYLOAD SHAPE, and that is the whole point. The obvious version — a callback
 * taking `{ jobId, lineIndex, sourceLine, proposal }` — would be a GUESS, and very likely the wrong half of
 * the transaction: the recipe service's `parseCorrectionPolicy` identifies a correction by the canonical
 * rendering of the CORRECTED FACTS (what the cook edited *to*), while `proposal` is what they edited
 * *from*. Shipping that signature would hand the follow-up a client contract built on the wrong end.
 *
 * What this surface commits to instead is only what it actually knows: that there is ONE place per line
 * where such a control belongs, that it belongs there only once a proposal has landed (there is nothing to
 * dispute about a line that has not been parsed), and that it renders below the review reasons where the
 * cook is already looking. The follow-up supplies a component that owns the real contract — most likely a
 * `useParseLineCorrection` controller mirroring `useIngredientCorrection`, whose notices can be rendered
 * through the existing `CorrectionNoticeModel` (`../correction/model.ts`) since that type describes a
 * `{ tone, text }` pair and asserts nothing about any wire shape.
 *
 * ## ⚠️ THE ROUTE NOW EXISTS — and the reason this is still a slot is a DEPENDENCY, not a judgement
 *
 * `POST /api/v1/ingredients/parse-corrections` shipped in a sibling change. It is not wired here because
 * its zod is not reachable from this tree yet: `@kitchensink/schema-recipe` publishes no `parseCorrection*`
 * export, and ADR-0014 forbids a client declaring a wire type it cannot import. Wiring it is therefore a
 * follow-up that starts by regenerating that contract package, NOT a design decision left open.
 *
 * What the follow-up will find, recorded so it need not be rediscovered:
 *
 *  - The body is `{ line, parse: { statedMeasure, quantity, unit, foods }, surfacing }`, every object
 *    STRICT (an unknown key is a `400`) and carrying NO scope/origin/user field — the reach is decided
 *    server-side from signed grants, exactly as the resolution correction's is.
 *  - ⛔ It is keyed on the CORRECTED facts — what the cook edited *to* — which is why this slot passes the
 *    line rather than a payload: the parameter here is the CONTEXT, and the control the follow-up renders
 *    owns the edited values.
 *  - ⛔ `recorded: false` (`already_in_force` / `superseded`) IS A SUCCESS. It must render as "already
 *    saved", never as a failure and never as a retryable error — the same rule
 *    `../correction/messages.ts` records for the resolution correction, and the reason
 *    `CorrectionNoticeModel`'s `tone` reserves `error` for one member alone.
 *  - Import the parse types from `@kitchensink/recipe-core` once regenerated, NOT from
 *    `recipe-import-core`: that package is outside the contract import allowlist and would drag
 *    `sanitize-html`, `parse-ingredient` and `fraction.js` into the mobile bundle.
 *
 * TODO(parse-corrections): regenerate `@kitchensink/schema-recipe`, add `recordParseCorrection` to
 * `RecipeServiceClient`, add a `useParseLineCorrection` controller mirroring `useIngredientCorrection`, and
 * pass its rendered control in through this slot. Do not invent the payload here.
 *
 * @param line - The line the control would be about, as the job reports it.
 * @returns The control, or `null`/`undefined` to render nothing for this line.
 */
export type ParseLineCorrectionRenderer = (line: ParseJobLineView) => ReactNode;

/** What one review row renders. */
export interface ParseLineRowProps {
    /** The line as the job reports it — the row derives its own display model. */
    readonly line: ParseJobLineView;
    /** The line-edit command. */
    readonly edit: ParseLineEditControl;
    /** {@link ParseLineCorrectionRenderer} — absent until the correction route ships. */
    readonly renderCorrection?: ParseLineCorrectionRenderer;
}

/** What the review surface renders. */
export interface ParseJobReviewProps {
    /** The single state this surface switches over. */
    readonly state: ParseJobViewState;
    /** The retry command. */
    readonly retry: ParseRetryControl;
    /** The line-edit command. */
    readonly edit: ParseLineEditControl;
    /** Abandon this job and return to the paste form. */
    readonly onStartOver: () => void;
    /**
     * ⛔ Leave the parse surface entirely — see {@link ParsePasteFormProps.onBack}.
     *
     * ⚠️ NOT redundant with `onStartOver`, which goes to the PASTE form. It is also the only control the
     * `running` state offers at all: that branch deliberately renders no retry (there is nothing to
     * re-drive yet), so before this it was a screen with zero affordances on a stack with no chrome.
     */
    readonly onBack: () => void;
    /** {@link ParseLineCorrectionRenderer} — absent until the correction route ships. */
    readonly renderCorrection?: ParseLineCorrectionRenderer;
}
