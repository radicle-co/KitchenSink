import type * as Preset from '@docusaurus/preset-classic';
import type { Config, PluginConfig } from '@docusaurus/types';
import { themes } from 'prism-react-renderer';

import { buildDocsPluginOptions } from './src/content/docsPluginOptions.js';
import { onBrokenMarkdownLink } from './src/content/brokenMarkdownLinkHook.js';
import { buildNavbarItems } from './src/content/navbarItems.js';
import { loadContentSources } from './src/content/loadContentSources.js';
import { SITE_TO_REPO_ROOT } from './src/content/paths.js';

/**
 * The Commise engineering documentation site.
 *
 * ⚠️ THIS FILE IS WIRING, NOT POLICY. Every decision worth arguing about — which corpora exist, where
 * they live, what happens when a generator has not run — is in `src/content/`, where it is unit
 * tested. Resist the pull to inline "just one" content path here; the registry is what keeps the
 * site's claims about the repository checkable.
 *
 * Two choices here are deliberate and look like oversights:
 *
 * 1. `markdown.format: 'md'` parses `.md` as CommonMark rather than MDX. The corpus this site mounts
 *    was written years before this site existed and is full of `<host>`, `${VAR}` and `{n}` — every
 *    one of which MDX reads as an expression and refuses to compile. Rendering the real documents
 *    matters more than being able to embed React in them, and nothing here needs to.
 * 2. `presets.classic.docs: false`. All content is mounted through explicitly registered
 *    `plugin-content-docs` instances derived from the registry, so there is no privileged "default"
 *    corpus and adding one is a registry edit rather than a config edit.
 */
const contentSources = loadContentSources();

const config: Config = {
    title: 'Commise Engineering',
    tagline: 'Architecture, standards and generated references for the Commise platform',

    // Placeholders. Hosting is an owner decision with cost implications and has NOT been made, so
    // nothing here is deployed and no deployment configuration exists. `url` only has to be a valid
    // absolute URL for the build to run.
    url: 'https://example.invalid',
    baseUrl: '/',

    // ⛔ `throw`, not `warn`. A broken link that only warns is a 404 nobody sees — which is the exact
    // shape of failure this site was commissioned to stop. If the inherited corpus grows a link this
    // rejects, fix or exclude the link; do not lower the setting.
    onBrokenLinks: 'throw',
    onBrokenAnchors: 'throw',
    onDuplicateRoutes: 'throw',

    markdown: {
        format: 'md',
        hooks: {
            // Not a severity — a POLICY. The mounted corpus links freely into `specs/`, `.specify/`
            // and `packages/`: real files this site deliberately does not publish. Those become
            // repository links; a link naming nothing at all is still reported and still fails.
            onBrokenMarkdownLinks: onBrokenMarkdownLink,
        },
    },

    // Developer documentation for one English-speaking engineering team. Deliberately NOT wired into
    // the product's localization path — see this package's README for the reasoning.
    i18n: { defaultLocale: 'en', locales: ['en'] },

    presets: [
        [
            'classic',
            {
                docs: false,
                blog: false,
                theme: { customCss: './src/css/custom.css' },
            } satisfies Preset.Options,
        ],
    ],

    plugins: contentSources.map((source): PluginConfig => [
        '@docusaurus/plugin-content-docs',
        buildDocsPluginOptions(source, SITE_TO_REPO_ROOT),
    ]),

    themeConfig: {
        navbar: {
            title: 'Commise Engineering',
            items: [...buildNavbarItems(contentSources)],
        },
        footer: {
            style: 'dark',
            copyright:
                'Generated from the repository. Every page describes what a commit DECLARES — never what is deployed.',
        },
        prism: {
            theme: themes.github,
            darkTheme: themes.dracula,
            additionalLanguages: ['bash', 'json', 'yaml', 'sql'],
        },
        // ⚠️ No `satisfies Preset.ThemeConfig` here, deliberately. Docusaurus types a navbar item as
        // `Record<string, unknown>`, so satisfying it would force the precisely-typed items from
        // `buildNavbarItems` to grow an index signature — trading a checked shape for an unchecked
        // one to please an assertion. Docusaurus validates this object with Joi at startup anyway,
        // which is a stronger check than the structural one being given up.
    },
};

export default config;
