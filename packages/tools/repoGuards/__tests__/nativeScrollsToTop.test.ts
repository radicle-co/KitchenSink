/**
 * One `scrollsToTop` per native screen (`docs/architecture/uiOverhaulBlueprint.md` slice 3 step 8;
 * `docs/design/uiOverhaul/buildSpec.md` §3.6). iOS scrolls a screen to the top on a status-bar tap only when EXACTLY ONE
 * scroll view on screen has `scrollsToTop` — and every `ScrollView`, `FlatList` and `FlashList` has it on by default. A
 * horizontal rail, chip row or strip left at the default silently breaks the gesture for the whole screen, with
 * nothing to see in review.
 *
 * So every HORIZONTAL scroller in native source sets `scrollsToTop={false}`. Read with the TypeScript parser over the
 * JSX, so a comment or a string that mentions `horizontal` is never mistaken for a prop. Set equality with an EMPTY
 * allowlist: a new offender fails, and so would a stale allowlist entry.
 *
 * ⛔ IT ENUMERATES NOTHING: candidates are every native source file on disk; the reader is proven against a fixture table
 * of the shapes below before it is trusted with the tree.
 *
 * ✅ THE FIX FOR A FAILURE: add `scrollsToTop={false}` to the horizontal scroller. (Scrollers inside a sheet need it too;
 * the sheet primitive owns that, and this guard reads only what a parser can see without running the app.)
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { globSync } from 'glob';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { repoRoot } from './serviceSources.js';

/** The scroller components whose `scrollsToTop` defaults to on. */
const SCROLLERS: ReadonlySet<string> = new Set([
    'ScrollView',
    'FlatList',
    'FlashList',
    'SectionList',
    'Animated.ScrollView',
    'Animated.FlatList',
]);

/** Whether a JSX attribute's value is the literal `false`. Pure. */
function isLiteralFalse(attribute: ts.JsxAttribute): boolean {
    const value = attribute.initializer;

    return (
        value !== undefined &&
        ts.isJsxExpression(value) &&
        value.expression !== undefined &&
        value.expression.kind === ts.SyntaxKind.FalseKeyword
    );
}

/**
 * The horizontal scrollers in a source file that leave `scrollsToTop` on, as `tag@line`.
 *
 * @param source - The file's text.
 * @param fileName - Its name.
 * @returns The offenders, in source order. Pure.
 */
export function horizontalScrollersWithScrollsToTop(source: string, fileName: string): readonly string[] {
    const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const offenders: string[] = [];

    const visit = (node: ts.Node): void => {
        if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
            const tag = node.tagName.getText(file);

            if (SCROLLERS.has(tag)) {
                const attributes = node.attributes.properties.filter(ts.isJsxAttribute);
                const named = (name: string) => attributes.find((attribute) => attribute.name.getText(file) === name);
                const horizontal = named('horizontal');
                const scrollsToTop = named('scrollsToTop');
                const isHorizontal = horizontal !== undefined && !isLiteralFalse(horizontal);

                if (isHorizontal && (scrollsToTop === undefined || !isLiteralFalse(scrollsToTop))) {
                    const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
                    offenders.push(`${tag}@${line + 1}`);
                }
            }
        }

        ts.forEachChild(node, visit);
    };

    visit(file);

    return offenders;
}

describe('the scroller reader', () => {
    const cases: readonly (readonly [string, string, readonly string[]])[] = [
        ['a horizontal ScrollView left on', '<ScrollView horizontal />', ['ScrollView@1']],
        ['a horizontal FlatList with an expression', '<FlatList horizontal={true} data={x} />', ['FlatList@1']],
        ['a horizontal FlashList with children', '<FlashList horizontal>{a}</FlashList>', ['FlashList@1']],
        ['an animated horizontal scroller', '<Animated.ScrollView horizontal />', ['Animated.ScrollView@1']],
        [
            'scrollsToTop set to a variable is not proof',
            '<ScrollView horizontal scrollsToTop={off} />',
            ['ScrollView@1'],
        ],
        ['scrollsToTop={true} is the default', '<ScrollView horizontal scrollsToTop={true} />', ['ScrollView@1']],
        // Shapes that are NOT offenders.
        ['a horizontal scroller that opts out', '<ScrollView horizontal scrollsToTop={false} />', []],
        ['a vertical scroller (the screen’s one)', '<ScrollView contentContainerStyle={s} />', []],
        ['horizontal={false}', '<FlatList horizontal={false} />', []],
        ['a horizontal prop on something that does not scroll', '<View horizontal />', []],
        ['a comment', '// <ScrollView horizontal />\nconst a = 1;', []],
        ['a string', "const a = '<ScrollView horizontal />';", []],
    ];

    it.each(cases)('%s', (_name, source, expected) => {
        expect(horizontalScrollersWithScrollsToTop(source, 'fixture.tsx')).toEqual(expected);
    });
});

/** Every native source file: the design system's and the features' `.native.tsx` leaves, and the mobile app. */
function nativeSources(): readonly string[] {
    const root = repoRoot;
    const patterns = [
        'packages/apps/commise/ui/src/**/*.native.tsx',
        'packages/apps/commise/features/*/src/**/*.native.tsx',
        'packages/apps/commise/mobile/src/**/*.tsx',
    ];

    return patterns
        .flatMap((pattern) => globSync(pattern, { cwd: root, ignore: ['**/__tests__/**', '**/node_modules/**'] }))
        .sort();
}

/** No exceptions. */
const ALLOWLIST: readonly string[] = [];

describe('one scrollsToTop per native screen', () => {
    it('finds the native sources (so an empty result is not a vacuous pass)', () => {
        expect(nativeSources().length).toBeGreaterThan(50);
    });

    it('leaves no horizontal scroller with scrollsToTop on', () => {
        const root = repoRoot;
        const offenders = nativeSources().flatMap((file) =>
            horizontalScrollersWithScrollsToTop(readFileSync(path.join(root, file), 'utf8'), file).map(
                (site) => `${file}:${site}`,
            ),
        );

        expect(offenders, 'set scrollsToTop={false} on each').toEqual(ALLOWLIST);
    });
});
