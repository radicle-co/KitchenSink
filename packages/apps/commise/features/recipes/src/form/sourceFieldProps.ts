/**
 * @module @commise/features-recipes/form — the contract the Source row's web and native leaves share (ADR-0089).
 */
import type { SourceRowModel } from './sourceLink.js';

/** Props for `RecipeSourceField`. A pure render of {@link SourceRowModel}: the editor's session owns every state. */
export interface RecipeSourceFieldProps {
    /** What the row draws. */
    readonly row: SourceRowModel;
    /** The cook typed in the field. */
    readonly onChange: (text: string) => void;
    /** The cook left the field, or pressed its Done key: an unusable address is an error from now on. */
    readonly onTouched: () => void;
    /** "Remove source". */
    readonly onRemove: () => void;
    /** The field is asked for focus (after Remove): a level, which stands until {@link onFocusHandled}. */
    readonly focusRequested: boolean;
    /** The field took a requested focus. */
    readonly onFocusHandled: () => void;
}

/** The native row's extra: React Native has no declarative link, so opening the locked site is injected. */
export interface RecipeSourceFieldNativeProps extends RecipeSourceFieldProps {
    /** Open the locked site's address in the browser. Defaults to the platform's URL opener. */
    readonly onOpen?: (url: string) => void;
}
