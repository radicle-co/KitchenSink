# Plan: design canvases move to repo source

Owner decision 2026-11-15: near-zero tolerance for broken mockups, while agents still work on mockups independently.
The repo becomes the only place where a screen canvas changes. A published canvas changes only by a publish from
`main`, after review and merge. Today every screen canvas has source `live` (`docs/design/canvases/README.md`).

## Preconditions

1. The snapshot PR is merged: every `page` and `feature` canvas in `docs/design/canvases/registry.json` lives under
   `docs/design/canvases/<id>/<artifact file path>`, byte-identical to the published canvas (prompt given to the owner
   2026-11-15. It runs in a session that has the `Artifact` tool).
2. The Design System (`kind: designSystem`, source `repo`) does not change: it already builds from `@commise/ui`.

## Target workflow

1. Edit: an agent changes board files under `docs/design/canvases/<id>/` on its own branch and worktree.
2. Preview: to show the owner work in progress, publish the branch's files to a preview artifact that is not in the
   registry. Never to a registered canvas.
3. Check before merge:
    - CI: structural guard (below).
    - Local: the design-artifact LOCAL e2e renders every changed board in light and dark (it needs
      `DESIGN_CANVAS_RUNTIME`. The runtime must not be vendored, so this cannot run in CI).
    - The PR needs the designer's approval (squad merge rule: `docs/design/` counts as UI).
4. Merge to `main`.
5. Publish from `main` (procedure below). Only content identical to `origin/main` can reach a registered canvas.
6. Owner comments stay on the live canvas. The designer makes the change in the repo, and after the publish replies in
   the thread and resolves it.
7. Rollback: `git revert` the merge, then publish.

## Publish procedure (an agent with the `Artifact` tool)

Each published canvas carries a marker file `project/published.json`: `{"sha": "<main commit published>"}`.

1. `git fetch origin main`. Work from a clean checkout of `origin/main`.
2. For each canvas whose folder changed between its marker sha and `origin/main`:
    1. Read the live marker, then download the live files the change touches.
    2. Drift check: each live file must equal the repo file at the marker sha. Any difference (an edit made on claude.ai)
       stops the publish for that canvas. Import the live files into a PR titled `canvas drift: <id>`, and publish
       after it merges.
    3. Publish only the changed files plus the new marker, `root` = the canvas folder in the checkout. Never pass
       `force`. A refusal (someone published in between) restarts this canvas at step 2.1.
3. Report each canvas published, skipped (drift) and failed.

## Deliverables (TDD: each test fails before its code exists)

1. `packages/tools/designArtifact/bin/canvasPublishPlan.ts`: for `origin/main`, lists per canvas the changed files since
   the marker sha and the expected sha256 of each file at the marker sha, and compares downloaded live files against
   them (`--check <dir>`). Unit tests with fixture repos: no change, change, drift, missing marker, deleted board.
2. Structural guard in `packages/tools/repoGuards`, extending `designCanvasRegistry.test.ts`:
    - every registry entry with source `repo-canvas` has a folder.
    - every board that a `canvas.json` references exists.
    - no file sits outside the artifact layout.
    - every HTML file parses.
3. Registry: screen canvases change `source` from `live` to `repo-canvas`, with a `folder` field.
4. `docs/design/canvases/README.md`: replace "How to edit a screen canvas" and "Bulk changes" with the workflow and the
   publish procedure above. Keep the comments and archive rules.
5. LOCAL e2e: point the board render at `docs/design/canvases/<id>/` for changed canvases.
6. Global, outside the repo (owner's `~/.claude`):
    - Hook `canvasPublishGuard.py` (PreToolUse `Artifact`): for a registered canvas URL (registry read from
      `origin/main`), deny `delete`, deny `force`, and deny a publish unless every file under `root` equals
      `git show origin/main:docs/design/canvases/<id>/<path>` and the marker names `origin/main`. Unregistered (preview)
      URLs pass. Owner override via `OWNER_SAID`. Self-test first.
    - Squad designer supplement (`~/.claude/hooks/squadRoleSupplements/designer.md`): replace the live-editing rules
      with this workflow, then regenerate the squad agent types.

## Order

1. Snapshot PR merged.
2. Deliverables 1, 2, 3, 5 in one PR, reviewed and merged.
3. Deliverable 4 (README) in the same PR, so the rules and the tooling land together.
4. Then, same day: wire the hook and switch the designer supplement. Before this point the hook stays unwired, because
   designers still edit live.
5. First publish from `main` by the designer, watched by the owner.

## Open questions

- Is a full-board re-render per PR affordable locally, or only changed boards? Default: changed boards only, and a full
  render before each publish.
- Preview artifacts accumulate: delete each after its PR merges (cleanup rule).
