"""Tests for the native content converter and the native build check.

The converter turns a web-drawn phone or tablet board body into one that React Native (and so Tamagui) can draw:
flexbox only, no hover, no cursor, no backdrop blur, and the tamaguiAudit.md Part 5 rules (X1 to X4). The check
refuses a native board that still carries web-only CSS.
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bs4 import BeautifulSoup  # noqa: E402

from checkNative import check_native  # noqa: E402
from toNative import convert_body, convert_css  # noqa: E402


def rule(css: str, selector: str) -> str:
    start = css.index(selector + " {") + len(selector) + 2
    return css[start : css.index("}", start)]


class CssTest(unittest.TestCase):
    def test_centring_grid_becomes_a_centring_flex_box(self) -> None:
        css, _ = convert_css(".rd .avatar { width: 36px; display: grid; place-items: center; }", "ios")
        body = rule(css, ".rd .avatar")
        self.assertNotIn("grid", body)
        self.assertIn("display: flex", body)
        self.assertIn("align-items: center", body)
        self.assertIn("justify-content: center", body)

    def test_grid_without_columns_becomes_a_flex_column_and_keeps_its_gap(self) -> None:
        css, grids = convert_css(".rd .grid { display: grid; gap: 12px; }", "ios")
        body = rule(css, ".rd .grid")
        self.assertIn("display: flex", body)
        self.assertIn("flex-direction: column", body)
        self.assertIn("gap: 12px", body)
        self.assertEqual(grids, [])

    def test_a_rule_with_columns_is_handed_to_the_body_pass(self) -> None:
        css, grids = convert_css(".rd .nut { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }", "ios")
        self.assertNotIn("grid-template-columns", css)
        self.assertEqual(grids, [(".rd .nut", ["1fr", "1fr", "1fr", "1fr"], 8)])

    def test_web_only_effects_are_removed(self) -> None:
        source = (
            ".rd a { cursor: pointer; color: red; }\n"
            ".rd a:hover { color: blue; }\n"
            ".rd .bar { backdrop-filter: blur(20px); background: var(--bar); }\n"
            ".rd h1 { text-wrap: balance; }\n"
            ".rd .link { text-decoration-thickness: 1px; }\n"
            ".rd .btn:focus-visible { box-shadow: inset 0 0 0 2px var(--focus-ring); }\n"
            ".rd input:focus { box-shadow: inset 0 0 0 2px var(--focus-ring); }\n"
        )
        css, _ = convert_css(source, "ios")
        self.assertNotIn("cursor", css)
        self.assertNotIn(":hover", css)
        self.assertNotIn("backdrop-filter", css)
        self.assertIn("background: var(--paper-raised)", rule(css, ".rd .bar"))
        self.assertNotIn("balance", css)
        self.assertNotIn("thickness", css)
        self.assertNotIn(".btn:focus-visible", css)
        self.assertIn(".rd input:focus", css)

    def test_android_keeps_balanced_titles(self) -> None:
        css, _ = convert_css(".rd h1 { text-wrap: balance; }", "android")
        self.assertIn("balance", css)


class GridFormsTest(unittest.TestCase):
    def test_minmax_zero_to_one_fr_is_an_equal_column(self) -> None:
        _, grids = convert_css(".g { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }", "ios")
        self.assertEqual(grids, [(".g", ["1fr", "1fr", "1fr"], 8)])

    def test_auto_flow_column_is_one_row_of_equal_cells(self) -> None:
        css, grids = convert_css(".acts { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 10px; }", "ios")
        body = rule(css, ".acts")
        self.assertIn("flex-direction: row", body)
        self.assertIn("gap: 10px", body)
        self.assertNotIn("grid", body)
        self.assertEqual(grids, [(".acts", ["row"], 10)])

    def test_auto_fill_minmax_wraps_with_a_basis(self) -> None:
        css, grids = convert_css(
            ".n { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); column-gap: 16px; }", "ios"
        )
        body = rule(css, ".n")
        self.assertIn("flex-wrap: wrap", body)
        self.assertEqual(grids, [(".n", ["wrap:150"], 16)])

    def test_the_body_pass_sizes_row_and_wrap_children(self) -> None:
        soup = BeautifulSoup('<div class="a"><b>1</b><b>2</b></div><div class="n"><i>x</i></div>', "html.parser")
        convert_body(soup, [(".a", ["row"], 10), (".n", ["wrap:150"], 16)], {})
        self.assertIn("flex: 1 1 0%", soup.find("b")["style"])
        self.assertIn("flex: 1 1 150px", soup.find("i")["style"])


class BodyTest(unittest.TestCase):
    def test_equal_columns_become_rows_of_equal_cells(self) -> None:
        html = '<div class="grid" style="grid-template-columns: repeat(2, 1fr)"><a>1</a><a>2</a><a>3</a></div>'
        soup = BeautifulSoup(html, "html.parser")
        convert_body(soup, [], {"grid": 12})
        container = soup.find("div", class_="grid")
        self.assertNotIn("grid-template-columns", container["style"])
        rows = container.find_all("div", class_="nv-row", recursive=False)
        self.assertEqual(len(rows), 2)
        self.assertEqual([len(r.find_all(recursive=False)) for r in rows], [2, 2])
        spacer = rows[1].find_all(recursive=False)[1]
        self.assertIn("nv-spacer", spacer["class"])
        self.assertIn("gap: 12px", rows[0]["style"])

    def test_a_short_rows_spacer_has_the_same_box_as_its_cells(self) -> None:
        # A cell's padding and border sit on top of a 0 flex basis, so a bare spacer would leave the short row's
        # cells wider than a full row's. The spacer is an invisible copy of a cell, so every row shares one track.
        html = (
            '<div class="grid" style="grid-template-columns: repeat(3, 1fr)">'
            '<a class="tile" id="t1"><b>1</b></a><a class="tile">2</a><a class="tile">3</a><a class="tile">4</a></div>'
        )
        soup = BeautifulSoup(html, "html.parser")
        convert_body(soup, [], {"grid": 12})
        short = soup.find_all("div", class_="nv-row")[1]
        spacers = short.find_all(class_="nv-spacer", recursive=False)
        self.assertEqual(len(spacers), 2)
        for spacer in spacers:
            self.assertIn("tile", spacer["class"])
            self.assertIn("visibility: hidden", spacer["style"])
            self.assertEqual(spacer.get("aria-hidden"), "true")
            self.assertIsNone(spacer.find(id=True))
            self.assertIn("flex: 1 1 0%", spacer["style"])

    def test_a_rating_star_and_its_number_wrap_as_one_unit(self) -> None:
        html = '<p class="meta">1 h 50 min<span>·</span><svg class="star"><use href="#star"/></svg>4.8 (12) </p>'
        soup = BeautifulSoup(html, "html.parser")
        convert_body(soup, [], {})
        unit = soup.find("svg", class_="star").parent
        self.assertEqual(unit.name, "span")
        # One inline box that keeps the meta line's own gap between the star and the number.
        self.assertIn("display: inline-flex", unit["style"])
        self.assertIn("gap: inherit", unit["style"])
        self.assertNotIn("nowrap", unit["style"])
        self.assertEqual(unit.get_text().strip(), "4.8 (12)")
        self.assertEqual(soup.find("p").get_text().replace(" ", ""), "1h50min·4.8(12)")

    def test_a_single_row_does_not_get_wrapped(self) -> None:
        html = '<ol class="week" style="grid-template-columns: repeat(2, 1fr)"><li>a</li><li>b</li></ol>'
        soup = BeautifulSoup(html, "html.parser")
        convert_body(soup, [], {"week": 12})
        ol = soup.find("ol")
        self.assertEqual(len(ol.find_all("li", recursive=False)), 2)
        self.assertIn("flex-direction: row", ol["style"])

    def test_a_short_single_row_keeps_its_column_widths(self) -> None:
        html = '<ol class="week" style="grid-template-columns: repeat(4, 1fr)"><li>a</li><li>b</li></ol>'
        soup = BeautifulSoup(html, "html.parser")
        convert_body(soup, [], {"week": 12})
        ol = soup.find("ol")
        # The two spacers are hidden copies of a cell (see the spacer box test), so they are list items too.
        kids = ol.find_all(recursive=False)
        self.assertEqual([("nv-spacer" in k.get("class", [])) for k in kids], [False, False, True, True])

    def test_mixed_tracks_keep_their_kind(self) -> None:
        soup = BeautifulSoup('<div class="r"><p>a</p><b>b</b></div>', "html.parser")
        convert_body(soup, [(".r", ["1fr", "auto"], 8)], {})
        p, b = soup.find("p"), soup.find("b")
        self.assertIn("flex: 1 1 0%", p["style"])
        self.assertIn("flex: none", b["style"])


class CheckTest(unittest.TestCase):
    def test_a_clean_board_passes(self) -> None:
        self.assertEqual(check_native("<style>.a { display: flex; font: 600 16px/24px x; }</style>", "ios"), [])

    def test_web_only_css_is_refused(self) -> None:
        bad = {
            "display: grid": ".a { display: grid; }",
            ":hover": ".a:hover { color: red; }",
            "cursor": ".a { cursor: pointer; }",
            "backdrop-filter": ".a { backdrop-filter: blur(2px); }",
            "sticky": ".a { position: sticky; }",
            "fixed": ".a { position: fixed; }",
            "balance": ".a { text-wrap: balance; }",
            "thickness": ".a { text-decoration-thickness: 1px; }",
            "weight": ".a { font-weight: 700; }",
            "size": ".a { font-size: 15px; }",
        }
        for label, css in bad.items():
            with self.subTest(label=label):
                self.assertTrue(check_native(f"<style>{css}</style>", "ios"), label)

    def test_inline_grid_is_refused_too(self) -> None:
        self.assertTrue(check_native('<div style="grid-template-columns: 1fr 1fr"></div>', "ios"))


if __name__ == "__main__":
    unittest.main()
