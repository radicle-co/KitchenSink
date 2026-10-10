'use client';

/**
 * @module CollectionNotFound — what a collection surface renders when the collection it reads does not exist or is
 * not the viewer's to see (`docs/design/uiOverhaul/buildSpec.md` §5.2: "the 404 body inside the shell with 'Back to
 * Collections'"). It offers no retry, because nothing a retry could change, and a way out instead. Rendered by the read
 * boundary of the collection detail route, which decides not-found from the owning client's `isNotFoundError`.
 */
import { collectionMessages } from '@commise/features-recipes';
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { LARGE_TITLE_CLASS } from '@commise/ui/large-title-header';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import type { FC } from 'react';

import { webMessages } from '@/i18n/messages';

/** Props for {@link CollectionNotFound}. */
export interface CollectionNotFoundProps {
    /** The active route locale, for the way back. */
    readonly locale: string;
}

/** Presentational: the collection does not exist, or is not the viewer's to see. */
export const CollectionNotFound: FC<CollectionNotFoundProps> = ({ locale }) => {
    const { collections } = useMessages(webMessages);
    const { detail, list } = useMessages(collectionMessages);
    const router = useRouter();

    return (
        <div role="alert" className="mx-auto flex w-full max-w-page flex-col items-start gap-3 py-8">
            <h1 className={LARGE_TITLE_CLASS}>{collections.detail.notFoundTitle}</h1>
            <p className="text-body text-ink-muted">{detail.notFoundBody}</p>
            <Button
                variant="secondary"
                icon="chevronLeft"
                onPress={() => router.push(`/${locale}/collections` as Route)}
            >
                {detail.backTo.replace('{parent}', list.heading)}
            </Button>
        </div>
    );
};
