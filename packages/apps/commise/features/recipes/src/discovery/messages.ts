/**
 * @module @commise/features-recipes/discovery/messages — user-facing copy for the public-discovery
 * surface (T076, US2).
 *
 * Shared, platform-neutral strings for the discovery view as a {@link LocalizedMessages} dictionary,
 * consumed by BOTH the web `.tsx` and native `.native.tsx` leaves (via `useMessages`), so the platforms
 * cannot drift on copy. The `en` set is required; adding a locale is just another key. This is scoped to
 * discovery so it can grow independently of the shared recipe-feature copy in `../messages.ts`.
 */
import type { LocalizedMessages } from '@commise/i18n';

/** Shared copy for the public-discovery screen (T076), rendered by both the web and native views. */
export interface DiscoveryMessages {
    /** Page/section heading for the discovery surface. */
    readonly heading: string;
    /** Accessible name for the search field. */
    readonly searchLabel: string;
    /** Placeholder shown inside the search field. */
    readonly searchPlaceholder: string;
    /** Singular result-count template (contains `{count}`). */
    readonly countOne: string;
    /** Plural result-count template (contains `{count}`). */
    readonly countOther: string;
    /** Query-echo results header when a search term is active (contains `{count}` and `{query}`) — S5. */
    readonly resultsForQuery: string;
    /** Accessible name for the sort control (S3). */
    readonly sortLabel: string;
    /** Visible label for the Relevance sort. */
    readonly sortRelevance: string;
    /** Visible label for the Newest (recent) sort. */
    readonly sortNewest: string;
    /** Visible label for the Most-cloned sort. */
    readonly sortMostCloned: string;
    /** Visible label for the Quickest sort. */
    readonly sortQuickest: string;
    /** Accessible label for the loading state. */
    readonly loadingLabel: string;
    /** Heading of the browse-empty state (no public recipes to show at all). */
    readonly emptyTitle: string;
    /** Body copy of the browse-empty state. */
    readonly emptyBody: string;
    /** Heading of the no-match state (an active search/filter matched nothing). */
    readonly noMatchTitle: string;
    /** Body copy of the no-match state. */
    readonly noMatchBody: string;
    /** Message shown when discovery fails to load. */
    readonly errorTitle: string;
    /** Label of the retry action in the error state. */
    readonly retry: string;
    /** Source-provenance template shown on a row (contains `{source}`). */
    readonly attribution: string;
    /** Visible label of the idle clone action. */
    readonly clone: string;
    /** Visible label of the clone action while its clone is in flight. */
    readonly cloning: string;
    /** Accessible label for the idle clone action (contains `{title}`, so each row is uniquely named). */
    readonly cloneLabel: string;
    /** Accessible label for the in-flight clone action (contains `{title}`). */
    readonly cloningLabel: string;
}

export const discoveryMessages: LocalizedMessages<DiscoveryMessages> = {
    en: {
        heading: 'Discover recipes',
        searchLabel: 'Search public recipes',
        searchPlaceholder: 'Search public recipes...',
        countOne: '{count} recipe',
        countOther: '{count} recipes',
        resultsForQuery: 'Showing {count} for “{query}”',
        sortLabel: 'Sort by',
        sortRelevance: 'Relevance',
        sortNewest: 'Newest',
        sortMostCloned: 'Most cloned',
        sortQuickest: 'Quickest',
        loadingLabel: 'Loading recipes',
        emptyTitle: 'No recipes found',
        emptyBody: 'Try a different search to discover public recipes.',
        noMatchTitle: 'No matching recipes',
        noMatchBody: 'No public recipes match your search and filters. Try adjusting them.',
        errorTitle: 'We couldn’t load recipes.',
        retry: 'Try again',
        attribution: 'From {source}',
        clone: 'Clone',
        cloning: 'Cloning',
        cloneLabel: 'Clone {title}',
        cloningLabel: 'Cloning {title}',
    },
};
