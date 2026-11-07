"""Material incorporation must not require a completely local recipe."""

import copy
import json
import unittest
from pathlib import Path

from asteroid_industry.contributions import apply_resource_index, contribution_routes, source_minerals


ROOT = Path(__file__).resolve().parents[1]


def material(formula):
    return {"composition": {"components": [formula]}}


def process(inputs, outputs, **extra):
    return {"inputs": [{"material_id": key, "role": "feed"} for key in inputs],
            "outputs": [{"material_id": key} for key in outputs], **extra}


class MaterialContributionTests(unittest.TestCase):
    def setUp(self):
        self.chemical = {
            "mineral_types": {
                "iron_ore": {"source_material_id": "ore", "source_catalogue_entry": {"formula": "Fe3O4"}},
                "water_ice": {"source_material_id": "ice", "source_catalogue_entry": {"formula": "H2O"}},
            },
            "materials": {"iron": material("Fe"), "water": material("H2O"),
                          "hydrogen": material("H2"), "oxygen": material("O2")},
            "processes": {}, "material_groups": {},
        }
        self.manufacturing = {"materials": {}, "processes": {}}
        self.scenario = {"mineral_wt_pct": {"iron_ore": 100}}

    def routes(self):
        return contribution_routes(self.chemical, self.manufacturing, self.scenario)

    def test_one_local_constituent_reaches_assemblies_with_missing_coingredients(self):
        self.chemical["processes"]["smelt"] = process(["ore", "imported_reductant"], ["iron"])
        self.manufacturing["processes"] = {
            "make_part": process(["iron", "imported_chromium"], ["part"]),
            "assemble_drone": process(["part", "imported_chips", "imported_battery"], ["drone"]),
            "all_imported": process(["unrelated_import"], ["unrelated_product"]),
        }
        routes = self.routes()
        self.assertIn("drone", routes)
        self.assertEqual(routes["drone"].sources, {"ore"})
        self.assertIn("imported_chips", routes["drone"].imports)
        self.assertNotIn("unrelated_product", routes)

    def test_water_used_as_a_reductant_does_not_become_indigenous_iron(self):
        self.scenario = {"mineral_wt_pct": {"water_ice": 100}}
        self.chemical["processes"] = {
            "water_recovery": process(["ice"], ["water"]),
            "electrolyse": process(["water"], ["hydrogen", "oxygen"]),
            "reduce_imported_ore": process(["imported_iron_ore", "hydrogen"], ["iron", "water"]),
        }
        routes = self.routes()
        self.assertIn("hydrogen", routes)
        self.assertIn("oxygen", routes)
        self.assertNotIn("iron", routes)

    def test_assembly_constituents_override_unincorporated_process_inputs(self):
        self.scenario = {"mineral_wt_pct": {"water_ice": 100}}
        self.chemical["processes"]["recover"] = process(["ice"], ["water"])
        self.manufacturing["materials"]["device"] = {
            "composition": {"candidate_assembly_input_material_ids": ["imported_part"]}}
        self.manufacturing["processes"]["assembly"] = process(["imported_part", "water"], ["device"])
        self.assertNotIn("device", self.routes())

    def test_wash_water_does_not_make_a_silicon_wafer_asteroid_derived(self):
        self.scenario = {"mineral_wt_pct": {"water_ice": 100}}
        self.chemical["processes"]["recover"] = process(["ice"], ["mfg_UPW"])
        self.manufacturing["processes"]["wash"] = process(
            ["imported_wafer", "mfg_UPW"], ["clean_wafer"], main_feed_material_id="imported_wafer")
        self.assertNotIn("clean_wafer", self.routes())

    def test_consumed_reagents_can_contribute_atoms_to_a_known_product(self):
        self.scenario = {"mineral_wt_pct": {"water_ice": 100}}
        self.chemical["processes"]["recover"] = process(["ice"], ["water"])
        self.chemical["processes"]["convert"] = {
            "inputs": [{"material_id": "water", "role": "consumed_reagent"}],
            "outputs": [{"material_id": "hydrogen"}],
        }
        self.assertIn("hydrogen", self.routes())

    def test_catalysts_information_and_equipment_do_not_create_product_ancestry(self):
        self.manufacturing["processes"]["use_local_equipment"] = process(
            ["imported_feed"], ["product_a"], equipment_ids=["ore"])
        for name, role in [("catalyst", "catalytic_charge"), ("information", "information_requirement")]:
            self.manufacturing["processes"][name] = {
                "inputs": [{"material_id": "ore", "role": role, "consumed": False}],
                "outputs": [{"material_id": name + "_product"}],
            }
        routes = self.routes()
        self.assertNotIn("product_a", routes)
        self.assertNotIn("catalyst_product", routes)
        self.assertNotIn("information_product", routes)

    def test_rare_alternative_local_source_is_not_lost_to_first_recipe_choice(self):
        self.chemical["processes"] = {
            "imported_route": process(["all_imported"], ["iron"]),
            "local_route": process(["ore", "imported_reductant"], ["iron"]),
        }
        self.assertIn("iron", self.routes())

    def test_blocked_recipes_are_prospective_uses_and_keep_their_gap_marker(self):
        self.chemical["processes"]["unqualified"] = process(
            ["ore"], ["iron"], evidence_level="blocked_requires_design")
        self.assertEqual(self.routes()["iron"].blocked_processes, {"unqualified"})


class ResourcePresenceTests(unittest.TestCase):
    def test_presence_fallback_is_inherited_without_inventing_mass_fractions(self):
        chemical = {"mineral_types": {"water_ice": {}}, "taxonomy_scenarios": {
            "C": {"base_weights": {"C": 1}, "mineral_wt_pct": {"other": 100}},
            "blend": {"base_weights": {"C": 0.5, "S": 0.5}, "mineral_wt_pct": {"other": 100}},
            "dry": {"base_weights": {"C": 1}, "mineral_wt_pct": {"water_ice": 0, "other": 100}},
            "?": {"base_weights": {}, "mineral_wt_pct": {}},
        }}
        original = copy.deepcopy(chemical)
        index = {"types": {"C": {"resource_presence": {"water_ice": {"assumed_present": True}}}}}
        result = apply_resource_index(chemical, index)
        for code in ("C", "blend"):
            scenario = result["taxonomy_scenarios"][code]
            self.assertIn("water_ice", source_minerals(scenario))
            self.assertEqual(scenario["mineral_wt_pct"], {"other": 100})
        self.assertNotIn("water_ice", source_minerals(result["taxonomy_scenarios"]["dry"]))
        self.assertEqual(source_minerals(result["taxonomy_scenarios"]["?"]), set())
        self.assertEqual(chemical, original)

    def test_project_index_distinguishes_hydrated_classes_and_ice_assumptions(self):
        index = json.loads((ROOT / "asteroid_mineral_lookup.json").read_text())
        for code in ("C", "B", "P"):
            ice = index["types"][code]["resource_presence"]["water_ice"]
            self.assertTrue(ice["assumed_present"])
            self.assertIsNone(ice["bulk_wt_pct"])
            self.assertTrue(ice["sources"])
        for code in ("Ch", "Cgh"):
            self.assertIn("hydrated_phyllosilicates", index["types"][code]["resource_presence"])
            self.assertNotIn("water_ice", index["types"][code]["resource_presence"])
        for entry in index["types"].values():
            self.assertAlmostEqual(sum(entry["minerals_wt_pct"].values()), 100)


if __name__ == "__main__":
    unittest.main()
