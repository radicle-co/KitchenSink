/**
 * @module @commise/features-recipes/editor — the native one-page recipe editor (build spec §7, §7.12; owner decisions
 * D1, D2, D3, D12): the header, the section index, the four sections, the action bar and the notices, over the editor's
 * lifecycle (`useRecipeEditor`). Create and edit are this one screen.
 *
 * ORCHESTRATION of the screen: it owns the screen's one `ScrollHost` and its one vertical scroller, and draws what
 * `useEditorPage` decides — the same model the web leaf draws. Native adds what its platform alone has:
 *
 * - each section is a DIRECT child of the scroller's content, reporting its layout to the host (blueprint A7);
 * - a jump moves the SCREEN-READER cursor to the section's heading (the host holds no heading refs);
 * - the action bar sits outside the scroller in the thumb zone, and becomes the scroller's last content when the
 *   header and the bar together would take more than half the frame (`usePinnedFooter`; `compactHeightLayout.md` A1);
 * - while the keyboard is open the section bar hides, so the header alone holds the top edge (build spec §7.1). The
 *   pinning measures the header alone, so the bar hiding never moves the action bar back;
 * - an ingredient field whose list opens behind the bar or the keyboard is revealed (`useFieldRevealHost`), over the
 *   host's one scroller; and the cook's drag on that scroller closes an open food list unless it began on the list
 *   (`useScrollerDragHost`).
 *
 * No back-to-top control (D3): a second tap on the tab and the iOS status-bar tap do that job. × never asks.
 *
 * @pattern Mediator — the screen's chrome, sections and scroller coordinated around the editor's lifecycle
 */
import { ConfirmDialog } from '@commise/ui/confirm-dialog';
import {
    FieldRevealContext,
    RevealSpacer,
    ScrollerDragContext,
    isRevealScroller,
    useFieldRevealHost,
    useScrollerDragHost,
} from '@commise/ui/field-reveal';
import { KeyboardAvoider } from '@commise/ui/keyboard-avoider';
import { useContainerClass, useKeyboardShown, usePinnedFooter } from '@commise/ui/layout';
import { LiveRegion } from '@commise/ui/live-region';
import { nativeTokens } from '@commise/ui/native';
import { ScrollHost, useScrollHost, type ScrollBind } from '@commise/ui/scroll-host';
import { SectionIndex } from '@commise/ui/section-index';
import { useTheme } from '@commise/ui/theme';
import { useState, type FC } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { RecipeConflictView } from '../versions/RecipeConflictView.js';
import { EditorActionBar } from './EditorActionBar.js';
import { EditorHeader } from './EditorHeader.js';
import { FailureAlert } from './FailureAlert.js';
import { ResumeNotice } from './ResumeNotice.js';
import { UnmatchedNote } from './UnmatchedNote.js';
import { EditorSection } from './EditorSection.js';
import type { RecipeEditorViewProps } from './frameProps.js';
import { EDITOR_SECTIONS, isEditorSectionId, type EditorSectionId } from './sections.js';
import { useEditorPage } from './useEditorPage.js';

/** How far below the scroller's top the scroll spy's activation line sits, pt. */
const ACTIVATION_OFFSET_PT = 96;

/** The native one-page recipe editor. */
export const RecipeEditorView: FC<RecipeEditorViewProps> = (props) => {
    const { editor } = props;

    if (editor.state.status === 'done') {
        return null;
    }

    if (editor.state.status === 'conflict') {
        const conflict = editor.state;

        return (
            <RecipeConflictView
                server={conflict.server}
                {...(conflict.base === undefined ? {} : { base: conflict.base })}
                diff={conflict.diff}
                versionsBehind={conflict.versionsBehind}
                neverPublished={conflict.neverPublished}
                isResolving={conflict.isResolving}
                selections={conflict.mergeSelections}
                onSelectionsChange={editor.resolutions.setMergeSelections}
                onKeepServer={editor.resolutions.keepServer}
                onOverwrite={editor.resolutions.overwrite}
                onMerge={editor.resolutions.merge}
                onDiscardAndClose={editor.discardAndClose}
            />
        );
    }

    return (
        <ScrollHost sections={EDITOR_SECTIONS} activationOffset={ACTIVATION_OFFSET_PT}>
            {(bind) => <EditorScreen {...props} bind={bind} />}
        </ScrollHost>
    );
};

/** The screen under its `ScrollHost`, with the scroller's binding. */
const EditorScreen: FC<RecipeEditorViewProps & { readonly bind: ScrollBind }> = (props) => {
    const { sections, headingActions, railFooter, onPreview, bind } = props;
    const page = useEditorPage(props);
    const { m, chrome, entries } = page;
    const { colors } = useTheme();
    const host = useScrollHost();
    const wide = useContainerClass() === 'wide';
    const pinning = usePinnedFooter();
    const keyboardShown = useKeyboardShown();
    // The field reveal reads the host's ONE scroller rather than holding a second handle to it (blueprint A7).
    const [revealScroller] = useState(() => ({
        get current() {
            const target = host.handle.current;

            return target !== null && isRevealScroller(target) ? target : null;
        },
    }));
    const reveal = useFieldRevealHost(revealScroller);
    // The cook's drag on the page: it releases a section jump's hold (the host's), and closes an open food list unless
    // it began on that list (`ScrollerDragContext`).
    const drag = useScrollerDragHost();

    const onScrollBeginDrag = (): void => {
        bind.onScrollBeginDrag();
        drag.onScrollBeginDrag();
    };

    // A jump moves the screen-reader cursor to the section's heading: each section counts the jumps that landed on it.
    const [jumps, setJumps] = useState<Readonly<Partial<Record<EditorSectionId, number>>>>({});
    const [firstAction, secondAction] = chrome.failure?.actions ?? [];

    const actionBar = (
        <EditorActionBar
            label={m.actionBarLabel}
            previewLabel={m.preview}
            onPreview={onPreview}
            primaryLabel={chrome.primary.label}
            onPrimary={page.finish}
            primaryDisabled={chrome.primary.disabled || props.pastePending === true}
            busy={chrome.primary.busy}
            {...(chrome.fixLine === undefined ? {} : { fixLine: chrome.fixLine })}
            {...(page.publishNote === undefined ? {} : { readyLine: page.publishNote })}
            notice={
                chrome.failure === undefined || firstAction === undefined ? undefined : (
                    <FailureAlert
                        body={chrome.failure.body}
                        primary={page.actionOf(firstAction)}
                        {...(secondAction === undefined ? {} : { secondary: page.actionOf(secondAction) })}
                    />
                )
            }
        />
    );

    const index = (
        <SectionIndex
            label={m.index.label}
            sheetTitle={m.index.sheetTitle}
            sheetCloseLabel={m.index.sheetClose}
            items={entries.items}
            currentId={page.current}
            barName={entries.barName}
            {...(entries.barSuffix === undefined ? {} : { barSuffix: entries.barSuffix })}
            {...(entries.barCount === undefined ? {} : { barCount: entries.barCount })}
            railFooter={
                railFooter === undefined && entries.doneText === undefined ? undefined : (
                    <View style={styles.railFooter}>
                        {railFooter}
                        {entries.doneText === undefined ? null : (
                            <Text style={[styles.caption, { color: colors.inkMuted }]}>{entries.doneText}</Text>
                        )}
                    </View>
                )
            }
            onJump={(id) => {
                if (isEditorSectionId(id)) {
                    setJumps((current) => ({ ...current, [id]: (current[id] ?? 0) + 1 }));
                }
            }}
        />
    );

    return (
        <KeyboardAvoider style={[styles.container, { backgroundColor: colors.canvas }]}>
            <View style={styles.frame} onLayout={pinning.onFrameLayout}>
                <View onLayout={pinning.onTopLayout}>
                    <EditorHeader
                        title={chrome.title}
                        status={chrome.status.text}
                        closeLabel={m.close}
                        onClose={page.close}
                        {...(chrome.discard === undefined
                            ? {}
                            : {
                                  menu: {
                                      triggerLabel: m.more,
                                      closeLabel: m.discard.keep,
                                      discardLabel: chrome.discard.menuLabel,
                                      onDiscard: page.askToDiscard,
                                  },
                              })}
                    />
                </View>
                {wide || keyboardShown ? null : index}
                <LiveRegion politeness="polite" visuallyHidden>
                    {chrome.status.announced ? (chrome.status.text ?? '') : ''}
                </LiveRegion>
                <LiveRegion politeness="polite" visuallyHidden occurrence={page.announcement.n}>
                    {page.announcement.text}
                </LiveRegion>
                <View style={styles.body}>
                    {wide ? index : null}
                    <FieldRevealContext.Provider value={reveal.revealer}>
                        <ScrollerDragContext.Provider value={drag.subscribe}>
                            <ScrollView
                                {...bind}
                                onScrollBeginDrag={onScrollBeginDrag}
                                style={styles.scroll}
                                contentContainerStyle={styles.content}
                                keyboardShouldPersistTaps="handled"
                                onLayout={reveal.onViewportLayout}
                            >
                                {chrome.resumeBody === undefined ? null : (
                                    <View>
                                        <ResumeNotice
                                            body={chrome.resumeBody}
                                            saveLabel={m.resume.save}
                                            discardLabel={m.resume.discard}
                                            onSave={page.finish}
                                            onDiscard={page.askToDiscard}
                                        />
                                    </View>
                                )}
                                {/* ⛔ Each section a DIRECT child of the content: `onLayout` y is relative to it (A7). */}
                                {EDITOR_SECTIONS.map((section) => (
                                    <View key={section} onLayout={host.sectionLayout(section)}>
                                        <EditorSection
                                            id={section}
                                            title={m.index.sections[section]}
                                            current={page.current === section}
                                            focusSignal={jumps[section] ?? 0}
                                            {...(headingActions?.[section] === undefined
                                                ? {}
                                                : { action: headingActions[section] })}
                                        >
                                            {section === 'photos' && page.publishNote !== undefined ? (
                                                <UnmatchedNote text={page.publishNote} />
                                            ) : null}
                                            {sections[section]}
                                        </EditorSection>
                                    </View>
                                ))}
                                {/* Past the limit only: the bar as the content's last item. */}
                                {pinning.unpinned ? <View onLayout={pinning.onFooterLayout}>{actionBar}</View> : null}
                                {reveal.spacer === null ? null : <RevealSpacer {...reveal.spacer} />}
                            </ScrollView>
                        </ScrollerDragContext.Provider>
                    </FieldRevealContext.Provider>
                </View>
                {pinning.unpinned ? null : <View onLayout={pinning.onFooterLayout}>{actionBar}</View>}
            </View>
            {chrome.discard === undefined ? null : (
                <ConfirmDialog
                    open={page.confirming}
                    title={chrome.discard.title}
                    body={chrome.discard.body}
                    confirm={{ label: m.discard.confirm, icon: 'trash' }}
                    keep={{ label: m.discard.keep }}
                    onConfirm={page.confirmDiscard}
                    onKeep={page.keepEditing}
                />
            )}
        </KeyboardAvoider>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1 },
    frame: { flex: 1 },
    body: { flex: 1, flexDirection: 'row' },
    scroll: { flex: 1 },
    content: { gap: nativeTokens.spacing[6], padding: nativeTokens.spacing[4], paddingBottom: nativeTokens.spacing[7] },
    railFooter: { gap: nativeTokens.spacing[1] },
    caption: { ...nativeTokens.type.caption },
});
