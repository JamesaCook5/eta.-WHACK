"""Check recipe expansion, route selection and tiered station placement."""

import unittest
from pathlib import Path

from asteroid_industry.hierarchy import HierarchicalPlanner, _walk

ROOT = Path(__file__).resolve().parents[1]
ASTEROIDS = ROOT / "UI Skeleton" / "public" / "data" / "asteroids.json"


@unittest.skipUnless(ASTEROIDS.exists(), "asteroid table not present")
class HierarchyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.hierarchy = HierarchicalPlanner.from_files(ASTEROIDS, ROOT)

    def test_missing_process_quantities_fall_back_to_one(self):
        root = self.hierarchy.recipes.expand("steel")
        nodes = list(_walk(root))
        melt = next(node for node in nodes if node.material == "mfg_steel_melt")
        self.assertTrue(melt.recipe.quantities_inferred)
        self.assertEqual(melt.recipe.inputs["mfg_iron_feed"], 1.0)
        self.assertEqual(melt.recipe.outputs["mfg_steel_melt"], 1.0)

    def test_route_override_chooses_a_different_producer(self):
        route = {"mfg_iron_feed": "mfg_accept_Fe_from_magnetite"}
        root = self.hierarchy.recipes.expand("steel", route=route)
        iron = next(node for node in _walk(root) if node.material == "mfg_iron_feed")
        self.assertEqual(iron.process_id, "mfg_accept_Fe_from_magnetite")

    def test_steel_plan_produces_multiple_tiers(self):
        result = self.hierarchy.plan("steel", stations=2, trip_years=2.0)
        self.assertGreaterEqual(len(result["tiers"]), 2)
        self.assertEqual(len(result["tiers"][0]["stations"]), 2)
        self.assertTrue(result["stations"])
        self.assertGreater(result["tree"]["tier"], 0)
        for station in result["stations"]:
            self.assertIn("share", station)
            self.assertIn("a", station)
            self.assertIn("output", station)


if __name__ == "__main__":
    unittest.main()
