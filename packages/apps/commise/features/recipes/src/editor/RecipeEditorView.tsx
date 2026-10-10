'use client';

/**
 * @module @commise/features-recipes/editor — the web one-page recipe editor (build spec §7; owner decisions D1, D2, D3,
 * D12): the header, the section index, the four sections, the action bar and the notices, over the editor's lifecycle
 * (`useRecipeEditor`). Create and edit are this one page.
 *
 * ORCHESTRATION of the page: it owns the page's one `ScrollHost`, and draws what `useEditorPage` decides (the statuses
 * from the one validator, the chrome, the checkpoints, the announcements, the commands). The web adds only what the
 * browser alone has: work the server does not hold yet arms the browser's own unload prompt (D7), the
 * popups keep clear of the sticky chrome (the header and the index box stuck under it), and when the header and the
 * action bar together are taller than half the viewport (`compactHeightLayout.md` A1) the bar scrolls with the page and
 * the section bar hides (build spec §7.1). The sections' bodies are the container's, which owns their data.
 *
 * No back-to-top control (D3). The editor's glass is its action bar only (D12). × never asks (Settled 24).
 *
 * @pattern Mediator — the page's chrome, sections and scroll spy coordinated around the editor's lifecycle
 */
import { ConfirmDialog } from '@commise/ui/confirm-dialog';
import { LiveRegion } from '@commise/ui/live-region';
import { PopupInsetsContext } from '@commise/ui/popup-insets';
import { usePinnedFooter } from '@commise/ui/pinned-footer';
import { ScrollHost } from '@commise/ui/scroll-host';
import { SectionIndex } from '@commise/ui/section-index';
import { useCallback, type FC } from 'react';

import { RecipeConflictView } from '../versions/RecipeConflictView.js';
import { readChromeInsets } from './chromeInsets.js';
import { EditorActionBar } from './EditorActionBar.js';
import { EditorHeader } from './EditorHeader.js';
import { FailureAlert } from './FailureAlert.js';
import { ResumeNotice } from './ResumeNotice.js';
import { EditorSection } from './EditorSection.js';
import {
    EDITOR_ACTION_BAR_ID,
    EDITOR_INDEX_ID,
    EDITOR_TOP_CHROME_IDS,
    type RecipeEditorViewProps,
} from './frameProps.js';
import { EDITOR_SECTIONS } from './sections.js';
import { closingTabLosesWork } from './saveStatus.js';
import { useEditorPage } from './useEditorPage.js';
import { useUnloadGuard } from './useUnloadGuard.js';

/** How far below the viewport's top the scroll spy's activation line sits: under the header and the index bar. */
const ACTIVATION_OFFSET_PX = 120;

/** The web one-page recipe editor. */
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
        <ScrollHost sections={EDITOR_SECTIONS} activationOffset={ACTIVATION_OFFSET_PX}>
            <EditorPage {...props} />
        </ScrollHost>
    );
};

/** The page under its `ScrollHost`. */
const EditorPage: FC<RecipeEditorViewProps> = (props) => {
    const { editor, keep, sections, headingActions, railFooter, onPreview } = props;
    const page = useEditorPage(props);
    const { m, chrome, entries } = page;
    // A1: the header is stuck to the viewport's top, so the viewport is the frame.
    const pinning = usePinnedFooter({ frame: 'viewport' });

    // Closing the tab loses whatever the server does not hold yet: the draft and the outbox live in the tab (D7).
    useUnloadGuard(
        closingTabLosesWork({ keep, status: editor.saveStatus, lifecycle: editor.lifecycle, values: editor.values }),
    );

    const readInsets = useCallback(() => readChromeInsets(EDITOR_TOP_CHROME_IDS, EDITOR_ACTION_BAR_ID), []);
    const [firstAction, secondAction] = chrome.failure?.actions ?? [];

    return (
        <PopupInsetsContext value={readInsets}>
            <div className="flex min-h-dvh flex-col bg-canvas [--top-chrome:3.5rem]">
                <EditorHeader
                    placeRef={pinning.topRef}
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
                <LiveRegion politeness="polite" visuallyHidden>
                    {chrome.status.announced ? (chrome.status.text ?? '') : ''}
                </LiveRegion>
                <LiveRegion politeness="polite" visuallyHidden occurrence={page.announcement.n}>
                    {page.announcement.text}
                </LiveRegion>
                <div className="mx-auto flex w-full max-w-[calc(15rem+2rem+var(--container-list))] flex-1 flex-col @wide/main:flex-row @wide/main:gap-8 @wide/main:px-4">
                    <SectionIndex
                        stickyId={EDITOR_INDEX_ID}
                        narrowHidden={pinning.unpinned}
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
                                <div className="flex flex-col gap-1">
                                    {railFooter}
                                    {entries.doneText !== undefined && <p>{entries.doneText}</p>}
                                </div>
                            )
                        }
                    />
                    <div className="flex w-full max-w-list min-w-0 flex-1 flex-col gap-10 px-4 pt-6">
                        {chrome.resumeBody !== undefined && (
                            <ResumeNotice
                                body={chrome.resumeBody}
                                saveLabel={m.resume.save}
                                discardLabel={m.resume.discard}
                                onSave={page.finish}
                                onDiscard={page.askToDiscard}
                            />
                        )}
                        {EDITOR_SECTIONS.map((section) => (
                            <EditorSection
                                key={section}
                                id={section}
                                title={m.index.sections[section]}
                                current={page.current === section}
                                {...(headingActions?.[section] === undefined
                                    ? {}
                                    : { action: headingActions[section] })}
                            >
                                {sections[section]}
                            </EditorSection>
                        ))}
                        <EditorActionBar
                            pinned={!pinning.unpinned}
                            placeRef={pinning.footerRef}
                            label={m.actionBarLabel}
                            previewLabel={m.preview}
                            onPreview={onPreview}
                            primaryLabel={chrome.primary.label}
                            onPrimary={page.finish}
                            primaryDisabled={chrome.primary.disabled || props.pastePending === true}
                            busy={chrome.primary.busy}
                            {...(chrome.fixLine === undefined ? {} : { fixLine: chrome.fixLine })}
                            notice={
                                chrome.failure === undefined || firstAction === undefined ? undefined : (
                                    <FailureAlert
                                        body={chrome.failure.body}
                                        primary={page.actionOf(firstAction)}
                                        {...(secondAction === undefined
                                            ? {}
                                            : { secondary: page.actionOf(secondAction) })}
                                    />
                                )
                            }
                        />
                    </div>
                </div>
            </div>
            {chrome.discard !== undefined && (
                <ConfirmDialog
                    open={page.confirming}
                    title={chrome.discard.title}
                    body={editor.lifecycle === 'published' ? m.discard.changesBody : m.discard.draftBody}
                    confirm={{ label: m.discard.confirm, icon: 'trash' }}
                    keep={{ label: m.discard.keep }}
                    onConfirm={page.confirmDiscard}
                    onKeep={page.keepEditing}
                />
            )}
        </PopupInsetsContext>
    );
};
