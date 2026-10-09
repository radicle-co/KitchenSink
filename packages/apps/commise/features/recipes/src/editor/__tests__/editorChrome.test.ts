/**
 * The editor's chrome as both platforms draw it (build spec §7.1, §7.3, §7.8): which primary, whether it is busy or
 * disabled, the save status line, the ⋯ discard item, the parked-write alert and the resume notice's words. One pure
 * view model, so the web and native leaves cannot disagree about any of it.
 */
import { describe, expect, it } from 'vitest';

import { makeEditorResult } from '../../__fixtures__/editorResult.js';
import { makeFilledRecipeFormValues } from '../../__fixtures__/index.js';
import { editorChromeOf, type EditorChromeInput } from '../editorChrome.js';
import { editorMessages } from '../messages.js';
import { sectionStatusesOf } from '../sectionStatus.js';

function chrome(over: Partial<Parameters<typeof makeEditorResult>[0]> = {}, input: Partial<EditorChromeInput> = {}) {
    const editor = makeEditorResult(over);

    return editorChromeOf({
        editor,
        mode: 'create',
        keep: 'disk',
        statuses: sectionStatusesOf({
            values: editor.values,
            pendingEntryText: '',
            publishAttempted: editor.publishAttempted,
        }),
        messages: editorMessages.en,
        locale: 'en',
        ...input,
    });
}

describe('the primary', () => {
    it('is Publish until the recipe is published, then Save changes', () => {
        expect(chrome().primary).toEqual({ label: 'Publish', action: 'publish', disabled: false, busy: false });
        expect(chrome({ lifecycle: 'neverPublished' }).primary.label).toBe('Publish');
        expect(chrome({ lifecycle: 'published', hasUnsavedChanges: true }).primary).toEqual({
            label: 'Save changes',
            action: 'saveChanges',
            disabled: false,
            busy: false,
        });
    });

    it('Save changes is disabled while there is nothing to save', () => {
        expect(chrome({ lifecycle: 'published', hasUnsavedChanges: false }).primary.disabled).toBe(true);
    });

    it('is busy while a Publish or Save changes waits for its answer', () => {
        expect(chrome({ state: { status: 'finishing' } }).primary.busy).toBe(true);
    });
});

describe('the title', () => {
    it('names the task', () => {
        expect(chrome().title).toBe('New recipe');
        expect(chrome({}, { mode: 'edit' }).title).toBe('Edit recipe');
    });
});

describe('the ⋯ discard item', () => {
    it('is absent for a new recipe nothing was typed into: there is nothing to discard', () => {
        expect(chrome().discard).toBeUndefined();
    });

    it('discards a draft once something exists, and a published recipe`s changes once there are any', () => {
        expect(chrome({ values: makeFilledRecipeFormValues() }).discard).toEqual({
            menuLabel: 'Discard draft',
            title: 'Discard this draft?',
        });
        expect(chrome({ lifecycle: 'neverPublished', recipeId: 'rec_1' }).discard?.menuLabel).toBe('Discard draft');
        expect(chrome({ lifecycle: 'published', recipeId: 'rec_1', hasUnsavedChanges: false }).discard).toBeUndefined();
        expect(chrome({ lifecycle: 'published', recipeId: 'rec_1', hasUnsavedChanges: true }).discard).toEqual({
            menuLabel: 'Discard changes',
            title: 'Discard your changes?',
        });
    });
});

describe('the parked-write alert', () => {
    it.each([
        [{ failure: 'transient', kind: 'update' } as const, 'disk', undefined],
        [{ failure: 'conflict', kind: 'update' } as const, 'disk', undefined],
        [
            { failure: 'terminal', kind: 'update' } as const,
            'disk',
            { body: "We couldn't save your latest changes. They're kept on this device.", actions: ['retry'] },
        ],
        [
            { failure: 'terminal', kind: 'create' } as const,
            'tabSession',
            { body: "We couldn't save your latest changes. They're kept in this tab.", actions: ['retry'] },
        ],
        [
            { failure: 'unknown', kind: 'update' } as const,
            'disk',
            { body: "We couldn't tell if your changes were saved.", actions: ['saveAgain'] },
        ],
        [
            { failure: 'unknown', kind: 'create' } as const,
            'disk',
            {
                body: "We couldn't tell if your recipe was saved. Check My recipes before you save again, or you may get two copies.",
                actions: ['openMyRecipes', 'saveAgain'],
            },
        ],
    ] as const)('%j on %s → %j', (parked, keep, alert) => {
        expect(chrome({ parked }, { keep }).failure).toEqual(alert);
    });
});

describe('after a refused Publish', () => {
    it('says how many things to fix in all, and nothing before it was pressed', () => {
        const values = makeFilledRecipeFormValues({ title: '', steps: [] });

        expect(chrome({ values }).fixLine).toBeUndefined();
        expect(chrome({ values, publishAttempted: true }).fixLine).toBe('Fix 2 things to publish');
        expect(chrome({ values: makeFilledRecipeFormValues(), publishAttempted: true }).fixLine).toBeUndefined();
    });
});

describe('the resume notice', () => {
    it('says when the device changes are from', () => {
        const body = chrome({ resume: { savedAt: '2026-10-08T09:00:00.000Z' } }, { timeZone: 'UTC' }).resumeBody;

        expect(body).toMatch(/^You have changes from .*2026.* that aren't saved to your recipe\.$/);
    });

    it('is absent without device changes', () => {
        expect(chrome().resumeBody).toBeUndefined();
    });
});
