/**
 * THE PARSE PROMPT, AS THE MEASUREMENT HARNESS REACHES IT — one re-export, and no second copy.
 *
 * ⛔ THE TEXT MOVED TO `@kitchensink/recipe-core/parsing/parse-prompt` (plan U18) AND THIS FILE IS NOW AN
 * ALIAS. It is not a convenience: it is the whole point.
 *
 * The prompt is a MEASURED ARTIFACT — every figure in
 * `docs/reports/2026-08-23-002-ingredient-parse-model-comparison.md` is denominated in its exact bytes. When
 * the shipped parse leg took a copy, the harness and the worker held the same 511 bytes in two files that
 * nothing kept in step, and the drift would have been invisible in both directions: the harness would keep
 * reporting compliance figures for a prompt the worker had stopped sending, and the worker would keep citing
 * a report that measured something else. One authoritative representation, imported.
 *
 * ⚠️ Do not "restore" a local copy to decouple the tool from the service's shared package. That decoupling is
 * exactly the failure mode: the tool exists to measure what the service SENDS.
 *
 * Everything this module documented about the wording — that it is the result of a search, that it must not
 * be reworded or given an example, why it asks the model to parse rather than to verify, and why the line is
 * passed through verbatim as third-party DATA — now lives at the authority. Read it there before touching it.
 */
export {
    MAX_PARSE_PROMPT_CHARS,
    PARSE_MAX_INPUT_TOKENS,
    PARSE_MAX_OUTPUT_TOKENS,
    PARSE_PROMPT_SHA256,
    PARSE_PROMPT_VERSION,
    PARSE_SYSTEM_PROMPT,
    PARSE_TEMPERATURE,
    ParsePromptTooLargeError,
    buildParsePrompt,
    isParsePromptTooLargeError,
    type ParsePrompt,
} from '@kitchensink/recipe-core/parsing/parse-prompt';
