---
name: designCanvases
description: Find, read, edit or answer comments on the Commise design canvases on claude.ai, which hold the screen mockups (boards) for every page and feature, on web and mobile, and the Design System. Use it before any work that looks at, compares against, changes or reviews a Commise screen design, board, mockup or canvas, or the Design System artifact, and before replying to a comment on one.
---

# Commise design canvases

The screen designs and the Design System are claude.ai artifacts, and their source is in this repository. Each screen
canvas is the folder `docs/design/canvases/<id>/`: it changes on a branch, merges to `main`, and is then published
from `main`. The Design System is built from `@commise/ui` by `packages/tools/designArtifact`.

1. Find the canvas in `docs/design/canvases/registry.json`. Use the entries with status `current`. A link that is not
   in the registry is not a canvas to work on.
2. Read `docs/design/canvases/README.md` before you change anything. It holds the only copy of the editing steps, the
   rules for comments, and the rules for changes across many canvases. Follow it exactly.
