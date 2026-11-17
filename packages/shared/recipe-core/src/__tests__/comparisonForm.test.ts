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
    ['step 1: full-width letters fold to ASCII', '\u{FF45}\u{FF47}\u{FF47}\u{FF53}', 'eggs'],
    ['step 1: ligature fi is split', '\u{FB01}sh', 'fish'],
    ['step 1: roman numeral VIII becomes letters', '\u{2167}', 'viii'],
    ['step 1: ideographic space becomes a space', 'a\u{3000}b', 'a b'],
    ['step 1: full-width apostrophe reaches step 6', 'don\u{FF07}t', 'dont'],
    ['step 1: dz digraph with caron splits', '\u{1C6}', 'dz'],
];

// Step 2 pins: each separator must become a SPACE. A mutant that removes them (or leaves them) breaks these.
const step2: readonly Row[] = [
    ['step 2: Hangul choseong filler U+115F is a space', 'a\u{115F}b', 'a b'],
    ['step 2: Hangul jungseong filler U+1160 is a space', 'a\u{1160}b', 'a b'],
    ['step 2: Hangul filler U+3164 is a space', 'a\u{3164}b', 'a b'],
    ['step 2: half-width Hangul filler U+FFA0 is a space', 'a\u{FFA0}b', 'a b'],
    ['step 2: line separator U+2028 (Zl) is a space', 'a\u{2028}b', 'a b'],
    ['step 2: paragraph separator U+2029 (Zp) is a space', 'a\u{2029}b', 'a b'],
    ['step 2: ogham space mark U+1680 (Zs) is a space', 'a\u{1680}b', 'a b'],
    ['step 2: no-break space is a space', 'a\u{A0}b', 'a b'],
    ['step 2: tab is a space', 'a\tb', 'a b'],
    ['step 2: newline is a space', 'a\nb', 'a b'],
    ['step 2: carriage return is a space', 'a\rb', 'a b'],
    ['step 2: NEL U+0085 (Cc) is a space', 'a\u0085b', 'a b'],
    ['step 2: en dash is a space', 'a\u{2013}b', 'a b'],
    ['step 2: em dash is a space', 'a\u{2014}b', 'a b'],
    ['step 2: hyphen-minus (Pd) is a space', 'well-done', 'well done'],
    ['step 2: non-breaking hyphen is a space', 'a\u{2011}b', 'a b'],
    ['step 2: a run of separators stays a run, collapsing is the shingler job', 'a\t \u{2014}b', 'a   b'],
];

// Step 3 pins: Cf characters only, because step 5 would strip a Mn one (U+17B4, U+180F, VS) even without step 3.
const step3: readonly Row[] = [
    ['step 3: zero-width space is removed, not spaced', 'eg\u{200B}gs', 'eggs'],
    ['step 3: soft hyphen is removed, not spaced', 'per\u{AD}fect', 'perfect'],
    ['step 3: zero-width joiner is removed', 'a\u{200D}b', 'ab'],
    ['step 3: zero-width non-joiner is removed', 'a\u{200C}b', 'ab'],
    ['step 3: word joiner is removed', 'a\u{2060}b', 'ab'],
    ['step 3: byte order mark is removed', 'a\u{FEFF}b', 'ab'],
    ['step 3: Mongolian vowel separator U+180E is removed', 'a\u{180E}b', 'ab'],
    ['step 3: left-to-right mark is removed', 'a\u{200E}b', 'ab'],
    ['step 3: tag character is removed', 'a\u{E0041}b', 'ab'],
    ['step 3: combining grapheme joiner is removed', 'a\u{34F}b', 'ab'],
    ['step 3: Khmer inherent vowel U+17B4 is removed', 'eg\u{17B4}gs', 'eggs'],
    ['step 3: Mongolian free variation selector U+180F is removed', 'eg\u{180F}gs', 'eggs'],
    ['step 3: variation selector U+FE0F is removed', 'a\u{FE0F}b', 'ab'],
];

// Step 4 pins: lower-casing, on letters NFKC/NFD/mark-stripping leave in upper case.
const step4: readonly Row[] = [
    ['step 4: ASCII upper case is lowered', 'EGGS', 'eggs'],
    ['step 4: mixed case is lowered', 'Crack And Whisk', 'crack and whisk'],
    [
        'step 4: Greek capitals lower, final sigma included',
        '\u{39F}\u{394}\u{39F}\u{3A3}',
        '\u{3BF}\u{3B4}\u{3BF}\u{3C2}',
    ],
    [
        'step 4: Cyrillic capitals lower and lose the breve (step 5)',
        '\u{42F}\u{419}\u{426}\u{41E}',
        '\u{44F}\u{438}\u{446}\u{43E}',
    ],
    ['step 4: dotted capital I lowers to i plus a dot, which step 5 strips', '\u{130}stanbul', 'istanbul'],
    ['step 4: capital sharp s lowers to sharp s, not to ss', '\u{1E9E}', '\u{DF}'],
];

// Step 5 pins: marks only (Mn that is NOT Default_Ignorable, so step 3 cannot be what removes it).
const step5: readonly Row[] = [
    ['step 5: precomposed accents are stripped', 'cr\u{E8}me br\u{FB}l\u{E9}e', 'creme brulee'],
    ['step 5: decomposed accents are stripped', 'cre\u{300}me bru\u{302}le\u{301}e', 'creme brulee'],
    ['step 5: a lone combining acute is stripped', 'e\u{301}', 'e'],
    ['step 5: tilde and cedilla are stripped', 'ja\u{303} \u{E7}a', 'ja ca'],
    ['step 5: a precomposed upper-case accent folds with step 4', '\u{C9}CLAIR', 'eclair'],
];

// Step 6 pins: each listed apostrophe is REMOVED (not spaced). U+00B4 has its own step 0 block below.
const step6: readonly Row[] = [
    ['step 6: ASCII apostrophe is removed', "don't", 'dont'],
    ['step 6: right single quote U+2019 is removed', 'don\u{2019}t', 'dont'],
    ['step 6: left single quote U+2018 is removed', 'don\u{2018}t', 'dont'],
    ['step 6: modifier letter apostrophe U+02BC is removed', 'don\u{2BC}t', 'dont'],
    ['step 6: grave accent is removed', 'don`t', 'dont'],
    ['step 6: U+02BC inside a word joins the word', 'eg\u{2BC}gs', 'eggs'],
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
            expect(comparisonForm('whisk\u{3164}eggs')).toBe('whisk eggs');
        });

        it('step 1 before step 2: U+3164 is first compat-mapped to U+1160 by NFKC and is still spaced', () => {
            expect(comparisonForm('a\u{3164}b')).toBe(comparisonForm('a\u{1160}b'));
        });

        it('step 4 before step 5: dotted capital I lowers to i + U+0307 and the dot is then stripped', () => {
            expect(comparisonForm('\u{130}')).toBe('i');
        });

        it('step 1 before step 6: a compat apostrophe is normalised first and then removed', () => {
            expect(comparisonForm('don\u{FF07}t')).toBe('dont');
        });

        it('step 1 before step 5: n-with-preceding-apostrophe U+0149 becomes U+02BC + n, then 6 removes it', () => {
            expect(comparisonForm('\u{149}')).toBe('n');
        });
    });

    describe('review tricks reduce to the plain form', () => {
        const plain = 'eggs';
        it.each([
            ['Hangul filler in place of a space', 'whisk\u{3164}eggs', 'whisk eggs'],
            ['U+17B4 inside a word', 'eg\u{17B4}gs', plain],
            ['U+180F inside a word', 'eg\u{180F}gs', plain],
            ['U+02BC inside a word', 'eg\u{2BC}gs', plain],
            ['ZWSP inside a word', 'eg\u{200B}gs', plain],
            ['soft hyphen inside a word', 'e\u{AD}ggs', plain],
            ['full-width letters', '\u{FF45}\u{FF47}\u{FF47}\u{FF53}', plain],
            ['upper-case letters', 'EGGS', plain],
            ['upper-case full-width letters', '\u{FF25}\u{FF27}\u{FF27}\u{FF33}', plain],
            ['decomposed accent on a plain letter', 'e\u{301}ggs', plain],
            ['tag characters between letters', 'e\u{E0067}ggs', plain],
            ['every trick at once', '\u{FF25}\u{301}\u{200B}\u{17B4}G\u{AD}\u{180F}\u{2BC}Gs', plain],
        ] as const)('%s', (_label, input, expected) => {
            expect(comparisonForm(input)).toBe(expected);
        });

        it('a Cyrillic or Greek capital is lower-cased in its own script, never mapped to Latin', () => {
            expect(comparisonForm('\u{410}')).toBe('\u{430}'); // Cyrillic A -> Cyrillic a
            expect(comparisonForm('\u{391}')).toBe('\u{3B1}'); // Greek Alpha -> Greek alpha
        });
    });

    describe('step 0: apostrophe-like characters that NFKC would turn into a space plus a mark', () => {
        // NFKC maps U+00B4 to U+0020 U+0301, so left alone "don´t" would split into "don t". Step 0 runs BEFORE NFKC
        // and maps U+00B4, U+1FBF and U+1FFE (the apostrophe-likes found to decompose that way) to an ASCII
        // apostrophe, which step 6 then removes. REWRITTEN: this block pinned "don´t" to "don t"; it now pins "dont".
        it.each([
            ['U+00B4 acute accent', 'don\u{B4}t'],
            ['U+1FBF Greek psili', 'don\u1FBFt'],
            ['U+1FFE Greek dasia', 'don\u1FFEt'],
        ] as const)('%s joins the word like an ASCII apostrophe', (_label, input) => {
            expect(comparisonForm(input)).toBe('dont');
            expect(comparisonForm(input)).toBe(comparisonForm("don't"));
        });

        it('every other apostrophe-like candidate is handled without step 0', () => {
            // U+FF07 maps to an ASCII apostrophe in NFKC; U+02BC and the quotes are removed by step 6 as they are.
            expect(comparisonForm('don\u{FF07}t')).toBe('dont');
            expect(comparisonForm('don\u{2BC}t')).toBe('dont');
            // These are NOT apostrophes in the fold: they are kept as letters or marks of their own.
            expect(comparisonForm('don\u{2B9}t')).toBe('don\u{2B9}t');
            expect(comparisonForm('don\u{2BB}t')).toBe('don\u{2BB}t');
        });
    });

    describe('plain-form fixtures from the task', () => {
        it.each([
            ['ZWSP', 'eg\u{200B}gs', 'eggs'],
            ['soft hyphen', 'per\u{AD}fect', 'perfect'],
            ['full-width', '\u{FF45}\u{FF47}\u{FF47}\u{FF53}', 'eggs'],
            ['accents', 'cr\u{E8}me br\u{FB}l\u{E9}e', 'creme brulee'],
            ['curly apostrophe', 'don\u{2019}t', 'dont'],
            ['straight apostrophe', "don't", 'dont'],
            ['en dash', 'a\u{2013}b', 'a b'],
            ['em dash', 'a\u{2014}b', 'a b'],
            ['tab', 'a\tb', 'a b'],
            ['newline', 'a\nb', 'a b'],
            ['empty string', '', ''],
            ['only ignorables', '\u{200B}\u{AD}\u{FEFF}', ''],
            ['only apostrophes', "'\u{2019}\u{2BC}", ''],
        ] as const)('%s', (_label, input, expected) => {
            expect(comparisonForm(input)).toBe(expected);
        });
    });

    describe('not folded by design', () => {
        // The language allowlist refuses mixed-script and non-Latin text upstream, so comparisonForm does not
        // spend a confusables table on it. These tests document the boundary: look-alikes stay DISTINCT.
        it.each([
            ['Cyrillic a vs Latin a', '\u{430}', 'a'],
            ['Cyrillic e vs Latin e', '\u{435}', 'e'],
            ['Cyrillic o vs Latin o', '\u{43E}', 'o'],
            ['Cyrillic capital A vs Latin capital A', '\u{410}', 'A'],
            ['Greek omicron vs Latin o', '\u{3BF}', 'o'],
            ['Greek capital Alpha vs Latin capital A', '\u{391}', 'A'],
            ['dotless i U+0131 vs i', '\u{131}', 'i'],
            ['iota-like U+0269 vs i', '\u{269}', 'i'],
            ['Greek iota U+03B9 vs i', '\u{3B9}', 'i'],
            ['Cyrillic palochka U+04CF vs l', '\u{4CF}', 'l'],
            ['Cyrillic i U+0456 vs i', '\u{456}', 'i'],
        ] as const)('%s', (_label, lookalike, latin) => {
            expect(comparisonForm(lookalike)).not.toBe(comparisonForm(latin));
        });

        it('a word spelled with a Cyrillic o is a different word from the Latin one', () => {
            expect(comparisonForm('eggs t\u{43E}p')).not.toBe(comparisonForm('eggs top'));
        });

        it('the dotless i keeps its identity (it is not turned into i)', () => {
            expect(comparisonForm('\u{131}')).toBe('\u{131}');
        });

        it('sharp s is not expanded to ss', () => {
            expect(comparisonForm('Stra\u{DF}e')).toBe('stra\u{DF}e');
        });

        it('the Hawaiian okina U+02BB is not an apostrophe and is kept', () => {
            expect(comparisonForm('\u{2BB}okina')).toBe('\u{2BB}okina');
        });

        it('stripping marks is lossy for scripts that carry vowels in marks (known collision)', () => {
            // Devanagari ka + vowel sign i collapses to bare ka. Harmless for the allowlisted languages.
            expect(comparisonForm('\u{915}\u{93F}')).toBe(comparisonForm('\u{915}'));
        });
    });

    describe('idempotence', () => {
        const everyInput = [
            ...tables.flatMap(([, rows]) => rows.map(([, input]) => input)),
            'don\u{B4}t',
            '\u{149}',
            '\u{130}',
            '\u{915}\u{93F}',
            '\u{1112}\u{1161}\u{11AB}',
            '\u{131}\u{269}\u{3B9}\u{4CF}',
            'whisk\u{3164}eggs\t\u{2014} \u{200B}',
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
        const source = "whisk the Eggs until perfect, don't overmix the cr\u{E8}me br\u{FB}l\u{E9}e.";
        // One character per source character where the trick substitutes, so no run of spaces differs.
        const copy =
            'whisk\u{3164}the\tE\u{200B}g\u{17B4}g\u{180F}s\u{A0}until\u{2013}per\u{AD}fect,\u{2028}don\u{2019}t\u{3000}' +
            '\u{FF4F}\u{FF56}\u{FF45}\u{FF52}\u{FF4D}\u{FF49}\u{FF58}\u{2014}the\u{2009}cre\u{300}me\u{A0}bru\u{302}le\u{301}e.';
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
