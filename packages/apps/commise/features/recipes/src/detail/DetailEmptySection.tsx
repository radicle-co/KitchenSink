/**
 * @module @commise/features-recipes — an empty section of the web recipe page (build spec §6.7): its line ("No steps
 * yet.") and, for the owner, the ghost action that opens the editor at that section. Presentational.
 */
import { buttonSurfaceClass } from '@commise/ui/button';
import { Icon } from '@commise/ui/icon';
import Link from 'next/link';
import type { ComponentProps, FC } from 'react';

/** Props for {@link DetailEmptySection}. */
export interface DetailEmptySectionProps {
    /** The section's empty line ("No steps yet."). */
    readonly text: string;
    /** The editor at this section, for the owner; absent for another cook. */
    readonly action: ComponentProps<typeof Link>['href'] | undefined;
    /** The owner's action ("Add steps"). */
    readonly actionLabel: string;
}

/** The web empty section. */
export const DetailEmptySection: FC<DetailEmptySectionProps> = ({ text, action, actionLabel }) => (
    <div className="flex flex-col items-start gap-2 py-2">
        <p className="text-body text-ink-muted">{text}</p>
        {action !== undefined && (
            <Link href={action} className={buttonSurfaceClass('ghost', 'sm')}>
                <Icon name="plus" size={16} />
                {actionLabel}
            </Link>
        )}
    </div>
);
