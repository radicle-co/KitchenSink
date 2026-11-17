'use client';

/**
 * @module @commise/features-recipes/editor — `PrivateFoodsRefusalSheet` (web): what Publish, Save changes, Make public or
 * Restore says when the server refuses a public recipe because a line uses a food only the cook can see (ADR-0029
 * section 4; private foods spec section 7). A hard stop the server decided, so it is its own sheet and never the
 * open-choices sheet with a "Publish anyway".
 *
 * It lists the lines, each with an "Open food" button below its text (opens a new tab so the recipe stays here), then
 * the ways forward this cook has (`refusalPlanOf`). A cook who cannot go private sees the ways that work and one line
 * that their private recipes are full, never an upsell. Every close route means "back to the editor".
 *
 * Presentational: props in, markup out.
 *
 * @pattern Adapter over the design-system `Sheet` — a refusal's words and its one dismiss path on the house sheet
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { Sheet } from '@commise/ui/sheet';
import type { FC } from 'react';

import { fillTemplate, pluralOf } from '@commise/i18n';
import { AmountRun } from '../form/AmountRun.js';
import { refusalPlanOf } from '../foodPage/privateFoodsRefusal.js';
import { editorMessages } from './messages.js';
import { refusedLineLabel } from './refusedLineText.js';
import type { PrivateFoodsRefusalSheetProps } from './privateFoodsRefusalSheetProps.js';

/** The refusal sheet. */
export const PrivateFoodsRefusalSheet: FC<PrivateFoodsRefusalSheetProps> = ({
    open,
    door,
    canGoPrivate,
    lines,
    onOpenFood,
    onSendAsPrivate,
    onClose,
    onDismissed,
}) => {
    const { publishRefused: m } = useMessages(editorMessages);
    const locale = useLocale();
    const plan = refusalPlanOf({ door, canGoPrivate });
    const act = (effect: 'sendAsPrivate' | 'close'): (() => void) => (effect === 'close' ? onClose : onSendAsPrivate);
    const primary = plan.primary;
    const secondary = plan.secondary;

    return (
        <Sheet
            open={open}
            onOpenChange={(next) => {
                if (!next) {
                    onClose();
                }
            }}
            {...(onDismissed === undefined ? {} : { onDismissed })}
            title={m.title}
            closeLabel={m.closeLabel}
            size="content"
            presentation="dialog"
            footer={
                <div className="flex flex-col gap-3 sm:flex-row-reverse">
                    {primary.key === 'close' || primary.key === 'back' ? (
                        <Button variant="primary" icon="x" onPress={act(primary.effect)}>
                            {m[primary.key]}
                        </Button>
                    ) : (
                        <Button variant="primary" icon="lock" onPress={act(primary.effect)}>
                            {m[primary.key]}
                        </Button>
                    )}
                    {secondary === null ? null : (
                        <Button variant="secondary" onPress={act(secondary.effect)}>
                            {m[secondary.key]}
                        </Button>
                    )}
                </div>
            }
        >
            <div className="flex flex-col gap-4">
                <p className="text-body text-ink">{pluralOf(m.why, lines.length, locale)}</p>
                <ul className="flex flex-col gap-3">
                    {lines.map((line) => (
                        <li key={line.rowId} className="flex flex-col items-start gap-2">
                            <AmountRun amount={line.amount}>{line.words}</AmountRun>
                            <Button
                                variant="secondary"
                                size="md"
                                accessibilityLabel={fillTemplate(m.openFoodNameWeb, { line: refusedLineLabel(line) })}
                                onPress={() => onOpenFood(line.foodId)}
                            >
                                {m.openFood}
                            </Button>
                        </li>
                    ))}
                </ul>
                <p className="text-meta text-ink-muted">{m.newTab}</p>
                <h3 className="text-label text-ink">{m.waysHeading}</h3>
                <ul className="flex flex-col gap-1">
                    {plan.ways.map((way) => (
                        <li key={way} className="text-body text-ink">
                            {m[way]}
                        </li>
                    ))}
                </ul>
                {plan.slotsFull ? <p className="text-meta text-ink-muted">{m.slotsFull}</p> : null}
                {plan.note === null ? null : <p className="text-meta text-ink-muted">{m[plan.note]}</p>}
            </div>
        </Sheet>
    );
};
