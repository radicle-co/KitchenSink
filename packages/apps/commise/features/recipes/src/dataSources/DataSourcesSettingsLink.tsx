'use client';

/**
 * @module @commise/features-recipes/dataSources — web settings WAY IN to the Data sources page (presentational;
 * design §S16).
 *
 * A section headed "Food data", one line on what the page holds, and a link titled with the page's name. The address
 * is the app router's (`/{locale}/legal/sources`), so the host passes it; the link opens in the same tab, because it
 * is a route in this app.
 */
import { useMessages } from '@commise/i18n/react';
import Link from 'next/link';
import { useId, type ComponentProps, type FC } from 'react';

import { dataSourcesMessages } from './messages.js';
import type { DataSourcesSettingsLinkProps } from './model.js';

/**
 * The settings section that links to the Data sources page.
 *
 * @param props - The page's address, and the host's card classes.
 * @returns The section.
 */
export const DataSourcesSettingsLink: FC<DataSourcesSettingsLinkProps> = ({ href, className }) => {
    const messages = useMessages(dataSourcesMessages);
    const headingId = useId();

    return (
        <section aria-labelledby={headingId} className={className}>
            <h2 id={headingId} className="font-display text-heading-md font-semibold text-charcoal">
                {messages.settingsHeading}
            </h2>
            <p className="text-body-sm text-slate">{messages.settingsSummary}</p>
            <Link
                // Typed routes: the host owns the route and passes its address; the cast reads the accepted type off
                // `Link` itself, as `RecipeSourceTabs` does.
                href={href as ComponentProps<typeof Link>['href']}
                className="inline-block py-1 text-body-sm font-medium text-ocean-dark underline underline-offset-2"
            >
                {messages.title}
            </Link>
        </section>
    );
};
