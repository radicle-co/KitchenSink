/**
 * @module @commise/features-recipes/form — `RecipeVisibilityField` (native): "Who can see it"
 * (`docs/design/uiOverhaul/buildSpec.md` §7.7 item 2), the React Native leaf of `./RecipeVisibilityField.tsx`, on the
 * same props and the same rule (`visibilityChoice`): a radio group of two 56 pt cards; under `upsell` Private asks for
 * the upsell instead of changing the value, and for a downgraded owner Public on a private recipe asks to confirm
 * (`onConfirmPublic`), its card saying beforehand what it costs (`visibilityFieldOf`; plan 2026-10-14-009 D14, Q5).
 *
 * Styled with Tamagui only (ADR-0080): the card is a themed frame inside the `Pressable` that owns the press and the
 * accessibility, so both colour schemes paint from tokens (owner D15). An unavailable card takes the opaque muted role
 * and no opacity (`colors.ts` rule 3), the one treatment the web leaf shares.
 *
 * @pattern Policy — `visibilityChoice` decides what a choice does; the paid-feature state only derives the badge, the
 *     note and that decision's input, it selects no second mode of the field
 */
import { useMessages } from '@commise/i18n/react';
import { touchFloor } from '@commise/ui/layout';
import { useScreenReaderFocusOnSignal } from '@commise/ui/screen-reader-focus';
import { Text as UiText } from '@commise/ui/text';
import { RecipeVisibility as RecipeVisibilityValue, type RecipeVisibility } from '@kitchensink/recipe-core';
import type { FC } from 'react';
import { Pressable, type View } from 'react-native';
import { styled, XStack, YStack } from 'tamagui';

import { heldVisibility } from '../actions/privateGate.js';
import { editorMessages } from '../editor/messages.js';
import {
    visibilityChoice,
    visibilityFieldOf,
    type RecipeVisibilityFieldProps,
    type VisibilityOption,
} from './props.js';

const Field = styled(YStack, { name: 'VisibilityField', gap: '$2' });
const Cards = styled(YStack, { name: 'VisibilityCards', gap: '$2' });
const Ways = styled(YStack, { name: 'VisibilityWays', gap: '$2', marginTop: '$1' });
const OverLimit = styled(YStack, { name: 'VisibilityOverLimit', gap: '$1', alignItems: 'flex-start' });
const Words = styled(YStack, { name: 'VisibilityWords', flex: 1, minWidth: 0 });

/**
 * A card's frame. The press and the accessibility are the `Pressable` around it. An unavailable card keeps the paper and
 * takes the divider's edge, a muted one: the opaque role and no opacity, as its title does.
 */
const Card = styled(XStack, {
    name: 'VisibilityCard',
    minHeight: 56,
    alignItems: 'center',
    gap: '$3',
    borderWidth: 1,
    borderRadius: '$md',
    paddingHorizontal: '$4',
    paddingVertical: '$2',
    backgroundColor: '$paper',
    borderColor: '$lineControl',

    variants: {
        state: {
            resting: {},
            chosen: { backgroundColor: '$selectedFill', borderColor: '$selectedEdge' },
            refused: { borderColor: '$lineDivider' },
        },
    } as const,

    defaultVariants: { state: 'resting' },
});

/** A card's state: refused wins over chosen, as an unavailable card cannot be the one in force. Pure. */
const cardStateOf = (option: VisibilityOption, chosen: boolean): 'refused' | 'chosen' | 'resting' => {
    if (option.refused) {
        return 'refused';
    }

    return chosen ? 'chosen' : 'resting';
};

/** "Who can see it": Public or Private. */
export const RecipeVisibilityField: FC<RecipeVisibilityFieldProps> = ({
    values,
    onChange,
    facts,
    heldVisibility: held,
    privateRefusal,
    onPremiumRequired,
    onConfirmPublic,
    onFreeASlot,
    webSource,
    publicHeld,
    confirmLine: confirmText,
    focusSignal = 0,
}) => {
    const { visibility: v } = useMessages(editorMessages);
    // A ref, for the reason `useScreenReaderFocusOnSignal` states: moving the reading cursor has no declarative form. It goes to
    // the Public card, not the group: a container that is not itself an accessibility element takes no cursor on iOS, and the
    // card reads its title and, when it is unavailable, the held note as its hint.
    const publicCard = useScreenReaderFocusOnSignal<View>(focusSignal);
    // Idempotent over a host that already passes the held value: the field enforces the rule rather than trusting it.
    const savedVisibility = heldVisibility(held, values.visibility);
    const { shown, options, slotsFull, confirmLine } = visibilityFieldOf({
        draft: values.visibility,
        saved: savedVisibility,
        facts,
        refusal: privateRefusal,
        messages: v,
        ...(webSource === undefined ? {} : { webSource }),
        ...(publicHeld === undefined ? {} : { publicHeld }),
        ...(confirmText === undefined ? {} : { confirmLine: confirmText }),
    });

    const choose = (chosen: RecipeVisibility): void => {
        const next = visibilityChoice(shown, chosen, savedVisibility, facts);

        if (next === 'confirmPublic') {
            onConfirmPublic();
        } else if (next !== undefined) {
            onChange({ ...values, ...next });
        }
    };

    return (
        <Field>
            {/* The group is named by the same words; the visible legend is not read twice. */}
            <UiText aria-hidden typeRole="label" color="$inkMuted">
                {v.legend}
            </UiText>
            <Cards collapsable={false} role="radiogroup" aria-label={v.legend}>
                {options.map((option) => {
                    const chosen = shown === option.value;

                    return (
                        <Pressable
                            key={option.value}
                            ref={option.value === RecipeVisibilityValue.PUBLIC ? publicCard : undefined}
                            role="radio"
                            aria-checked={chosen}
                            // Refused, NOT disabled: the `disabled` prop would take the card out of the focus order and the reason
                            // with it. A screen reader lands on it, hears it dimmed, and reads the reason as its hint; the
                            // press is a no-op (`visibilityChoice`). The label is the title alone so the reason (also drawn
                            // as text) is not read twice.
                            accessibilityState={option.refused ? { disabled: true } : undefined}
                            aria-disabled={option.refused ? true : undefined}
                            accessibilityLabel={option.refused ? option.title : undefined}
                            accessibilityHint={option.refused ? option.note : undefined}
                            onPress={() => choose(option.value)}
                        >
                            <Card state={cardStateOf(option, chosen)}>
                                <Words>
                                    {/* Muted, as every unavailable control is; the reason below keeps its colour. */}
                                    <UiText typeRole="cardTitle" color={option.refused ? '$inkMuted' : '$ink'}>
                                        {option.title}
                                    </UiText>
                                    <UiText typeRole="meta" color="$inkMuted">
                                        {option.hint}
                                    </UiText>
                                    {option.note === undefined ? null : (
                                        <UiText typeRole="meta" color="$inkMuted">
                                            {option.note}
                                        </UiText>
                                    )}
                                </Words>
                            </Card>
                        </Pressable>
                    );
                })}
            </Cards>
            {confirmLine === undefined ? null : (
                // ADR-0095: said before the cook chooses Public.
                <UiText typeRole="meta" color="$inkMuted">
                    {confirmLine}
                </UiText>
            )}
            {slotsFull === undefined ? null : (
                // ADR-0073: the refusal's ways forward. Premium is among them only where paid features are shown.
                <Ways>
                    <UiText role="heading" typeRole="label" color="$ink">
                        {slotsFull.title}
                    </UiText>
                    {slotsFull.overLimit === undefined ? null : (
                        <OverLimit>
                            <UiText typeRole="meta" color="$inkMuted">
                                {slotsFull.overLimit.text}
                            </UiText>
                            {slotsFull.overLimit.premiumLink === undefined ? null : (
                                <Pressable role="button" onPress={onPremiumRequired}>
                                    <YStack minHeight={touchFloor()} justifyContent="center">
                                        <UiText typeRole="label" color="$action" textDecorationLine="underline">
                                            {slotsFull.overLimit.premiumLink}
                                        </UiText>
                                    </YStack>
                                </Pressable>
                            )}
                        </OverLimit>
                    )}
                    {slotsFull.ways.map((way) => (
                        <Pressable
                            key={way.id}
                            role="button"
                            onPress={way.id === 'premium' ? onPremiumRequired : onFreeASlot}
                        >
                            <Card>
                                <Words>
                                    <UiText typeRole="cardTitle" color="$ink">
                                        {way.label}
                                    </UiText>
                                    <UiText typeRole="meta" color="$inkMuted">
                                        {way.detail}
                                    </UiText>
                                </Words>
                            </Card>
                        </Pressable>
                    ))}
                </Ways>
            )}
        </Field>
    );
};
