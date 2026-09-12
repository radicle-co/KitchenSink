/**
 * @module @commise/features-recipes/dataSources/model — the Data sources page's props and its one pure card model
 * (plan R55, design §S16).
 *
 * Both platforms render a source from {@link dataSourceCardModel}, so the heading rule, the links' names and the
 * address gate cannot hold on one platform and not the other. The source itself is the food service's wire type,
 * taken from its client package and never redeclared (ADR-0014).
 *
 * ⛔ No id is ever mapped to a word here. Every name, licence title and credit arrives on the wire (§S16); a second
 * map in the client would be a second register, kept by hand.
 */
import type { DataSourceView } from '@kitchensink/food-service-client';
import { safeHttpUrl } from '@kitchensink/recipe-core/external-url';
import type { ReactNode } from 'react';

import { fillTemplate } from '../list/model.js';
import type { DataSourcesMessages } from './messages.js';

/** A link the page may render: a verified http(s) href and its accessible name. */
export interface DataSourceLink {
    readonly href: string;
    readonly accessibleName: string;
}

/** What one card shows, beyond the source's own fields. */
export interface DataSourceCardModel {
    /** The short name, or the name when the source has none. */
    readonly heading: string;
    /** The full name, shown under a short-name heading; absent when the name is already the heading. */
    readonly fullName: string | undefined;
    /** The licence link, or `null` when its address is not http(s); then the licence title shows as text. */
    readonly licence: DataSourceLink | null;
    /** The website link, or `null` when its address is not http(s); then the card shows no website link. */
    readonly homepage: DataSourceLink | null;
}

/**
 * A link to an address, or `null` when the address is not an absolute http(s) URL. The wire already carries the
 * register's https addresses; this gate is what stands between a malformed one and `Linking.openURL`. Pure.
 *
 * @param address - The address the source gives.
 * @param accessibleName - The link's accessible name.
 * @returns The link, or `null`.
 */
function linkTo(address: string, accessibleName: string): DataSourceLink | null {
    const safe = safeHttpUrl(address);

    return safe === null ? null : { href: safe.href, accessibleName };
}

/**
 * What one source's card shows. Pure.
 *
 * @param source - One source, as the food service sends it.
 * @param messages - The page's localized copy.
 * @returns The card's heading, its full-name line, and its two links.
 */
export function dataSourceCardModel(source: DataSourceView, messages: DataSourcesMessages): DataSourceCardModel {
    const heading = source.shortName ?? source.name;

    return {
        heading,
        fullName: source.shortName === undefined ? undefined : source.name,
        licence: linkTo(
            source.licenceUrl,
            fillTemplate(messages.licenceLinkName, { licence: source.licenceName, source: heading }),
        ),
        homepage: linkTo(source.homepage, fillTemplate(messages.homepageLinkName, { source: heading })),
    };
}

/** Props for `DataSourceCard`: one source. */
export interface DataSourceCardProps {
    /** One source a stored value cites, as the food service sends it. */
    readonly source: DataSourceView;
}

/** Props for the native `DataSourceCard`: the source, and the adapter that opens a verified link. */
export interface DataSourceCardNativeProps extends DataSourceCardProps {
    /** Opens a verified http(s) href in the system browser. Defaults to `openExternalUrl`. */
    readonly onOpen?: (href: string) => void;
}

/** Props for `DataSourcesList`: the sources a stored value cites, in the order the service sent them. */
export interface DataSourcesListProps {
    /** The cited sources, in the service's order; the list never sorts them again. */
    readonly sources: readonly DataSourceView[];
}

/** Props for the native `DataSourcesList`. */
export interface DataSourcesListNativeProps extends DataSourcesListProps {
    /** Passed to each card; see {@link DataSourceCardNativeProps.onOpen}. */
    readonly onOpen?: (href: string) => void;
}

/** Props for `DataSourcesLoadError`. */
export interface DataSourcesLoadErrorProps {
    /** Retries the read. The read's boundary owns what retrying means. */
    readonly onRetry: () => void;
    /** Whether that retry is in flight: Try again stays where it is, busy (§S16 "States"). */
    readonly retrying: boolean;
    /**
     * Failed reads so far (TanStack's `errorUpdateCount`). Each one is announced: the web alert is a new node for each,
     * because a live region is silent when its words do not change.
     */
    readonly failures: number;
}

/**
 * Props for the native `DataSourcesLoadError`: Try again only. The failure's words are the screen's always-mounted
 * live region, which Android speaks only at a change of a region it already holds (`LiveRegion`'s own rule).
 */
export type DataSourcesLoadErrorNativeProps = Omit<DataSourcesLoadErrorProps, 'failures'>;

/** Props for the web `DataSourcesPage`: the region below the intro, where the read's states render. */
export interface DataSourcesPageProps {
    /** The read's state — the skeleton, the error, or the list — which the host's boundary chooses. */
    readonly children: ReactNode;
    /**
     * Advances when a retry takes the failure, and its Try again, off the page: the heading then takes focus (web) or
     * the reading cursor (native), so neither is lost with the control (WCAG 2.2 SC 2.4.3).
     */
    readonly headingFocusSignal: number;
}

/** Props for the native `DataSourcesPage`, a full-screen sheet. */
export interface DataSourcesPageNativeProps extends DataSourcesPageProps {
    /** The sheet's one way out: Close, and Android back (§S16). */
    readonly onRequestClose: () => void;
}

/** Props of the native Data sources screen (the sheet on its read). */
export interface DataSourcesScreenNativeProps {
    /** Close, Android back: the sheet's one way out. */
    readonly onRequestClose: () => void;
}

/** Props for the web `DataSourcesSettingsLink`: the page's address, which the app's router owns. */
export interface DataSourcesSettingsLinkProps {
    /** The page's address, `/{locale}/legal/sources`, which the app's router owns. */
    readonly href: string;
    /** The host's card classes, so the section matches its siblings on the settings page. */
    readonly className?: string;
}

/** Props for the native `DataSourcesSettingsLink`: opens the sheet, which the host mounts. */
export interface DataSourcesSettingsLinkNativeProps {
    /** Opens the Data sources sheet, which the host mounts and closes. */
    readonly onOpen: () => void;
    /**
     * A count the host advances each time the sheet this link opened closes. A change takes the reading cursor back
     * to the link (design §S16 Focus); the first value moves nothing.
     */
    readonly returnFocusSignal?: number;
}
