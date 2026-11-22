/**
 * The shared config REGISTERS `eslint-plugin-sonarjs` and enables none of its rules.
 *
 * WHY. The CI code-quality overlay (`tooling/codeQuality`) runs sonarjs. A source comment that names one of its rules
 * in an `eslint-disable` is a reasoned, single-rule exception, but repo lint rejected it ("Definition for rule not
 * found") because it did not load the plugin, which left only a bare disable (turns off EVERY rule on the line) or
 * no disable. Registering the plugin with no rule enabled lets the comment name the rule, and repo lint reports what
 * it reported before.
 *
 * Three cases: the dependency is the overlay's exact pin (a different version means the two tools disagree about
 * which rules exist), a named sonarjs disable lints clean, and no sonarjs rule is switched on.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Linter } from 'eslint';
import { describe, expect, it } from 'vitest';

import { createConfig } from '../index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const readJson = (relative) => JSON.parse(readFileSync(path.join(here, relative), 'utf8'));

describe('eslint-plugin-sonarjs in the shared config', () => {
    it('is pinned to exactly the version the code-quality overlay pins', () => {
        const overlayPin = readJson('../../../../tooling/codeQuality/package.json').dependencies[
            'eslint-plugin-sonarjs'
        ];

        expect(overlayPin).toMatch(/^\d+\.\d+\.\d+$/);
        expect(readJson('../package.json').dependencies['eslint-plugin-sonarjs']).toBe(overlayPin);
    });

    it('lets a comment name a sonarjs rule in an eslint-disable without "Definition for rule not found"', () => {
        const code = [
            '// eslint-disable-next-line sonarjs/no-os-command-from-path -- git is found on PATH',
            'export const x = 1;',
            '',
        ].join('\n');
        const messages = new Linter({ configType: 'flat' }).verify(code, createConfig(), 'probe.js');

        // Repo lint enables no sonarjs rule, so ESLint also warns that the directive suppresses nothing here (the CI
        // overlay enables the rule, and there it does). That warning is not what this case is about.
        expect(messages.filter((message) => !message.message.startsWith('Unused eslint-disable directive'))).toEqual(
            [],
        );
    });

    it('enables no sonarjs rule', () => {
        const enabled = createConfig()
            .flatMap((block) => Object.entries(block.rules ?? {}))
            .filter(
                ([name, setting]) =>
                    name.startsWith('sonarjs/') && [setting].flat()[0] !== 'off' && [setting].flat()[0] !== 0,
            );

        expect(enabled).toEqual([]);
    });
});
