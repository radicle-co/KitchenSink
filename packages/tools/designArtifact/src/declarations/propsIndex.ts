/**
 * @module declarations/propsIndex — `components/index.d.ts`: the props contracts of the design system, as text.
 *
 * The file is documentation for a reader (and for the host's model), so it carries the declarations a caller needs
 * and none of the plumbing: imports are dropped (the types they name are described in the same file or are plain
 * data), and for a product component only its exported types are kept. Everything is read from the sources, nothing is
 * restated here.
 *
 * Pure over source text; reading the files belongs to `readDeclarationSections`.
 */
import ts from 'typescript';

/** One source file's contribution. */
export interface DeclarationSection {
    /** What the section is called in its heading, e.g. `@commise/ui/button`. */
    readonly heading: string;
    /** The declarations to print under it. Empty drops the section. */
    readonly source: string;
}

function parse(source: string): ts.SourceFile {
    return ts.createSourceFile('contract.ts', source, ts.ScriptTarget.Latest, true);
}

/**
 * The source without its import declarations. The module docblock above the first import stays.
 *
 * @param source - TypeScript source.
 * @returns The source with each import removed and the blank lines they leave collapsed, trimmed.
 */
export function stripImports(source: string): string {
    const file = parse(source);
    let text = '';
    let cursor = 0;

    for (const statement of file.statements) {
        if (ts.isImportDeclaration(statement)) {
            text += source.slice(cursor, statement.getStart(file));
            cursor = statement.getEnd();
        }
    }

    text += source.slice(cursor);

    return text.replace(/\n{3,}/gu, '\n\n').trim();
}

/**
 * The exported interfaces and type aliases of a source file, each with the comments above it.
 *
 * @param source - TypeScript source.
 * @returns The declarations separated by a blank line; empty when the file exports no type.
 */
export function exportedTypeDeclarations(source: string): string {
    const file = parse(source);

    return file.statements
        .filter(
            (statement): statement is ts.InterfaceDeclaration | ts.TypeAliasDeclaration =>
                (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) &&
                (ts.getModifiers(statement) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
        )
        .map((statement) => statement.getFullText(file).trim())
        .join('\n\n');
}

const PREAMBLE = [
    '// Props contracts of the Commise design system, copied from source. Documentation only.',
    '// Web: window.Commise.<Name>. Native (React Native leaves via react-native-web): window.Commise.Native.<Name>.',
].join('\n');

/**
 * Joins the sections into the published file.
 *
 * @param sections - In the order they should appear.
 * @returns The `index.d.ts` text.
 */
export function propsIndex(sections: readonly DeclarationSection[]): string {
    const body = sections
        .filter(({ source }) => source.trim().length > 0)
        .map(({ heading, source }) => `// ==== ${heading} ====\n${source.trim()}`);

    return `${[PREAMBLE, ...body].join('\n\n')}\n`;
}
