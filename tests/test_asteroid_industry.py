import math
import unittest

import numpy as np

from asteroid_industry import (
    Asteroid,
    CompositionModel,
    IndustrialModel,
    ProcessGraph,
    estimate_resources,
)


class CompositionTests(unittest.TestCase):
    def test_expected_and_samples_are_normalised(self):
        model = CompositionModel(seed=1)
        expected = model.expected("S")
        self.assertAlmostEqual(sum(expected.values()), 1.0, places=12)

        minerals, matrix = model.sample_matrix("S", n=25)
        self.assertEqual(matrix.shape, (25, len(minerals)))
        np.testing.assert_allclose(matrix.sum(axis=1), 1.0)

    def test_feedstock_aggregation_is_normalised(self):
        model = CompositionModel(seed=1)
        names, fractions = model.feedstock_matrix("C", n=10)
        self.assertIn("silicate_ore", names)
        self.assertIn("water", names)
        np.testing.assert_allclose(fractions.sum(axis=1), 1.0)

    def test_unknown_surface_type_falls_back(self):
        model = CompositionModel(seed=1)
        self.assertEqual(model.minerals_for("nonsense"), model.minerals_for("U"))


class AsteroidTests(unittest.TestCase):
    def test_mass_from_diameter_and_density(self):
        asteroid = Asteroid(
            id="x", name="x", surface_type="S", diameter_km=1.0, density_kg_m3=1000.0
        )
        expected = (4.0 / 3.0) * math.pi * 500.0**3 * 1000.0
        self.assertAlmostEqual(asteroid.mass_kg, expected)

    def test_resource_estimate(self):
        asteroid = Asteroid(
            id="x", name="x", surface_type="S", diameter_km=1.0, density_kg_m3=3000.0
        )
        model = CompositionModel(seed=2)
        estimate = estimate_resources(asteroid, model, n_samples=100)
        self.assertGreater(estimate.mean["silicate_ore"], 0)
        self.assertAlmostEqual(
            sum(estimate.mean.values()), asteroid.mass_kg, places=2
        )


PROCESSES = {
    "make_crusher": {
        "inputs": {"ore": 20.0},
        "outputs": {"crusher": 1.0},
        "equipment": {"assembly": 1},
    },
    "mine": {
        "inputs": {"ore": 10.0},
        "outputs": {"concentrate": 5.0, "waste": 5.0},
        "equipment": {"crusher": 1},
    },
    "smelt": {
        "inputs": {"concentrate": 5.0, "carbon": 1.0},
        "outputs": {"metal": 2.0, "slag": 4.0},
        "equipment": {"furnace": 1},
    },
    "make_part": {
        "inputs": {"metal": 2.0},
        "outputs": {"part": 1.0},
        "equipment": {"assembly": 1},
    },
}


class ProcessGraphTests(unittest.TestCase):
    def test_topological_order_and_terminal_materials(self):
        graph = ProcessGraph(PROCESSES)
        order = graph.order
        self.assertLess(order.index("make_crusher"), order.index("mine"))
        self.assertLess(order.index("mine"), order.index("smelt"))
        self.assertLess(order.index("smelt"), order.index("make_part"))
        self.assertIn("part", graph.terminal_materials)

    def test_cycle_is_rejected(self):
        cyclic = {
            "a": {"inputs": {"y": 1}, "outputs": {"x": 1}},
            "b": {"inputs": {"x": 1}, "outputs": {"y": 1}},
        }
        with self.assertRaises(ValueError):
            ProcessGraph(cyclic)


class ModelTests(unittest.TestCase):
    def setUp(self):
        self.graph = ProcessGraph(PROCESSES)
        self.model = IndustrialModel(
            self.graph,
            inventory={"ore": 100.0, "carbon": 10.0},
            equipment={"assembly": 1, "furnace": 1},
        )

    def test_backward_inputs(self):
        demand = self.model.required_inputs("part", 1.0)
        self.assertAlmostEqual(demand.raw_inputs["ore"], 10.0)
        self.assertAlmostEqual(demand.raw_inputs["carbon"], 1.0)
        self.assertIn("crusher", demand.equipment)
        self.assertIn("slag", demand.byproducts)

    def test_reachability_can_manufacture_equipment(self):
        reachable, blocked = self.model.reachability(assume_all_raw=False)
        self.assertIn("crusher", reachable)
        self.assertIn("part", reachable)
        self.assertNotIn("mine", blocked)

    def test_max_production(self):
        # Make the crusher available first, as the assessment layer does.
        model = IndustrialModel(
            self.graph,
            inventory={"ore": 100.0, "carbon": 10.0},
            equipment={"assembly": 1, "furnace": 1, "crusher": 1},
        )
        potential = model.max_production("part")
        self.assertTrue(potential.feasible)
        self.assertAlmostEqual(potential.quantity, 10.0)
        self.assertIn("carbon", potential.limiting_inputs)


if __name__ == "__main__":
    unittest.main()
