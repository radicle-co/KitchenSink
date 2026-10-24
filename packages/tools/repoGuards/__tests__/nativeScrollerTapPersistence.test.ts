/**
 * Every native scroller lets a control take a tap while the keyboard is up: `keyboardShouldPersistTaps="handled"`.
 *
 * React Native's `ScrollView` (and `FlatList`/`FlashList`, which render one) defaults to `never`. Then, with a text
 * field focused and a keyboard reported, it CAPTURES any touch that starts inside it on a non-text target, blurs the
 * field on release, and the control under the finger never sees the press (`ScrollView.js`
 * `_handleStartShouldSetResponderCapture`, `_handleResponderRelease`, React Native 0.86). That is the familiar "first tap
 * only closes the keyboard". It reaches further than the scroller's own content: the responder system walks the REACT
 * tree, outermost first, and a `Modal` is a React child of whatever renders it. So a sheet opened from a screen whose
 * scroller is left at `never` loses its first tap too, however its own scroller is set. On iOS, where keyboard events
 * are app-wide, that is the rename sheet's "Save name" closing the keyboard and saving nothing
 * (`collections.yaml`, run 38433716728). `handled` still closes the keyboard on a tap that no control takes.
 *
 * Read with the TypeScript parser over the JSX, so a comment or a string is never mistaken for a scroller. Set equality
 * with an EMPTY allowlist: a new offender fails, and so would a stale entry.
 *
 * ⛔ IT ENUMERATES NOTHING: candidates are every native source file on disk (the sibling guard
 * `nativeScrollsToTop.test.ts` reads the same set); the reader is proven against a fixture table first.
 *
 * ✅ THE FIX FOR A FAILURE: add `keyboardShouldPersistTaps="handled"` to the scroller.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { globSync } from 'glob';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { repoRoot } from './serviceSources.js';

/** The scroller components that take `keyboardShouldPersistTaps`. */
const SCROLLERS: ReadonlySet<string> = new Set([
    'ScrollView',
    'FlatList',
    'FlashList',
    'SectionList',
    'Animated.ScrollView',
    'Animated.FlatList',
]);

/** The one accepted value. */
const PERSISTS = 'handled';

/** Whether a JSX attribute's value is the string literal `handled`, written plainly or as an expression. Pure. */
function isHandled(attribute: ts.JsxAttribute): boolean {
    const value = attribute.initializer;

    if (value === undefined) {
        return false;
    }

    if (ts.isStringLiteral(value)) {
        return value.text === PERSISTS;
    }

    return (
        ts.isJsxExpression(value) &&
        value.expression !== undefined &&
        ts.isStringLiteralLike(value.expression) &&
        value.expression.text === PERSISTS
    );
}

/**
 * The scrollers in a source file that do not set `keyboardShouldPersistTaps="handled"`, as `tag@line`.
 *
 * @param source - The file's text.
 * @param fileName - Its name.
 * @returns The offenders, in source order. Pure.
 */
export function scrollersDroppingKeyboardTaps(source: string, fileName: string): readonly string[] {
    const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const offenders: string[] = [];

    const visit = (node: ts.Node): void => {
        if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
            const tag = node.tagName.getText(file);

            if (SCROLLERS.has(tag)) {
                const persists = node.attributes.properties
                    .filter(ts.isJsxAttribute)
                    .find((attribute) => attribute.name.getText(file) === 'keyboardShouldPersistTaps');

                if (persists === undefined || !isHandled(persists)) {
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

describe('the scroller tap-persistence reader', () => {
    const cases: readonly (readonly [string, string, readonly string[]])[] = [
        ['a ScrollView left at the default', '<ScrollView />', ['ScrollView@1']],
        ['a FlatList with other props', '<FlatList data={x} renderItem={r} />', ['FlatList@1']],
        ['a FlashList with children', '<FlashList data={x}>{a}</FlashList>', ['FlashList@1']],
        ['an animated scroller', '<Animated.ScrollView horizontal />', ['Animated.ScrollView@1']],
        ['a SectionList', '<SectionList sections={s} />', ['SectionList@1']],
        ['never, said out loud', '<ScrollView keyboardShouldPersistTaps="never" />', ['ScrollView@1']],
        ['a variable is not proof', '<ScrollView keyboardShouldPersistTaps={mode} />', ['ScrollView@1']],
        ['a bare attribute is not a value', '<ScrollView keyboardShouldPersistTaps />', ['ScrollView@1']],
        ['a spread is not proof', '<ScrollView {...props} />', ['ScrollView@1']],
        [
            'the second of two, on its own line',
            '<ScrollView keyboardShouldPersistTaps="handled" />\n<FlatList />',
            ['FlatList@2'],
        ],
        // Shapes that are NOT offenders.
        ['handled', '<ScrollView keyboardShouldPersistTaps="handled" />', []],
        ['handled as an expression', "<FlashList keyboardShouldPersistTaps={'handled'} data={x} />", []],
        ['handled beside a spread', '<ScrollView {...bind} keyboardShouldPersistTaps="handled">{a}</ScrollView>', []],
        ['a prop on something that does not scroll', '<View keyboardShouldPersistTaps="never" />', []],
        ['a comment', '// <ScrollView />\nconst a = 1;', []],
        ['a string', "const a = '<ScrollView />';", []],
    ];

    it.each(cases)('%s', (_name, source, expected) => {
        expect(scrollersDroppingKeyboardTaps(source, 'fixture.tsx')).toEqual(expected);
    });
});

/** Every native source file: the design system's and the features' `.native.tsx` leaves, and the mobile app. */
function nativeSources(): readonly string[] {
    const patterns = [
        'packages/apps/commise/ui/src/**/*.native.tsx',
        'packages/apps/commise/features/*/src/**/*.native.tsx',
        'packages/apps/commise/mobile/src/**/*.tsx',
    ];

    return patterns
        .flatMap((pattern) => globSync(pattern, { cwd: repoRoot, ignore: ['**/__tests__/**', '**/node_modules/**'] }))
        .sort();
}

/** No exceptions. */
const ALLOWLIST: readonly string[] = [];

describe('every native scroller lets a control take a tap while the keyboard is up', () => {
    it('finds the native sources (so an empty result is not a vacuous pass)', () => {
        expect(nativeSources().length).toBeGreaterThan(50);
    });

    it('leaves no scroller at keyboardShouldPersistTaps="never"', () => {
        const offenders = nativeSources().flatMap((file) =>
            scrollersDroppingKeyboardTaps(readFileSync(path.join(repoRoot, file), 'utf8'), file).map(
                (site) => `${file}:${site}`,
            ),
        );

        expect(offenders, 'set keyboardShouldPersistTaps="handled" on each').toEqual(ALLOWLIST);
    });
});
