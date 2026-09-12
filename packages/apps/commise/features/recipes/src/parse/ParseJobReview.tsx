'use client';

/**
 * The WEB review leaf — what a cook sees while a parse job runs and once it settles (plan U9).
 *
 * DESIGN PATTERN: **discriminated union + exhaustive switch (Visitor, satisfied by the language)** over
 * `ParseJobViewState`. The state is decided ONCE, in `model.ts`, from the wire status, the review
 * deadline, the elapsed wait and any error; this file only chooses a rendering for it. A member added to
 * the union is a compile error here rather than a silently blank screen.
 *
 * ⛔ THE RETRY CONTROL IS OFFERED ONLY WHERE IT CAN DO SOMETHING. `POST /{id}/retry` re-drives exactly the
 * `failed_retryable` population, so on a `ready` job it provably does nothing and on an `expired` one the
 * server answers `409`. It appears on `settling` (its purpose) and on `stalled` (where the cook is owed
 * every option), and nowhere else.
 */
import { useMessages } from '@commise/i18n/react';
import { useLocale } from '@commise/i18n/react';
import { useState, type FC, type JSX } from 'react';

import type { ParseJobLineView } from '@kitchensink/recipe-service-client';

import { fillTemplate } from '../list/model.js';
import { recipeParseMessages, type RecipeParseMessages } from './messages.js';
import { toParseLineModel, toParseSubmissionModel, type ParseJobProgress, type ParseLineTone } from './model.js';
import type { ParseJobReviewProps, ParseLineRowProps } from './props.js';

/** Tone → the text colour that carries it. Exhaustive, so a new tone cannot render as default body text. */
const TONE_CLASS: Readonly<Record<ParseLineTone, string>> = {
    progress: 'text-slate',
    success: 'text-ocean-dark',
    warning: 'text-warning',
    error: 'text-error-dark',
};

/** The settled-of-total readout, in its own live region so a screen reader hears it change. */
const ParseProgress: FC<{ readonly progress: ParseJobProgress; readonly messages: RecipeParseMessages }> = ({
    progress,
    messages,
}): JSX.Element => (
    <p role="status" aria-label={messages.progressLabel} className="text-body-sm text-slate">
        {fillTemplate(messages.progressCount, { settled: progress.settled, total: progress.total })}
    </p>
);

/**
 * One review row: the submitted line, what the parse made of it, and the two affordances that act on it.
 *
 * The edit field's open/closed condition and its draft text are the ONLY state this file owns — they are
 * genuinely local (nothing outside the row can observe whether a cook has an editor open), and the command
 * that acts on them is injected.
 */
const ParseLineRow: FC<ParseLineRowProps> = ({ line, edit, renderCorrection }): JSX.Element => {
    const messages = useMessages(recipeParseMessages);
    const locale = useLocale();
    const model = toParseLineModel(line, messages, locale);
    const [draft, setDraft] = useState<string | undefined>(undefined);
    const [pendingText, setPendingText] = useState<string | undefined>(undefined);
    const busy = edit.busyLineIndex === line.lineIndex;
    // ⛔ THE SAME ADMISSION THE PASTE FORM RUNS, on the one line being edited. Pressing Save on a blank or
    // over-long replacement used to do NOTHING and say nothing — while the paste form goes to real trouble
    // to name the offending line. Both refusals are the same shared knowledge (`refuseParseJobLines`); it
    // was simply used on one path and not the other.
    const draftAdmission = draft === undefined ? undefined : toParseSubmissionModel(draft, messages);

    // ⛔ THE EDITOR CLOSES ON SUCCESS, NOT ON SUBMIT. Closing it the moment the request left discarded the
    // cook's typed correction whenever that request failed — the exact loss the paste form goes out of its
    // way to prevent one component over, and inconsistency there is worse than either choice alone. The
    // stored line reading back what was sent IS the server's acceptance, so that is what dismisses it.
    //
    // React's documented "adjust state while rendering" pattern rather than an effect: an effect would
    // paint the stale editor for a frame first.
    if (pendingText !== undefined && line.sourceLine === pendingText) {
        setPendingText(undefined);
        setDraft(undefined);
    }

    return (
        <li aria-label={model.label} className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
            <div className="flex items-baseline justify-between gap-2">
                <span className="text-body-sm font-medium text-charcoal">{model.sourceLine}</span>
                <span className={`shrink-0 text-caption ${TONE_CLASS[model.tone]}`}>{model.statusLabel}</span>
            </div>

            {model.measure !== undefined && <p className="text-body-sm text-charcoal">{model.measure}</p>}

            {model.foods !== undefined && model.foods.length > 0 && (
                <ul aria-label={messages.lineFoodsLabel} className="flex flex-wrap gap-2">
                    {model.foods.map((food, index) => (
                        <li key={`${food.name}-${String(index)}`} className="text-body-sm text-ocean-dark">
                            {food.name}
                            {food.prep !== null && <span className="text-slate">{` · ${food.prep}`}</span>}
                        </li>
                    ))}
                </ul>
            )}

            {/* A line that named no foods is a FACT (a heading is a legitimate line), not a failure. */}
            {model.emptyFoodsNotice !== undefined && (
                <p className="text-body-sm text-slate">{model.emptyFoodsNotice}</p>
            )}

            {model.reviewReasons.length > 0 && (
                <ul aria-label={messages.reasonsLabel} className="flex flex-wrap gap-2">
                    {model.reviewReasons.map((reason) => (
                        <li key={reason} className="rounded-full bg-warning/15 px-3 py-1 text-caption text-charcoal">
                            {reason}
                        </li>
                    ))}
                </ul>
            )}

            {/* ⛔ THE CORRECTION SEAM — offered only once a proposal has landed. See `props.ts`. */}
            {line.proposal !== null && renderCorrection?.(line)}

            {draft === undefined ? (
                <button
                    type="button"
                    onClick={() => setDraft(model.sourceLine)}
                    disabled={busy}
                    aria-busy={busy}
                    className="self-start rounded-full bg-seafoam/10 px-3 py-1 text-caption font-medium text-ocean-dark disabled:opacity-60"
                >
                    {model.editLabel}
                </button>
            ) : (
                <div className="flex flex-col gap-2">
                    <label className="flex flex-col gap-1">
                        <span className="text-caption text-slate">{messages.lineEditLabel}</span>
                        <input
                            type="text"
                            value={draft}
                            onChange={(event) => setDraft(event.target.value)}
                            className="rounded-md border border-border bg-card px-3 py-2 text-body-sm text-charcoal"
                        />
                    </label>
                    {draftAdmission?.refusals.map((refusal) => (
                        <p key={refusal} role="alert" className="text-caption text-error-dark">
                            {refusal}
                        </p>
                    ))}
                    <div className="flex gap-2">
                        <button
                            type="button"
                            // ⛔ THE WIRE INDEX, never the number in the label. The row reads "line 4" and
                            // the API takes `3`; sending the human number edits a different line silently.
                            disabled={busy || draftAdmission?.canSubmit !== true}
                            aria-busy={busy}
                            onClick={() => {
                                const next = draft.trim();

                                // An edit is not a delete — a blank replacement is refused, exactly as the
                                // service's own schema refuses it.
                                if (draftAdmission?.canSubmit !== true || busy) {
                                    return;
                                }

                                // `.trim()`: the service stores the trimmed line, so this is the text the
                                // row will read back on success.
                                setPendingText(next);
                                edit.submit(line.lineIndex, draft);
                            }}
                            className="rounded-full bg-seafoam px-3 py-1 text-caption font-semibold text-ocean-dark"
                        >
                            {messages.lineEditSubmit}
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setPendingText(undefined);
                                setDraft(undefined);
                            }}
                            className="rounded-full bg-card px-3 py-1 text-caption font-medium text-slate"
                        >
                            {messages.lineEditCancel}
                        </button>
                    </div>
                </div>
            )}
        </li>
    );
};

/** The line list — one row per submitted line, in submission order. */
const ParseLineList: FC<{
    readonly lines: readonly ParseJobLineView[];
    readonly edit: ParseJobReviewProps['edit'];
    readonly renderCorrection: ParseJobReviewProps['renderCorrection'];
}> = ({ lines, edit, renderCorrection }): JSX.Element => {
    const messages = useMessages(recipeParseMessages);

    return (
        <ul aria-label={messages.lineListLabel} className="flex flex-col gap-2">
            {lines.map((line) => (
                <ParseLineRow key={line.lineIndex} line={line} edit={edit} renderCorrection={renderCorrection} />
            ))}
        </ul>
    );
};

export const ParseJobReview: FC<ParseJobReviewProps> = ({
    state,
    retry,
    edit,
    onStartOver,
    onBack,
    renderCorrection,
}): JSX.Element => {
    const messages = useMessages(recipeParseMessages);

    // ⛔ Rendered in EVERY branch below, including `running`, which offers nothing else — see
    // `ParseJobReviewProps.onBack`.
    const back = (
        <button
            type="button"
            onClick={onBack}
            className="self-start rounded-full bg-card px-4 py-2 text-body-sm font-medium text-slate"
        >
            {messages.backAction}
        </button>
    );

    const startOver = (
        <button
            type="button"
            onClick={onStartOver}
            className="self-start rounded-full bg-card px-4 py-2 text-body-sm font-medium text-slate"
        >
            {messages.startOverAction}
        </button>
    );

    const retryControl = (
        <button
            type="button"
            onClick={retry.run}
            disabled={retry.busy}
            aria-busy={retry.busy}
            className="self-start rounded-full bg-seafoam px-4 py-2 text-body-sm font-semibold text-ocean-dark disabled:opacity-60"
        >
            {messages.retryAction}
        </button>
    );

    const notices = (
        <>
            {retry.notice !== undefined && (
                <p role="alert" className="text-body-sm text-error-dark">
                    {retry.notice}
                </p>
            )}
            {edit.notice !== undefined && (
                <p role="alert" className="text-body-sm text-error-dark">
                    {edit.notice}
                </p>
            )}
        </>
    );

    switch (state.kind) {
        case 'loading':
            return (
                <section aria-label={messages.reviewHeading} className="flex flex-col gap-3">
                    <p role="status" className="text-body-sm text-slate">
                        {messages.loading}
                    </p>
                    {back}
                </section>
            );

        case 'missing':
            return (
                <section aria-label={messages.reviewHeading} className="flex flex-col gap-3">
                    <p role="alert" className="text-body-sm text-error-dark">
                        {messages.missing}
                    </p>
                    {startOver}
                    {back}
                </section>
            );

        case 'failed':
            return (
                <section aria-label={messages.reviewHeading} className="flex flex-col gap-3">
                    <p role="alert" className="text-body-sm text-error-dark">
                        {messages.failed}
                    </p>
                    {startOver}
                    {back}
                </section>
            );

        // ⛔ NO RETRY HERE. The TTL has passed, `gateMutation` refuses on the timestamp, and the only
        // remedy the server leaves is a fresh paste.
        case 'expired':
            return (
                <section aria-label={messages.reviewHeading} className="flex flex-col gap-3">
                    <p role="alert" className="text-body-sm text-error-dark">
                        {messages.expired}
                    </p>
                    {startOver}
                    {back}
                </section>
            );

        case 'running':
        case 'stalled':
        case 'settling':
            return (
                <section aria-label={messages.reviewHeading} className="flex flex-col gap-3">
                    <h1 className="text-heading-md font-semibold text-charcoal">{messages.reviewHeading}</h1>
                    <ParseProgress progress={state.progress} messages={messages} />
                    <p className="text-body-sm text-slate">
                        {state.kind === 'running'
                            ? messages.running
                            : state.kind === 'stalled'
                              ? messages.stalled
                              : messages.settling}
                    </p>
                    {notices}
                    {retry.busy && (
                        <p role="status" className="text-body-sm text-slate">
                            {messages.retrying}
                        </p>
                    )}
                    {/* `running` is healthy progress and needs no control; the other two are where a cook
                        is owed a way to act. */}
                    {state.kind !== 'running' && (
                        <div className="flex gap-2">
                            {retryControl}
                            {startOver}
                        </div>
                    )}
                    <ParseLineList lines={state.job.lines} edit={edit} renderCorrection={renderCorrection} />
                    {back}
                </section>
            );

        case 'ready':
            return (
                <section aria-label={messages.reviewHeading} className="flex flex-col gap-3">
                    <h1 className="text-heading-md font-semibold text-charcoal">{messages.reviewHeading}</h1>
                    <ParseProgress progress={state.progress} messages={messages} />
                    <p className="text-body-sm text-slate">{messages.ready}</p>
                    {notices}
                    <ParseLineList lines={state.job.lines} edit={edit} renderCorrection={renderCorrection} />
                    <div className="flex gap-2">
                        {startOver}
                        {back}
                    </div>
                </section>
            );
    }
};
