# Design canvases

The Commise design system and the screen mockups are claude.ai artifacts. This folder is where every agent finds
them, and it holds the rules for editing them without losing another agent's work.

`registry.json` lists every canvas: its link, what it holds, its status and its source. It is the only list. Do not
copy links into other documents. Link to this folder instead. `designCanvasRegistry.test.ts` in `packages/tools/repoGuards`
checks its shape.

Each page and feature canvas has a folder here, named in its registry `folder` field. The folder is the canvas: its
`snapshot.json` records the link, the version first read and the time, and `project/` holds the files of the artifact.
The repository is the truth, and the published canvas is a copy that a publish from `main` refreshes. Never edit or
publish a registered screen canvas live.

## What each kind means

| Kind           | Meaning                                                             |
| -------------- | ------------------------------------------------------------------- |
| `designSystem` | The Design System: tokens, fonts and a card per component.          |
| `page`         | The screens of one page of the app, such as Home or Recipe detail.  |
| `feature`      | The screens of one feature, such as Meal planning or Grocery lists. |
| `unused`       | A canvas that holds nothing.                                        |

## What each status means

| Status    | Meaning                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------ |
| `current` | The canvas to read and edit. Every page and every feature has one web canvas and one mobile canvas.          |
| `archive` | An older canvas that holds web and mobile together. Do not make new changes there. Read it for history only. |
| `unused`  | A canvas that holds nothing. Do not use it.                                                                  |

The owner can still leave a comment on an archive canvas. Answer it in that thread. Make the change on the `current`
web and mobile canvases for the same subject, and say so in the reply.

## What each source means

| Source        | Where the truth lives                                | How to change it                                                                                                                                                                                 |
| ------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `repo`        | The repository. Only the Design System.              | Change `@commise/ui` or `packages/tools/designArtifact`, then follow "Regenerate the artifacts" in that package's README. Never edit the artifact directly: the next regeneration overwrites it. |
| `repo-canvas` | The entry's `folder` in this directory. All screens. | Edit the files in the folder on a branch, then publish from `main` (the sections below).                                                                                                         |
| `none`        | Nothing. Only an `unused` canvas.                    | Do not change it.                                                                                                                                                                                |

A screen canvas is a `page` or `feature` entry, current or archive. It has source `repo-canvas` and a `folder`, and no
other entry has either. `designCanvasRegistry.test.ts` and `designCanvasFolders.test.ts` in `packages/tools/repoGuards`
check both.

## Repo-source canvases (`repo-canvas`)

Every screen canvas follows this section. `docs/design/canvases/<folder>/` holds `snapshot.json` and `project/…`, the
files of the artifact. The repository folder is the truth.

Before you change a screen, find its `current` web and mobile canvases in `registry.json`. A change to a screen that
exists on both platforms goes on both canvases in the same PR. Read the comments on the canvas first, with the
`ArtifactComments` tool (`action: "read"`): an open owner comment can change what you are about to do.

### Edit

Work on a branch, in your own worktree, in `docs/design/canvases/<folder>/project/`. Never edit or publish a
registered canvas live. Start from the files in the repository, never from a copy saved earlier or from a build.
Never put `index.html`, `SKILL.md`, `artifact-type/` or `project/published.json` in the folder:
the artifact type owns the first three, and the publish writes the marker.

### Preview

To show work in progress, publish the branch files to an artifact that is not in the registry. Delete that artifact
after the PR merges.

### Check before merge

- The repo guards pass: `designCanvasRegistry.test.ts` and `designCanvasFolders.test.ts`.
- The LOCAL e2e renders every changed board in light and dark:
  `DESIGN_CANVAS_RUNTIME=<runtime file> npm run test:e2e:canvases --workspace=packages/tools/designArtifact`. It picks the folders
  changed against `origin/main`. `CANVASES=all` renders every canvas, and you run it before a publish. `CANVASES=id,id`
  renders the ones you name. The runtime is the `artifact-type/dc-runtime.js` of any Design canvas artifact, read with
  the `Artifact` tool. Never commit it.
- The designer approves the PR.

### Publish from main

Run these after `git fetch origin main`. Only the `Artifact` tool can read and publish. `stage` writes `main`'s blobs
from git, so the work tree needs no cleaning.

0. **Marker.** For each `repo-canvas` entry, read `project/published.json` with the `Artifact` tool
   (`action: "read"`) into `<dir>/<folder>/project/`. A canvas that was never published from the repo has none, so skip
   the read. Without the marker the baseline falls back to the snapshot. Also save the `action: "list"` result as a
   JSON array of paths (`<list.json>`): `check` and `stage` exit 2 when it names the marker and it was not downloaded.
1. **Plan.** `npm run canvas:publishPlan --workspace=packages/tools/designArtifact -- plan --live <dir>`. It prints,
   for each `repo-canvas` entry, the baseline (the live marker, or the snapshot commit when there is no marker), the
   changed and deleted paths, and what to download. Skip a canvas with status `unchanged` and a `marker` baseline. A
   canvas with a `snapshot` baseline downloads every baseline path, even when it is `unchanged`.
2. **Read.** For each canvas, download the paths in `download` with the `Artifact` tool (`action: "read"`) into
   `<dir>/<folder>/`.
3. **Check.** `… -- check <id> --main <sha> --live <dir> --list <list.json>`. `<sha>` is the `main.sha` that `plan`
   printed (the `origin/main` tip). Exit 0 is clean. A live file passes when it equals the baseline or `main`. Exit 1
   is drift: stop and follow "Drift". Exit 2 is bad input, or a `<sha>` behind the tip whose canvas changed since.
4. **Stage.** `… -- stage <id> --main <sha> --live <dir> --list <list.json> --out <out>`. It checks again, writes the
   `main` blobs from git (a dirty work tree cannot leak in) and the marker under `<out>`, never in the repository, and
   prints `url`, `root`, `file_path`, `files` and `label` for the publish. When the marker already names `main` it
   prints nothing and exits 0: there is nothing to publish.
5. **Publish.** Pass `url`, `root`, `file_path`, `files` and `label` to the `Artifact` tool unchanged. `file_path` is
   the marker, `project/published.json`: the tool needs one of the canvas's own data files there. `files` is the dict
   form, and a deletion is `null`. It is empty when only the marker changes. The label is
   `canvas <baseline>..<main>`, with 12-character commit prefixes so it fits the tool's 60-character limit. It lets a
   reviewer confirm the publish covers every path that changed between the two commits. The tool refuses a publish
   until this session has read the canvas itself (`action: "read"` with only the `url`), because reads of single
   paths do not count. If it refuses for that reason, do that read and publish again unchanged. For any other
   refusal, restart at step 0 for that canvas. Never pass `force`.

### Drift

The check found a live edit that the repository does not have. This is the one case where a live file matters: import
the live files into the folder in a PR titled `canvas drift: <id>`, merge it, then publish. After that merge the live
file equals `main`, so the check passes.

### Rollback

`git revert` the merge on `main`, then publish.

## Comments

Claude can reply to and resolve only a thread that a person sent to Claude ("Send to Claude", or `@claude` in the
thread). A comment wakes a session only while that session watches the canvas. If you are working on a canvas, start
a watch with `ArtifactComments` (`action: "watch"`) so new comments reach you while you work.

## When a canvas is created, renamed or retired

Update `registry.json` in the same change. A canvas that is not in the registry does not exist for other agents. A new
screen canvas gets `source: "repo-canvas"` and a `folder` of letters and digits that no other entry uses. Create it by
adding the folder (`snapshot.json` and `project/canvas.json` at least), then publish it to a new artifact and put its
link in the entry. A rename changes the `id` and keeps the `folder`, so the history stays with the files. To retire a
canvas, set its `status` to `archive` or `unused`.
