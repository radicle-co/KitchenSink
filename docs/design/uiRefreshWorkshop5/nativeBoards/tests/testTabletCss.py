"""Tests for `tabletCss`: a page's hand-designed iPad rules for a state that has no tablet board of its own.

Without a rule, such a state keeps the holding layout: the phone layout in one centred 640 column. With a rule (by
state prefix, the longest prefix wins), the iPad board drops that column and takes the rule's CSS instead, so the page
can lay the state out at the iPad's full width. The rule is iPad-only: the phone boards must not change.
"""

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import buildNativeBoards as build  # noqa: E402

PAGE = "tabletCssTestPage"
LEGACY_BOARD = """<!doctype html><html><head></head><body><x-dc><helmet><style>
body { margin: 0; width: 390px; }
.crop { width: 390px; padding: 16px; }
</style></helmet>
<div class="pg"><div class="fg"><p class="cap">A state.</p><div class="crop"><p>Content</p></div></div></div>
</x-dc></body></html>
"""


class TabletCssTest(unittest.TestCase):
    def setUp(self) -> None:
        self.dir = tempfile.TemporaryDirectory()
        self.project = Path(self.dir.name)
        for state in ("Thing", "ThingStates", "Other"):
            (self.project / f"{state}Mobile.dc.html").write_text(LEGACY_BOARD)
        self.saved = build.LAYOUTS.get(PAGE)

    def tearDown(self) -> None:
        if self.saved is None:
            build.LAYOUTS.pop(PAGE, None)
        else:
            build.LAYOUTS[PAGE] = self.saved
        self.dir.cleanup()

    def board(self, state: str, device: str, layout: dict) -> dict:
        build.LAYOUTS[PAGE] = layout
        return build.native_board(self.project, PAGE, state, device, build.DEVICES[device], [])

    def test_a_state_with_a_rule_drops_the_holding_column_on_the_ipad(self) -> None:
        built = self.board("Thing", "Ipad820", {"tabletCss": {"Thing": ".crop { padding-right: 99px; }"}})
        self.assertEqual(built["strategy"], "tablet css")
        self.assertNotIn(f"max-width: {build.CONTENT_COLUMN}px", built["inner"])
        self.assertIn(".crop { padding-right: 99px; }", built["css"])

    def test_a_state_without_a_rule_keeps_the_holding_column(self) -> None:
        built = self.board("Other", "Ipad820", {"tabletCss": {"Thing": ".crop { padding-right: 99px; }"}})
        self.assertEqual(built["strategy"], "centred column")
        self.assertIn(f"max-width: {build.CONTENT_COLUMN}px", built["inner"])
        self.assertNotIn("99px", built["css"])

    def test_the_longest_matching_prefix_wins(self) -> None:
        layout = {"tabletCss": {"Thing": ".crop { color: red; }", "ThingStates": ".crop { color: blue; }"}}
        built = self.board("ThingStates", "Ipad820", layout)
        self.assertIn("color: blue", built["css"])
        self.assertNotIn("color: red", built["css"])

    def test_a_keyboard_board_is_looked_up_by_its_own_name(self) -> None:
        build.LAYOUTS[PAGE] = {"tabletCss": {"Thing": ".a { color: red; }", "ThingTyping": ".a { color: blue; }"}}
        typing = {"state": "Thing", "name": "ThingTyping", "title": "typing"}
        built = build.native_board(self.project, PAGE, "Thing", "Ipad820", build.DEVICES["Ipad820"], [], typing)
        self.assertIn("color: blue", built["css"])
        self.assertNotIn("color: red", built["css"])

    def test_the_phone_boards_do_not_change(self) -> None:
        rule = {"tabletCss": {"Thing": ".crop { padding-right: 99px; }"}}
        for device in ("Iphone390", "Android384"):
            with self.subTest(device=device):
                self.assertEqual(self.board("Thing", device, rule), self.board("Thing", device, {}))

    def test_a_state_with_its_own_tablet_board_also_takes_the_rule(self) -> None:
        (self.project / "Thing834Mobile.dc.html").write_text(LEGACY_BOARD)
        built = self.board("Thing", "Ipad820", {"tabletCss": {"Thing": ".crop { padding-right: 99px; }"}})
        self.assertEqual(built["strategy"], "own tablet board")
        self.assertIn(".crop { padding-right: 99px; }", built["css"])


if __name__ == "__main__":
    unittest.main()
