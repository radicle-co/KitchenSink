/**
 * A native text field that can sit under the keyboard must ask the field reveal host to hold it in view
 * (`useFocusReveal`, directly or through `useRevealedField`; `docs/design/uiOverhaul/specSharedSystem.md` §16.3). The
 * editor's duration boxes and the row editor's amount field rendered the primitive without it, so the keyboard covered
 * the focused box and the page did not scroll (qa-ios, 2026-11-03).
 *
 * The rule: every native module that renders `<TextInput>` calls one of the two hooks, or is listed below with the
 * reason it cannot be covered, and the reason is CHECKED where it names a container: the module must import it.
 *
 * ✅ THE FIX FOR A FAILURE: call `useRevealedField()` (`@commise/ui/field-reveal`) and spread its `ref`, `onFocus` and
 * `onBlur` onto the input. Add an exemption only for a field that is inside a surface that lifts it above the keyboard.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { revealsFocus, rendersTextInput } from './nativeInputFieldReveal.js';
import { nativeSources } from './nativeSources.js';
import { repoRoot } from './serviceSources.js';

/** A module that renders an input and does not call the hook, with why that is safe. */
interface Exemption {
    readonly why: string;
    /** An import specifier the module must hold for the reason to be true; none for a field at the top of its screen. */
    readonly container?: string;
}

const EXEMPT: Readonly<Record<string, Exemption>> = {
    'packages/apps/commise/ui/src/searchField/SearchField.native.tsx': {
        why: 'The search field sits at the top of its screen or frame, or inside the filters sheet; the keyboard never covers it.',
    },
    'packages/apps/commise/features/recipes/src/form/AuthoredFoodSheet.native.tsx': {
        why: 'The fields are inside a Sheet, which lifts its body above the keyboard (KeyboardLift).',
        container: '@commise/ui/sheet',
    },
    'packages/apps/commise/features/recipes/src/details/VariantDetailsDialog.native.tsx': {
        why: 'The search field is inside a Sheet, which lifts its body above the keyboard (KeyboardLift).',
        container: '@commise/ui/sheet',
    },
    'packages/apps/commise/features/account/src/danger/AccountEraseDialog.native.tsx': {
        why: 'The phrase field is inside a DialogFrame, which lifts the card above the keyboard.',
        container: '@commise/ui/dialog-frame',
    },
};

const FILE = 'packages/apps/commise/ui/src/thing/Thing.native.tsx';
const HEAD = `import { TextInput } from '@commise/ui/text-input';\n`;

describe('the reader', () => {
    it.each([
        ['an input with no hook', `const A = () => <TextInput />;`, true, false],
        [
            'an input with useFocusReveal',
            `const A = () => { useFocusReveal(node, f); return <TextInput />; };`,
            true,
            true,
        ],
        [
            'an input with useRevealedField',
            `const A = () => { const r = useRevealedField(); return <TextInput {...r} />; };`,
            true,
            true,
        ],
        ['a hook and no input', `const A = () => { useFocusReveal(node, f); return null; };`, false, true],
        ['no input, no hook', `const A = () => <View />;`, false, false],
        ['a hook named in a comment only', `// useFocusReveal\nconst A = () => <TextInput />;`, true, false],
    ])('reads %s', (_name, source, renders, reveals) => {
        expect(rendersTextInput(`${HEAD}${source}`, FILE)).toBe(renders);
        expect(revealsFocus(`${HEAD}${source}`, FILE)).toBe(reveals);
    });
});

describe('every native module that renders a text input', () => {
    const sources = nativeSources().map((file) => [file, readFileSync(path.join(repoRoot, file), 'utf8')] as const);
    const rendering = sources.filter(([file, source]) => rendersTextInput(source, file));

    it('reads real inputs, so a reader that sees nothing cannot pass', () => {
        expect(rendering.length).toBeGreaterThan(5);
    });

    it('reveals its focus or is listed with a reason', () => {
        const unrevealed = rendering
            .filter(([file, source]) => !revealsFocus(source, file) && !(file in EXEMPT))
            .map(([file]) => file);

        expect(unrevealed).toEqual([]);
    });

    it('lists only modules that still render an input and still lack the hook', () => {
        const live = new Set(rendering.filter(([file, source]) => !revealsFocus(source, file)).map(([file]) => file));

        expect(Object.keys(EXEMPT).filter((file) => !live.has(file))).toEqual([]);
    });

    it('holds the container each reason names', () => {
        const missing = Object.entries(EXEMPT).flatMap(([file, { container }]) => {
            const source = sources.find(([candidate]) => candidate === file)?.[1] ?? '';

            return container === undefined || source.includes(`'${container}'`)
                ? []
                : [`${file} does not import ${container}`];
        });

        expect(missing).toEqual([]);
    });
});
