"""Potential product uses of asteroid material, with other inputs supplied.

This is material ancestry, not a complete-recipe feasibility calculation.
Origins pass through material inputs, never through equipment, information or
working inventories. Known product chemistry and assembly BOM ancestry constrain
which inputs can contribute. Unknown compositions remain candidate links.
"""

from __future__ import annotations

import copy
import re
from dataclasses import dataclass


ELEMENTS = frozenset("""
H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn
Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La
Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi
Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt
Ds Rg Cn Nh Fl Mc Lv Ts Og PGM
""".split())
FORMULAS = re.compile(r"(?<![A-Za-z])(?:[A-Z][a-z]?\d*)+(?![A-Za-z])")
# Washing / crystallisation water is not incorporated just because it is used.
# Explicit assembly constituents and the main feed take precedence over this.
PROCESS_WATERS = {"mfg_UPW", "mfg_pharma_water"}


def elements_in(text: str) -> frozenset[str]:
    found = set()
    for formula in FORMULAS.findall(text):
        symbols = set(re.findall(r"[A-Z][a-z]?", formula))
        if formula == "PGM":
            found.add("PGM")
        elif symbols <= ELEMENTS:
            found.update(symbols)
    return frozenset(found)


def source_minerals(scenario: dict) -> set[str]:
    return {key for key, value in scenario.get("mineral_wt_pct", {}).items() if value > 0} | set(
        scenario.get("qualitative_source_minerals", [])
    )


def apply_resource_index(chemical: dict, index: dict) -> dict:
    """Overlay presence-only class assumptions; never change bulk wt% values.

    Blends inherit an assumption from any positive-weight resolved component.
    Explicitly listed fractions (including zero) take precedence over a fallback.
    """
    result = copy.deepcopy(chemical)
    for code, scenario in result["taxonomy_scenarios"].items():
        weights = scenario.get("base_weights") or {scenario.get("canonical_code", code): 1.0}
        additional = set(scenario.get("qualitative_source_minerals", []))
        for base, weight in weights.items():
            if weight <= 0:
                continue
            presence = index.get("types", {}).get(base, {}).get("resource_presence", {})
            for mineral, record in presence.items():
                if (record.get("assumed_present") and mineral not in scenario.get("mineral_wt_pct", {})
                        and mineral in result["mineral_types"]):
                    additional.add(mineral)
        scenario["qualitative_source_minerals"] = sorted(additional)
    return result


@dataclass(frozen=True)
class MaterialContribution:
    origins: frozenset[tuple[str, str]] = frozenset()  # (source ore, local element)
    imports: frozenset[str] = frozenset()
    equipment: frozenset[str] = frozenset()
    processes: frozenset[str] = frozenset()
    blocked_processes: frozenset[str] = frozenset()

    @property
    def sources(self) -> frozenset[str]:
        return frozenset(source for source, _ in self.origins)


def _product_elements(chemical: dict, manufacturing: dict) -> dict[str, frozenset[str]]:
    result = {}
    for key, material in (chemical.get("materials", {}) | manufacturing.get("materials", {})).items():
        components = material.get("composition", {}).get("components", [])
        elements = frozenset().union(*(elements_in(component) for component in components))
        if elements:
            result[key] = elements
    # Intended species constrain pure products. Compound families can also
    # contain locally supplied H/O even when their other element is imported.
    for group_id, group in chemical.get("material_groups", {}).items():
        elements = frozenset().union(*(elements_in(value) for value in group.get("requires", [])))
        for member in group["members"]:
            if group.get("is_pure_element_group") and elements:
                result[member] = elements
            elif group_id != "FeNi":
                material = chemical.get("materials", {}).get(member, {})
                components = material.get("composition", {}).get("components", [])
                primary = elements_in(components[0]) if components else frozenset()
                if primary:
                    result[member] = primary
    return result


def _incorporated_inputs(process: dict, output: dict, materials: dict, known_product: bool) -> set[str]:
    composition = materials.get(output["material_id"], {}).get("composition", {})
    assembly = composition.get("candidate_assembly_input_material_ids")
    if assembly is not None:
        return set(assembly)
    inputs = set()
    main_feed = process.get("main_feed_material_id")
    for port in process["inputs"]:
        key, role = port["material_id"], port.get("role", "feed")
        if port.get("consumed") is False or role == "information_requirement":
            continue
        if key == main_feed:
            inputs.add(key)
        elif role in {"feed", "feed_or_consumed_auxiliary"} and key not in PROCESS_WATERS:
            inputs.add(key)
        elif known_product and key not in PROCESS_WATERS:
            # A consumed reagent may provide atoms to a known compound; the
            # output element filter below rejects unrelated reagent elements.
            inputs.add(key)
    return inputs


def contribution_routes(chemical: dict, manufacturing: dict, scenario: dict) -> dict[str, MaterialContribution]:
    """Trace any local material constituent through alternative product chains.

    Missing co-ingredients may be supplied externally. Explicit blocked recipes
    remain visible as prospective uses and are recorded in blocked_processes.
    Returned metadata records the contributing paths discovered during traversal,
    not a minimal or universally mandatory bill of materials.
    """
    materials = chemical.get("materials", {}) | manufacturing.get("materials", {})
    product_elements = _product_elements(chemical, manufacturing)
    routes = {}
    for mineral in source_minerals(scenario):
        entry = chemical["mineral_types"].get(mineral, {})
        source = entry.get("source_material_id")
        catalogue = entry.get("source_catalogue_entry", {})
        if not source:
            continue
        elements = elements_in(catalogue.get("formula", "")) | frozenset().union(*(
            frozenset({"H", "O"}) if value == "water" else elements_in(value)
            for value in catalogue.get("ore_of", [])
        ))
        # A source without a chemical specification can still have material
        # ancestry, but it cannot satisfy a known pure-element output contract.
        origins = frozenset((source, element) for element in elements or {"?"})
        routes[source] = MaterialContribution(origins=origins)

    processes = chemical["processes"] | manufacturing["processes"]
    changed = True
    while changed:
        changed = False
        for process_id, process in processes.items():
            for output in process["outputs"]:
                target = output["material_id"]
                if output.get("role") == "residue_for_later_recovery" or target.endswith("_next_batch"):
                    continue
                inputs = _incorporated_inputs(process, output, materials, target in product_elements)
                parents = [routes[key] for key in sorted(inputs) if key in routes]
                origins = frozenset().union(*(route.origins for route in parents))
                if target in product_elements:
                    origins = frozenset((source, element) for source, element in origins
                                        if element in product_elements[target])
                previous = routes.get(target, MaterialContribution())
                if not origins - previous.origins:
                    continue
                required = {port["material_id"] for port in process["inputs"] if port.get("required", True)}
                required.update(item["resource_id"] for item in process.get("inventories", []))
                blocker = (process.get("evidence_level", "").startswith("blocked")
                           or output.get("excluded_from_feasible_path_if_blocked", False))
                routes[target] = MaterialContribution(
                    origins=previous.origins | origins,
                    imports=previous.imports | (required - routes.keys())
                    | frozenset().union(*(route.imports for route in parents)),
                    equipment=previous.equipment | frozenset(process.get("equipment_ids", []))
                    | frozenset(process.get("site_equipment_ids", []))
                    | frozenset().union(*(route.equipment for route in parents)),
                    processes=previous.processes | {process_id}
                    | frozenset().union(*(route.processes for route in parents)),
                    blocked_processes=previous.blocked_processes | ({process_id} if blocker else set())
                    | frozenset().union(*(route.blocked_processes for route in parents)),
                )
                changed = True
    return routes
