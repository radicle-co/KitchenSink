'use client';

/**
 * @module @commise/features-recipes/dataSources — web Data sources CARD (presentational; plan R55, design §S16).
 *
 * One source a stored value cites: its heading, its full name and publisher, then edition, licence and credit as a
 * description list, a note when some of its values were converted (R54), and its website. Pure `props → JSX`; the
 * browser's own `<a href>` is the link adapter.
 *
 * ⛔ The credit renders word for word, in its own language (`lang`), and wraps anywhere, because two credits hold a
 * bare web address. It is never translated, re-cased or cut short: it is a licence term (CC BY 4.0 §3(a)(1)).
 */
import { useMessages } from '@commise/i18n/react';
import { useId, type FC, type ReactNode } from 'react';

import { dataSourcesMessages } from './messages.js';
import { dataSourceCardModel, type DataSourceCardProps, type DataSourceLink } from './model.js';

/** The house link form, plus the outbound-tab glyph a screen reader never reads. */
const ExternalLink: FC<{ readonly link: DataSourceLink; readonly children: ReactNode }> = ({ link, children }) => (
    <a
        href={link.href}
        target="_blank"
        // `noopener` denies the opened page a `window.opener` handle; `noreferrer` withholds this page's URL.
        rel="noopener noreferrer"
        aria-label={link.accessibleName}
        // Contrast (WCAG AA): `ocean-dark` on the card is 6.20:1. Underlined, so the affordance is not carried by
        // colour alone (SC 1.4.1). `py-1` lifts the target toward SC 2.5.8's 24 px.
        className="inline-block py-1 text-body-sm font-medium text-ocean-dark underline underline-offset-2"
    >
        {children}
        <span aria-hidden="true"> ↗</span>
    </a>
);

/** One term and its value; the term sits above its value below 24rem of card width, and beside it from 24rem. */
const Entry: FC<{ readonly term: string; readonly children: ReactNode }> = ({ term, children }) => (
    <div className="flex flex-col gap-0.5 @sm:flex-row @sm:gap-3">
        <dt className="shrink-0 text-caption font-semibold text-slate @sm:w-20">{term}</dt>
        <dd className="min-w-0 text-body-sm text-charcoal">{children}</dd>
    </div>
);

/**
 * One cited source: its heading, names, edition, licence, credit, conversion note and website.
 *
 * @param props - The source, as the food service sends it.
 * @returns The card.
 */
export const DataSourceCard: FC<DataSourceCardProps> = ({ source }) => {
    const messages = useMessages(dataSourcesMessages);
    const headingId = useId();
    const card = dataSourceCardModel(source, messages);

    return (
        <section
            aria-labelledby={headingId}
            // `break-word`: a source's own long words (Livsmedelsdatabasen, Bundeslebensmittelschlüssel) must wrap at
            // 320 px and 200% text, where the text box is 128 px wide (§S16, "everything wraps").
            className="flex flex-col gap-2 rounded-2xl bg-card p-4 shadow-sm [overflow-wrap:break-word]"
        >
            <h2 id={headingId} className="font-display text-heading-sm font-semibold text-charcoal">
                {card.heading}
            </h2>
            {card.fullName !== undefined && <p className="text-body-md text-charcoal">{card.fullName}</p>}
            <p className="text-body-sm text-slate">{source.publisher}</p>
            <dl className="flex flex-col gap-2 @container">
                <Entry term={messages.editionLabel}>{source.edition}</Entry>
                <Entry term={messages.licenceLabel}>
                    {card.licence === null ? (
                        source.licenceName
                    ) : (
                        <ExternalLink link={card.licence}>{source.licenceName}</ExternalLink>
                    )}
                </Entry>
                <Entry term={messages.creditLabel}>
                    <p lang={source.attributionLanguage} className="[overflow-wrap:anywhere]">
                        {source.attribution}
                    </p>
                </Entry>
            </dl>
            {source.converted && <p className="text-body-sm text-slate">{messages.convertedNote}</p>}
            {card.homepage !== null && (
                <div>
                    <ExternalLink link={card.homepage}>{messages.homepageLink}</ExternalLink>
                </div>
            )}
        </section>
    );
};
