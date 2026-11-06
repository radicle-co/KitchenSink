"""Tests for redesignCanvas/boardNames.py: one parse, one legacy-to-new map, no default case.

Run from the repo root: python3 -m unittest discover -s docs/design/uiRefreshWorkshop5/nativeBoards/tests -p 'test*.py'
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "redesignCanvas"))

from boardNames import BoardName, BoardNameError, legacy_to_new, parse  # noqa: E402


class ParseTest(unittest.TestCase):
    def test_every_platform_parses(self) -> None:
        self.assertEqual(parse("HomeWeb1280"), BoardName("Home", "Web", 1280))
        self.assertEqual(parse("HomeEmptyIphone390.dc.html"), BoardName("HomeEmpty", "Iphone", 390))
        self.assertEqual(parse("HomeAndroid384"), BoardName("Home", "Android", 384))
        self.assertEqual(parse("HomeIpad820"), BoardName("Home", "Ipad", 820))

    def test_a_name_without_a_width_is_refused(self) -> None:
        for bad in ("HomeWeb", "Home", "HomeMobile", "Home834Mobile", "home-web1280", "HomeTablet820"):
            with self.subTest(bad=bad), self.assertRaises(BoardNameError):
                parse(bad)

    def test_platform_word_inside_the_state_does_not_confuse_the_parse(self) -> None:
        self.assertEqual(parse("ImportWebLinkWeb768"), BoardName("ImportWebLink", "Web", 768))

    def test_render_round_trips(self) -> None:
        name = BoardName("CookingModeDone", "Ipad", 820)
        self.assertEqual(parse(name.file), name)
        self.assertEqual(name.file, "CookingModeDoneIpad820.dc.html")

    def test_family_is_web_or_mobile(self) -> None:
        self.assertEqual(parse("HomeWeb390").family, "web")
        self.assertEqual(parse("HomeIphone390").family, "mobile")
        self.assertEqual(parse("HomeAndroid384").family, "mobile")


class DigitsInTheStateTest(unittest.TestCase):
    def test_a_state_may_end_in_a_number(self) -> None:
        self.assertEqual(parse("CookWithMeAgeUnder16Web390"), BoardName("CookWithMeAgeUnder16", "Web", 390))
        self.assertEqual(parse("CookWithMeAgeUnder16Ipad820"), BoardName("CookWithMeAgeUnder16", "Ipad", 820))

    def test_legacy_names_with_a_number_in_the_state(self) -> None:
        self.assertEqual(legacy_to_new("CookWithMeAgeUnder16.dc.html"), "CookWithMeAgeUnder16Web1280.dc.html")
        self.assertEqual(legacy_to_new("CookWithMeAgeUnder16Mobile.dc.html"), "CookWithMeAgeUnder16Web390.dc.html")
        self.assertIsNone(legacy_to_new("CookWithMeAgeUnder16834Mobile.dc.html"))
        self.assertIsNone(legacy_to_new("CookWithMeAgeUnder161194Mobile.dc.html"))


class LegacyTest(unittest.TestCase):
    def test_web_sizes_map_to_explicit_widths(self) -> None:
        self.assertEqual(legacy_to_new("Home.dc.html"), "HomeWeb1280.dc.html")
        self.assertEqual(legacy_to_new("Home1024.dc.html"), "HomeWeb1024.dc.html")
        self.assertEqual(legacy_to_new("HomeTwoSessions768.dc.html"), "HomeTwoSessionsWeb768.dc.html")

    def test_the_phone_board_becomes_the_web_phone_board(self) -> None:
        self.assertEqual(legacy_to_new("HomeMobile.dc.html"), "HomeWeb390.dc.html")

    def test_retired_and_source_only_boards_map_to_nothing(self) -> None:
        # The legacy 390 web boards lost the owner decisions; the tablet boards are only content sources now.
        for name in ("Home390.dc.html", "Home834Mobile.dc.html", "Home1194Mobile.dc.html"):
            with self.subTest(name=name):
                self.assertIsNone(legacy_to_new(name))


if __name__ == "__main__":
    unittest.main()
