"""The one source of the S4a Done row's action-group rule (designer D37): the two actions wrap as one group and stay
right-aligned, so at the largest text on a narrow row they stack instead of overflowing. Imported by buildS4aBoards.py
and by docs/design/canvases/scripts/s4aResumeCopy.py."""

DOCK_ACTS_CSS = '.dockActs { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 0 12px; margin-left: auto; }'
