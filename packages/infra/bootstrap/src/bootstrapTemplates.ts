/**
 * @module bootstrapTemplates — reads the vendored stock template and renders the per-qualifier bootstrap template.
 *
 * The only I/O the package does at read time; `customizeBootstrapTemplate` stays pure. The rendered text is what is
 * committed under `golden/`, and what the owner passes to `cdk bootstrap --template`.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Document, isScalar, parse, visit } from 'yaml';

import { customizeBootstrapTemplate } from './customizeBootstrapTemplate.js';
import type { Json } from './json.js';
import type { QualifierName } from './qualifiers.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Where `src/stockTemplate.yaml` came from. A CDK upgrade that moves the template is a deliberate regeneration:
 * `npm run bootstrap:stock`, then `npm run bootstrap:golden`, then re-run the owner bootstrap (the runbook).
 */
export const STOCK_TEMPLATE_PROVENANCE = {
    /** `cdk --version` of the pinned CLI that printed it with `cdk bootstrap --show-template`. */
    cdkCliVersion: '2.1140.0',
    /** The template's own `BootstrapVersion` output. */
    bootstrapVersion: '32',
} as const;

/** @sideEffect Reads the vendored file. */
export function readStockTemplateText(): string {
    return readFileSync(path.join(here, 'stockTemplate.yaml'), 'utf8');
}

/** Where a qualifier's golden file lives. */
export const goldenPath = (qualifier: QualifierName): string => path.join(here, '../golden', `${qualifier}.yaml`);

/**
 * The bootstrap template for one qualifier, as the YAML the owner deploys.
 *
 * @sideEffect Reads the vendored stock template.
 */
export function renderBootstrapTemplate(qualifier: QualifierName): string {
    const stock = parse(readStockTemplateText()) as Json;
    // ⛔ CloudFormation's YAML parser REJECTS aliases (`&a1` / `*a1`), which the library emits for any object
    // reachable twice, so aliasing is switched off and the shared objects are written out in full.
    const document = new Document(customizeBootstrapTemplate(stock, qualifier), { aliasDuplicateObjects: false });

    // A bare `2012-10-17` is a date to some YAML readers; the stock template quotes the policy version, so does this.
    visit(document, {
        Scalar(_key, node) {
            if (isScalar(node) && typeof node.value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(node.value)) {
                node.type = 'QUOTE_DOUBLE';
            }
        },
    });

    return document.toString({ lineWidth: 0 });
}
