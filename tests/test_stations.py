"""Check the station planner: k-means invariants, output accounting and the Monte Carlo."""

import base64
import unittest
from pathlib import Path

import numpy as np

from asteroid_industry.stations import StationPlanner, _assign, _lloyd

ROOT = Path(__file__).resolve().parents[1]
ASTEROIDS = ROOT / "UI Skeleton" / "public" / "data" / "asteroids.json"


class KMeansTests(unittest.TestCase):
    def test_every_point_ends_at_its_nearest_weighted_centre(self):
        rng = np.random.default_rng(0)
        X = np.concatenate([rng.normal(c, 0.1, (200, 5)) for c in (0.0, 1.0, 2.0)])
        w = rng.uniform(0.5, 2.0, len(X))
        C, labels, _ = _lloyd(X, w, X[[0, 250, 500]].copy(), 100)
        np.testing.assert_array_equal(labels, _assign(X, C))
        for c in range(3):
            members = labels == c
            np.testing.assert_allclose(C[c], (w[members, None] * X[members]).sum(0) / w[members].sum())

    def test_exact_ties_go_to_the_later_station(self):
        X = np.zeros((1, 5))
        C = np.array([[1.0, 0, 0, 0, 0], [-1.0, 0, 0, 0, 0]])
        self.assertEqual(_assign(X, C)[0], 1)


@unittest.skipUnless(ASTEROIDS.exists(), "asteroid table not present")
class PlannerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.planner = StationPlanner.from_files(ASTEROIDS, ROOT)

    def decode(self, text):
        return np.frombuffer(base64.b64decode(text), dtype=np.uint8)

    def test_every_planned_asteroid_belongs_to_exactly_one_station(self):
        result = self.planner.plan("steel", stations=4, draws=0)
        assignment = self.decode(result["assignment"])
        planned = assignment < 255
        self.assertEqual(planned.sum(), sum(s["members"] for s in result["stations"]))
        self.assertFalse(planned[self.planner.asteroids.outer].any())  # outer bodies excluded by default
        self.assertAlmostEqual(sum(s["share"] for s in result["stations"]), 1.0, places=9)

    def test_output_is_what_the_assigned_asteroids_hold(self):
        p = self.planner
        result = p.plan("titanium", stations=3, draws=0)
        assignment = self.decode(result["assignment"])
        e = p.sampling.elements.index("Fe")
        rows = np.flatnonzero((assignment == 0) & (p.scenario >= 0))
        expected = (p.mass[rows] * p.sampling.grade[p.scenario[rows], e] / 1000).sum()
        self.assertAlmostEqual(result["stations"][0]["output"][e] / expected, 1.0, places=9)

    def test_monte_carlo_gives_ranges_around_the_nominal_plan(self):
        result = self.planner.plan("steel", stations=3, draws=200)
        self.assertEqual(result["draws"], 200)
        for station in result["stations"]:
            r = station["ranges"]
            self.assertLessEqual(r["share"]["lo"], r["share"]["hi"])
            self.assertTrue(r["a"]["lo"] - 0.05 <= station["a"] <= r["a"]["hi"] + 0.05)
            self.assertEqual(len(r["output"]), len(result["elements"]))
        self.assertEqual(len(result["cloud"]), 3)
        self.assertEqual(len(result["cloud"][0]), 2 * 200)

    def test_products_without_asteroid_inputs_return_no_stations(self):
        result = self.planner.plan("polyimide", stations=3)
        self.assertEqual(result["stations"], [])
        self.assertIsNone(result["assignment"])


if __name__ == "__main__":
    unittest.main()
