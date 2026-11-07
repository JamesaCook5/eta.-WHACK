"""Product-specific constituent coverage and quantity-aware supply utility.

The default benchmarks measure composition suitability per tonne of feed.
They are not monetary values, qualified yields or complete production capacity.
Real reference-batch demands can instead be supplied to capped_inventory_utility.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

import numpy as np

from .contributions import ELEMENTS, source_minerals

# Only these compound entries appear in the mineral lookup's yield table.
# Splitting their mass into elements preserves mass rather than counting water
# both as a molecule and again as its constituent H/O inventory.
COMPOUND_MASS_FRACTIONS = {
    "water": {"H": 2 * 1.008 / 18.015, "O": 15.999 / 18.015},
    "CO2": {"C": 12.011 / 44.009, "O": 2 * 15.999 / 44.009},
}


def profile_weights(key: str, profiles: dict, stack: tuple = ()) -> dict[str, float]:
    """Equal family weights, then equal constituent weights within each family."""
    if key in stack:
        raise ValueError(f"Cyclic input profile: {stack + (key,)}")
    profile = profiles[key]
    weights = {}
    if "profiles" in profile:
        for child, weight in profile["profiles"].items():
            if not np.isfinite(weight) or weight <= 0:
                raise ValueError("Profile weights must be finite and positive")
            for element, share in profile_weights(child, profiles, stack + (key,)).items():
                weights[element] = weights.get(element, 0.0) + weight * share
    else:
        for part in profile["parts"]:
            inputs, weight = part["inputs"], float(part.get("weight", 1.0))
            if not inputs or len(set(inputs)) != len(inputs) or not np.isfinite(weight) or weight <= 0:
                raise ValueError("Each part needs unique constituents and a finite positive weight")
            if not set(inputs) <= ELEMENTS:
                raise ValueError(f"Unknown constituents in {part['name']!r}")
            for element in inputs:
                weights[element] = weights.get(element, 0.0) + weight / len(inputs)
    total = sum(weights.values())
    if total <= 0:
        raise ValueError(f"Profile {key!r} has no inputs")
    return {element: weight / total for element, weight in sorted(weights.items())}


def mineral_content_matrix(index: dict) -> tuple[list[str], list[str], np.ndarray]:
    """Elemental content proxies (kg/kg mineral), using only numerical entries."""
    minerals = sorted(index["mineral_catalogue"])
    tables = []
    all_elements = set()
    for mineral in minerals:
        table = {}
        yields = index["mineral_catalogue"][mineral].get("typical_yield_wt_pct", {})
        for resource, percentage in yields.items():
            if not np.isfinite(percentage) or not 0 <= percentage <= 100:
                raise ValueError(f"Invalid content percentage for {mineral}/{resource}")
            if resource in COMPOUND_MASS_FRACTIONS:
                fractions = COMPOUND_MASS_FRACTIONS[resource]
            elif resource in ELEMENTS:
                fractions = {resource: 1.0}
            else:
                raise ValueError(f"Unspecified elemental conversion for {resource!r}")
            for element, fraction in fractions.items():
                table[element] = table.get(element, 0.0) + percentage / 100 * fraction
        if sum(table.values()) > 1.0 + 1e-9:
            raise ValueError(f"Content table double-counts mass for {mineral!r}")
        tables.append(table)
        all_elements.update(table)
    elements = sorted(all_elements)
    matrix = np.array([[table.get(element, 0.0) for element in elements] for table in tables])
    return minerals, elements, matrix


def mean_inventory(scenario: dict, minerals: list[str], elements: list[str], matrix: np.ndarray) -> dict[str, float]:
    fractions = np.array([scenario.get("mineral_wt_pct", {}).get(m, 0.0) / 100 for m in minerals])
    _validate_fractions(fractions)
    return dict(zip(elements, fractions @ matrix * 1000))


def _validate_fractions(fractions):
    if np.any(~np.isfinite(fractions)) or np.any(fractions < 0) or fractions.sum() > 1 + 1e-9:
        raise ValueError("Mineral fractions must be finite, nonnegative and sum to at most one")


def fixed_benchmarks(chemical: dict, minerals, elements, matrix) -> dict[str, float]:
    """Fix each element's benchmark to the best mean indexed class, kg/t feed."""
    inventories = [mean_inventory(scenario, minerals, elements, matrix)
                   for scenario in chemical["taxonomy_scenarios"].values()]
    return {element: max((inventory[element] for inventory in inventories), default=0.0)
            for element in elements}


def capped_inventory_utility(
    inventory_kg: Mapping[str, float],
    demand_kg: Mapping[str, float],
    weights: Mapping[str, float] | None = None,
) -> float:
    """Weighted fulfilled-demand fraction; surplus of one input cannot fill another.

    Sum inventories across suppliers before calling this for a facility. For
    several products, allocate shared inputs before adding their utilities.
    """
    if not demand_kg:
        raise ValueError("Demand must contain at least one constituent")
    score = total = 0.0
    for element, demand in demand_kg.items():
        available = float(inventory_kg.get(element, 0.0))
        weight = float(weights.get(element, 1.0) if weights is not None else 1.0)
        if not np.isfinite(demand) or demand <= 0 or not np.isfinite(available) or available < 0:
            raise ValueError("Demand must be positive and inventory nonnegative, both finite")
        if not np.isfinite(weight) or weight < 0:
            raise ValueError("Utility weights must be finite and nonnegative")
        total += weight
        score += weight * min(available / demand, 1.0)
    if total <= 0:
        raise ValueError("At least one utility weight must be positive")
    return score / total


@dataclass
class SupplyAssessment:
    mean: float
    p10: float
    p90: float
    count_coverage: float
    constituents: dict[str, dict]
    inventory_kg_per_tonne: dict[str, float]

    def to_dict(self):
        return {
            "abundance_score": {"mean": self.mean, "p10": self.p10, "p90": self.p90},
            "family_balanced_count_score": self.count_coverage,
            "constituents": self.constituents,
            "inventory_kg_per_tonne": self.inventory_kg_per_tonne,
        }


def assess_supply(
    scenario: dict, weights: Mapping[str, float], minerals, elements, matrix, benchmarks,
    *, samples: int = 0, concentration: float = 100.0, rng=None,
) -> SupplyAssessment | None:
    """Expected abundance coverage; optional Dirichlet composition sensitivity.

    Absent minerals stay absent. An unresolved fraction stays unresolved, rather
    than being redistributed onto known minerals. Presence-only ice has no
    invented numerical mass. Samples are a sensitivity model, not calibrated
    geological confidence intervals.
    """
    if not source_minerals(scenario):
        return None
    if samples < 0 or not np.isfinite(concentration) or concentration <= 0:
        raise ValueError("Samples must be nonnegative and concentration finite and positive")
    if not weights or any(not np.isfinite(w) or w < 0 for w in weights.values()) or sum(weights.values()) <= 0:
        raise ValueError("Constituent weights must be nonnegative, finite and have a positive sum")
    weights = {element: weight / sum(weights.values()) for element, weight in weights.items()}
    fractions = np.array([scenario.get("mineral_wt_pct", {}).get(m, 0.0) / 100 for m in minerals])
    _validate_fractions(fractions)
    total = fractions.sum()
    if samples > 0 and total > 0:
        active = fractions > 0
        generator = rng if rng is not None else np.random.default_rng()
        draws = np.zeros((samples, len(minerals)))
        draws[:, active] = generator.dirichlet(fractions[active] / total * concentration, size=samples) * total
    else:
        draws = fractions.reshape(1, -1)
    inventories = draws @ matrix * 1000
    by_element = {element: inventories[:, i] for i, element in enumerate(elements)}
    # Include required inputs with no indexed amount in the denominator. Missing
    # lithium/copper cannot silently disappear and turn partial supply white.
    scores = np.zeros(len(draws))
    details = {}
    coverage = 0.0
    for element, weight in weights.items():
        amounts = by_element.get(element, np.zeros(len(draws)))
        benchmark = float(benchmarks.get(element, 0.0))
        if not np.isfinite(benchmark) or benchmark < 0:
            raise ValueError("Benchmarks must be finite and nonnegative")
        fulfilled = np.minimum(amounts / benchmark, 1.0) if benchmark > 0 else np.zeros(len(draws))
        scores += weight * fulfilled
        present = bool(np.any(amounts > 0))
        coverage += weight * present
        details[element] = {
            "weight": float(weight), "mean_kg_per_tonne": float(np.mean(amounts)),
            "benchmark_kg_per_tonne": benchmark if benchmark > 0 else None,
            "abundance_credit": float(np.mean(fulfilled)), "has_indexed_quantity": present,
        }
    return SupplyAssessment(
        mean=float(np.mean(scores)), p10=float(np.percentile(scores, 10)), p90=float(np.percentile(scores, 90)),
        count_coverage=float(coverage), constituents=details,
        inventory_kg_per_tonne={element: float(np.mean(amounts)) for element, amounts in by_element.items()},
    )
