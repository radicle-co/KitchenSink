/**
 * @module css/darkThemeSelector — a PostCSS plugin that moves the theme's dark overrides from the system colour
 * scheme onto an attribute.
 *
 * `@commise/ui/theme.css` switches themes with one `@media (prefers-color-scheme: dark) { :root { … } }` block.
 * Inside a published artifact the viewer picks the theme, so the same declarations must answer to
 * `:root[data-theme="dark"]` instead. That block, and nothing else, is rewritten.
 *
 * @pattern Visitor — a PostCSS AtRule visitor
 */
import type { AtRule, Plugin } from 'postcss';

/** The one media query this plugin owns. `(prefers-color-scheme: dark)` and nothing compound. */
const DARK_SCHEME_QUERY = /^\(\s*prefers-color-scheme\s*:\s*dark\s*\)$/i;

/** The selector the dark overrides move onto. */
const DARK_SELECTOR = ':root[data-theme="dark"]';

/**
 * Whether a node is a top-level dark-scheme media query.
 *
 * @param atRule - The at-rule visited.
 * @returns True for `@media (prefers-color-scheme: dark)` directly under the stylesheet root.
 */
function isDarkSchemeBlock(atRule: AtRule): boolean {
    return atRule.parent?.type === 'root' && DARK_SCHEME_QUERY.test(atRule.params.trim());
}

/**
 * Rewrite every top-level `@media (prefers-color-scheme: dark) { :root { … } }` into
 * `:root[data-theme="dark"] { … }`.
 *
 * The block must hold only `:root` rules: anything else has no attribute form this plugin can vouch for, and
 * leaving it behind would put a `prefers-color-scheme` rule in the artifact, so the plugin throws instead.
 * Other media queries, the light scheme and a dark block nested in another rule are left as they are.
 *
 * @returns The plugin.
 * @throws CssSyntaxError when a dark-scheme block holds a node that is not a plain `:root` rule.
 */
export function darkThemeSelector(): Plugin {
    return {
        postcssPlugin: 'design-artifact-dark-theme-selector',
        AtRule: {
            media(atRule) {
                if (!isDarkSchemeBlock(atRule)) {
                    return;
                }

                const children = [...(atRule.nodes ?? [])];

                for (const child of children) {
                    if (child.type !== 'rule' || child.selector.trim() !== ':root') {
                        throw child.error(
                            'A prefers-color-scheme: dark block may hold only :root rules; ' +
                                'this node has no data-theme form.',
                        );
                    }
                }

                for (const child of children) {
                    if (child.type === 'rule') {
                        child.selector = DARK_SELECTOR;
                    }
                }

                atRule.replaceWith(children);
            },
        },
    };
}

darkThemeSelector.postcss = true as const;
