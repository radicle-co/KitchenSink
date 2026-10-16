"""Sentry for the CRF ingredient-parse engine (plan U21).

⛔ WHY THIS EXISTS. An exception inside `parse_ingredient` is per-LINE by design: `handler.py` catches it and
reports a `status` so one bad sentence does not lose the other 199 parses in the batch. That is right for the
caller and useless for diagnosis — the caller learns "that line failed" and never learns WHY, because the
Python traceback that names the cause went to a log group nobody read. Reporting it makes the engine's own
failures visible as issues, with a stack trace, grouped by where they happen rather than by which recipe hit
them.

⚠️ INERT WITHOUT A DSN, and that is what keeps every local run and every test unchanged. `init()` returns
`False` and `report()` does nothing, so the handler behaves exactly as it did before this module existed.

⚠️ NO PII. The engine is handed ingredient phrases — a cook's own words — and `send_default_pii` is off, but
that setting governs request/user data rather than exception values. Not reporting the input is not enough:
the engine's own exceptions can ECHO the line they choked on, and the SDK also captures the local variables of
every stack frame (`parse_line` has the sentence in scope). So `scrub_event` is installed as `before_send` and
strips exception values, frame variables, log entries and breadcrumbs, keeping the exception type and the stack
— which is what grouping and diagnosis read. The erasure path does not reach Sentry, so the phrase must never
get there to begin with.
"""

from __future__ import annotations

import logging
import os
from typing import Any

_logger = logging.getLogger(__name__)
_initialised = False


def scrub_event(event: dict[str, Any], hint: dict[str, Any]) -> dict[str, Any]:
    """Remove every place a cook's ingredient line can ride on a Sentry event (the SDK's ``before_send``).

    ⛔ KEPT: the exception ``type`` and the stack (file, function, line), because Sentry groups on them and they
    name the cause. REMOVED: each exception ``value`` (the chained cause included — a ``from`` raise carries its
    own), each frame's captured ``vars``, ``logentry``, ``message`` and ``breadcrumbs``.

    ⚠️ An allow-list would be safer in the abstract, but the event is the SDK's own shape and an allow-list of
    its fields rots on every SDK release; this removes the known carriers and the test pins each one.

    :param event: The event the SDK is about to send. Mutated in place and returned, as the SDK expects.
    :param hint: The SDK's hint (unused).
    :returns: The same event, scrubbed. Never raises on an unexpected shape.
    """
    exception = event.get("exception")
    values = exception.get("values") if isinstance(exception, dict) else None

    for value in values if isinstance(values, list) else []:
        if not isinstance(value, dict):
            continue

        value.pop("value", None)
        stacktrace = value.get("stacktrace")
        frames = stacktrace.get("frames") if isinstance(stacktrace, dict) else None

        for frame in frames if isinstance(frames, list) else []:
            if isinstance(frame, dict):
                frame.pop("vars", None)

    for carrier in ("logentry", "message", "breadcrumbs"):
        event.pop(carrier, None)

    return event


def init(engine_version: str) -> bool:
    """Initialise Sentry from the environment.

    :param engine_version: The pinned engine version, reported as the release so a traceback is attributable
        to the model that produced it — which for this service is the thing that actually changes behaviour.
    :returns: Whether Sentry was initialised.
    """
    global _initialised

    if _initialised:
        return True

    dsn = os.environ.get("SENTRY_DSN")

    if not dsn:
        return False

    try:
        import sentry_sdk
    except ImportError:  # pragma: no cover - the asset guard makes this unreachable in a deploy
        # ⚠️ Swallowed DELIBERATELY, and only here. A missing SDK must never stop the parser parsing: this
        # module is observability, and an import error in observability that takes the service down is
        # strictly worse than the blindness it was added to fix.
        _logger.warning("sentry-sdk is not installed; the parser runs unreported")
        return False

    sentry_sdk.init(
        dsn=dsn,
        environment=os.environ.get("STAGE", "dev"),
        release=engine_version,
        send_default_pii=False,
        # ⛔ Belt and braces with `scrub_event`: never CAPTURE frame locals, so the sentence is not collected at
        # all rather than collected and then removed.
        include_local_variables=False,
        before_send=scrub_event,
        # ⚠️ Tracing OFF by default. This function is invoked in a batch by one caller that already traces;
        # a second trace of the same work would double the spans and tell nobody anything new.
        traces_sample_rate=float(os.environ.get("SENTRY_TRACES_SAMPLE_RATE", "0")),
    )
    _initialised = True

    return True


def report(error: BaseException, **context: object) -> None:
    """Report a handled exception, with identifiers only.

    ⚠️ ``object``, not ``Any``. ``Any`` silences the type checker for every caller — ruff's ANN401 refuses
    it for exactly that reason — while ``object`` still accepts any value and keeps the checker honest about
    what may be done with it. Nothing here does anything with a context value except hand it to Sentry.

    :param error: The caught exception.
    :param context: Identifiers describing where it happened. ⛔ NEVER the ingredient phrase — the whole
        point of reporting here is to name the failure without copying the cook's words into a place the
        erasure path does not reach.
    """
    if not _initialised:
        return

    try:
        import sentry_sdk

        with sentry_sdk.new_scope() as scope:
            scope.set_context("work_unit", context)
            sentry_sdk.capture_exception(error)
    except Exception:  # pragma: no cover - reporting must never fail the parse
        _logger.warning("could not report an engine failure to Sentry", exc_info=True)
