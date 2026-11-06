"""Tests for a redesign phone page that draws its own page padding: a `.pg` with the iPhone's 60 px status gap baked
in, 16 px sides and room under the list, and a floating button placed above the tab bar it drew itself.

The native frame already pads the screen (the inset plus 16 on top, 16 at the sides, T31) and pins its own tab bar
outside the page, so the page's own padding doubled the sides to 32 and left the button 96 above the page's end,
on top of the last card. The page must end with 88 of room under a floating button (56 + its 16 margin + 16)."""

import re
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bs4 import BeautifulSoup  # noqa: E402

import buildNativeBoards as build  # noqa: E402

PAGE = "phonePageTestPage"
BOARD = """<!doctype html><html><head></head><body><x-dc><helmet><style>.x { color: red; }</style></helmet>
<div class="rd"><div class="shell"><div class="pg" style="padding: 60px 16px 104px"><p>list</p></div>
<a class="fab abs" href="#" style="right: 16px; bottom: 96px; z-index: 3">New</a>{tabbar}</div></div>
</x-dc></body></html>
"""
TABBAR = '<nav class="tabbar"><a class="tab on">Recipes</a></nav>'


class PhonePageTest(unittest.TestCase):
    def setUp(self) -> None:
        self.dir = tempfile.TemporaryDirectory()
        self.project = Path(self.dir.name)
        (self.project / "ListMobile.dc.html").write_text(BOARD.replace("{tabbar}", TABBAR))
        (self.project / "PlainMobile.dc.html").write_text(BOARD.replace("{tabbar}", TABBAR).replace(' class="fab abs" href="#" style="right: 16px; bottom: 96px; z-index: 3">New', ' href="#">Link'))
        build.LAYOUTS[PAGE] = {}

    def tearDown(self) -> None:
        build.LAYOUTS.pop(PAGE, None)
        self.dir.cleanup()

    def soup(self, state: str) -> BeautifulSoup:
        built = build.native_board(self.project, PAGE, state, "Iphone390", build.DEVICES["Iphone390"], [])
        return BeautifulSoup(built["inner"], "html.parser")

    def test_the_page_pads_once_at_16_and_ends_with_88_under_the_floating_button(self) -> None:
        soup = self.soup("List")
        self.assertNotIn("padding", soup.select_one(".pg").get("style", ""))
        shell = soup.select_one(".shell")["style"]
        self.assertRegex(shell, r"padding: \d+px 16px 88px")

    def test_the_floating_button_sits_16_above_the_page_end(self) -> None:
        self.assertRegex(self.soup("List").select_one(".fab")["style"], r"bottom: 16px")

    def test_a_page_with_no_floating_button_keeps_the_usual_end(self) -> None:
        self.assertRegex(self.soup("Plain").select_one(".shell")["style"], r"padding: \d+px 16px 24px")


if __name__ == "__main__":
    unittest.main()
