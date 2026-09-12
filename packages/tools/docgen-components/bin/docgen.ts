/**
 * @module bin/docgen — the generator entry point.
 *
 * `npm run docs:generate --workspace=packages/tools/docgen-components`.
 *
 * It prints the coverage the run measured, because the numbers ARE the finding: a documentation generator
 * whose output nobody reads still tells you, in one line, how much of the component surface is undocumented.
 *
 * @sideEffect Reads the component sources and REWRITES the generated documentation directories.
 */
import { REPO_ROOT } from '../src/config.js';
import { buildArtifacts, writeArtifacts } from '../src/generate.js';

const artifacts = buildArtifacts(REPO_ROOT);
await writeArtifacts(artifacts, REPO_ROOT);

const index: unknown = JSON.parse(artifacts.get('docs/generated/components/index.json') ?? '{}');
const totals = (index as { totals?: Record<string, number> }).totals ?? {};

process.stdout.write(`${[...artifacts.keys()].length} artifacts written\n`);

for (const [name, value] of Object.entries(totals)) {
    process.stdout.write(`  ${name}: ${value}\n`);
}
