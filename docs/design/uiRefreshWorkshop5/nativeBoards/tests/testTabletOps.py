"""Tests for the tablet ops on the redesign's `.rd` boards: which state's rules apply (the longest state prefix wins,
as for `tabletCss`), and the `remove` and `insertFrom` ops a page uses to move a phone control where the iPad board
draws it (for example the New recipe button from a floating button into the search row)."""

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bs4 import BeautifulSoup  # noqa: E402

import buildNativeBoards as build  # noqa: E402

PAGE = "tabletOpsTestPage"
PHONE = """<!doctype html><html><head></head><body><x-dc><helmet><style>.x { color: red; }</style></helmet>
<div class="rd"><div class="shell"><div class="pg"><div class="srow"><div class="field">q</div></div>
<div class="grid"><a class="tile">1</a></div></div><a class="fab">New</a></div></div>
</x-dc></body></html>
"""
TABLET = PHONE.replace('<div class="field">q</div>', '<div class="field">q</div><a class="btn primary">New</a>')


class TabletOpsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.dir = tempfile.TemporaryDirectory()
        self.project = Path(self.dir.name)
        for state in ("ListLoading", "ListError", "Other"):
            (self.project / f"{state}Mobile.dc.html").write_text(PHONE)
        (self.project / "List834Mobile.dc.html").write_text(TABLET)
        self.saved = build.LAYOUTS.get(PAGE)

    def tearDown(self) -> None:
        if self.saved is None:
            build.LAYOUTS.pop(PAGE, None)
        else:
            build.LAYOUTS[PAGE] = self.saved
        self.dir.cleanup()

    def board(self, state: str, layout: dict) -> BeautifulSoup:
        build.LAYOUTS[PAGE] = layout
        built = build.native_board(self.project, PAGE, state, "Ipad820", build.DEVICES["Ipad820"], [])
        self.strategy = built["strategy"]
        return BeautifulSoup(built["inner"], "html.parser")

    def test_rules_apply_by_the_longest_state_prefix(self) -> None:
        layout = {"tablet": {"List": [{"op": "columns", "select": ".grid", "n": 2}],
                             "ListError": [{"op": "columns", "select": ".grid", "n": 3}]}}
        # The converter draws an n-column grid as one flex row with n cells (the tile plus spacers).
        cells = lambda soup: len(soup.select_one(".grid").find_all(recursive=False))  # noqa: E731
        self.assertEqual(cells(self.board("ListLoading", layout)), 2)
        self.assertEqual(self.strategy, "tablet rules")
        self.assertEqual(cells(self.board("ListError", layout)), 3)

    def test_a_state_no_prefix_names_keeps_the_holding_column(self) -> None:
        self.board("Other", {"tablet": {"List": [{"op": "columns", "select": ".grid", "n": 2}]}})
        self.assertEqual(self.strategy, "centred column")

    def test_remove_drops_every_match(self) -> None:
        soup = self.board("ListLoading", {"tablet": {"List": [{"op": "remove", "select": ".fab"}]}})
        self.assertIsNone(soup.select_one(".fab"))

    def test_insert_from_appends_the_tablet_boards_element_into_the_target(self) -> None:
        op = {"op": "insertFrom", "board": "List834Mobile", "select": ".srow > a.btn", "into": ".srow"}
        soup = self.board("ListLoading", {"tablet": {"List": [op]}})
        row = soup.select_one(".srow")
        self.assertEqual([c.get("class") for c in row.find_all(recursive=False)], [["field"], ["btn", "primary"]])
        self.assertEqual(row.select_one(".field").get_text(), "q")

    def test_insert_from_reaches_every_target_on_a_board_of_examples(self) -> None:
        (self.project / "ListLoadingMobile.dc.html").write_text(PHONE.replace('<div class="grid">', '<div class="srow"></div><div class="grid">'))
        op = {"op": "insertFrom", "board": "List834Mobile", "select": ".srow > a.btn", "into": ".srow"}
        soup = self.board("ListLoading", {"tablet": {"List": [op]}})
        self.assertEqual(len(soup.select(".srow > a.btn")), 2)

    def test_copy_from_with_a_target_replaces_that_element_instead(self) -> None:
        op = {"op": "copyFrom", "board": "List834Mobile", "select": ".srow > a.btn", "target": ".grid"}
        soup = self.board("ListLoading", {"tablet": {"List": [op]}})
        self.assertIsNone(soup.select_one(".grid"))
        self.assertEqual(soup.select_one(".pg > a.btn").get_text(), "New")

    def test_insert_from_stops_when_the_source_is_missing(self) -> None:
        op = {"op": "insertFrom", "board": "List834Mobile", "select": ".nothing", "into": ".srow"}
        with self.assertRaises(SystemExit):
            self.board("ListLoading", {"tablet": {"List": [op]}})

    def test_style_from_takes_each_boards_missing_rules_and_the_first_board_wins(self) -> None:
        (self.project / "A834Mobile.dc.html").write_text(PHONE.replace(".x { color: red; }", ".a { color: blue; } .b { color: green; }"))
        (self.project / "B834Mobile.dc.html").write_text(PHONE.replace(".x { color: red; }", ".b { color: pink; } .c { color: gray; }"))
        build.LAYOUTS[PAGE] = {"tabletSource": {"styleFrom": ["A834Mobile", "B834Mobile"]}, "tablet": {"List": []}}
        css = build.native_board(self.project, PAGE, "ListLoading", "Ipad820", build.DEVICES["Ipad820"], [])["css"]
        self.assertIn("color: blue", css)
        self.assertIn("color: green", css)
        self.assertIn("color: gray", css)
        self.assertNotIn("color: pink", css)
        self.assertEqual(css.count(".x {"), 1)

    def test_group_wraps_the_selected_siblings_in_a_new_element_in_place(self) -> None:
        op = {"op": "group", "select": [".pg > .srow", ".pg > .grid"], "class": "duo"}
        soup = self.board("ListLoading", {"tablet": {"List": [op]}})
        pg = soup.select_one(".pg")
        self.assertEqual([c.get("class") for c in pg.find_all(recursive=False)], [["duo"]])
        self.assertEqual([c.get("class")[0] for c in pg.select_one(".duo").find_all(recursive=False)], ["srow", "grid"])

    def test_a_legacy_board_takes_its_tablet_ops_too(self) -> None:
        legacy = PHONE.replace('<div class="rd">', '<div class="legacyRoot">').replace(
            '<div class="grid">', '<div class="grid" style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr))">'
        ).replace('<a class="tile">1</a>', '<x-import component-from-global-scope="Commise.Native.Card" variant="compact"></x-import>')
        (self.project / "ListErrorMobile.dc.html").write_text(legacy)
        ops = [
            {"op": "columns", "select": ".grid", "n": 3},
            {"op": "attr", "select": "x-import[variant=compact]", "name": "variant", "value": "grid"},
        ]
        soup = self.board("ListError", {"tablet": {"List": ops}})
        self.assertEqual(self.strategy, "tablet rules")
        self.assertNotIn(f"max-width: {build.CONTENT_COLUMN}px", str(soup))
        self.assertEqual(len(soup.select_one(".grid").find_all(recursive=False)), 3)
        self.assertEqual(soup.select_one("x-import")["variant"], "grid")

    def test_wrap_each_puts_every_match_in_its_own_box(self) -> None:
        op = {"op": "wrapEach", "select": ".grid > a.tile", "style": "min-width: 0"}
        soup = self.board("ListLoading", {"tablet": {"List": [op]}})
        tile = soup.select_one("a.tile")
        self.assertEqual(tile.parent.name, "div")
        self.assertIn("min-width: 0", tile.parent["style"])
        self.assertEqual(tile.parent.parent.get("class"), ["grid"])

    def test_tablet_own_ops_reach_a_states_own_tablet_board_and_tablet_ops_do_not(self) -> None:
        (self.project / "ListMobile.dc.html").write_text(PHONE)
        layout = {
            "tablet": {"List": [{"op": "remove", "select": ".fab"}]},
            "tabletOwn": {"List": [{"op": "columns", "select": ".grid", "n": 3}]},
        }
        soup = self.board("List", layout)
        self.assertEqual(self.strategy, "own tablet board")
        self.assertEqual(len(soup.select_one(".grid").find_all(recursive=False)), 3)
        self.assertIsNotNone(soup.select_one(".fab"))

    def test_tablet_own_ops_reach_the_tablet_board_under_an_overlay(self) -> None:
        (self.project / "ListSortMobile.dc.html").write_text(PHONE.replace('<a class="fab">New</a>', '<a class="fab">New</a><div class="scrim"></div><div class="sheet">s</div>'))
        layout = {"tabletBase": {"ListSort": "List834Mobile"}, "tabletOwn": {"List": [{"op": "columns", "select": ".grid", "n": 3}]}}
        soup = self.board("ListSort", layout)
        self.assertTrue(self.strategy.startswith("overlay on"))
        self.assertEqual(len(soup.select_one(".grid").find_all(recursive=False)), 3)

    def test_insert_html_places_markup_after_the_target(self) -> None:
        op = {"op": "insertHtml", "after": ".srow > .field", "html": '<a class="btn">New</a>'}
        soup = self.board("ListLoading", {"tablet": {"List": [op]}})
        self.assertEqual([c.get("class") for c in soup.select_one(".srow").find_all(recursive=False)], [["field"], ["btn"]])

    def test_group_within_repeats_in_every_matching_container(self) -> None:
        two = PHONE.replace('<div class="rd"><div class="shell"><div class="pg">', '<div class="rd"><div class="shell"><div class="ex"><div class="pg">').replace(
            '</div><a class="fab">', '</div></div><div class="ex"><div class="pg"><div class="srow">b</div><div class="grid">g</div></div></div><a class="fab">', 1)
        (self.project / "ListLoadingMobile.dc.html").write_text(two)
        op = {"op": "group", "within": ".ex .pg", "select": [":scope > .srow", ":scope > .grid"], "class": "duo"}
        soup = self.board("ListLoading", {"tablet": {"List": [op]}})
        self.assertEqual(len(soup.select(".pg > .duo")), 2)
        for duo in soup.select(".duo"):
            self.assertEqual([c.get("class")[0] for c in duo.find_all(recursive=False)], ["srow", "grid"])

    def test_insert_html_can_place_markup_before_the_target(self) -> None:
        op = {"op": "insertHtml", "before": ".srow", "html": '<div class="navRow">n</div>'}
        soup = self.board("ListLoading", {"tablet": {"List": [op]}})
        self.assertEqual([c.get("class")[0] for c in soup.select_one(".pg").find_all(recursive=False)][:2], ["navRow", "srow"])

    def test_tablet_board_names_another_board_as_a_states_ipad_source(self) -> None:
        (self.project / "Other834Mobile.dc.html").write_text(TABLET.replace('<div class="field">q</div>', '<div class="field">other</div>'))
        layout = {"tabletBoard": {"ListError": "Other834Mobile"}, "tabletOwn": {"ListError": [{"op": "remove", "select": ".fab"}]}}
        soup = self.board("ListError", layout)
        self.assertEqual(self.strategy, "own tablet board")
        self.assertEqual(soup.select_one(".field").get_text(), "other")
        self.assertIsNone(soup.select_one(".fab"))

    def test_insert_html_stops_when_its_target_is_missing(self) -> None:
        op = {"op": "insertHtml", "after": ".nothing", "html": "<a>x</a>"}
        with self.assertRaises(SystemExit):
            self.board("ListLoading", {"tablet": {"List": [op]}})


if __name__ == "__main__":
    unittest.main()
