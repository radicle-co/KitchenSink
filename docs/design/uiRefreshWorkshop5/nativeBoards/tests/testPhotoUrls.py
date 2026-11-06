"""Tests for splitScreens.photo_urls and unexplained_photo_urls: repoint only the photos the target canvas uploaded,
and flag any board photo URL that no upload explains."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "redesignCanvas"))

from splitScreens import photo_urls, unexplained_photo_urls  # noqa: E402

URLS = {
    "redesign": {"padThai.webp": "/_blob/r-pad", "cookies.webp": "/_blob/r-cookies"},
    "home": {"padThai.webp": "/_blob/h-pad", "cookies.webp": "/_blob/h-cookies", "pork.webp": "/_blob/h-pork"},
    "homeMobile": {"padThai.webp": "/_blob/m-pad"},
}


class PhotoUrlsTest(unittest.TestCase):
    def test_maps_every_other_canvas_url_for_a_photo_the_target_uploaded(self) -> None:
        mapping = photo_urls("homeMobile", URLS)
        self.assertEqual(mapping["/_blob/r-pad"], "/_blob/m-pad")
        self.assertEqual(mapping["/_blob/h-pad"], "/_blob/m-pad")

    def test_a_photo_the_target_did_not_upload_is_left_out_not_an_error(self) -> None:
        mapping = photo_urls("homeMobile", URLS)
        self.assertNotIn("/_blob/r-cookies", mapping)
        self.assertNotIn("/_blob/h-pork", mapping)

    def test_a_canvas_with_no_uploads_stops(self) -> None:
        with self.assertRaises(SystemExit):
            photo_urls("discoverMobile", URLS)

    def test_a_board_url_no_upload_explains_is_flagged(self) -> None:
        boards = ['<div style="background: url(/_blob/r-pad)"></div>', '<i style="background:url(/_blob/r-cookies)">']
        self.assertEqual(unexplained_photo_urls("homeMobile", boards, URLS), ["/_blob/r-cookies"])

    def test_the_targets_own_urls_are_explained(self) -> None:
        self.assertEqual(unexplained_photo_urls("homeMobile", ["url(/_blob/m-pad)"], URLS), [])


if __name__ == "__main__":
    unittest.main()
