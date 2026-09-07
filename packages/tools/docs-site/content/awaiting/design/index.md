---
title: Design system — not generated yet
sidebar_label: Not generated yet
---

# The design-system style guide has not been generated in this checkout

This section is **generated**, not written. Nothing has been written to `docs/generated/design/` in
the commit you are looking at.

No swatches, scales or token tables are shown here. A style guide that displays plausible-looking
colours nobody ships is actively harmful — it becomes the reference, and the real tokens drift away
from it unobserved.

## What belongs here

The design tokens as the applications actually consume them — colour, typography, spacing and the
rest — derived from the token source rather than re-typed into a document.

## How to fill it in

Run the design-token generator, which writes into `docs/generated/design/` and commits its output.
The moment that directory contains Markdown, this page disappears and the real content is mounted at
the same route — the site needs no configuration change.
