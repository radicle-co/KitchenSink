"""Read ingredient lines from stdin, print one JSON object per line to stdout.

The sidecar for the ingredient-parse model comparison. It exists so `ingredient-parser-nlp`'s CRF model is
loaded ONCE for a whole corpus instead of once per line, and so the flattening from its rich objects to the
four fields the comparison uses happens in exactly one place.

WHAT IS AND IS NOT ALTERED HERE. Each field is the parser's OWN `text`, verbatim. The structured values it
also offers -- a `Fraction` quantity, a `pint` unit -- are deliberately NOT used to re-render a measure
string: the comparison is between two readings of one line, and putting our own rendering in the middle of
it would measure the renderer. `size`, `preparation` and `comment` are carried through because the answer
shape under test has no slot for them, and a disagreement traceable to one of them must be nameable rather
than counted as a plain difference.

The protocol is deliberately positional-free: one input line in, one output row out, in order, with the
submitted sentence echoed back so the caller can assert the pairing rather than trust it. Input lines are
JSON-encoded strings, so a line containing a newline, a quote or a brace cannot corrupt the stream.

Run:  python3 scripts/crfParse.py < lines.jsonl > crf.jsonl
Needs: pip3 install --user ingredient-parser-nlp
"""

import json
import sys

from ingredient_parser import parse_ingredient


def row(line: str) -> dict[str, object]:
    """Flatten one parsed line to the four fields the comparison reads, plus its three modifiers."""
    parsed = parse_ingredient(line)

    return {
        "sentence": parsed.sentence,
        "measure": " ".join(amount.text for amount in parsed.amount),
        "names": [name.text for name in parsed.name],
        "size": parsed.size.text if parsed.size else None,
        "preparation": parsed.preparation.text if parsed.preparation else None,
        "comment": parsed.comment.text if parsed.comment else None,
    }


def main() -> None:
    """Stream stdin to stdout, one JSON-encoded input line to one JSON output row, in order."""
    for raw in sys.stdin:
        raw = raw.strip()

        if not raw:
            continue

        print(json.dumps(row(json.loads(raw)), ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
