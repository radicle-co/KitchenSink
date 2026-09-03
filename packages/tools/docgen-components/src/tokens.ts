/**
 * @module @kitchensink/docgen-components/tokens — derives the design-token catalogue a style guide renders.
 *
 * ## It IMPORTS the tokens; it does not read them out of the source text
 *
 * `space[4]` is `pxToRem(spacing[4])` and `shadows.md` is `boxShadow(elevation.md)` — values COMPUTED from
 * the numeric source in `scale.ts`. A text-scraping emitter would publish the expression, not the value, and
 * the only way to publish the value would be to compute it a second time here, which is the second source of
 * truth this artifact exists to avoid. So the generator imports `@commise/ui` and serializes what the app
 * itself consumes: the style guide cannot disagree with the running product, because it is the same object.
 *
 * ⚠️ That is why this module needs `@commise/ui` BUILT. Its `.` entry point resolves to `dist`, so both the
 * generate task and the guard declare `dependsOn: ["^build"]` (turbo's ordinary workspace edge). The raw-source
 * entry `@commise/ui/scale` needs no build, which is why the numeric source is read through it.
 *
 * ## Each group's prose is the JSDoc above its own `export const`
 *
 * `colors.ts` carries the two measured WCAG rules the palette obeys; `gradients.ts` explains why the scrim's
 * terminal stop is charcoal-at-zero-alpha rather than `transparent`. That reasoning is what a designer opening
 * a style guide needs, it is already written, and it is written in ONE place. This module quotes it — it never
 * paraphrases it, and there is no field here a human fills in.
 *
 * @sideEffect Reads the `@commise/ui` token sources to recover their docblocks.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
    chart,
    fontSizes,
    fontWeights,
    fonts,
    glass,
    gradient,
    lineHeights,
    nativeTokens,
    palette,
    radius,
    semantic,
    shadows,
    size,
    space,
} from '@commise/ui';
import * as scale from '@commise/ui/scale';
import ts from 'typescript';

import { REPO_ROOT, SCHEMA_VERSION, UI_TOKENS_DIR } from './config.js';
import { readDeclarationDocs } from './docblock.js';

/** What a token's VALUE is, derived from the value itself so the classification cannot go stale. */
export type TokenKind = 'color' | 'dimension' | 'number' | 'gradient' | 'glass' | 'shadow' | 'text' | 'object';

/** One design token. */
export interface DesignToken {
    readonly name: string;
    readonly kind: TokenKind;
    readonly value: unknown;
}

/** One named export of one token module. */
export interface DesignTokenGroup {
    /** Stable slug, e.g. `palette` or `native.spacing`. */
    readonly id: string;
    /** Repo-relative module the group is exported from. */
    readonly source: string;
    /** The JSDoc above the group's own `export const`, verbatim. Empty when it carries none. */
    readonly doc: string;
    readonly tokens: readonly DesignToken[];
}

/** The emitted document. */
export interface DesignTokenDocument {
    readonly schemaVersion: number;
    /** The package the values were imported from — they are the running app's own objects. */
    readonly source: string;
    readonly groups: readonly DesignTokenGroup[];
}

/** Colour notations the palette actually uses. */
const COLOR_PATTERN = /^(?:#[0-9a-f]{3,8}|(?:rgba?|hsla?|oklch|color-mix)\()/i;

/** A CSS length or ratio. */
const DIMENSION_PATTERN = /^-?\d*\.?\d+(?:rem|px|em|%)$/;

/**
 * Classify a token from its value.
 *
 * Derived rather than declared: a hand-maintained `kind` beside each group is a second statement of something
 * the value already says, and it is the statement that rots when a token changes shape.
 *
 * @param value - The token's value.
 * @returns Its kind.
 */
export function tokenKindOf(value: unknown): TokenKind {
    if (typeof value === 'number') {
        return 'number';
    }

    if (typeof value === 'string') {
        if (COLOR_PATTERN.test(value)) {
            return 'color';
        }

        if (DIMENSION_PATTERN.test(value)) {
            return 'dimension';
        }

        return value.includes('px ') && value.includes('rgba(') ? 'shadow' : 'text';
    }

    if (typeof value === 'object' && value !== null) {
        if ('stops' in value && 'angle' in value) {
            return 'gradient';
        }

        if ('fallback' in value) {
            return 'glass';
        }

        if ('shadowRadius' in value || 'blur' in value) {
            return 'shadow';
        }
    }

    return 'object';
}

/** Turn a record of values into tokens, in declaration order — the order the design system wrote them in. */
function toTokens(record: Readonly<Record<string, unknown>>): readonly DesignToken[] {
    return Object.entries(record).map(([name, value]) => ({ name, kind: tokenKindOf(value), value }));
}

/** One export of one module, before its docblock is attached. */
interface GroupSource {
    readonly id: string;
    readonly module: string;
    readonly exportName: string;
    readonly values: unknown;
}

/**
 * The exports emitted, in reading order: colour, then space, then shape, then type, then the composed
 * surfaces, then each platform's projection.
 *
 * The VALUES are imported bindings, so this list cannot name a token that does not exist — deleting an export
 * from `@commise/ui` is a compile error here rather than a silently-missing section in the style guide.
 */
const GROUP_SOURCES: readonly GroupSource[] = [
    { id: 'palette', module: 'colors.ts', exportName: 'palette', values: palette },
    { id: 'semantic', module: 'colors.ts', exportName: 'semantic', values: semantic },
    { id: 'chart', module: 'colors.ts', exportName: 'chart', values: chart },
    { id: 'space', module: 'spacing.ts', exportName: 'space', values: space },
    { id: 'size', module: 'spacing.ts', exportName: 'size', values: size },
    { id: 'radius', module: 'radius.ts', exportName: 'radius', values: radius },
    { id: 'shadows', module: 'shadows.ts', exportName: 'shadows', values: shadows },
    { id: 'fonts', module: 'typography.ts', exportName: 'fonts', values: fonts },
    { id: 'fontSizes', module: 'typography.ts', exportName: 'fontSizes', values: fontSizes },
    { id: 'fontWeights', module: 'typography.ts', exportName: 'fontWeights', values: fontWeights },
    { id: 'lineHeights', module: 'typography.ts', exportName: 'lineHeights', values: lineHeights },
    { id: 'gradient', module: 'gradients.ts', exportName: 'gradient', values: gradient },
    { id: 'glass', module: 'gradients.ts', exportName: 'glass', values: glass },
    { id: 'native', module: 'native.ts', exportName: 'nativeTokens', values: nativeTokens },
    { id: 'scale.spacing', module: 'scale.ts', exportName: 'spacing', values: scale.spacing },
    { id: 'scale.radius', module: 'scale.ts', exportName: 'radius', values: scale.radius },
    { id: 'scale.fontSize', module: 'scale.ts', exportName: 'fontSize', values: scale.fontSize },
    { id: 'scale.fontWeight', module: 'scale.ts', exportName: 'fontWeight', values: scale.fontWeight },
    { id: 'scale.lineHeightRatio', module: 'scale.ts', exportName: 'lineHeightRatio', values: scale.lineHeightRatio },
    { id: 'scale.elevation', module: 'scale.ts', exportName: 'elevation', values: scale.elevation },
    { id: 'scale.mediaHeight', module: 'scale.ts', exportName: 'mediaHeight', values: scale.mediaHeight },
    { id: 'scale.fontFamily', module: 'scale.ts', exportName: 'fontFamily', values: scale.fontFamily },
    { id: 'scale.displayFontFace', module: 'scale.ts', exportName: 'displayFontFace', values: scale.displayFontFace },
];

/**
 * The docblock of every exported const in a token module, read once per module.
 *
 * @param repoRoot - Absolute repository root.
 * @param moduleName - File name within the token directory.
 * @returns Export name to docblock text.
 * @sideEffect Reads the module source.
 */
function docsForModule(repoRoot: string, moduleName: string): ReadonlyMap<string, string> {
    const path = join(repoRoot, UI_TOKENS_DIR, moduleName);
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);

    return readDeclarationDocs(source);
}

/**
 * Build the design-token document.
 *
 * `nativeTokens` is expanded into one sub-group per projection (`native.spacing`, `native.fontSize`, …)
 * rather than emitted as a single opaque token, because it is a record OF records and a style guide renders
 * each of those as its own scale. The expansion is driven by the value's shape, so a new projection appears
 * on its own.
 *
 * @param repoRoot - Absolute repository root. Defaults to this checkout's root.
 * @returns The document.
 * @sideEffect Reads the token module sources for their docblocks.
 */
export function buildDesignTokens(repoRoot: string = REPO_ROOT): DesignTokenDocument {
    const docCache = new Map<string, ReadonlyMap<string, string>>();
    const groups: DesignTokenGroup[] = [];

    for (const groupSource of GROUP_SOURCES) {
        const cached = docCache.get(groupSource.module) ?? docsForModule(repoRoot, groupSource.module);
        docCache.set(groupSource.module, cached);

        const doc = cached.get(groupSource.exportName) ?? '';
        const source = `${UI_TOKENS_DIR}/${groupSource.module}`;
        const values = groupSource.values as Readonly<Record<string, unknown>>;

        if (groupSource.id === 'native') {
            const scalars: Record<string, unknown> = {};

            for (const [name, value] of Object.entries(values)) {
                if (typeof value === 'object' && value !== null) {
                    groups.push({
                        id: `native.${name}`,
                        source,
                        doc,
                        tokens: toTokens(value as Readonly<Record<string, unknown>>),
                    });
                } else {
                    scalars[name] = value;
                }
            }

            if (Object.keys(scalars).length > 0) {
                groups.push({ id: 'native', source, doc, tokens: toTokens(scalars) });
            }

            continue;
        }

        groups.push({ id: groupSource.id, source, doc, tokens: toTokens(values) });
    }

    return { schemaVersion: SCHEMA_VERSION, source: '@commise/ui', groups };
}
