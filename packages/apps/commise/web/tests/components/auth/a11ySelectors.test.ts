import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function sourceFiles(directory: string): string[] {
    return readdirSync(directory).flatMap((entry) => {
        const absolutePath = join(directory, entry);

        if (statSync(absolutePath).isDirectory()) {
            return sourceFiles(absolutePath);
        }

        return absolutePath.endsWith('.tsx') || absolutePath.endsWith('.ts') ? [absolutePath] : [];
    });
}

describe('auth UI accessibility selectors', () => {
    it('uses accessible selectors instead of test-only attributes in auth surfaces', () => {
        const forbiddenAttribute = ['data', 'testid'].join('-');
        const files = [
            ...sourceFiles(join(process.cwd(), 'src/components/auth')),
            ...sourceFiles(join(process.cwd(), 'tests/components/auth')).filter(
                (file) => !file.endsWith('a11ySelectors.test.ts'),
            ),
        ];

        for (const file of files) {
            expect(readFileSync(file, 'utf8'), file).not.toContain(forbiddenAttribute);
        }
    });
});
