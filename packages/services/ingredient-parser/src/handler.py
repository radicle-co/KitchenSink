"""The CRF ingredient-parse engine, as an AWS Lambda handler.

The repository's first non-Node deployable. See
docs/architecture/decisions/0025-ingredient-parser-python-deployable.md for why it is a separate function
rather than a library linked into recipe-service, and packages/services/ingredient-parser/README.md for how
the asset is built.

WHY A BATCH, NOT A LINE. `ingredient_parser` loads a CRF model at import time. Invoking once per line pays
that load on every cold start for one sentence's work, which is the exact cost the comparison harness's
sidecar exists to avoid ("it exists so the CRF model is loaded ONCE for a whole corpus instead of once per
line"). So the request carries a batch and the response echoes each submitted sentence back, in order, so
the caller can assert the pairing rather than trust it.

WHAT IS AND IS NOT ALTERED HERE. Each field is the parser's OWN `text`, verbatim. The structured values it
also offers -- a `Fraction` quantity, a `pint` unit -- are deliberately NOT used to re-render a measure
string: the caller compares this reading against a second engine's, and putting our rendering in the middle
of that would measure the renderer. `size`, `preparation` and `comment` are carried because the answer shape
has no slot for them and a disagreement traceable to one of them must be nameable rather than counted as a
plain difference.

⛔ `foundation_foods` IS NOT EMITTED, AND MUST NOT BE. The engine can attach an FDC database match to each
name (`parse_ingredient(..., foundation_foods=True)`). Consuming it would stand up a SECOND, unowned
resolution authority beside `resolutionCascade.ts` -- and it is measurably wrong, having mis-mapped soy
flour in the sample. The default is `False`; this handler never passes the flag, never reads the field, and
the caller's zod rejects the key outright. Turning it on is a resolution-architecture decision, not a
parser flag.

⛔ FAILURE IS PER LINE, NEVER PER BATCH. One sentence the engine chokes on must not lose the other 199
parses, so each result carries its own `status`. The caller decides what an individual failure means; this
process only reports it.
"""

import json
import logging
from importlib import metadata
from typing import Any

from ingredient_parser import parse_ingredient

# Bounds on ONE request. Both are input validation, not tuning: without them a caller can hand this process
# an unbounded amount of CRF inference and the function's duration becomes the caller's choice.
#
# ⚠️ Kept equal to `engineRequestSchema` in `src/engine.schema.ts`, which is the contract callers are
# written against. A caller that respects the schema can never be refused here.
MAX_LINES = 200
MAX_LINE_CHARS = 512

ENGINE = "crf"
ENGINE_VERSION = metadata.version("ingredient-parser-nlp")

logger = logging.getLogger()
logger.setLevel(logging.INFO)


class InvalidRequest(ValueError):
    """The request is not something this engine can be asked. Reported as a refusal, never retried."""


def _lines_of(event: Any) -> list[str]:
    """Validate the request and return its lines.

    Raises:
        InvalidRequest: when the event is not `{"lines": [str, ...]}` within the declared bounds.
    """
    if not isinstance(event, dict):
        raise InvalidRequest("request must be a JSON object")

    lines = event.get("lines")

    if not isinstance(lines, list):
        raise InvalidRequest("request must carry a 'lines' array")

    if not lines:
        raise InvalidRequest("request carries no lines")

    if len(lines) > MAX_LINES:
        raise InvalidRequest(f"request carries {len(lines)} lines, more than the {MAX_LINES} allowed")

    for index, line in enumerate(lines):
        if not isinstance(line, str):
            raise InvalidRequest(f"line {index} is not a string")

        # ⚠️ Kept in step with `engineRequestSchema`'s `z.string().min(1)`. An empty line has nothing to
        # parse, and accepting one here while the caller's zod refuses it would put the two representations
        # of this contract out of step in the direction nobody tests -- Python accepting more than TypeScript
        # will ever send.
        if len(line) < 1:
            raise InvalidRequest(f"line {index} is empty")

        if len(line) > MAX_LINE_CHARS:
            raise InvalidRequest(
                f"line {index} is {len(line)} characters, more than the {MAX_LINE_CHARS} allowed"
            )

    return lines


def parse_line(line: str) -> dict[str, Any]:
    """Read one ingredient line, flattened to the fields the answer shape and its diagnosis need.

    Returns:
        A `parsed` row, or a `failed` row naming the sentence and the reason. Never raises for a line the
        engine dislikes -- see the module docstring on per-line failure.
    """
    try:
        parsed = parse_ingredient(line)
    except Exception as failure:  # noqa: BLE001 -- a third-party parser's failure modes are not enumerable
        # ⚠️ The class name, NOT `str(failure)`: the message can echo the submitted line, and the line is
        # user-typed recipe text. The caller already knows what it sent.
        return {"status": "failed", "sentence": line, "reason": type(failure).__name__}

    return {
        "status": "parsed",
        # The parser's NORMALISED sentence, which is what every other field was read out of.
        "sentence": parsed.sentence,
        # The parser's own amount text, joined when it read several. Empty string when it read none.
        "measure": " ".join(amount.text for amount in parsed.amount),
        # The parser's own name texts, in the order it produced them.
        "names": [name.text for name in parsed.name],
        "size": parsed.size.text if parsed.size else None,
        "preparation": parsed.preparation.text if parsed.preparation else None,
        "comment": parsed.comment.text if parsed.comment else None,
    }


def handle(event: Any, _context: Any = None) -> dict[str, Any]:
    """Parse a batch of ingredient lines.

    Args:
        event: `{"lines": ["1 cup flour", ...]}`.
        _context: The Lambda context, unused.

    Returns:
        `{"engine", "engineVersion", "results"}` -- one result per submitted line, in order.

    Raises:
        InvalidRequest: when the request is malformed. Deliberately raised rather than returned as an error
            envelope: a malformed request is a caller defect that must not be retried, and letting it fail
            the invocation is what makes that visible in the caller's own error path.
    """
    lines = _lines_of(event)

    logger.info(json.dumps({"event": "parse.start", "lineCount": len(lines), "engineVersion": ENGINE_VERSION}))

    results = [parse_line(line) for line in lines]
    failed = sum(1 for result in results if result["status"] == "failed")

    logger.info(json.dumps({"event": "parse.done", "lineCount": len(lines), "failedCount": failed}))

    return {"engine": ENGINE, "engineVersion": ENGINE_VERSION, "results": results}
