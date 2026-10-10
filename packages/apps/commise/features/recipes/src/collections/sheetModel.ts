/**
 * @module @commise/features-recipes/collections — the collection sheet's contract, shared by both leaves.
 *
 * One sheet creates and renames (`docs/design/uiOverhaul/buildSpec.md` §5.1). A union on `intent`, so a rename cannot be
 * given an `onCreate` and a create cannot be given an `initial` — the same sheet, with the title, the primary action,
 * the failure copy and the starting values of whichever job it was opened for.
 */
import type { CreateCollectionRequest } from '@kitchensink/recipe-service-client';

/** What both jobs take. */
interface CollectionSheetBaseProps {
    readonly open: boolean;
    /** Every close route calls this with `false`, after the discard confirmation when there is something to lose. */
    readonly onOpenChange: (open: boolean) => void;
    /** The request is in flight. */
    readonly submitting: boolean;
    /** The last request failed; what was typed stays. */
    readonly failed: boolean;
}

/** The sheet opened to create a collection. */
export interface CollectionCreateSheetProps extends CollectionSheetBaseProps {
    readonly intent?: 'create';
    /** Create the collection; the host runs the request and, on success, closes and opens it. */
    readonly onCreate: (request: CreateCollectionRequest) => void;
    readonly initial?: undefined;
    readonly onRename?: undefined;
}

/** The sheet opened to rename a collection: its name and description arrive filled in. */
export interface CollectionRenameSheetProps extends CollectionSheetBaseProps {
    readonly intent: 'rename';
    /** The collection as it is now. The sheet starts from it each time it opens. */
    readonly initial: { readonly name: string; readonly description?: string | undefined };
    /** Save the edits; the host runs the request and, on success, closes. */
    readonly onRename: (request: CreateCollectionRequest) => void;
    readonly onCreate?: undefined;
}

/** Props for `CollectionSheet` (web and native). */
export type CollectionSheetProps = CollectionCreateSheetProps | CollectionRenameSheetProps;
