/**
 * G7 (ADR-0080): no Tamagui shorthand on a Tamagui element or in `styled()`. See `tamaguiShorthands.test.ts` for why.
 *
 * Tamagui keeps its built-in shorthand table private (`@tamagui/web` `createTamagui.ts`), but every config it builds
 * carries the table as `shorthands`. The names are read from a minimal config built here, once, by `@tamagui/web`'s own
 * `createTamagui`, the module that holds the table. So this module holds no list of its own.
 *
 * @pattern Specification — one predicate over a parsed module, through the shared style-site walk
 */
import { createTamagui, createTokens } from '@tamagui/web';
import ts from 'typescript';

import type { StyledExportsOf } from './tamaguiElements.js';
import { styleSiteFindings } from './tamaguiStyleSites.js';

/**
 * Tamagui's own shorthand names.
 *
 * @sideEffect `createTamagui` registers the config it builds as the process-wide Tamagui config, and this runs at
 *   module load.
 */
function builtInShorthands(): ReadonlySet<string> {
    const config = createTamagui({
        tokens: createTokens({ space: {}, size: {}, radius: {}, zIndex: {}, color: {} }),
        themes: {},
        fonts: {},
    });
    const names = Object.keys(config.shorthands);

    if (names.length === 0) {
        throw new Error('Tamagui built a config with no shorthands; G7 would refuse nothing.');
    }

    return new Set(names);
}

/** Every shorthand Tamagui accepts on any config. */
export const TAMAGUI_SHORTHANDS: ReadonlySet<string> = builtInShorthands();

/**
 * Every shorthand on a Tamagui element or in a `styled()` configuration in one module, plus every part of a
 * configuration the walk cannot read. Pure, given `styledExportsOf`.
 *
 * @param source - The module's text.
 * @param fileName - Its path.
 * @param styledExportsOf - Which names a design-system subpath exports as Tamagui `styled(…)` components.
 * @returns One `file:line text` entry per finding.
 */
export function shorthandFindings(
    source: string,
    fileName: string,
    styledExportsOf: StyledExportsOf,
): readonly string[] {
    return styleSiteFindings(source, fileName, styledExportsOf, {
        attribute: (attribute, file) =>
            ts.isJsxAttribute(attribute) && TAMAGUI_SHORTHANDS.has(attribute.name.getText(file)),
        property: ({ key }) => TAMAGUI_SHORTHANDS.has(key),
    });
}
