import type { ContentSource } from './contentSource.js';

/**
 * THE REGISTRY — the one authoritative statement of what this site is made of.
 *
 * Pattern: Registry. Every path here is repo-root-relative and points at material that lives
 * SOMEWHERE ELSE and stays there. Nothing under `docs/` is copied into this package; Docusaurus
 * mounts the real directories. A second copy of an ADR is the drift this repository keeps paying
 * for, so the site references and never duplicates.
 *
 * ⚠️ `include` is an ALLOWLIST, deliberately, not an `exclude` blocklist. `docs/` also holds working
 * material — review notes, plans, brainstorms, reports, competitive analyses — that is correspondence
 * rather than documentation. A blocklist would silently admit the next working directory somebody
 * adds; an allowlist silently admits nothing, and `contentRegistry.test.ts` fails the build if any
 * single glob here stops reaching files.
 */
export const CONTENT_SOURCES: readonly ContentSource[] = [
    {
        id: 'handbook',
        label: 'Handbook',
        routeBasePath: '/handbook',
        availability: 'required',
        contentPath: 'docs',
        include: [
            'CODING_STANDARDS.md',
            'CI_ARCHITECTURE.md',
            'api-conventions.md',
            'tooling.md',
            'SENTRY_OBSERVABILITY_SETUP.md',
            'architecture/**/*.md',
            'engineering/**/*.md',
            'runbooks/**/*.md',
        ],
    },
    {
        id: 'infrastructure',
        label: 'Infrastructure',
        routeBasePath: '/infrastructure',
        availability: 'generated',
        contentPath: 'docs/generated/infrastructure',
        placeholderPath: 'packages/tools/docs-site/content/awaiting/infrastructure',
        include: ['**/*.md'],
    },
    {
        id: 'components',
        label: 'Components',
        routeBasePath: '/components',
        availability: 'generated',
        contentPath: 'docs/generated/components',
        placeholderPath: 'packages/tools/docs-site/content/awaiting/components',
        include: ['**/*.md'],
    },
    {
        id: 'design',
        label: 'Design system',
        routeBasePath: '/design',
        availability: 'generated',
        contentPath: 'docs/generated/design',
        placeholderPath: 'packages/tools/docs-site/content/awaiting/design',
        include: ['**/*.md'],
    },
];
