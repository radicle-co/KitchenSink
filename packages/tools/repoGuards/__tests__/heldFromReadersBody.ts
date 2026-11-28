/**
 * Finds the body of the NEWEST definition of the database function `recipe_held_from_readers` across ordered migrations, and
 * says whether it still calls `recipe_is_from_person(` (ADR-0106). Pure: it reads text it is given.
 *
 * The newest event decides: a later DROP or RENAME of the function leaves no definition, so the answer is `undefined`.
 */
import { withoutSqlCommentsAndLiterals } from './sourceComments.js';

export interface NamedSql {
    readonly name: string;
    readonly text: string;
}

export interface HeldFromReadersBody {
    readonly file: string;
    readonly keepsFromPerson: boolean;
}

// The function name, optionally `public.`-qualified and optionally quoted.
const NAME = String.raw`(?:(?:"public"|public)\s*\.\s*)?"?recipe_held_from_readers"?`;
const CREATE = new RegExp(String.raw`create\s+(?:or\s+replace\s+)?function\s+${NAME}\s*\(`, 'gi');
const DROP = new RegExp(String.raw`drop\s+function\s+(?:if\s+exists\s+)?${NAME}\b`, 'gi');
const RENAME = new RegExp(String.raw`alter\s+function\s+${NAME}\s*\([^)]*\)\s+rename\b`, 'gi');
const TAG = /\$[A-Za-z_]*\$/;
const FROM_PERSON_CALL = /\b(?:public\s*\.\s*)?recipe_is_from_person\s*\(/i;

interface Event {
    readonly kind: 'create' | 'remove';
    readonly index: number;
    readonly file: string;
    readonly code: string;
}

function eventsOf({ name, text }: NamedSql): Event[] {
    const code = withoutSqlCommentsAndLiterals(text);
    const found: Event[] = [];

    for (const [pattern, kind] of [
        [CREATE, 'create'],
        [DROP, 'remove'],
        [RENAME, 'remove'],
    ] as const) {
        for (const match of code.matchAll(pattern)) {
            found.push({ kind, index: match.index, file: name, code });
        }
    }

    return found.sort((a, b) => a.index - b.index);
}

/** The text between the first dollar tag after `from` and the next occurrence of the same tag. */
function dollarBodyAfter(code: string, from: number): string {
    const rest = code.slice(from);
    const open = TAG.exec(rest);

    if (open === null) {
        return '';
    }

    const start = open.index + open[0].length;
    const end = rest.indexOf(open[0], start);

    return end === -1 ? rest.slice(start) : rest.slice(start, end);
}

/**
 * @param files - Every migration's name and text, in any order.
 * @returns The newest definition's file and whether its body calls `recipe_is_from_person(`, or `undefined` when the newest
 *   event is not a CREATE or there is none.
 */
export function newestHeldFromReadersBody(files: readonly NamedSql[]): HeldFromReadersBody | undefined {
    const events = [...files].sort((a, b) => a.name.localeCompare(b.name)).flatMap((file) => eventsOf(file));
    const last = events.at(-1);

    if (last === undefined || last.kind !== 'create') {
        return undefined;
    }

    return { file: last.file, keepsFromPerson: FROM_PERSON_CALL.test(dollarBodyAfter(last.code, last.index)) };
}
