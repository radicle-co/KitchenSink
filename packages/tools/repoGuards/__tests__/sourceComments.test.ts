// @vitest-environment node
/**
 * Tests for `sourceComments` — the ONE owner of "this source text without its comments".
 *
 * ⛔ WHY A FIXTURE TABLE AND NOT THE CORPUS. `withoutTsComments.test.ts` proves the blanking lemma over every file
 * the guards read, which shows the stripper is safe over shapes the tree HAS held. A stripper that removes too
 * much answers "no violation found" for a violation that is right there, so this table is built from shapes the
 * tree has never held — the ones a regex pair gets wrong by construction.
 *
 * ⛔ Every row also runs the regex pair the guards used before (`regexPair`) and asserts it is WRONG on that row.
 * A row the old stripper already handled would prove nothing about this one, so the control makes the table
 * fail loudly if a row stops discriminating.
 */
import { describe, expect, it } from 'vitest';

import {
    withoutComments,
    withoutCssComments,
    withoutSqlComments,
    withoutSqlCommentsAndLiterals,
    withoutTsComments,
} from './sourceComments.js';

/** The stripper twenty-two guards carried: block comments first, then everything after a `//`. */
function regexPair(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '');
}

interface Row {
    readonly name: string;
    readonly path?: string;
    readonly source: string;
    /** Substrings that are CODE or DATA and must survive. */
    readonly keeps: readonly string[];
    /** Substrings that are comment text and must be gone. */
    readonly drops: readonly string[];
    /**
     * Whether the regex pair gets this row wrong. `false` marks a row that a regex ALSO gets right, kept because the
     * new stripper must still hold it (a parser can regress on the easy shapes) — and so the control is an explicit
     * choice per row, not a silent skip.
     */
    readonly regexPairFails?: false;
}

const ROWS: readonly Row[] = [
    {
        name: 'a URL in a single-quoted string',
        source: "const u = 'http://x'; const kept = 1; // gone",
        keeps: ["'http://x'", 'const kept = 1;'],
        drops: ['gone'],
    },
    {
        name: 'a URL in a double-quoted string',
        source: 'const u = "https://x/y"; useDangerous(); // gone',
        keeps: ['"https://x/y"', 'useDangerous();'],
        drops: ['gone'],
    },
    {
        name: 'a template literal holding // and /*',
        source: 'const t = `a // b /* c`; const kept = 1; // gone',
        keeps: ['`a // b /* c`', 'const kept = 1;'],
        drops: ['gone'],
    },
    {
        name: 'a template literal whose ${} holds code with a real comment',
        source: 'const t = `a ${x /* real */} // still text`; const kept = 1;',
        keeps: ['// still text`', 'const kept = 1;'],
        drops: ['real'],
    },
    {
        name: 'a template literal nested inside a ${}',
        source: 'const t = `a ${`b // ${c}`} // d`; const kept = 1; // gone',
        keeps: ['`b // ${c}`', '// d`', 'const kept = 1;'],
        drops: ['gone'],
    },
    {
        name: 'a regex literal whose class holds /*',
        source: 'const r = /[/*]/u; const kept = 1; /* real */ const alsoKept = 2;',
        keeps: ['/[/*]/u', 'const kept = 1;', 'const alsoKept = 2;'],
        drops: ['real'],
    },
    {
        name: 'a regex literal that opens with an escaped slash and a star',
        source: 'const r = /\\/*x/; const kept = 1; /* real */ const alsoKept = 2;',
        keeps: ['/\\/*x/', 'const kept = 1;', 'const alsoKept = 2;'],
        drops: ['real'],
    },
    {
        name: 'a regex literal holding // in a class',
        source: 'const r = /a[/]b[//]/; const kept = 1; // gone',
        keeps: ['/a[/]b[//]/', 'const kept = 1;'],
        drops: ['gone'],
    },
    {
        name: 'a regex literal with a lone quote in a class',
        source: 'const r = /[\'"]x/u; const kept = 1; // gone',
        keeps: ['const kept = 1;'],
        drops: ['gone'],
        regexPairFails: false,
    },
    {
        name: 'division, which is not a regex',
        source: 'const x = (a) / 2; const y = b / 3; // gone',
        keeps: ['(a) / 2;', 'b / 3;'],
        drops: ['gone'],
        regexPairFails: false,
    },
    {
        name: 'a block comment that contains another /*',
        source: '/* a /* b */ const kept = 1; // gone',
        keeps: ['const kept = 1;'],
        drops: ['a /* b', 'gone'],
        regexPairFails: false,
    },
    {
        name: 'JSX text holding //',
        path: 'view.tsx',
        source: 'const a = <a href="x">see http://example.com now</a>; const kept = 1; // gone',
        keeps: ['see http://example.com now', 'const kept = 1;'],
        drops: ['gone'],
    },
    {
        name: 'JSX text holding /*',
        path: 'view.tsx',
        source: 'const a = <p>a /* not a comment */ b</p>; const kept = 1;',
        keeps: ['a /* not a comment */ b', 'const kept = 1;'],
        drops: [],
    },
    {
        name: 'a JSX expression comment',
        path: 'view.tsx',
        source: 'const a = <p>{/* real */}text</p>; const kept = 1;',
        keeps: ['text', 'const kept = 1;'],
        drops: ['real'],
        regexPairFails: false,
    },
    {
        name: 'a line comment holding an apostrophe',
        source: '// it\'s fine\nconst kept = "x"; // don\'t\nconst alsoKept = 2;',
        keeps: ['const kept = "x";', 'const alsoKept = 2;'],
        drops: ["it's fine", "don't"],
        regexPairFails: false,
    },
    {
        name: 'a block comment holding a quote and a backtick',
        source: "/* don't `x */ const kept = 1;",
        keeps: ['const kept = 1;'],
        drops: ["don't"],
        regexPairFails: false,
    },
    {
        name: 'an astral character (emoji) inside a comment, which is TWO UTF-16 units',
        source: '// 🍳 gone\nconst kept = 1; /* 🍳🍳 */ const alsoKept = 2;',
        keeps: ['const kept = 1;', 'const alsoKept = 2;'],
        drops: ['gone'],
        regexPairFails: false,
    },
    {
        name: 'a path glob inside a line comment',
        source: '// packages/infra/global/**\nconst kept = 1;\n/** doc */\nconst alsoKept = 2;',
        keeps: ['const kept = 1;', 'const alsoKept = 2;'],
        drops: ['packages/infra/global', 'doc'],
    },
    {
        name: 'a JSONC file with a URL value',
        path: 'turbo.json',
        source: '{\n  // note\n  "url": "https://x/y",\n  "kept": true\n}',
        keeps: ['"https://x/y"', '"kept": true'],
        drops: ['note'],
    },
];

describe('withoutTsComments', () => {
    describe.each(ROWS)('$name', (row) => {
        const stripped = withoutTsComments(row.source, row.path ?? 'source.ts');

        it('keeps every code and data fragment', () => {
            for (const fragment of row.keeps) {
                expect(stripped).toContain(fragment);
            }
        });

        it('drops every comment fragment', () => {
            for (const fragment of row.drops) {
                expect(stripped).not.toContain(fragment);
            }
        });

        it('preserves length and line count, changing only comment characters to spaces', () => {
            expect(stripped).toHaveLength(row.source.length);
            expect(stripped.split('\n')).toHaveLength(row.source.split('\n').length);

            for (let index = 0; index < row.source.length; index += 1) {
                expect([row.source[index], ' ']).toContain(stripped[index]);
            }
        });
    });

    describe.each(ROWS.filter((row) => row.regexPairFails !== false))('⛔ CONTROL: $name', (row) => {
        it('the regex pair this replaces is wrong on this row', () => {
            const old = regexPair(row.source);
            const loses = row.keeps.some((fragment) => !old.includes(fragment));
            const retains = row.drops.some((fragment) => old.includes(fragment));

            expect(loses || retains, 'the old stripper already handled this row, so it discriminates nothing').toBe(
                true,
            );
        });
    });

    it('leaves a comment-free file byte-identical', () => {
        const source = 'export const a = 1;\nexport const b = a + 1;\n';

        expect(withoutTsComments(source, 'a.ts')).toBe(source);
    });

    it('does not throw on a file that does not parse', () => {
        expect(withoutTsComments('const = ; /* open', 'broken.ts')).toHaveLength('const = ; /* open'.length);
    });
});

describe('withoutSqlComments', () => {
    it('keeps a -- inside a string literal and removes the real comment after it', () => {
        const stripped = withoutSqlComments("INSERT INTO t VALUES ('a -- b'); -- gone\nSELECT 1;");

        expect(stripped).toContain("'a -- b'");
        expect(stripped).toContain('SELECT 1;');
        expect(stripped).not.toContain('gone');
    });

    it('keeps /* inside a string literal, and honours the doubled-quote escape', () => {
        const stripped = withoutSqlComments("SELECT 'it''s /* not */ a comment', 2; /* real */ SELECT 3;");

        expect(stripped).toContain("'it''s /* not */ a comment'");
        expect(stripped).toContain('SELECT 3;');
        expect(stripped).not.toContain('real');
    });

    it('nests block comments the way PostgreSQL does', () => {
        const stripped = withoutSqlComments('/* a /* b */ still comment */ SELECT 1;');

        expect(stripped).not.toContain('still comment');
        expect(stripped).toContain('SELECT 1;');
    });

    it('scans a dollar-quoted body as SQL: its strings stay, its comments go, and its closing tag still closes', () => {
        const stripped = withoutSqlComments(
            "DO $$ BEGIN RAISE NOTICE 'x -- y'; -- inner\n/* block */ END $$; SELECT 1; -- gone\nSELECT 2;",
        );

        expect(stripped).toContain("'x -- y'");
        expect(stripped).toContain('END $$;');
        expect(stripped).toContain('SELECT 2;');
        expect(stripped).not.toContain('inner');
        expect(stripped).not.toContain('block');
        expect(stripped).not.toContain('gone');
    });

    it('does not read $1 or a$b$ as a dollar quote', () => {
        const stripped = withoutSqlComments('SELECT $1, a$b$c; -- gone\nSELECT 2;');

        expect(stripped).toContain('SELECT 2;');
        expect(stripped).not.toContain('gone');
    });

    it('preserves length and newlines', () => {
        const source = '-- a\nSELECT 1; /* b\nc */\n';
        const stripped = withoutSqlComments(source);

        expect(stripped).toHaveLength(source.length);
        expect(stripped.split('\n')).toHaveLength(source.split('\n').length);
    });
});

describe('withoutSqlCommentsAndLiterals', () => {
    it('blanks string literals too, so only code is matched', () => {
        const stripped = withoutSqlCommentsAndLiterals("SELECT 'food_items', x FROM t; -- food_items");

        expect(stripped).not.toContain('food_items');
        expect(stripped).toContain('FROM t;');
    });
});

describe('withoutCssComments', () => {
    it('removes a block comment and keeps a /* inside a string', () => {
        const stripped = withoutCssComments('a { content: "/* x */"; } /* real */ b { color: red; }');

        expect(stripped).toContain('"/* x */"');
        expect(stripped).toContain('b { color: red; }');
        expect(stripped).not.toContain('real');
    });
});

describe('withoutComments', () => {
    it('reads each file by the comment syntax of its own language', () => {
        expect(withoutComments('a.ts', 'const u = "http://x"; // gone')).toContain('"http://x"');
        expect(withoutComments('a.sh', 'curl http://x/y # not stripped\n# gone')).toContain('http://x/y');
        expect(withoutComments('a.sh', 'curl http://x/y\n# gone')).not.toContain('gone');
        expect(withoutComments('a.yml', 'url: http://x\n# gone')).not.toContain('gone');
        expect(withoutComments('a.sql', "select '--'; -- gone")).not.toContain('gone');
        expect(withoutComments('a.css', 'a{} /* gone */')).not.toContain('gone');
    });
});
