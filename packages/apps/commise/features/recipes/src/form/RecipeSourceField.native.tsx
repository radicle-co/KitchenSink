/**
 * @module @commise/features-recipes/form — `RecipeSourceField` (native): the Source row in Photos & publish (ADR-0089), the
 * React Native leaf of `./RecipeSourceField.tsx`, on the same props, the same row model (`sourceRowOf`) and the same copy.
 * Styled with Tamagui only (ADR-0080).
 *
 * What differs from web, and why:
 * - React Native has no `aria-describedby`, so the field is given its hint, status and error as its accessibility hint
 *   (`hint`, `error`), and each is also drawn.
 * - React Native has no declarative link: the locked site opens through `onOpen`, which defaults to the platform's URL
 *   opener, and its accessible name says it opens in the browser.
 * - The field asks for a URL keyboard with no capitalisation or autocorrect, as on web.
 *
 * @pattern Visitor — an exhaustive switch over the discriminated union `SourceRowModel`
 * @pattern Adapter — `onOpen` wraps the platform's URL opener
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { FieldLabel, Input } from '@commise/ui/input';
import { touchFloor } from '@commise/ui/layout';
import { PressScale } from '@commise/ui/press-scale';
import { Text } from '@commise/ui/text';
import { SOURCE_LINK_INPUT_MAX_LENGTH } from '@kitchensink/recipe-core';
import type { FC } from 'react';
import { styled, YStack } from 'tamagui';

import { editorMessages } from '../editor/messages.js';
import { fillTemplate } from '../format/fillTemplate.js';
import { openExternalUrl } from '../detail/openExternalUrl.native.js';
import { sourceErrorId, sourceNoteId } from './fieldErrorIds.js';
import { sourceFieldId } from './fieldIds.js';
import type { RecipeSourceFieldNativeProps } from './sourceFieldProps.js';

const Column = styled(YStack, { name: 'SourceField', gap: '$1' });

// The site is often a short string, and a link that small is unhittable under the touch floor.
const LinkTouch = styled(YStack, { name: 'SourceLinkTouch', justifyContent: 'center', minHeight: touchFloor() });

// `actionText` is 6.20:1 on the light page and 9.61:1 on the dark one. Underlined so the affordance does not ride on colour alone.
const LinkText = styled(Text, {
    name: 'SourceLinkText',
    typeRole: 'caption',
    color: '$actionText',
    textDecorationLine: 'underline',
});

/** The Source row. */
export const RecipeSourceField: FC<RecipeSourceFieldNativeProps> = ({
    row,
    onChange,
    onRemove,
    onTouched,
    focusRequested,
    onFocusHandled,
    onOpen = openExternalUrl,
}) => {
    const { source: m } = useMessages(editorMessages);

    if (row.kind === 'hidden') {
        return null;
    }

    if (row.kind === 'locked') {
        return (
            <Column>
                <Text typeRole="label" color="$inkMuted">
                    {m.label}
                </Text>
                <PressScale
                    accessibilityRole="link"
                    accessibilityLabel={fillTemplate(m.openLinkNative, { site: row.site })}
                    onPress={() => onOpen(row.url)}
                >
                    <LinkTouch>
                        <LinkText>{fillTemplate(m.openLinkNative, { site: row.site })}</LinkText>
                    </LinkTouch>
                </PressScale>
                <Text typeRole="meta" color="$inkMuted" flexShrink={1}>
                    {row.url}
                </Text>
                <Text typeRole="meta" color="$inkMuted">
                    {m.locked}
                </Text>
            </Column>
        );
    }

    // empty, filled, invalid or a Commise link: the field.
    const error = row.kind === 'invalid' ? m.invalid : row.kind === 'ownSite' ? m.ownSite : undefined;
    const status = row.kind === 'filled' ? fillTemplate(m.rightsLabel, { site: row.site }) : m.hint;
    const pasted = row.kind === 'filled' && row.fromPaste;

    return (
        <Column>
            <FieldLabel forId={sourceFieldId} label={m.label} hint={status} />
            <Input
                id={sourceFieldId}
                value={row.text}
                label={m.label}
                hint={pasted ? `${status} ${m.fromPaste}` : status}
                inputMode="url"
                maxLength={SOURCE_LINK_INPUT_MAX_LENGTH}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                {...(error === undefined ? {} : { error })}
                focusRequested={focusRequested}
                onFocusRequestHandled={onFocusHandled}
                onChangeText={onChange}
                onSubmit={onTouched}
            />
            {pasted ? (
                <Text nativeID={sourceNoteId} typeRole="meta" color="$inkMuted">
                    {m.fromPaste}
                </Text>
            ) : null}
            {error === undefined ? null : (
                <Text nativeID={sourceErrorId} accessibilityRole="alert" typeRole="meta" color="$dangerText">
                    {error}
                </Text>
            )}
            {row.text === '' ? null : (
                // Hugging its label at the start, not stretched across the column.
                <YStack alignItems="flex-start">
                    <Button variant="ghost" onPress={onRemove}>
                        {m.remove}
                    </Button>
                </YStack>
            )}
        </Column>
    );
};
