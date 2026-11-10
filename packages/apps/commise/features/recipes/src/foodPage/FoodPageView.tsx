'use client';

/**
 * @module @commise/features-recipes/foodPage — `FoodPageView` (web): the author's food page body, under the frame's
 * title (private foods spec section 5). One of twelve states: loading, not found, error, offline, the seven author
 * states, and another cook's public food. The state's words, badges and actions come from `foodPageCopyOf`, so this leaf
 * only draws them.
 *
 * Presentational: `props → JSX`. The actions are one group in the DOM: at the end of the content on a phone (where the
 * thumb is, full width, the primary on top) and inside the status panel from 600 px (reading order, a row with the
 * primary last), moved by CSS, never duplicated.
 *
 * @pattern Visitor — an exhaustive switch over the `FoodPageState` union
 */
import { offlineNoticeMessages } from '@commise/features-core/offline';
import { useLocale, useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { ConfirmDialog } from '@commise/ui/confirm-dialog';
import { LoadingNotice } from '@commise/ui/loading-notice';
import { OfflineReadSlot } from '@commise/ui/offline-notice';
import { StateNotice } from '@commise/ui/state-notice';
import { StatusBadge } from '@commise/ui/status-badge';
import type { FC } from 'react';

import { fillTemplate } from '../format/fillTemplate.js';
import { figureText } from './foodEditComparison.js';
import { foodPageCopyOf, type FoodShownState } from './foodPageCopy.js';
import type { FoodPageViewProps } from './foodPageViewProps.js';
import { foodPageMessages } from './messages.js';

/** The glyph each action draws before its words. */
const ACTION_ICON = { edit: 'pencilLine', ask: 'globe' } as const;

/** The food page body. */
export const FoodPageView: FC<FoodPageViewProps> = (props) => {
    const m = useMessages(foodPageMessages);
    const offline = useMessages(offlineNoticeMessages);
    const { state } = props;

    switch (state.kind) {
        case 'loading':
            return <LoadingNotice label={m.loading} />;
        case 'offline':
            return <OfflineReadSlot message={offline.readOffline} />;
        case 'notFound':
            return (
                <StateNotice
                    title={m.notFound.title}
                    body={m.notFound.body}
                    primary={{ label: props.leaveLabel ?? m.notFound.toRecipes, icon: 'house', onPress: props.onLeave }}
                />
            );
        case 'error':
            return (
                <StateNotice
                    title={m.error.title}
                    primary={{ label: m.error.retry, icon: 'rotateCcw', onPress: props.onRetry }}
                />
            );
        default:
            return <FoodShown {...props} state={state} />;
    }
};

/** A state that has a food to show. Presentational: `props → JSX`. */
const FoodShown: FC<FoodPageViewProps & { readonly state: FoodShownState }> = ({
    state,
    ask,
    withdraw,
    onEdit,
    onAsk,
    onWithdraw,
    onWithdrawConfirm,
    onWithdrawKeep,
}) => {
    const m = useMessages(foodPageMessages);
    const locale = useLocale();
    const copy = foodPageCopyOf(state, m, locale);
    const macros = state.food.authoredMacros;
    const figures: readonly (readonly [string, number | undefined, 'kcal' | 'g'])[] = [
        [m.nutrition.calories, macros?.calories, 'kcal'],
        [m.nutrition.protein, macros?.proteinG, 'g'],
        [m.nutrition.carbs, macros?.carbsG, 'g'],
        [m.nutrition.fat, macros?.fatG, 'g'],
    ];
    const name = state.food.name ?? m.titleFallback;
    const press = { edit: onEdit, ask: onAsk } as const;

    const actions =
        copy.actions.length === 0 ? null : (
            <div
                data-actions
                className="order-[90] flex flex-col-reverse gap-3 @regular/main:order-none @regular/main:flex-row @regular/main:flex-wrap @regular/main:justify-end"
            >
                {copy.actions.map((action) => {
                    const common = {
                        size: 'lg',
                        width: 'fill',
                        disabled: copy.actionsDisabled,
                        busy: action.key === 'ask' && ask === 'busy',
                        description: copy.actionsNote,
                        onPress: press[action.key],
                    } as const;
                    const label = action.key === 'ask' && ask === 'busy' ? m.ask.busy : m.action[action.key];

                    return (
                        <div key={action.key} data-action className="w-full @regular/main:w-auto">
                            {action.variant === 'primary' ? (
                                <Button variant="primary" icon={ACTION_ICON[action.key]} {...common}>
                                    {label}
                                </Button>
                            ) : (
                                <Button variant="secondary" icon={ACTION_ICON[action.key]} {...common}>
                                    {label}
                                </Button>
                            )}
                        </div>
                    );
                })}
                {copy.actionsNote === undefined ? null : (
                    <p aria-hidden className="text-meta text-ink-muted @regular/main:w-full @regular/main:text-end">
                        {copy.actionsNote}
                    </p>
                )}
                {ask === 'failed' ? (
                    <p role="alert" className="text-meta text-danger-text @regular/main:w-full @regular/main:text-end">
                        {m.ask.failed}
                    </p>
                ) : null}
            </div>
        );

    return (
        <div className="flex flex-col gap-4">
            <ul className="order-1 flex flex-wrap gap-2">
                {copy.badges.map((badge) => (
                    <li key={badge.text}>
                        <StatusBadge status={badge.status}>{badge.text}</StatusBadge>
                    </li>
                ))}
            </ul>

            {/* One group of actions in the DOM. On a phone the panel is `contents`: the statement keeps its own card and
                the actions fall to the end of the page by `order` (where the thumb is). From 600 the panel is the card
                and the actions sit inside it, under its text. */}
            {copy.statement === undefined && actions === null ? null : (
                <section className="order-2 contents @regular/main:flex @regular/main:flex-col @regular/main:gap-3 @regular/main:rounded-lg @regular/main:bg-paper @regular/main:p-4">
                    {copy.statement === undefined ? null : (
                        <div className="order-2 flex flex-col gap-1 rounded-lg bg-paper p-4 @regular/main:order-none @regular/main:rounded-none @regular/main:bg-transparent @regular/main:p-0">
                            <p className="text-card-title text-ink" tabIndex={-1}>
                                {copy.statement}
                            </p>
                            {copy.details.map((line) => (
                                <p key={line} className="text-meta text-ink-muted">
                                    {line}
                                </p>
                            ))}
                        </div>
                    )}
                    {actions}
                </section>
            )}

            {copy.comparison === undefined ? null : (
                <section className="order-4 flex flex-col gap-2">
                    <h2 className="text-section-title text-ink">{copy.comparison.heading}</h2>
                    <ul className="flex flex-col gap-2">
                        {copy.comparison.rows.map((row) => (
                            <li key={row.label} aria-label={row.spoken} className="flex flex-col">
                                <span aria-hidden className="text-meta text-ink-muted">
                                    {row.label}
                                </span>
                                <span aria-hidden className="text-body text-ink">
                                    {row.text}
                                </span>
                            </li>
                        ))}
                    </ul>
                    <p className="text-meta text-ink-muted">{copy.comparison.rest}</p>
                </section>
            )}

            <section className="order-5 flex flex-col gap-2">
                <h2 className="text-section-title text-ink">{m.nutrition.heading}</h2>
                <ul className="flex flex-col gap-2">
                    {figures.map(([label, amount, unit]) => (
                        <li key={label} className="flex flex-wrap justify-between gap-x-4">
                            <span className="text-meta text-ink-muted">{label}</span>
                            <span className="text-meta text-ink">
                                {amount === undefined ? '–' : `${figureText(amount)} ${m.unit[unit]}`}
                            </span>
                        </li>
                    ))}
                </ul>
            </section>

            {state.food.portions.length === 0 ? null : (
                <section className="order-6 flex flex-col gap-2">
                    <h2 className="text-section-title text-ink">{m.portions.heading}</h2>
                    <ul className="flex flex-col gap-1">
                        {state.food.portions.map((portion) => (
                            <li key={portion.label} className="text-meta text-ink">
                                {`${portion.label} · ${figureText(portion.gramWeight)} ${m.unit.g}`}
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {copy.withdraw.offered ? (
                <div className="order-[95] mt-4 border-t border-line-divider pt-6">
                    <Button variant="destructive" icon="trash" size="md" onPress={onWithdraw}>
                        {m.action.withdraw}
                    </Button>
                </div>
            ) : null}

            <ConfirmDialog
                open={withdraw.open}
                title={fillTemplate(m.withdraw.title, { name })}
                body={copy.withdraw.body}
                confirm={{ label: m.withdraw.confirm, icon: 'trash' }}
                keep={{ label: m.withdraw.keep }}
                busy={withdraw.busy}
                busyLabel={m.withdraw.busy}
                {...(withdraw.failed ? { error: m.withdraw.failed } : {})}
                onConfirm={onWithdrawConfirm}
                onKeep={onWithdrawKeep}
            />
        </div>
    );
};
