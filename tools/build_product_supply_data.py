"""Build the product-to-asteroid supply table used by the map's station planner.

Reads the two DAGs and the mineral lookup at the repo root and writes
UI Skeleton/public/data/product-supply.json with:

- elements: the asteroid-sourced inputs the planner can track.
- scenarios: per taxonomy scenario (class, or class@X=P/M/E/? for classes
  containing X), bulk density and element grade in kg per tonne of rock.
  Grade = sum over minerals of mineral wt% x the mineral's typical yield wt%.
- products: per product in the manufacturing DAG's catalogue, the qualified
  feedstock interfaces it can draw on (mapped to elements) and the external
  (Earth-supplied) stocks it needs; externals holds their labels and reasons.

The DAG carries no quantities, so every required element counts equally.
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MFG_DAG_PATH = ROOT / "Space_Industrial_Manufacturing_DAG.json"
CHEM_DAG_PATH = ROOT / "Asteroid_Chemical_DAG-2.json"
LOOKUP_PATH = ROOT / "asteroid_mineral_lookup.json"
OUTPUT_PATH = ROOT / "UI Skeleton/public/data/product-supply.json"

# Element (or compound) the planner tracks, with display label.
ELEMENTS = {
    "Fe": "Iron",
    "Ni": "Nickel",
    "Co": "Cobalt",
    "Mg": "Magnesium",
    "Al": "Aluminium",
    "Ti": "Titanium",
    "Cr": "Chromium",
    "Si": "Silicon",
    "C": "Carbon",
    "water": "Water",
    "H": "Hydrogen",
    "O": "Oxygen",
    "N": "Nitrogen",
    "CO2": "CO₂",
    "P": "Phosphorus",
}

# Feedstock interface -> elements it is made from.
FEED_ELEMENTS = {
    "mfg_iron_feed": ["Fe"],
    "mfg_iron_oxide_feed": ["Fe"],
    "mfg_nickel_feed": ["Ni"],
    "mfg_cobalt_feed": ["Co"],
    "mfg_magnesium_feed": ["Mg"],
    "mfg_aluminium_feed": ["Al"],
    "mfg_alumina_feed": ["Al"],
    "mfg_titanium_feed": ["Ti"],
    "mfg_chromium_feed": ["Cr"],
    "mfg_silicon_feed": ["Si"],
    "mfg_polysilicon_feed": ["Si"],
    "mfg_silica_feed": ["Si"],
    "mfg_carbon_feed": ["C"],
    "mfg_CO_feed": ["C"],
    "mfg_methane_feed": ["C", "H"],
    "mfg_water_feed": ["water"],
    "mfg_hydrogen_feed": ["H"],
    "mfg_oxygen_feed": ["O"],
    "mfg_nitrogen_feed": ["N"],
    "mfg_CO2_feed": ["CO2"],
    "mfg_phosphoric_acid_feed": ["P"],
}

# Display groups for the product picker (UI grouping, not from the DAG).
GROUPS = [
    ("Electronics", ["semiconductors", "computers", "flight_computers"]),
    ("Power", ["solar_panels", "solar_arrays", "batteries", "power_plants"]),
    ("Materials", ["steel", "titanium", "plastics", "polyimide", "cutting_tools", "industrial_lubricants"]),
    ("Vehicles & robots", ["robots", "space_drones", "spacecraft", "tugs", "mining_vessels",
                           "manufacturing_vessels", "refinery_vessels", "assembly_vessels"]),
    ("Infrastructure", ["cooling", "machine_tools", "factory_seeds", "habitats"]),
    ("Optics & sails", ["mirrors", "sails", "beam_arrays", "beamed_sails", "collector_swarms"]),
    ("Medicines", ["medicines_small_molecule", "medicines_biologic"]),
]

# Hydrogen held in water counts towards hydrogen supply (2 x 1.008 / 18.015).
H_IN_WATER = 2.016 / 18.015


def feed_label(feed_id: str) -> str:
    return feed_id.removeprefix("mfg_").removesuffix("_feed").replace("_", " ")


def ext_label(ext_id: str) -> str:
    return ext_id.removeprefix("ext_").replace("_", " ")


def class_densities(chem: dict) -> dict:
    out = {}
    for code, entry in chem["asteroid_classes"].items():
        out[code] = entry.get("source_entry", {}).get("physical", {}).get("rho_bulk", 2.0)
    return out


def main() -> None:
    mfg = json.loads(MFG_DAG_PATH.read_text())
    chem = json.loads(CHEM_DAG_PATH.read_text())
    lookup = json.loads(LOOKUP_PATH.read_text())

    yields = {m: v.get("typical_yield_wt_pct", {}) for m, v in lookup["mineral_catalogue"].items()}
    rho = class_densities(chem)

    scenarios = {}
    for key, scen in chem["taxonomy_scenarios"].items():
        grades = {}
        for mineral, wt in scen.get("mineral_wt_pct", {}).items():
            for el, y in yields.get(mineral, {}).items():
                grades[el] = grades.get(el, 0.0) + wt / 100 * y / 100 * 1000  # kg per tonne
        grades["H"] = grades.get("H", 0.0) + grades.get("water", 0.0) * H_IN_WATER
        weights = {b: w for b, w in (scen.get("base_weights") or {}).items() if b in rho}
        total = sum(weights.values())
        density = sum(rho[b] * w for b, w in weights.items()) / total if total else 2.0
        scenarios[key] = {
            "density_g_cm3": round(density, 3),
            "grade_kg_per_t": {el: round(grades[el], 3) for el in ELEMENTS if grades.get(el, 0) > 0},
        }

    externals = mfg.get("external_resources", {})
    feeds = mfg["feedstock_interfaces"]
    group_of = {pid: g for g, ids in GROUPS for pid in ids}

    products = []
    used_externals = set()
    for pid, prod in mfg["product_catalogue"].items():
        local_feeds = sorted(m for m in prod.get("possible_material_ids", []) if m in feeds)
        elements = []
        for f in local_feeds:
            for el in FEED_ELEMENTS.get(f, []):
                if el not in elements:
                    elements.append(el)
        elements.sort(key=list(ELEMENTS).index)
        imported = sorted(set(prod.get("possible_external_stock_ids_union", [])))
        used_externals.update(imported)
        products.append({
            "id": pid,
            "label": prod["label"],
            "group": group_of.get(pid, "Other"),
            "processes": len(prod.get("possible_upstream_process_ids", [])),
            "feeds": [{"id": f, "label": feed_label(f), "elements": FEED_ELEMENTS.get(f, [])} for f in local_feeds],
            "elements": elements,
            "imported": imported,
        })

    order = [pid for _, ids in GROUPS for pid in ids]
    products.sort(key=lambda p: (order.index(p["id"]) if p["id"] in order else len(order), p["label"]))

    out = {
        "source": {
            "manufacturing_dag": MFG_DAG_PATH.name,
            "chemical_dag": CHEM_DAG_PATH.name,
            "mineral_lookup": LOOKUP_PATH.name,
        },
        "notes": [
            "Grade = sum over minerals of mineral wt% x typical yield wt% (kg per tonne of rock).",
            "Hydrogen includes the hydrogen held in water.",
            "Classes containing X use the albedo split: < 0.075 P, 0.075-0.30 M, > 0.30 E, missing ?.",
            "The DAG has no quantities, so each required element is weighted equally.",
        ],
        "x_albedo_split": {"P_below": 0.075, "E_above": 0.30},
        "elements": [{"id": k, "label": v} for k, v in ELEMENTS.items()],
        "groups": [g for g, _ in GROUPS],
        "scenarios": scenarios,
        "externals": {
            ext: {
                "label": ext_label(ext),
                "why": externals.get(ext, {}).get("why_not_assumed_local", ""),
            }
            for ext in sorted(used_externals)
        },
        "products": products,
    }
    OUTPUT_PATH.write_text(json.dumps(out, separators=(",", ":")))
    print(f"wrote {OUTPUT_PATH} ({OUTPUT_PATH.stat().st_size / 1024:.1f} KB, {len(products)} products, {len(scenarios)} scenarios)")


if __name__ == "__main__":
    main()
