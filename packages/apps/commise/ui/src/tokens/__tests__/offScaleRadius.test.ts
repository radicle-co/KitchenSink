/**
 * The design system's own components draw only the four radius steps (8, 12, 18, 24 px: `sm`, `md`, `lg`, `xl`) and the
 * pill (parity item 9). Tailwind's default `rounded-2xl` is 16 px, which is on NONE of them, and it was written in the
 * sheet, popover, combobox and both notices. `rounded-3xl` and `-4xl` are off the scale the same way.
 *
 * Scope is `@commise/ui`'s own source, which owns the scale. The feature files that still say `rounded-2xl` are a
 * recorded follow-up, not an exemption: this guard is where the design system proves it is clean.
 *
 * A comment may name a class (a docblock that explains the old one), so the scan reads only quoted text.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const UI_SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** An off-scale default radius utility, behind any variant prefix and corner suffix. */
const OFF_SCALE = /(?:^|[\s"'`:])rounded(?:-[a-z]{1,2})?-(?:2xl|3xl|4xl)(?=$|[\s"'`])/u;

/** Every non-test source file under `@commise/ui/src`. */
function sources(directory: string): readonly string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(directory, entry.name);

        if (entry.isDirectory()) {
            return entry.name === '__tests__' || entry.name === '__fixtures__' ? [] : sources(full);
        }

        return /\.tsx?$/u.test(entry.name) && !/\.test\./u.test(entry.name) ? [full] : [];
    });
}

/** The text between quotes and backticks on each line: a docblock's prose has none. */
const quotedText = (line: string): string =>
    [...line.matchAll(/(["'`])((?:\\.|(?!\1).)*)\1/gu)].map((m) => ` ${m[2] ?? ''} `).join(' ');

describe('@commise/ui radius scale', () => {
    it('reads the component sources (a vacuous pass would hide the rule)', () => {
        const files = sources(UI_SRC).map((file) => path.relative(UI_SRC, file));

        expect(files).toContain(path.join('sheet', 'Sheet.tsx'));
        expect(files).toContain(path.join('refreshNotice', 'RefreshNotice.tsx'));
    });

    it('draws no rounded-2xl, rounded-3xl or rounded-4xl, which sit between the steps', () => {
        const offenders = sources(UI_SRC).flatMap((file) =>
            readFileSync(file, 'utf8')
                .split('\n')
                .flatMap((line, index) => {
                    const hit = OFF_SCALE.exec(quotedText(line));

                    return hit === null
                        ? []
                        : [`${path.relative(UI_SRC, file)}:${String(index + 1)}  ${hit[0].trim()}`];
                }),
        );

        expect(offenders).toEqual([]);
    });

    it('recognises the classes it forbids', () => {
        for (const text of [' rounded-2xl ', ' sm:rounded-2xl ', ' rounded-t-3xl ', ' hover:rounded-4xl ']) {
            expect(OFF_SCALE.test(text), text).toBe(true);
        }

        for (const text of [
            ' rounded-xl ',
            ' rounded-lg ',
            ' rounded-full ',
            ' rounded-t-xl ',
            ' rounded-[calc(var(--spacing)*5.5)] ',
        ]) {
            expect(OFF_SCALE.test(text), text).toBe(false);
        }
    });
});
