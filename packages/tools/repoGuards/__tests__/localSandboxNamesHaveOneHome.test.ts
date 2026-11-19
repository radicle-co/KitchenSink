// @vitest-environment node
/**
 * Repo-wide guard: the names of a local stack's Docker objects have ONE home, `local-sandbox/src/stackPorts.ts`.
 *
 * A second stack runs beside the first (`LOCAL_SANDBOX_PORT`), so a container is `<project>-<service>` and an image is
 * `local-sandbox/<repo>:local` or `:local-<port>`. Code that spells `local-sandbox-postgres`, or builds
 * `local-sandbox-${service}`, finds the default stack's container whatever stack the run names, and reads or writes the
 * other session's data. Every other file asks the `Stack` (`containerName`, `imageTag`).
 *
 * The rule reads string and template text through the TypeScript parser, so a comment that names a container is not a
 * finding. It is a pure analyzer over one source, run over the real tree and over a fixture that breaks it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { isTestFile, presentFiles, repoRoot, visit } from './serviceSources.js';

const PACKAGE = 'packages/tools/local-sandbox';
const HOME = `${PACKAGE}/src/stackPorts.ts`;
/** A container, project or volume name, or a local image tag. A temp-folder prefix is fine. */
const NAME = /local-sandbox-(?:postgres|recipes|identity|food|localstack|pgdata|\d)|local-sandbox\/[\w.-]+:local/u;
/** A template that ends where a service name is about to go: `local-sandbox-${service}`. */
const BEING_BUILT = /local-sandbox-$/u;

/** The string and template texts of a file that spell a stack object's name. */
function namesIn(contents: string): readonly string[] {
    const found: string[] = [];
    const parsed = ts.createSourceFile('file.ts', contents, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);

    visit(parsed, (node) => {
        if (
            ts.isStringLiteral(node) ||
            ts.isNoSubstitutionTemplateLiteral(node) ||
            ts.isTemplateHead(node) ||
            ts.isTemplateMiddle(node) ||
            ts.isTemplateTail(node)
        ) {
            if (NAME.test(node.text) || (ts.isTemplateHead(node) && BEING_BUILT.test(node.text))) {
                found.push(node.text);
            }
        }
    });

    return found;
}

/** The names a shell script spells, on lines that are not comments. A template being built counts too. */
function shellNamesIn(contents: string): readonly string[] {
    return contents
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('#'))
        .filter((line) => NAME.test(line) || /local-sandbox-\$/u.test(line));
}

describe('the names of a local stack are built in stackPorts.ts and nowhere else', () => {
    const sources = presentFiles([`${PACKAGE}/src`, `${PACKAGE}/bin`]).filter(
        (file) => !isTestFile(file) && file !== HOME,
    );
    const files = sources.filter((file) => file.endsWith('.ts'));
    const scripts = sources.filter((file) => file.endsWith('.sh'));

    it('finds the files it is meant to read, so an empty list cannot pass', () => {
        expect(files).toContain(`${PACKAGE}/bin/up.ts`);
        expect(files).toContain(`${PACKAGE}/src/composePlan.ts`);
        expect(scripts).toContain(`${PACKAGE}/bin/localMaestro.sh`);
    });

    it.each(scripts)('%s spells no container, image or volume name of its own', (file) => {
        expect(shellNamesIn(readFileSync(join(repoRoot, file), 'utf8'))).toEqual([]);
    });

    it.each(files)('%s spells no container or image name of its own', (file) => {
        expect(namesIn(readFileSync(join(repoRoot, file), 'utf8'))).toEqual([]);
    });

    it('catches a literal container name, a name being built, and a local image tag', () => {
        expect(namesIn("const c = 'local-sandbox-postgres';")).toEqual(['local-sandbox-postgres']);
        expect(namesIn('const c = `local-sandbox-${service}`;')).toEqual(['local-sandbox-']);
        expect(namesIn("const t = 'local-sandbox/recipe-service:local';")).toEqual([
            'local-sandbox/recipe-service:local',
        ]);
    });

    it('catches the volume name, in code and in a shell script, and passes a shell comment', () => {
        expect(namesIn("const v = 'local-sandbox-pgdata';")).toEqual(['local-sandbox-pgdata']);
        expect(shellNamesIn('docker volume rm local-sandbox_local-sandbox-pgdata\n')).toHaveLength(1);
        expect(shellNamesIn('docker exec local-sandbox-postgres psql\n')).toHaveLength(1);
        expect(shellNamesIn('# the container local-sandbox-postgres\necho hi\n')).toEqual([]);
    });

    it('passes a comment and an ordinary string', () => {
        expect(namesIn('// the container local-sandbox-postgres\nconst a = 1;')).toEqual([]);
        expect(namesIn("const s = 'sandbox';")).toEqual([]);
        expect(namesIn("mkdtempSync(path.join(tmpdir(), 'local-sandbox-'))")).toEqual([]);
    });
});
