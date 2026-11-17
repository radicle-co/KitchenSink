/**
 * Text as a list of comparable tokens, the one rule the reader uses to ask "does the page say this".
 *
 * Case, punctuation, brackets, spacing and the way a fraction or a times sign is written do not make two texts differ;
 * a number, a unit, a word or a slash do. A character scan: only letters, combining marks and digits (in any script, so
 * a script with no case still tokenizes) are word material, and no pattern runs over page text except a one-character
 * class test, which cannot backtrack. A format character (Unicode `Cf`: a soft hyphen, a zero-width space or joiner, a
 * byte-order mark) is invisible and is dropped, so it neither splits a word nor joins two.
 */
import { classifyUnit, isSizeWord } from '@kitchensink/recipe-core';

/** A vulgar fraction and what it reads as. NFKC alone would turn `1½` into `11⁄2`, so it is expanded first. */
const VULGAR_FRACTIONS: Readonly<Record<string, string>> = Object.freeze({
    '¼': '1/4',
    '½': '1/2',
    '¾': '3/4',
    '⅐': '1/7',
    '⅑': '1/9',
    '⅒': '1/10',
    '⅓': '1/3',
    '⅔': '2/3',
    '⅕': '1/5',
    '⅖': '2/5',
    '⅗': '3/5',
    '⅘': '4/5',
    '⅙': '1/6',
    '⅚': '5/6',
    '⅛': '1/8',
    '⅜': '3/8',
    '⅝': '5/8',
    '⅞': '7/8',
});

const isDigit = (char: string): boolean => char >= '0' && char <= '9';
const isSpace = (char: string): boolean => char.trim() === '';

/** A letter, a combining mark or a digit, in any script. One character class: linear, and it cannot backtrack. */
const LETTER_MARK_OR_DIGIT = /^[\p{L}\p{M}\p{N}]$/u;

/** An invisible format character (Unicode `Cf`). */
const FORMAT_CHARACTER = /^\p{Cf}$/u;

/**
 * Whether `char` is part of a word or a number: a letter, a mark or a digit. Anything else (punctuation, a plugin's
 * checkbox "▢", a bullet, a star, an emoji) separates words like a space. The reader's one definition of word material:
 * the tokenizer, the fragment-link count and the gate all use it.
 */
export const isWordMaterial = (char: string): boolean => LETTER_MARK_OR_DIGIT.test(char);

/** The text with each vulgar fraction written out as ` n/d `, so `1½` reads `1 1/2`. */
function withFractionsWritten(text: string): string {
    let out = '';

    for (const char of text) {
        const fraction = VULGAR_FRACTIONS[char];

        out += fraction === undefined ? char : ` ${fraction} `;
    }

    return out;
}

/** One character, with the slashes, dashes and times signs that mean the same read as one, and a format character dropped. */
function foldedChar(char: string): string {
    if (FORMAT_CHARACTER.test(char)) {
        return '';
    }

    if (char === '⁄' || char === '∕') {
        return '/';
    }

    if (char === '×') {
        return 'x';
    }

    return (char >= '‐' && char <= '―') || char === '−' ? '-' : char;
}

/** Whether the next character after `index`, skipping spaces, is a digit. */
function digitFollows(text: string, index: number): boolean {
    let next = index + 1;

    while (next < text.length && isSpace(text.charAt(next))) {
        next += 1;
    }

    return next < text.length && isDigit(text.charAt(next));
}

/**
 * The tokens of `text`: runs of digits, runs of everything else that is word material, and a `/` or `-` between digits
 * (spaces allowed) or a `.` or `,` glued between digits, each as its own token. Lower case. So `1/2`, `1-2`, `1.5`, `15`,
 * `1 1/2` and `11/2` all read differently, and `750g` reads as `750`, `g`.
 *
 * @param text - Any text.
 * @returns The tokens in order. Linear in the text. Pure.
 */
export function tokensOf(text: string): readonly string[] {
    const folded = Array.from(withFractionsWritten(text).normalize('NFKC').toLowerCase(), foldedChar).join('');
    const tokens: string[] = [];
    let run = '';
    let runIsDigits = false;

    const flush = (): void => {
        if (run !== '') {
            tokens.push(run);
            run = '';
        }
    };

    for (let index = 0; index < folded.length; index += 1) {
        const char = folded.charAt(index);

        if (isWordMaterial(char)) {
            if (run !== '' && runIsDigits !== isDigit(char)) {
                flush();
            }

            runIsDigits = isDigit(char);
            run += char;
            continue;
        }

        const gluedToDigits =
            run !== '' && runIsDigits && index + 1 < folded.length && isDigit(folded.charAt(index + 1));

        flush();

        const last = tokens[tokens.length - 1];
        const afterNumber = last !== undefined && isDigit(last.charAt(0));

        if (afterNumber && (char === '/' || char === '-') && digitFollows(folded, index)) {
            tokens.push(char);
        } else if (gluedToDigits && (char === '.' || char === ',')) {
            tokens.push(char);
        }
    }

    flush();

    return tokens;
}

/**
 * Whether `text` names a measure: a unit the reader knows ("g", "pinch", "to taste") or a size word ("large"), as one
 * token or two. English-only, as the unit vocabulary is: a measure in another language is not seen, so a caller relies on
 * it only to refuse more, never to accept.
 *
 * @param text - Any text.
 * @returns Whether any token, or any two tokens in a row, is a unit or a size word. Pure.
 */
export function namesAMeasure(text: string): boolean {
    const words = tokensOf(text);

    return words.some((word, index) => {
        const pair = index + 1 < words.length ? `${word} ${words[index + 1] ?? ''}` : undefined;

        return (
            classifyUnit(word) !== 'unknown' ||
            isSizeWord(word) ||
            (pair !== undefined && classifyUnit(pair) !== 'unknown')
        );
    });
}
