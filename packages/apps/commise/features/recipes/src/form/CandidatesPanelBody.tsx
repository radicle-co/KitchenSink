'use client';

/**
 * @module @commise/features-recipes/form — the web `CandidatesPanelBody`, the panel body of rows 6 and 7 (SPECIFY.1),
 * presentational: it draws the view `shortlistPanelOf` derives from the progressive food search and hands each press to
 * its host (`docs/design/rowEditorOpenDecisions.md`, S7 list contract P12).
 *
 * - The view's own explanation, then what the search holds: one named list per group, our database's foods first and
 *   each remote source's after under its visible `From {source}` heading, one button per food; or one sentence for
 *   loading, offline, empty or a failed read. Loading and offline are a `status`, a failed read an `alert` with Try
 *   again (WCAG 4.1.3).
 * - After the lists, one polite line: the waiting line while the answer runs, then what could not be searched and each
 *   source's note. It is mounted with the lists, so it speaks once, when the answer ends (P7, per row). Frames only add
 *   lists after the last, so nothing shown moves (P2).
 * - A pick's failure or the cook's limit is said assertively, the limit again at each refused press (R8).
 * - None of these is always last, so the cook is never left without a way on (§3a).
 *
 * @pattern Visitor — an exhaustive switch over the view's body union
 */
import { useMessages } from '@commise/i18n/react';
import { BUSY_CONTROL_CLASS, Button, busyControlProps } from '@commise/ui/button';
import { LiveRegion } from '@commise/ui/live-region';
import type { FC, ReactElement } from 'react';

import type { CandidatesPanelBody as Body, CandidatesPanelBodyProps } from './candidatesPanel.js';
import { RetryIcon, SearchIcon } from './icons.js';
import { recipeFormMessages } from './messages.js';

/** Rows 6 and 7's panel body: the candidates, a pick per candidate, and None of these. */
export const CandidatesPanelBody: FC<CandidatesPanelBodyProps> = ({ view, onPick, onRetryRead, onNoneOfThese }) => {
    const m = useMessages(recipeFormMessages);

    const contentOf = (body: Body): ReactElement => {
        switch (body.kind) {
            case 'list': {
                const line = body.waiting ?? body.notes.join(' ');

                return (
                    <>
                        {body.groups.map((group) => (
                            <div key={group.key} className="flex w-full flex-col">
                                {group.heading && (
                                    <p aria-hidden className="px-3 pt-2 text-caption font-semibold text-slate">
                                        {group.label}
                                    </p>
                                )}
                                <ul aria-label={group.label} className="flex w-full flex-col">
                                    {group.options.map((option) => (
                                        <li key={option.candidateId}>
                                            <button
                                                type="button"
                                                aria-label={option.accessibleName}
                                                {...busyControlProps({
                                                    busy: option.busy,
                                                    blocked: option.blocked,
                                                    onClick: () => onPick(option.candidateId),
                                                })}
                                                className={`w-full rounded-lg px-3 py-2 text-left text-body-sm text-charcoal transition hover:bg-pearl ${BUSY_CONTROL_CLASS}`}
                                            >
                                                {option.name}
                                                {option.summary !== undefined && (
                                                    <span className="block text-caption text-slate">
                                                        {option.summary}
                                                    </span>
                                                )}
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                        <p role="status" className={line === '' ? 'sr-only' : 'text-caption text-slate'}>
                            {line}
                        </p>
                    </>
                );
            }

            case 'failed':
                return (
                    <>
                        <p role="alert">{body.text}</p>
                        <Button variant="secondary" icon={<RetryIcon />} onPress={onRetryRead}>
                            {m.statusActionRetry}
                        </Button>
                    </>
                );
            case 'loading':
            case 'offline':
                return (
                    <p role="status" className="text-slate">
                        {body.text}
                    </p>
                );
            case 'empty':
                return <p className="text-slate">{body.text}</p>;
        }
    };

    return (
        <div className="flex flex-col items-start gap-2">
            <p>{view.explanation}</p>
            {contentOf(view.body)}
            <LiveRegion politeness="assertive" occurrence={view.alertOccurrence} className="text-error-dark">
                {view.alert}
            </LiveRegion>
            <Button variant="secondary" icon={<SearchIcon />} onPress={onNoneOfThese}>
                {m.statusActionNoneOfThese}
            </Button>
        </div>
    );
};
