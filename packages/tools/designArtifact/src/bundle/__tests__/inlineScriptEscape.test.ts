import { describe, expect, it } from 'vitest';

import { inlineScriptEscape } from '../inlineScriptEscape.js';

describe('inlineScriptEscape', () => {
    it.each([
        ['a closing script tag', 'a</script>b', 'a<\\/script>b'],
        ['any case', 'a</SCRIPT>b', 'a<\\/SCRIPT>b'],
        ['mixed case', 'a</ScRiPt>b', 'a<\\/ScRiPt>b'],
        ['a comment opener', 'a<!--b', 'a\\x3C!--b'],
        ['both, repeatedly', '</script></script><!--<!--', '<\\/script><\\/script>\\x3C!--\\x3C!--'],
        ['a close tag with no space before attributes', '</script foo>', '<\\/script foo>'],
        ['nothing to escape', 'const a = 1 < 2 && "</div>";', 'const a = 1 < 2 && "</div>";'],
        ['empty text', '', ''],
    ])('%s', (_label, input, expected) => {
        expect(inlineScriptEscape(input)).toBe(expected);
    });

    it('leaves no sequence the HTML tokenizer would act on', () => {
        const escaped = inlineScriptEscape('x</script>y<!--z</SCRIPT');

        expect(escaped).not.toMatch(/<\/script/iu);
        expect(escaped).not.toContain('<!--');
    });
});
