/**
 * Re-vendors the stock bootstrap template with the repository's pinned CDK CLI.
 *
 * `cdk bootstrap --show-template` makes NO AWS call: it prints the template the CLI would deploy. After running
 * this, update `STOCK_TEMPLATE_PROVENANCE` to the printed CLI version and the template's `BootstrapVersion`, then
 * regenerate the goldens. The transform throws if the new template moved a piece it edits.
 *
 * @sideEffect Runs the CDK CLI from `packages/infra/global` and overwrites `src/stockTemplate.yaml`.
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const globalInfra = path.resolve(here, '../../global');

const result = spawnSync('npx', ['cdk', 'bootstrap', '--show-template'], {
    cwd: globalInfra,
    encoding: 'utf8',
});

if (result.status !== 0 || result.stdout.length === 0) {
    throw new Error(`cdk bootstrap --show-template failed:\n${result.stderr}`);
}

writeFileSync(path.join(here, '../src/stockTemplate.yaml'), result.stdout);
