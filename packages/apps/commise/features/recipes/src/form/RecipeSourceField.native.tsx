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
 * @pattern Visitor — an exhaustive switch over the discriminated union `SourceFieldView` (`sourceFieldViewOf`)
 * @pattern Adapter — `onOpen` wraps the platform's URL opener
 */
import { fillTemplate } from '@commise/i18n';
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { FieldLabel, Input } from '@commise/ui/input';
import { touchFloor } from '@commise/ui/layout';
import { PressScale } from '@commise/ui/press-scale';
import { useScreenReaderFocusOnSignal } from '@commise/ui/screen-reader-focus';
import { Text } from '@commise/ui/text';
import { SOURCE_LINK_INPUT_MAX_LENGTH } from '@kitchensink/recipe-core';
import type { ComponentRef, FC } from 'react';
import { styled, YStack } from 'tamagui';

import { recipeActionMessages } from '../actions/messages.js';
import { editorMessages } from '../editor/messages.js';
import { openExternalUrl } from '../detail/openExternalUrl.native.js';
import { sourceErrorId, sourceNoteId, sourceWarningId } from './fieldErrorIds.js';
import { sourceFieldId } from './fieldIds.js';
import { sourceFieldViewOf, type SourceFieldView } from './sourceFieldView.js';
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

/** The help link of a locked row, and of "I wrote this" (its own words): a link-role press target, never a button. */
const HelpLink: FC<{ readonly href?: string; readonly text: string; readonly onOpen: (url: string) => void }> = ({
    href,
    text,
    onOpen,
}) =>
    href === undefined ? null : (
        <PressScale
            accessibilityRole="link"
            accessibilityLabel={text}
            onPress={() => {
                onOpen(href);
            }}
        >
            <LinkTouch>
                <LinkText>{text}</LinkText>
            </LinkTouch>
        </PressScale>
    );

/** A citation, when there is one. */
const Citation: FC<{ readonly text?: string }> = ({ text }) =>
    text === undefined ? null : (
        <Text typeRole="meta" color="$inkMuted" flexShrink={1}>
            {text}
        </Text>
    );

/** A ghost button hugging its label at the start of the column. */
const StartButton: FC<{ readonly label: string; readonly onPress: () => void }> = ({ label, onPress }) => (
    <YStack alignItems="flex-start">
        <Button variant="ghost" onPress={onPress}>
            {label}
        </Button>
    </YStack>
);

type FieldView = Extract<SourceFieldView, { readonly kind: 'field' }>;

/** The field: empty, filled, unusable or a Commise link. */
const SourceInput: FC<{
    readonly view: FieldView;
    readonly onChange: (text: string) => void;
    readonly onTouched: () => void;
    readonly onRemove: () => void;
    readonly onAsk: RecipeSourceFieldNativeProps['onAsk'];
}> = ({ view, onChange, onTouched, onRemove, onAsk }) => {
    const { source: m } = useMessages(editorMessages);
    const { status, warning, error, pasted } = view;
    const hint = [status, pasted ? m.fromPaste : undefined, warning].filter((part) => part !== undefined).join(' ');

    return (
        <Column>
            <FieldLabel forId={sourceFieldId} label={m.label} hint={status} />
            <Input
                id={sourceFieldId}
                value={view.text}
                label={m.label}
                hint={hint}
                inputMode="url"
                maxLength={SOURCE_LINK_INPUT_MAX_LENGTH}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                {...(error === undefined ? {} : { error })}
                onChangeText={onChange}
                onSubmit={onTouched}
            />
            {pasted ? (
                <Text nativeID={sourceNoteId} typeRole="meta" color="$inkMuted">
                    {m.fromPaste}
                </Text>
            ) : null}
            {warning === undefined ? null : (
                <Text nativeID={sourceWarningId} typeRole="meta" color="$inkMuted">
                    {warning}
                </Text>
            )}
            {error === undefined ? null : (
                <Text nativeID={sourceErrorId} accessibilityRole="alert" typeRole="meta" color="$dangerText">
                    {error}
                </Text>
            )}
            {view.text === '' ? null : <StartButton label={m.remove} onPress={onRemove} />}
            <StartButton
                label={m.sayWhere}
                onPress={() => {
                    onAsk('firstAnswer');
                }}
            />
        </Column>
    );
};

/** The Source row. */
export const RecipeSourceField: FC<RecipeSourceFieldNativeProps> = ({
    row,
    onChange,
    onRemove,
    onTouched,
    onAsk,
    askHref,
    focusSignal = 0,
    onOpen = openExternalUrl,
}) => {
    const answer = useScreenReaderFocusOnSignal<ComponentRef<typeof Text>>(focusSignal);
    const { source: m } = useMessages(editorMessages);
    const { sourceStatement: answers } = useMessages(recipeActionMessages);
    const view = sourceFieldViewOf(row, m, answers);

    switch (view.kind) {
        case 'hidden':
            return null;
        case 'own':
            return (
                <Column>
                    <Text typeRole="label" color="$inkMuted">
                        {m.label}
                    </Text>
                    <Text typeRole="body" color="$ink">
                        {view.answer}
                    </Text>
                    <StartButton
                        label={m.changeOwn}
                        onPress={() => {
                            onAsk('downgrade');
                        }}
                    />
                    <HelpLink href={askHref} text={m.askOtherNative} onOpen={onOpen} />
                </Column>
            );
        case 'openAnswered':
            return (
                <Column>
                    <Text typeRole="label" color="$inkMuted">
                        {m.label}
                    </Text>
                    <Text typeRole="body" color="$ink">
                        {view.answer}
                    </Text>
                    <Citation text={view.citation} />
                    <Text typeRole="meta" color="$inkMuted">
                        {m.lockWarning}
                    </Text>
                    <StartButton
                        label={m.changeAnswer}
                        onPress={() => {
                            onAsk('change');
                        }}
                    />
                </Column>
            );
        case 'locked':
            return (
                <Column>
                    <Text typeRole="label" color="$inkMuted">
                        {m.label}
                    </Text>
                    <PressScale
                        accessibilityRole="link"
                        accessibilityLabel={fillTemplate(m.openLinkNative, { site: view.site })}
                        onPress={() => {
                            onOpen(view.url);
                        }}
                    >
                        <LinkTouch>
                            <LinkText>{fillTemplate(m.openLinkNative, { site: view.site })}</LinkText>
                        </LinkTouch>
                    </PressScale>
                    <Text typeRole="meta" color="$inkMuted" flexShrink={1}>
                        {view.url}
                    </Text>
                    <Text typeRole="meta" color="$inkMuted">
                        {m.locked}
                    </Text>
                    <HelpLink href={askHref} text={m.askChangeNative} onOpen={onOpen} />
                </Column>
            );
        case 'lockedAnswer':
            return (
                <Column>
                    <Text typeRole="label" color="$inkMuted">
                        {m.label}
                    </Text>
                    {view.answer === undefined ? null : (
                        <Text ref={answer} typeRole="body" color="$ink">
                            {view.answer}
                        </Text>
                    )}
                    <Citation text={view.citation} />
                    <Text typeRole="meta" color="$inkMuted">
                        {m.locked}
                    </Text>
                    <HelpLink href={askHref} text={m.askChangeNative} onOpen={onOpen} />
                </Column>
            );
        case 'field':
            return (
                <SourceInput view={view} onChange={onChange} onTouched={onTouched} onRemove={onRemove} onAsk={onAsk} />
            );
    }
};
