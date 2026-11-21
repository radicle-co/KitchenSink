// Where a scanner's finding is — read from the tool's own output and the file it names, never guessed.
//
// A location has three honest shapes, and scan.mjs keeps them apart:
//   { file, line }        the tool (or the file it names) pins the finding to that line
//   { file, line: null }  the finding is about the whole file (an orphan module, a missing manifest field)
//   { file: null, ... }   the finding is about the workspace, and no single file owns it
// The failure this exists to end: four tools reported `line: 1` for all three, and a GATE read "file:1" as a location.
//
// Every function here is pure. The TypeScript compiler is used as a PARSER only — for import specifiers, JSONC keys
// and `process.env` reads — because a text search lands on comments and on the first line that merely mentions a word.
import { createRequire } from 'node:module';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';

// The toolchain is this directory: its pinned node_modules sit beside these scripts (`npm ci` in tooling/codeQuality).
const SCQ_HOME = process.env['SCQ_HOME'] ?? dirname(fileURLToPath(import.meta.url));
const ts = createRequire(join(SCQ_HOME, 'package.json'))('typescript');

const lineAt = (text, pos) => ts.computeLineAndCharacterOfPosition(ts.computeLineStarts(text), pos).line + 1;

/** The line of the import, re-export, `require` or dynamic `import()` of `specifier`; null when the file has none. */
export function importLine(text, specifier) {
    const imported = ts.preProcessFile(text, true, true).importedFiles.find((ref) => ref.fileName === specifier);
    return imported === undefined ? null : lineAt(text, imported.pos);
}

/** The line of the property at `path` in a JSON or JSONC document; null when the path does not exist. */
export function jsonKeyLine(text, path) {
    const source = ts.parseJsonText('document.json', text);
    let node = source.statements[0]?.expression;
    let property = null;
    for (const key of path) {
        if (node === undefined || !ts.isObjectLiteralExpression(node)) {
            return null;
        }
        property = node.properties.find(
            (p) => ts.isPropertyAssignment(p) && ts.isStringLiteral(p.name) && p.name.text === key,
        );
        if (property === undefined) {
            return null;
        }
        node = property.initializer;
    }
    return property === null ? null : source.getLineAndCharacterOfPosition(property.getStart(source)).line + 1;
}

/** The line of the first syntax error in a JSON or JSONC document (comments and trailing commas are valid); null when it parses. */
export function jsonSyntaxErrorLine(text) {
    const [first] = ts.parseJsonText('document.json', text).parseDiagnostics;
    return first === undefined ? null : lineAt(text, first.start);
}

/** Every literal `process.env.NAME` / `process.env['NAME']` read of an upper-case name, in source order. */
export function envReads(text, fileName) {
    const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
    const isProcessEnv = (node) =>
        ts.isPropertyAccessExpression(node) &&
        node.name.text === 'env' &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'process';
    const reads = [];
    const visit = (node) => {
        let name = null;
        if (ts.isPropertyAccessExpression(node) && isProcessEnv(node.expression)) {
            name = node.name.text;
        } else if (
            ts.isElementAccessExpression(node) &&
            isProcessEnv(node.expression) &&
            ts.isStringLiteralLike(node.argumentExpression)
        ) {
            name = node.argumentExpression.text;
        }
        if (name !== null && /^[A-Z0-9_]+$/.test(name)) {
            reads.push({ name, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return reads;
}

/**
 * The specifier `file` wrote for the dependency a dependency-cruiser violation is about; null when the violation is
 * about the whole module (an orphan) or when `file` holds no import for it. Paths are as depcruise prints them.
 * A cycle is reported once but every member takes part: a member's edge is the one to its successor round the cycle.
 */
export function depcruiseEdgeSpecifier(violation, modules, file) {
    const specifierOf = (source, resolved) =>
        modules.find((m) => m.source === source)?.dependencies.find((d) => d.resolved === resolved)?.module ?? null;
    if (violation.type === 'module' || violation.from === violation.to) {
        return null;
    }
    if (file === violation.from) {
        return violation.unresolvedTo ?? specifierOf(violation.from, violation.to);
    }
    const ring = (violation.cycle ?? []).map((member) => (typeof member === 'string' ? member : member.name));
    const at = ring.indexOf(file);
    return at === -1 ? null : specifierOf(file, ring[(at + 1) % ring.length]);
}

/** One finding per item knip reports, of every kind it reports. Grouped symbols (duplicates, cycles) are one finding. */
export function knipFindings(report) {
    const found = [];
    for (const issue of report.issues ?? []) {
        for (const [kind, items] of Object.entries(issue)) {
            if (kind === 'owners' || !Array.isArray(items)) {
                continue;
            }
            for (const item of items) {
                const symbols = Array.isArray(item) ? item : [item];
                found.push({
                    kind,
                    file: issue.file,
                    line: symbols[0]?.line ?? null,
                    name: symbols.map((s) => (s.namespace ? `${s.namespace}.${s.name}` : s.name)).join(', '),
                });
            }
        }
    }
    return found;
}

/**
 * sherif prints text only. Each issue belongs to the block header above it: `./<path>:` names a manifest, and a bare
 * `./:` is workspace-wide (manifest null). What follows an issue line is one of three things:
 *   - a multiple-versions TABLE: `  ./packages` group lines, `      b   3.23.0   ↑ highest` rows naming a directory,
 *     and `      ./ …` for the root → `versions`, the manifests involved;
 *   - a CODE FRAME of the manifest: `│   "dependencies": {` opens a section, `~ "react": …` marks a key, `~ ...` marks
 *     the section itself, and `+` a field that is missing → `frame`, the key path at the first mark and the marked keys;
 *   - a DETAIL line naming a path (`./packages/x/package.json doesn't exist.`) → appended to the message, because a
 *     workspace-wide issue has no file to carry it.
 */
export function parseSherif(text) {
    const issues = [];
    let manifest = null;
    let current = null;
    let group = '';
    let open = [];
    for (const line of stripVTControlCharacters(text).split('\n')) {
        const header = /issues? found in \.\/(\S*):\s*$/.exec(line);
        if (header) {
            manifest = header[1] === '' ? null : header[1];
            current = null;
            continue;
        }
        const issue = /[⨯⚠]\S*\s+(error|warning)\s+(.+?)\s+([a-z0-9-]+)\s*$/.exec(line);
        if (issue) {
            current = {
                rule: issue[3],
                severity: issue[1],
                message: issue[2],
                manifest,
                versions: [],
                frame: { path: [], keys: [] },
            };
            issues.push(current);
            group = '';
            open = [];
            continue;
        }
        if (current === null) {
            continue;
        }
        if (current.rule !== 'multiple-dependency-versions') {
            const opens = /^\s+│\s+"([^"]+)":\s*\{\s*$/.exec(line);
            const mark = /^\s+~\s+(?:"([^"]+)":)?/.exec(line);
            const detail = /^\s{2,}(\.\/\S+ .+?)\s*$/.exec(line);
            if (opens) {
                open.push(opens[1]);
            } else if (/^\s+│\s+\}/.test(line)) {
                open.pop();
            } else if (mark) {
                if (current.frame.keys.length === 0 && current.frame.path.length === 0) {
                    current.frame.path = [...open];
                }
                if (mark[1] !== undefined) {
                    current.frame.keys.push(mark[1]);
                }
            } else if (detail) {
                current.message = `${current.message} (${detail[1]})`;
            }
            continue;
        }
        const groupLine = /^ {2}(\.\/\S*)\s*$/.exec(line);
        const row = /^ {4,}(\S+)\s+\S+\s+\S+\s+(?:highest|lowest|between)\s*$/.exec(line);
        if (groupLine) {
            group = groupLine[1].slice(2);
        } else if (row) {
            current.versions.push(
                row[1].startsWith('./')
                    ? posix.join(row[1].slice(2), 'package.json')
                    : posix.join(group, row[1], 'package.json'),
            );
        }
    }
    return issues;
}

const DEPENDENCY_SECTIONS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

/**
 * Where a parsed sherif issue is. `read(path)` returns a manifest's text, or null when there is no such file.
 * Multiple versions → the dependency's key in each listed manifest. A code frame → the first key it marks, or the
 * section it marks. Anything else (a missing field, an unknown rule) → its manifest as a whole, or the workspace when
 * the block named no manifest.
 */
export function sherifLocations(issue, read) {
    if (issue.rule === 'multiple-dependency-versions') {
        const dependency = /^Dependency (\S+) has multiple versions/.exec(issue.message)?.[1];
        const located = issue.versions.flatMap((path) => {
            const text = read(path);
            if (text === null) {
                return [];
            }
            const line =
                dependency === undefined
                    ? null
                    : (DEPENDENCY_SECTIONS.map((section) => jsonKeyLine(text, [section, dependency])).find(
                          (l) => l !== null,
                      ) ?? null);
            return [{ file: path, line }];
        });
        if (located.length > 0) {
            return located;
        }
    }
    if (issue.manifest === null) {
        return [{ file: null, line: null }];
    }
    const { path, keys } = issue.frame;
    const text = path.length === 0 ? null : read(issue.manifest);
    if (text === null) {
        return [{ file: issue.manifest, line: null }];
    }
    const keyLine = keys.map((key) => jsonKeyLine(text, [...path, key])).find((l) => l !== null);
    return [{ file: issue.manifest, line: keyLine ?? jsonKeyLine(text, path) }];
}
