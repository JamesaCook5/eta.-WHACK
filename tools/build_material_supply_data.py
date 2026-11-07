"""Build the compact map data file from the asteroid chemical DAG."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DAG_PATH = ROOT / "Asteroid_Chemical_DAG-2.json"
OUTPUT_PATH = ROOT / "UI Skeleton/public/data/material-supply.json"


def main() -> None:
    dag = json.loads(DAG_PATH.read_text())
    classes = {}
    for code, entry in dag["asteroid_classes"].items():
        physical = entry.get("source_entry", {}).get("physical", {})
        classes[code] = {"density_g_cm3": physical.get("rho_bulk", 2.0)}

    for code, entry in dag["asteroid_blends"].items():
        weights = entry.get("source_entry", {})
        components = [
            (classes[base]["density_g_cm3"], weight)
            for base, weight in weights.items()
            if base in classes
        ]
        density = sum(value * weight for value, weight in components) / sum(
            weight for _, weight in components
        ) if components else 2.0
        classes[code] = {"density_g_cm3": density}

    scenarios = {
        code: {
            "canonical_code": scenario.get("canonical_code"),
            "mineral_wt_pct": scenario.get("mineral_wt_pct", {}),
            "coverage_fraction": scenario.get("coverage_fraction", 1),
        }
        for code, scenario in dag["taxonomy_scenarios"].items()
    }

    minerals = {}
    for mineral_id, mineral in dag["mineral_types"].items():
        routes = []
        for process_id in mineral.get("direct_process_ids", []):
            process = dag["processes"].get(process_id)
            if not process:
                continue
            inputs = [port["material_id"] for port in process.get("inputs", [])]
            outputs = [port["material_id"] for port in process.get("outputs", [])]
            routes.append({
                "id": process_id,
                "name": process.get("name", process_id),
                "inputs": inputs,
                "outputs": outputs,
                "external_inputs": [
                    item for item in inputs if item in dag.get("external_resources", {})
                ],
            })

        downstream_external_inputs = []
        process_ids = mineral.get("downstream_candidate_process_ids") or mineral.get("direct_process_ids", [])
        for process_id in process_ids:
            process = dag["processes"].get(process_id, {})
            for port in process.get("inputs", []):
                material_id = port["material_id"]
                if material_id in dag.get("external_resources", {}) and material_id not in downstream_external_inputs:
                    downstream_external_inputs.append(material_id)

        source = mineral.get("source_catalogue_entry", {})
        minerals[mineral_id] = {
            "label": source.get("name", mineral_id.replace("_", " ").title()),
            "source_material_id": mineral.get("source_material_id"),
            "routes": routes,
            "downstream_external_inputs": downstream_external_inputs,
        }

    materials = {
        material_id: {
            "label": material.get("description") or material_id.replace("_", " "),
            "role": dag["external_resources"].get(material_id, {}).get("role"),
            "startup_mass_kg": dag["external_resources"].get(material_id, {}).get("required_startup_mass_kg"),
            "makeup_kg_per_tonne_feed": dag["external_resources"].get(material_id, {}).get("makeup_kg_per_tonne_feed"),
        }
        for material_id, material in dag["materials"].items()
        if material_id in dag["external_resources"]
    }
    payload = {
        "classes": classes,
        "scenarios": scenarios,
        "minerals": minerals,
        "material_labels": {
            material_id: material.get("description") or material_id.replace("_", " ")
            for material_id, material in dag["materials"].items()
        },
        "external_materials": materials,
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(payload, separators=(",", ":")) + "\n")


if __name__ == "__main__":
    main()
