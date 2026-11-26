/**
 * @module @commise/features-recipes/form — the contract the Source row's web and native leaves share (ADR-0089).
 */
import type { StatementSurface } from '../actions/sourceStatement.js';
import type { SourceRowModel } from './sourceLink.js';

/** The three sheets the Source row opens: the first answer, a change of an answer not yet confirmed, and the downgrade of "I wrote this". */
export type SourceRowSheet = Extract<StatementSurface, 'firstAnswer' | 'change' | 'downgrade'>;

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
    /** The cook asked to say, or change, where the recipe is from: open the statement sheet for this purpose. */
    readonly onAsk: (sheet: SourceRowSheet) => void;
    /**
     * The support page for THIS recipe (`supportLinkOf`), or `undefined` when no address is configured: the help link is then
     * not drawn, and the locked line still reads true.
     */
    readonly askHref?: string;
}

/** The native row's extra: React Native has no declarative link, so opening the locked site is injected. */
export interface RecipeSourceFieldNativeProps extends RecipeSourceFieldProps {
    /** Open the locked site's address in the browser. Defaults to the platform's URL opener. */
    readonly onOpen?: (url: string) => void;
}
