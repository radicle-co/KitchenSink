/**
 * @module bundle/inlineScriptEscape — makes script text safe to sit inside an HTML `<script>` element.
 */

/**
 * Escapes the two sequences the HTML tokenizer acts on inside a script: `</script` (ends the element, in any
 * case) and `<!--` (enters the "script data escaped" state). Both are rewritten to JavaScript escapes that
 * mean the same thing inside a string, template or regular expression.
 *
 * It rewrites the sequences ANYWHERE in the text, including inside string literals and comments, because the
 * tokenizer does not know what a literal is. Equivalent only where the sequence is inside a string-like
 * token, which is true of minified library output and generated bundles; it would change meaning in code that
 * has either sequence as bare syntax, which JavaScript cannot contain.
 *
 * @param text - Script source.
 * @returns The same program, safe to inline.
 */
export function inlineScriptEscape(text: string): string {
    return text.replace(/<\/(script)/giu, '<\\/$1').replace(/<!--/gu, '\\x3C!--');
}
