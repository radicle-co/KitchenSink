# Canvas scripts

Each script in this folder is the record of one merged change across many board files in `docs/design/canvases/`. A
script is a record, like a database migration. It is not a tool.

## Rules

- Name a script `draw<yyyymmdd><Change>.py`. The date is the day the boards were drawn. A data file that the script
  reads takes the same stem, for example `draw20261117U9BoardsHeights.json`.
- Run a script once, from the repository root, on the parent commit of its pull request. It reproduces its change only
  from that commit. Do not run it on a later `main`.
- Nothing imports a script. Do not edit a script after its pull request merges.
- A script must pass the root ruff configuration (`pyproject.toml`) at merge.
- Commit a script in the same pull request as the boards it draws. Its docstring names that pull request and the
  parent commit.
  The first script, `draw20261117U9Boards.py`, is the one exception. It was added after its boards merged (#358), and it
  was admitted only because it reproduced #358's boards byte for byte, as the pull request that added it records. It
  was run with Python 3.10.12.
- The reusable board builders stay in `docs/design/uiRefreshWorkshop5/redesignCanvas/`. This folder holds only frozen
  one-time change records.

## Review

The reviewer runs the script on the parent commit and compares its output with the boards in the pull request. Every
board and `canvas.json` file must be byte-identical. If a board was fixed by hand after the script ran, the script is
not a true record: fix the script, or leave it out of the pull request.
