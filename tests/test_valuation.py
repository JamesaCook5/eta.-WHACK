"""Check that supply valuation preserves deficits, units and uncertainty draws."""

import json
import unittest
from pathlib import Path

import numpy as np

from asteroid_industry.valuation import (
    assess_supply, capped_inventory_utility, fixed_benchmarks, mineral_content_matrix, profile_weights,
)
from visualise_constituents import assess_catalogue


ROOT = Path(__file__).resolve().parents[1]


class UtilityTests(unittest.TestCase):
    def test_surplus_of_one_resource_does_not_cover_another_missing_resource(self):
        self.assertEqual(capped_inventory_utility({"Fe": 1e9}, {"Fe": 1, "Li": 1}), 0.5)

    def test_missing_constituents_remain_in_the_denominator(self):
        value = capped_inventory_utility({"Fe": 1, "C": 1}, {"Fe": 1, "C": 1, "Cu": 1, "Li": 1})
        self.assertEqual(value, 0.5)

    def test_zero_and_complete_supply_have_exact_endpoints(self):
        demand = {"Fe": 2, "C": 3}
        self.assertEqual(capped_inventory_utility({}, demand), 0)
        self.assertEqual(capped_inventory_utility(demand, demand), 1)

    def test_complementary_suppliers_are_aggregated_before_scoring(self):
        demand = {"Fe": 1, "C": 1}
        suppliers = [{"Fe": 1}, {"C": 1}]
        combined = {e: sum(s.get(e, 0) for s in suppliers) for e in demand}
        self.assertEqual(capped_inventory_utility(combined, demand), 1)
        self.assertEqual(capped_inventory_utility(suppliers[0], demand), 0.5)

    def test_invalid_inventory_demand_and_weights_are_rejected(self):
        for inventory, demand, weights in [({"Fe": -1}, {"Fe": 1}, None),
                                            ({"Fe": 1}, {"Fe": 0}, None),
                                            ({"Fe": 1}, {"Fe": 1}, {"Fe": 0})]:
            with self.assertRaises(ValueError):
                capped_inventory_utility(inventory, demand, weights)


class ProfileTests(unittest.TestCase):
    def test_each_family_receives_a_share_before_its_constituents(self):
        profiles = {"p": {"parts": [{"name": "pair", "inputs": ["Fe", "Li"]},
                                    {"name": "single", "inputs": ["C"]}]}}
        self.assertEqual(profile_weights("p", profiles), {"C": 0.5, "Fe": 0.25, "Li": 0.25})

    def test_bulk_metals_is_the_equal_weight_mean_of_the_three_metal_profiles(self):
        profiles = json.loads((ROOT / "industrial_input_profiles.json").read_text())["profiles"]
        combined = profile_weights("bulk_metals", profiles)
        children = [profile_weights(key, profiles) for key in ("aluminium", "steel", "titanium")]
        for element in combined:
            self.assertAlmostEqual(combined[element], sum(child.get(element, 0) for child in children) / 3)
        self.assertAlmostEqual(sum(combined.values()), 1)

    def test_reference_material_ids_exist_in_the_manufacturing_dag(self):
        profiles = json.loads((ROOT / "industrial_input_profiles.json").read_text())["profiles"]
        materials = json.loads((ROOT / "Space_Industrial_Manufacturing_DAG.json").read_text())["materials"]
        for profile in profiles.values():
            for part in profile.get("parts", []):
                self.assertTrue(set(part["material_ids"]) <= materials.keys())


class CompositionScoreTests(unittest.TestCase):
    def setUp(self):
        self.index = {"mineral_catalogue": {
            "iron": {"typical_yield_wt_pct": {"Fe": 100}},
            "carbon": {"typical_yield_wt_pct": {"C": 100}},
            "ice": {"typical_yield_wt_pct": {"water": 100}},
        }}
        self.minerals, self.elements, self.matrix = mineral_content_matrix(self.index)

    def assess(self, scenario, weights, **kwargs):
        return assess_supply(scenario, weights, self.minerals, self.elements, self.matrix,
                             {e: 1000.0 for e in self.elements}, **kwargs)

    def test_water_is_split_into_hydrogen_and_oxygen_without_duplicate_mass(self):
        result = self.assess({"mineral_wt_pct": {"ice": 100}}, {"H": 1, "O": 1})
        inventory = result.inventory_kg_per_tonne
        self.assertAlmostEqual(inventory["H"] + inventory["O"], 1000)
        self.assertNotIn("water", inventory)

    def test_a_trace_does_not_earn_full_constituent_credit(self):
        result = self.assess({"mineral_wt_pct": {"iron": 0.1}}, {"Fe": 1})
        self.assertAlmostEqual(result.mean, 0.001)
        self.assertEqual(result.count_coverage, 1)

    def test_missing_benchmark_does_not_remove_lithium_from_the_score(self):
        result = self.assess({"mineral_wt_pct": {"iron": 100}}, {"Fe": 1, "Li": 1})
        self.assertEqual(result.mean, 0.5)
        self.assertIsNone(result.constituents["Li"]["benchmark_kg_per_tonne"])

    def test_presence_only_ice_does_not_acquire_a_fabricated_inventory(self):
        result = self.assess({"qualitative_source_minerals": ["water_ice"]}, {"H": 1})
        self.assertEqual(result.mean, 0)
        self.assertEqual(result.inventory_kg_per_tonne["H"], 0)

    def test_unknown_composition_is_distinct_from_a_known_zero_score(self):
        self.assertIsNone(self.assess({}, {"Fe": 1}))
        self.assertEqual(self.assess({"mineral_wt_pct": {"carbon": 100}}, {"Fe": 1}).mean, 0)

    def test_monte_carlo_preserves_the_unresolved_fraction_and_seed(self):
        scenario = {"mineral_wt_pct": {"iron": 20, "carbon": 30}}
        first = self.assess(scenario, {"Fe": 2, "C": 1}, samples=100, rng=np.random.default_rng(5))
        repeat = self.assess(scenario, {"Fe": 2, "C": 1}, samples=100, rng=np.random.default_rng(5))
        self.assertEqual(first.to_dict(), repeat.to_dict())
        self.assertAlmostEqual(sum(first.inventory_kg_per_tonne.values()), 500)
        self.assertLess(first.p10, first.p90)

    def test_all_products_share_the_same_class_composition_draws(self):
        asteroids = [{"type": "C"}]
        chemical = {"taxonomy_scenarios": {"C": {"mineral_wt_pct": {"iron": 40, "carbon": 60}}}}
        profiles = {"a": {"parts": [{"name": "iron", "inputs": ["Fe"]}]},
                    "b": {"parts": [{"name": "carbon", "inputs": ["C"]}]}}
        results, _, _ = assess_catalogue(asteroids, chemical, self.index, profiles, ["a", "b"], samples=100)
        self.assertEqual(results["C"]["a"].inventory_kg_per_tonne, results["C"]["b"].inventory_kg_per_tonne)

    def test_fixed_benchmarks_use_class_means(self):
        chemical = {"taxonomy_scenarios": {"a": {"mineral_wt_pct": {"iron": 20}},
                                            "b": {"mineral_wt_pct": {"iron": 80}}}}
        benchmarks = fixed_benchmarks(chemical, self.minerals, self.elements, self.matrix)
        self.assertEqual(benchmarks["Fe"], 800)


if __name__ == "__main__":
    unittest.main()
