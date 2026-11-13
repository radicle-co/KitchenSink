/**
 * @module @commise/features-recipes/editor — `PrivateFoodsRefusalSheet` (native): the React Native leaf of
 * `./PrivateFoodsRefusalSheet.tsx`, on the same props and words. What Publish, Save changes, Make public or
 * Restore says when the server refuses a public recipe because a line uses a food only the cook can see (ADR-0029
 * section 4; private foods spec section 7). A hard stop the server decided, so it is its own sheet and never the
 * open-choices sheet with a "Publish anyway".
 *
 * A bottom sheet with the footer pinned in the thumb zone. Each line has an "Open food" button below its text; the host
 * closes the sheet and pushes the food page above the editor. Then
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
import { Text as DesignText } from '@commise/ui/text';
import type { FC } from 'react';
import { YStack } from 'tamagui';

import { fillTemplate, pluralOf } from '@commise/i18n';
import { AmountRun } from '../form/AmountRun.native.js';
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
                <YStack gap="$3">
                    {primary.key === 'close' || primary.key === 'back' ? (
                        <Button variant="primary" icon="x" size="lg" width="fill" onPress={act(primary.effect)}>
                            {m[primary.key]}
                        </Button>
                    ) : (
                        <Button variant="primary" icon="lock" size="lg" width="fill" onPress={act(primary.effect)}>
                            {m[primary.key]}
                        </Button>
                    )}
                    {secondary === null ? null : (
                        <Button variant="secondary" size="lg" width="fill" onPress={act(secondary.effect)}>
                            {m[secondary.key]}
                        </Button>
                    )}
                </YStack>
            }
        >
            <YStack gap="$4">
                <DesignText typeRole="body" color="$ink">
                    {pluralOf(m.why, lines.length, locale)}
                </DesignText>
                <YStack gap="$3">
                    {lines.map((line) => (
                        <YStack key={line.rowId} alignItems="flex-start" gap="$2">
                            <AmountRun amount={line.amount}>{line.words}</AmountRun>
                            <Button
                                variant="secondary"
                                size="md"
                                accessibilityLabel={fillTemplate(m.openFoodName, { line: refusedLineLabel(line) })}
                                onPress={() => onOpenFood(line.foodId)}
                            >
                                {m.openFood}
                            </Button>
                        </YStack>
                    ))}
                </YStack>
                <DesignText role="header" typeRole="label" color="$ink">
                    {m.waysHeading}
                </DesignText>
                <YStack gap="$1">
                    {plan.ways.map((way) => (
                        <DesignText key={way} typeRole="body" color="$ink">
                            {m[way]}
                        </DesignText>
                    ))}
                </YStack>
                {plan.slotsFull ? (
                    <DesignText typeRole="meta" color="$inkMuted">
                        {m.slotsFull}
                    </DesignText>
                ) : null}
                {plan.note === null ? null : (
                    <DesignText typeRole="meta" color="$inkMuted">
                        {m[plan.note]}
                    </DesignText>
                )}
            </YStack>
        </Sheet>
    );
};
