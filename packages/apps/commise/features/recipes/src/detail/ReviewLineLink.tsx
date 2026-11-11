'use client';

/**
 * @module @commise/features-recipes — the owner's "Needs review" control on a recipe page's ingredient row (web): a real
 * link to the editor, open on that ingredient. It shows the attention badge and a chevron, is at least 44 px tall, and is
 * named "Needs review: {food}" so a list of them is not a list of identical links (WCAG 2.4.4). It is a SIBLING of the
 * row's check control (`IngredientCheckRow`'s `reviewAction` slot), so pressing it never ticks the line.
 *
 * It is `next/link`, as the page's other Edit links are: `RouteAction` (`@commise/ui/route-link`) asks for an `onPress`
 * router call, and this page owns no router, only hrefs.
 *
 * Presentational: props → JSX.
 */
import { useMessages } from '@commise/i18n/react';
import { FOCUS_RING_CLASS } from '@commise/ui/focus-ring';
import { Icon } from '@commise/ui/icon';
import { StatusBadge } from '@commise/ui/status-badge';
import Link from 'next/link';
import type { ComponentProps, FC } from 'react';

import { fillTemplate } from '../format/fillTemplate.js';
import { recipeMessages } from '../messages.js';

/** Props for {@link ReviewLineLink}. */
export interface ReviewLineLinkProps {
    /** The editor's address, ending in the line's `#ingredients/{version}.{position}`. */
    readonly href: ComponentProps<typeof Link>['href'];
    /** The line's food, for the control's name. */
    readonly food: string;
}

/** The owner's way from a line that needs review to that line in the editor. */
export const ReviewLineLink: FC<ReviewLineLinkProps> = ({ href, food }) => {
    const { detail } = useMessages(recipeMessages);

    return (
        <Link
            href={href}
            aria-label={fillTemplate(detail.needsReviewLinkLabel, { food })}
            className={`inline-flex min-h-11 items-center gap-1 rounded-md ${FOCUS_RING_CLASS.offset}`}
        >
            <StatusBadge status="attention">{detail.needsReviewBadge}</StatusBadge>
            <Icon name="chevronRight" size={16} />
        </Link>
    );
};
