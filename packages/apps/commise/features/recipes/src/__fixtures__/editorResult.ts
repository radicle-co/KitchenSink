/**
 * @module @commise/features-recipes/__fixtures__ — an editor result for view tests: every field a neutral value, every
 * command a no-op, overridable per field. The view decides nothing itself, so a test drives it by the result it reads.
 */
import type { UseRecipeEditorResult } from '../hooks/useRecipeEditor.js';
import { defaultRecipeFormValues } from '../form/values.js';

/**
 * Build an editor result.
 *
 * @param over - Fields to override.
 * @returns A complete result, a new recipe by default.
 */
export function makeEditorResult(over: Partial<UseRecipeEditorResult> = {}): UseRecipeEditorResult {
    const noop = (): void => undefined;

    return {
        state: { status: 'editing' },
        values: defaultRecipeFormValues(),
        errors: {},
        publishAttempted: false,
        lifecycle: 'unsaved',
        recipeId: undefined,
        saveStatus: { kind: 'unsaved' },
        parked: undefined,
        hasUnsavedChanges: false,
        resume: undefined,
        pasteAvailable: true,
        pasteKeepsSource: true,
        discardMayLeaveServerCopy: false,
        discarding: false,
        setValues: noop,
        setField: noop,
        dispatch: noop,
        checkpoint: noop,
        publish: () => ({ kind: 'send' }),
        saveChanges: () => ({ kind: 'send' }),
        retry: noop,
        discard: noop,
        cancelDiscard: noop,
        lineCommand: { persistedKeys: [], holdsRebinds: false, run: async () => ({ kind: 'failed' }), hold: noop },
        discardAndClose: noop,
        resolutions: { overwrite: noop, keepServer: noop, merge: noop, setMergeSelections: noop },
        ...over,
    };
}
