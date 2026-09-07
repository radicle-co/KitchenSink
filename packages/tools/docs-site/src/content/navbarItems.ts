import type { ResolvedContentSource } from './contentSource.js';

/** A Docusaurus navbar item addressing one docs-plugin instance by its sidebar. */
export interface DocSidebarNavbarItem {
    readonly type: 'docSidebar';
    readonly docsPluginId: string;
    readonly sidebarId: string;
    readonly position: 'left';
    readonly label: string;
}

/**
 * Derives the navbar from the resolved content sources.
 *
 * Every source gets a link, INCLUDING one whose generator has not run — the placeholder makes that
 * route real, so the link cannot dangle and the page itself says what is missing and where it will
 * land. A navbar that hides ungenerated sections would be the quieter, worse behaviour: the reader
 * would never learn the section exists.
 *
 * `type: 'docSidebar'` rather than a bare `to:` link is load-bearing. A bare link to
 * `/infrastructure` 404s unless some document in that corpus happens to be slugged `/`, and the
 * generated corpora are written by other tools — this site cannot assume an index page it does not
 * author. Addressing the sidebar lands on its first document, whatever that turns out to be.
 */
export function buildNavbarItems(sources: readonly ResolvedContentSource[]): DocSidebarNavbarItem[] {
    return sources.map((source) => ({
        type: 'docSidebar',
        docsPluginId: source.id,
        sidebarId: 'sections',
        position: 'left',
        label: source.label,
    }));
}
