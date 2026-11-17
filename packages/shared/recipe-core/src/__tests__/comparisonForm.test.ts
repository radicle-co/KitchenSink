/**
 * comparisonForm: the fold both sides of a wording comparison pass through before shingling. Six steps, in order:
 * (1) NFKC, (2) Hangul fillers + \p{Z} + \p{Cc} + \p{Pd} become one space, (3) other Default_Ignorable_Code_Point
 * removed, (4) lower-case, (5) NFD then strip \p{M}, (6) remove apostrophes. Whitespace is NOT collapsed here; the
 * shingler does that. Every invisible or confusable character is written as an escape so the file stays reviewable.
 * A step 0 (apostrophe-likes that NFKC would turn into a space plus a mark) runs before step 1.
 */
import { describe, expect, it } from 'vitest';

import { comparisonForm } from '../comparisonForm.js';

/** [step label, input, expected]. One table per step, each row built so removing that ONE step breaks it. */
type Row = readonly [label: string, input: string, expected: string];

// Step 1 pins: only NFKC can produce these (lower-casing, NFD and mark-stripping leave them alone).
const step1: readonly Row[] = [
    ['step 1: full-width letters fold to ASCII', 'ｅｇｇｓ', 'eggs'],
    ['step 1: ligature fi is split', 'ﬁsh', 'fish'],
    ['step 1: roman numeral VIII becomes letters', 'Ⅷ', 'viii'],
    ['step 1: ideographic space becomes a space', 'a　b', 'a b'],
    ['step 1: full-width apostrophe reaches step 6', 'don＇t', 'dont'],
    ['step 1: dz digraph with caron splits', 'ǆ', 'dz'],
];

// Step 2 pins: each separator must become a SPACE. A mutant that removes them (or leaves them) breaks these.
const step2: readonly Row[] = [
    ['step 2: Hangul choseong filler U+115F is a space', 'aᅟb', 'a b'],
    ['step 2: Hangul jungseong filler U+1160 is a space', 'aᅠb', 'a b'],
    ['step 2: Hangul filler U+3164 is a space', 'aㅤb', 'a b'],
    ['step 2: half-width Hangul filler U+FFA0 is a space', 'aﾠb', 'a b'],
    ['step 2: line separator U+2028 (Zl) is a space', 'a b', 'a b'],
    ['step 2: paragraph separator U+2029 (Zp) is a space', 'a b', 'a b'],
    ['step 2: ogham space mark U+1680 (Zs) is a space', 'a b', 'a b'],
    ['step 2: no-break space is a space', 'a b', 'a b'],
    ['step 2: tab is a space', 'a\tb', 'a b'],
    ['step 2: newline is a space', 'a\nb', 'a b'],
    ['step 2: carriage return is a space', 'a\rb', 'a b'],
    ['step 2: NEL U+0085 (Cc) is a space', 'a\u0085b', 'a b'],
    ['step 2: en dash is a space', 'a–b', 'a b'],
    ['step 2: em dash is a space', 'a—b', 'a b'],
    ['step 2: hyphen-minus (Pd) is a space', 'well-done', 'well done'],
    ['step 2: non-breaking hyphen is a space', 'a‑b', 'a b'],
    ['step 2: a run of separators stays a run, collapsing is the shingler job', 'a\t —b', 'a   b'],
];

// Step 3 pins: Cf characters only, because step 5 would strip a Mn one (U+17B4, U+180F, VS) even without step 3.
const step3: readonly Row[] = [
    ['step 3: zero-width space is removed, not spaced', 'eg​gs', 'eggs'],
    ['step 3: soft hyphen is removed, not spaced', 'per­fect', 'perfect'],
    ['step 3: zero-width joiner is removed', 'a‍b', 'ab'],
    ['step 3: zero-width non-joiner is removed', 'a‌b', 'ab'],
    ['step 3: word joiner is removed', 'a⁠b', 'ab'],
    ['step 3: byte order mark is removed', 'a﻿b', 'ab'],
    ['step 3: Mongolian vowel separator U+180E is removed', 'a᠎b', 'ab'],
    ['step 3: left-to-right mark is removed', 'a‎b', 'ab'],
    ['step 3: tag character is removed', 'a\u{E0041}b', 'ab'],
    ['step 3: combining grapheme joiner is removed', 'a͏b', 'ab'],
    ['step 3: Khmer inherent vowel U+17B4 is removed', 'eg឴gs', 'eggs'],
    ['step 3: Mongolian free variation selector U+180F is removed', 'eg᠏gs', 'eggs'],
    ['step 3: variation selector U+FE0F is removed', 'a️b', 'ab'],
];

// Step 4 pins: lower-casing, on letters NFKC/NFD/mark-stripping leave in upper case.
const step4: readonly Row[] = [
    ['step 4: ASCII upper case is lowered', 'EGGS', 'eggs'],
    ['step 4: mixed case is lowered', 'Crack And Whisk', 'crack and whisk'],
    ['step 4: Greek capitals lower, final sigma included', 'ΟΔΟΣ', 'οδος'],
    ['step 4: Cyrillic capitals lower and lose the breve (step 5)', 'ЯЙЦО', 'яицо'],
    ['step 4: dotted capital I lowers to i plus a dot, which step 5 strips', 'İstanbul', 'istanbul'],
    ['step 4: capital sharp s lowers to sharp s, not to ss', 'ẞ', 'ß'],
];

// Step 5 pins: marks only (Mn that is NOT Default_Ignorable, so step 3 cannot be what removes it).
const step5: readonly Row[] = [
    ['step 5: precomposed accents are stripped', 'crème brûlée', 'creme brulee'],
    ['step 5: decomposed accents are stripped', 'crème brûlée', 'creme brulee'],
    ['step 5: a lone combining acute is stripped', 'é', 'e'],
    ['step 5: tilde and cedilla are stripped', 'jã ça', 'ja ca'],
    ['step 5: a precomposed upper-case accent folds with step 4', 'ÉCLAIR', 'eclair'],
];

// Step 6 pins: each listed apostrophe is REMOVED (not spaced). U+00B4 has its own step 0 block below.
const step6: readonly Row[] = [
    ['step 6: ASCII apostrophe is removed', "don't", 'dont'],
    ['step 6: right single quote U+2019 is removed', 'don’t', 'dont'],
    ['step 6: left single quote U+2018 is removed', 'don‘t', 'dont'],
    ['step 6: modifier letter apostrophe U+02BC is removed', 'donʼt', 'dont'],
    ['step 6: grave accent is removed', 'don`t', 'dont'],
    ['step 6: U+02BC inside a word joins the word', 'egʼgs', 'eggs'],
];

const tables: ReadonlyArray<readonly [string, readonly Row[]]> = [
    ['step 1', step1],
    ['step 2', step2],
    ['step 3', step3],
    ['step 4', step4],
    ['step 5', step5],
    ['step 6', step6],
];

describe('comparisonForm', () => {
    describe.each(tables)('%s', (_name, rows) => {
        it.each(rows)('%s', (_label, input, expected) => {
            expect(comparisonForm(input)).toBe(expected);
        });
    });

    describe('order of the steps', () => {
        it('step 2 before step 3: a Hangul filler is spaced even though it is also Default_Ignorable', () => {
            // If 3 ran first the filler would vanish and the words would join.
            expect(comparisonForm('whiskㅤeggs')).toBe('whisk eggs');
        });

        it('step 1 before step 2: U+3164 is first compat-mapped to U+1160 by NFKC and is still spaced', () => {
            expect(comparisonForm('aㅤb')).toBe(comparisonForm('aᅠb'));
        });

        it('step 4 before step 5: dotted capital I lowers to i + U+0307 and the dot is then stripped', () => {
            expect(comparisonForm('İ')).toBe('i');
        });

        it('step 1 before step 6: a compat apostrophe is normalised first and then removed', () => {
            expect(comparisonForm('don＇t')).toBe('dont');
        });

        it('step 1 before step 5: n-with-preceding-apostrophe U+0149 becomes U+02BC + n, then 6 removes it', () => {
            expect(comparisonForm('ŉ')).toBe('n');
        });
    });

    describe('review tricks reduce to the plain form', () => {
        const plain = 'eggs';
        it.each([
            ['Hangul filler in place of a space', 'whiskㅤeggs', 'whisk eggs'],
            ['U+17B4 inside a word', 'eg឴gs', plain],
            ['U+180F inside a word', 'eg᠏gs', plain],
            ['U+02BC inside a word', 'egʼgs', plain],
            ['ZWSP inside a word', 'eg​gs', plain],
            ['soft hyphen inside a word', 'e­ggs', plain],
            ['full-width letters', 'ｅｇｇｓ', plain],
            ['upper-case letters', 'EGGS', plain],
            ['upper-case full-width letters', 'ＥＧＧＳ', plain],
            ['decomposed accent on a plain letter', 'éggs', plain],
            ['tag characters between letters', 'e\u{E0067}ggs', plain],
            ['every trick at once', 'Ｅ́​឴G­᠏ʼGs', plain],
        ] as const)('%s', (_label, input, expected) => {
            expect(comparisonForm(input)).toBe(expected);
        });

        it('a Cyrillic or Greek capital is lower-cased in its own script, never mapped to Latin', () => {
            expect(comparisonForm('А')).toBe('а'); // Cyrillic A -> Cyrillic a
            expect(comparisonForm('Α')).toBe('α'); // Greek Alpha -> Greek alpha
        });
    });

    describe('step 0: apostrophe-like characters that NFKC would turn into a space plus a mark', () => {
        // NFKC maps U+00B4 to U+0020 U+0301, so left alone "don´t" would split into "don t". Step 0 runs BEFORE NFKC
        // and maps U+00B4, U+1FBF and U+1FFE (the apostrophe-likes found to decompose that way) to an ASCII
        // apostrophe, which step 6 then removes. REWRITTEN: this block pinned "don´t" to "don t"; it now pins "dont".
        it.each([
            ['U+00B4 acute accent', 'don´t'],
            ['U+1FBF Greek psili', 'don\u1FBFt'],
            ['U+1FFE Greek dasia', 'don\u1FFEt'],
        ] as const)('%s joins the word like an ASCII apostrophe', (_label, input) => {
            expect(comparisonForm(input)).toBe('dont');
            expect(comparisonForm(input)).toBe(comparisonForm("don't"));
        });

        it('every other apostrophe-like candidate is handled without step 0', () => {
            // U+FF07 maps to an ASCII apostrophe in NFKC; U+02BC and the quotes are removed by step 6 as they are.
            expect(comparisonForm('don＇t')).toBe('dont');
            expect(comparisonForm('donʼt')).toBe('dont');
            // These are NOT apostrophes in the fold: they are kept as letters or marks of their own.
            expect(comparisonForm('donʹt')).toBe('donʹt');
            expect(comparisonForm('donʻt')).toBe('donʻt');
        });
    });

    describe('plain-form fixtures from the task', () => {
        it.each([
            ['ZWSP', 'eg​gs', 'eggs'],
            ['soft hyphen', 'per­fect', 'perfect'],
            ['full-width', 'ｅｇｇｓ', 'eggs'],
            ['accents', 'crème brûlée', 'creme brulee'],
            ['curly apostrophe', 'don’t', 'dont'],
            ['straight apostrophe', "don't", 'dont'],
            ['en dash', 'a–b', 'a b'],
            ['em dash', 'a—b', 'a b'],
            ['tab', 'a\tb', 'a b'],
            ['newline', 'a\nb', 'a b'],
            ['empty string', '', ''],
            ['only ignorables', '​­﻿', ''],
            ['only apostrophes', "'’ʼ", ''],
        ] as const)('%s', (_label, input, expected) => {
            expect(comparisonForm(input)).toBe(expected);
        });
    });

    describe('not folded by design', () => {
        // The language allowlist refuses mixed-script and non-Latin text upstream, so comparisonForm does not
        // spend a confusables table on it. These tests document the boundary: look-alikes stay DISTINCT.
        it.each([
            ['Cyrillic a vs Latin a', 'а', 'a'],
            ['Cyrillic e vs Latin e', 'е', 'e'],
            ['Cyrillic o vs Latin o', 'о', 'o'],
            ['Cyrillic capital A vs Latin capital A', 'А', 'A'],
            ['Greek omicron vs Latin o', 'ο', 'o'],
            ['Greek capital Alpha vs Latin capital A', 'Α', 'A'],
            ['dotless i U+0131 vs i', 'ı', 'i'],
            ['iota-like U+0269 vs i', 'ɩ', 'i'],
            ['Greek iota U+03B9 vs i', 'ι', 'i'],
            ['Cyrillic palochka U+04CF vs l', 'ӏ', 'l'],
            ['Cyrillic i U+0456 vs i', 'і', 'i'],
        ] as const)('%s', (_label, lookalike, latin) => {
            expect(comparisonForm(lookalike)).not.toBe(comparisonForm(latin));
        });

        it('a word spelled with a Cyrillic o is a different word from the Latin one', () => {
            expect(comparisonForm('eggs tоp')).not.toBe(comparisonForm('eggs top'));
        });

        it('the dotless i keeps its identity (it is not turned into i)', () => {
            expect(comparisonForm('ı')).toBe('ı');
        });

        it('sharp s is not expanded to ss', () => {
            expect(comparisonForm('Straße')).toBe('straße');
        });

        it('the Hawaiian okina U+02BB is not an apostrophe and is kept', () => {
            expect(comparisonForm('ʻokina')).toBe('ʻokina');
        });

        it('stripping marks is lossy for scripts that carry vowels in marks (known collision)', () => {
            // Devanagari ka + vowel sign i collapses to bare ka. Harmless for the allowlisted languages.
            expect(comparisonForm('कि')).toBe(comparisonForm('क'));
        });
    });

    describe('idempotence', () => {
        const everyInput = [
            ...tables.flatMap(([, rows]) => rows.map(([, input]) => input)),
            'don´t',
            'ŉ',
            'İ',
            'कि',
            '한',
            'ıɩιӏ',
            'whiskㅤeggs\t— ​',
            '',
        ];
        it.each(everyInput.map((input) => [JSON.stringify(input), input] as const))(
            'comparisonForm(comparisonForm(x)) === comparisonForm(x) for %s',
            (_label, input) => {
                const once = comparisonForm(input);
                expect(comparisonForm(once)).toBe(once);
            },
        );
    });

    describe('a copy using every trick reaches the source form', () => {
        const source = "whisk the Eggs until perfect, don't overmix the crème brûlée.";
        // One character per source character where the trick substitutes, so no run of spaces differs.
        const copy = 'whiskㅤthe\tE​g឴g᠏s until–per­fect, don’t　' + 'ｏｖｅｒｍｉｘ—the crème brûlée.';
        const expected = 'whisk the eggs until perfect, dont overmix the creme brulee.';

        it('the source reaches the expected form', () => {
            expect(comparisonForm(source)).toBe(expected);
        });

        it('the copy reaches the same form as the source', () => {
            expect(comparisonForm(copy)).toBe(comparisonForm(source));
        });

        it('the copy reaches the expected literal, not just something equal to the source', () => {
            expect(comparisonForm(copy)).toBe(expected);
        });
    });
});
