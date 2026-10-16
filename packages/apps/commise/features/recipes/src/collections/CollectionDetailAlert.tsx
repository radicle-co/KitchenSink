/**
 * @module @commise/features-recipes/collections — a line the web collection detail says when an action failed ("We
 * couldn’t make this private.", "We couldn’t save a copy."): an alert in the page's flow, in the danger text colour.
 *
 * Presentational: props → JSX.
 */
import type { FC } from 'react';

/** Props for {@link CollectionDetailAlert}. */
export interface CollectionDetailAlertProps {
    /** What went wrong, already localized. */
    readonly text: string;
}

export const CollectionDetailAlert: FC<CollectionDetailAlertProps> = ({ text }) => (
    <p role="alert" className="text-body text-danger-text">
        {text}
    </p>
);
