'use client';

/**
 * @module @commise/features-recipes/collections — the SETTLED collection detail, composed once for web and mobile
 * (`docs/design/uiOverhaul/buildSpec.md` §5.2, §5.3): the {@link CollectionHeader} (back, name, meta, description, Add
 * recipes and the ⋯ menu), the two failure lines, the {@link CollectionMembers} list, and the sheets the header opens —
 * rename, delete, Premium, the add-recipes picker and the pull-updates dialog.
 *
 * Orchestration: every piece it draws is a leaf pair that resolves per platform, and what it reads is the
 * {@link CollectionDetail} view-model — plain `.tsx` with no native twin. The app keeps only what differs: the frame around it (a page `<section>` on
 * web, a `ScrollView` on mobile), the read boundary, the navigation, and the links web needs so a card is a real anchor.
 *
 * The picker's read boundary is the app's (`ClientQueryBoundary` on web, `QueryBoundary` on mobile; this package may
 * not import `@commise/query`), handed in as {@link CollectionDetailBodyProps.PickerBoundary}.
 *
 * @pattern Composite — the detail's header, members and sheets over one view-model
 * @pattern Strategy — the picker's read boundary, injected per platform
 */
import { useMessages } from '@commise/i18n/react';
import { type ComponentType, type FC, type ReactNode, useCallback } from 'react';

import { RecipeNutritionSlot } from '../nutrition/RecipeNutritionSlot.js';
import { CollectionDeleteDialog } from './CollectionDeleteDialog.js';
import { CollectionDetailAlert } from './CollectionDetailAlert.js';
import { CollectionHeader } from './CollectionHeader.js';
import { CollectionMembers } from './CollectionMembers.js';
import { CollectionPickerBody } from './CollectionPickerBody.js';
import { CollectionRecipePicker } from './CollectionRecipePicker.js';
import { CollectionRecipePickerLoadError } from './CollectionRecipePickerLoadError.js';
import { CollectionRecipePickerLoading } from './CollectionRecipePickerLoading.js';
import { CollectionSheet } from './CollectionSheet.js';
import { CollectionUpsellSheet } from './CollectionUpsellSheet.js';
import { collectionMessages } from './messages.js';
import { PullUpdatesDialog } from './PullUpdatesDialog.js';
import type { CollectionDetail } from './useCollectionDetail.js';

/** The id of the detail's heading, which takes focus when the last row is removed. */
const COLLECTION_TITLE_ID = 'collection-title';

/** What the picker's read boundary takes: the structural subset of `QueryBoundary` this body uses. */
export interface CollectionPickerBoundaryProps {
    readonly loading: ReactNode;
    readonly renderError: (fallback: { readonly resetErrorBoundary: () => void }) => ReactNode;
    readonly resetKeys: readonly unknown[];
    readonly children: ReactNode;
}

/** Where web's cards and Back lead, so each is a real link; mobile has no addresses and passes none. */
export interface CollectionDetailLinks {
    /** The collections list. */
    readonly back: string;
    /** A recipe's page. */
    readonly recipeOf: (recipeId: string) => string;
}

/** Props for {@link CollectionDetailBody}. */
export interface CollectionDetailBodyProps {
    readonly detail: CollectionDetail;
    /** Back to the collections list. */
    readonly onBack: () => void;
    /** Open a member recipe. */
    readonly onSelectRecipe: (recipeId: string) => void;
    /** Open the collection this one was copied from. */
    readonly onViewSource: (sourceCollectionId: string) => void;
    readonly links?: CollectionDetailLinks;
    /** The app's read boundary for the picker's settled body. */
    readonly PickerBoundary: ComponentType<CollectionPickerBoundaryProps>;
}

export const CollectionDetailBody: FC<CollectionDetailBodyProps> = ({
    detail,
    onBack,
    onSelectRecipe,
    onViewSource,
    links,
    PickerBoundary,
}) => {
    const { member: copy } = useMessages(collectionMessages);
    const { collection, members, layout, picker, rename, deletion, pull, visibility, removal } = detail;
    const { nutritionFor } = detail;
    const renderNutrition = useCallback(
        (recipeId: string) => {
            const batch = nutritionFor(recipeId);

            return batch === null ? null : <RecipeNutritionSlot nutritionBatchPromise={batch} recipeId={recipeId} />;
        },
        [nutritionFor],
    );

    return (
        <>
            <CollectionHeader
                name={collection.name}
                {...(collection.description === undefined ? {} : { description: collection.description })}
                visibility={collection.visibility}
                recipeCount={members.length}
                {...(collection.sourceCollectionName === undefined
                    ? {}
                    : { sourceCollectionName: collection.sourceCollectionName })}
                {...(collection.sourceOwnerDisplayName === undefined
                    ? {}
                    : { sourceOwnerDisplayName: collection.sourceOwnerDisplayName })}
                {...(collection.sourceOwnerUsername === undefined
                    ? {}
                    : { sourceOwnerUsername: collection.sourceOwnerUsername })}
                {...(collection.sourceCollectionId === undefined
                    ? {}
                    : { sourceCollectionId: collection.sourceCollectionId })}
                {...(collection.lastPulledAt === undefined ? {} : { lastPulledAt: collection.lastPulledAt })}
                actionsPlacement={layout.container === 'narrow' ? 'below' : 'title'}
                headingId={COLLECTION_TITLE_ID}
                headingFocusSignal={0}
                onBack={onBack}
                {...(links === undefined ? {} : { backHref: links.back })}
                onAddRecipes={picker.onOpen}
                onViewSource={onViewSource}
                {...(detail.refreshNotice === undefined ? {} : { refreshNotice: detail.refreshNotice })}
                onRename={rename.onStart}
                {...(detail.onToggleVisibility === undefined ? {} : { onToggleVisibility: detail.onToggleVisibility })}
                onSaveCopy={detail.saveCopy.onSave}
                onPullUpdates={pull.start}
                onDelete={deletion.onStart}
            />

            {visibility.failed ? <CollectionDetailAlert text={copy.visibilityFailed} /> : null}
            {detail.saveCopy.failed ? <CollectionDetailAlert text={copy.saveCopyFailed} /> : null}

            <CollectionMembers
                members={members}
                viewMode={layout.viewMode}
                onViewModeChange={layout.onViewModeChange}
                variant={layout.variant}
                {...(links === undefined ? {} : { hrefOf: links.recipeOf })}
                onSelectRecipe={onSelectRecipe}
                onRemoveRecipe={removal.remove}
                onAddRecipes={picker.onOpen}
                {...(removal.failedTitle === undefined ? {} : { removeFailedTitle: removal.failedTitle })}
                renderNutrition={renderNutrition}
                headingId={COLLECTION_TITLE_ID}
            />

            <CollectionSheet
                open={rename.open}
                onOpenChange={rename.onOpenChange}
                intent="rename"
                initial={{
                    name: collection.name,
                    ...(collection.description === undefined ? {} : { description: collection.description }),
                }}
                submitting={rename.submitting}
                failed={rename.failed}
                onRename={rename.onSubmit}
            />

            <CollectionDeleteDialog
                open={deletion.open}
                name={collection.name}
                recipeCount={members.length}
                busy={deletion.busy}
                failed={deletion.failed}
                onKeep={deletion.onKeep}
                onConfirm={deletion.onConfirm}
            />

            <CollectionUpsellSheet
                open={visibility.upsellOpen}
                onOpenChange={(open) => {
                    if (!open) {
                        visibility.closeUpsell();
                    }
                }}
                onSeePremium={visibility.closeUpsell}
            />

            <CollectionRecipePicker
                open={picker.open}
                onClose={picker.onClose}
                onDismissed={picker.onDismissed}
                collectionName={collection.name}
                query={picker.query}
                onQueryChange={picker.onQueryChange}
                summary={picker.summary}
                {...(picker.announcement === undefined ? {} : { announcement: picker.announcement })}
            >
                <PickerBoundary
                    loading={<CollectionRecipePickerLoading />}
                    renderError={({ resetErrorBoundary }) => (
                        <CollectionRecipePickerLoadError onRetry={resetErrorBoundary} />
                    )}
                    resetKeys={[collection.id]}
                >
                    <CollectionPickerBody
                        collectionId={collection.id}
                        query={picker.query}
                        onClearSearch={picker.onClearSearch}
                        onCreateRecipe={picker.onCreateRecipe}
                    />
                </PickerBoundary>
            </CollectionRecipePicker>

            {collection.sourceCollectionId !== undefined && (
                <PullUpdatesDialog
                    open={pull.open}
                    diff={pull.diff}
                    isLoadingPreview={pull.isLoadingPreview}
                    isCommitting={pull.isCommitting}
                    error={pull.error}
                    sourceOwnerDisplayName={collection.sourceOwnerDisplayName}
                    sourceOwnerUsername={collection.sourceOwnerUsername}
                    sourceCollectionName={collection.sourceCollectionName}
                    onCancel={pull.cancel}
                    onConfirm={pull.confirm}
                />
            )}
        </>
    );
};
