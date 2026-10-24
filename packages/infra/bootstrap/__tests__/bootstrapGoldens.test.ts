/**
 * The golden files are what the owner deploys (`cdk bootstrap --template golden/<q>.yaml`), so the proof that
 * matters is that the committed file is EXACTLY what the transform produces from the committed stock template.
 * A hand edit to a golden, a stale golden after a policy change, or a stock template swapped without a
 * regeneration all fail here with the diff.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import {
    STOCK_TEMPLATE_PROVENANCE,
    goldenPath,
    readStockTemplateText,
    renderBootstrapTemplate,
} from '../src/bootstrapTemplates.js';
import { QUALIFIERS } from '../src/qualifiers.js';

describe('the vendored stock template', () => {
    const text = readStockTemplateText();

    it('declares the BootstrapVersion the provenance records', () => {
        const stock = parse(text) as { Outputs: { BootstrapVersion: { Value: string } } };

        expect(stock.Outputs.BootstrapVersion.Value).toBe(STOCK_TEMPLATE_PROVENANCE.bootstrapVersion);
    });

    it('is the default-qualifier template (the transform changes the qualifier, the stock never has ours)', () => {
        const stock = parse(text) as { Parameters: { Qualifier: { Default: string } } };

        expect(stock.Parameters.Qualifier.Default).toBe('hnb659fds');
    });

    it('records the CDK CLI that emitted it', () => {
        expect(STOCK_TEMPLATE_PROVENANCE.cdkCliVersion).toMatch(/^\d+\.\d+\.\d+$/u);
    });
});

describe.each(Object.values(QUALIFIERS))('golden/%s.yaml', (qualifier) => {
    it('equals the transform output, byte for byte', () => {
        const committed = readFileSync(goldenPath(qualifier), 'utf8');

        expect(committed).toBe(renderBootstrapTemplate(qualifier));
    });

    it('is a different document from the other qualifiers', () => {
        const here = path.dirname(fileURLToPath(import.meta.url));
        const others = Object.values(QUALIFIERS).filter((q) => q !== qualifier);

        for (const other of others) {
            expect(readFileSync(path.join(here, '../golden', `${qualifier}.yaml`), 'utf8')).not.toBe(
                readFileSync(path.join(here, '../golden', `${other}.yaml`), 'utf8'),
            );
        }
    });

    it('uses no YAML alias, which CloudFormation refuses', () => {
        // An anchor is `&name` on a node; an alias is `*name` as a whole value. `*` inside a string is an IAM wildcard.
        expect(readFileSync(goldenPath(qualifier), 'utf8')).not.toMatch(/(^|\s)[&*][A-Za-z0-9_]+(\s|$)/mu);
    });

    it('quotes the policy-language version so no reader takes it for a date', () => {
        const text = readFileSync(goldenPath(qualifier), 'utf8');

        expect(text).toContain('Version: "2012-10-17"');
        expect(text).not.toMatch(/Version: 2012-10-17/u);
    });

    it('commits no AWS account id (the repository refuses them)', () => {
        expect(readFileSync(goldenPath(qualifier), 'utf8')).not.toMatch(/\b\d{12}\b/u);
    });
});
