/**
 * @module @commise/features-recipes/form — the Paste a list sheet's reading of the pasted text (build spec §7.5.4): how
 * many lines the parse job would store ("9 lines"), and why the paste would be refused, before any round trip. The
 * splitter and the refusals are recipe-core's, the ones the client and the service apply, so the count is the job's.
 *
 * ⚠️ Not a second validator: `createParseJob` refuses an inadmissible paste with no network call. What this adds is the
 * half a transport cannot, saying WHICH line is the problem, 1-based, in the cook's locale.
 *
 * Pure and platform-agnostic.
 */
import {
    MAX_PARSE_JOB_LINES,
    PARSE_JOB_LINE_MAX_CHARS,
    refuseParseJobLines,
    splitParseJobLines,
} from '@kitchensink/recipe-core';

import { fillTemplate } from '../format/fillTemplate.js';

/** The two refusals a cook can act on, already localised. */
export interface PasteRefusalCopy {
    /** Holds `{line}` (1-based) and `{max}`. */
    readonly lineTooLong: string;
    /** Holds `{max}`. */
    readonly tooManyLines: string;
}

/** What the sheet says about the text so far. */
export interface PasteIngredientsModel {
    /** The lines the job would store: the splitter's count, not the raw newline count. */
    readonly lineCount: number;
    /** Why the paste would be refused, in line order. Empty text is not one: the disabled button says that. */
    readonly refusals: readonly string[];
    readonly canSubmit: boolean;
}

/**
 * The sheet's reading of the pasted text. Pure.
 *
 * @param text - The pasted text.
 * @param copy - The refusals' copy.
 * @returns The count, the refusals, and whether it may be sent.
 */
export function pasteIngredientsOf(text: string, copy: PasteRefusalCopy): PasteIngredientsModel {
    const lines = splitParseJobLines(text);
    const refused = refuseParseJobLines(lines);
    const refusals = refused.flatMap((refusal): readonly string[] => {
        switch (refusal.reason) {
            case 'line_too_long':
                return [fillTemplate(copy.lineTooLong, { line: refusal.lineIndex + 1, max: PARSE_JOB_LINE_MAX_CHARS })];
            case 'too_many_lines':
                return [fillTemplate(copy.tooManyLines, { max: MAX_PARSE_JOB_LINES })];
            case 'no_lines':
                return [];
        }
    });

    return { lineCount: lines.length, refusals, canSubmit: refused.length === 0 };
}
