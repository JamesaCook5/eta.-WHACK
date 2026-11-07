"""Check dependency semantics behind the plotted candidate routes."""

import json
import tempfile
import unittest
from pathlib import Path

import duckdb

from visualise_industry import (
    ROOT, dependency_routes, group_output_sets, load_asteroids, output_label, output_routes, scenario_code,
)


def process(inputs, outputs, **kwargs):
    return {
        "inputs": [{"material_id": item} for item in inputs],
        "outputs": [{"material_id": item} for item in outputs],
        **kwargs,
    }


class DependencyRouteTests(unittest.TestCase):
    def setUp(self):
        self.chemical = {
            "external_resources": {"acid": {}, "filter_media": {}},
            "mineral_types": {"metal": {"source_material_id": "ore"}},
            "processes": {},
        }
        self.manufacturing = {"external_resources": {}, "processes": {}}
        self.scenario = {"mineral_wt_pct": {"metal": 80}, "potential_elements_or_compounds": ["Fe"]}

    def routes(self):
        return dependency_routes(self.chemical, self.manufacturing, self.scenario)

    def test_all_inputs_required_and_missing_inputs_are_not_automatic_imports(self):
        self.chemical["processes"] = {"smelt": process(["ore", "unprovided_reductant"], ["metal"])}
        self.assertNotIn("metal", self.routes())

    def test_alternative_recipes_are_not_merged(self):
        self.chemical["processes"] = {
            "wet": process(["ore", "acid"], ["metal"]),
            "dry": process(["ore", "missing_flux"], ["metal"]),
        }
        route = self.routes()["metal"]
        self.assertEqual(route.imports, {"acid"})
        self.assertEqual(route.processes, {"wet"})

    def test_working_inventories_and_reusable_equipment_are_separate(self):
        self.chemical["processes"] = {"extract": process(
            ["ore", "acid"], ["metal"], inventories=[{"resource_id": "filter_media"}],
            equipment_ids=["reactor"], site_equipment_ids=["site_power"],
        )}
        route = self.routes()["metal"]
        self.assertEqual(route.imports, {"acid", "filter_media"})
        self.assertEqual(route.equipment, {"reactor", "site_power"})
        self.assertEqual(route.sources, {"ore"})

    def test_explicit_blockers_and_absent_class_elements_prevent_outputs(self):
        self.chemical["processes"] = {
            "blocked": process(["ore"], ["metal"], evidence_level="blocked_requires_testwork"),
            "wrong_element": process(["ore"], ["nickel"], class_element_requirements=["Ni"]),
        }
        self.assertNotIn("metal", self.routes())
        self.assertNotIn("nickel", self.routes())

    def test_zero_mineral_fraction_does_not_enable_a_route(self):
        self.scenario["mineral_wt_pct"]["metal"] = 0
        self.chemical["processes"] = {"extract": process(["ore"], ["metal"])}
        self.assertNotIn("metal", self.routes())

    def test_conditional_auxiliary_stock_is_not_a_mandatory_input(self):
        self.chemical["processes"] = {
            "extract": process(["ore"], ["metal"], conditional_auxiliary_inputs=[{"resource_id": "acid"}]),
            "form": process(["metal"], ["stock"]),
        }
        route = self.routes()["stock"]
        self.assertEqual(route.imports, set())
        self.assertEqual(route.conditional_imports, {"acid"})


class CatalogueContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.chemical = json.loads((ROOT / "Asteroid_Chemical_DAG-2.json").read_text())
        cls.manufacturing = json.loads((ROOT / "Space_Industrial_Manufacturing_DAG.json").read_text())

    def test_dry_iron_scenario_does_not_gain_water_or_hydrogen(self):
        routes = output_routes(self.chemical, self.manufacturing,
                               self.chemical["taxonomy_scenarios"]["M_iron"], "raw")
        self.assertIn("FeNi", routes)
        self.assertNotIn("H2O", routes)
        self.assertNotIn("H2", routes)

    def test_unknown_taxonomy_is_not_assigned_carbonaceous_composition(self):
        scenarios = self.chemical["taxonomy_scenarios"]
        self.assertEqual(scenario_code("not-a-type", None, scenarios), "?")
        self.assertEqual(scenario_code("X", "X", scenarios), "X@X=?")
        self.assertEqual(scenario_code("Ch", "C", scenarios), "Ch")
        self.assertEqual(output_routes(self.chemical, self.manufacturing, {}, "raw"), {})

    def test_blocked_semiconductor_chain_is_not_shown_as_available(self):
        routes = output_routes(self.chemical, self.manufacturing,
                               self.chemical["taxonomy_scenarios"]["C"], "industrial", strict=True)
        self.assertIn("steel", routes)
        self.assertNotIn("semiconductors", routes)

    def test_partial_material_contribution_includes_complete_assemblies(self):
        routes = output_routes(self.chemical, self.manufacturing,
                               self.chemical["taxonomy_scenarios"]["S"], "industrial")
        self.assertIn("semiconductors", routes)
        self.assertIn("space_drones", routes)
        self.assertIn("spacecraft", routes)
        self.assertTrue(routes["semiconductors"].blocked_processes)


class FullCatalogueMapTests(unittest.TestCase):
    def test_output_identity_is_preserved_even_when_counts_match(self):
        asteroids = [{"type": code} for code in ("C", "S", "M", "?", "C")]
        groups = group_output_sets(asteroids, {
            "C": {"Fe": object(), "H2O": object()},
            "S": {"Fe": object(), "Si": object()},
            "M": {}, "?": None,
        })
        self.assertEqual(groups[("Fe", "H2O")], [0, 4])
        self.assertEqual(groups[("Fe", "Si")], [1])
        self.assertEqual(groups[()], [2])
        self.assertEqual(groups[None], [3])
        self.assertNotEqual(output_label((), "raw"), output_label(None, "raw"))

    def test_loader_keeps_every_positioned_asteroid_without_name_or_sample_filters(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "catalogue.parquet"
            with duckdb.connect() as con:
                con.execute('''CREATE TABLE asteroids AS
                    SELECT i::VARCHAR AS id, ('body-' || i) AS name,
                           'C' AS "taxonomy.class", 'C' AS "taxonomy.complex",
                           [i::DOUBLE + 1, 2.0, 0.0] AS position, 2461300.5 AS ref_epoch
                    FROM range(2101) t(i)''')
                con.execute("COPY asteroids TO ? (FORMAT PARQUET)", [str(path)])
            asteroids, epoch = load_asteroids(path, {"C": {}})
            self.assertEqual(len(asteroids), 2101)
            self.assertEqual({a["id"] for a in asteroids}, {str(i) for i in range(2101)})
            self.assertEqual(epoch, 2461300.5)


if __name__ == "__main__":
    unittest.main()
