"""Tiered station placement over the manufacturing DAG.

The single-product planner in :mod:`asteroid_industry.stations` answers "where
should we mine for this product's elements?"  This module answers the next
question: given a product whose manufacture needs intermediates, where should
each stage of the production network sit?

The model uses the same physical proxy as the single-tier planner: an orbit is
embedded in a five-dimensional Euclidean space, and straight-line distance
approximates relative transfer cost. Station centers use weighted geometric
medians to minimize the modeled linear transport cost. No Lambert solver,
launch windows or propellant model is used.

Pipeline
--------
1. Expand the product's manufacturing DAG into a recipe tree.  A material with
   several producers uses one route (the most "local" one, or an explicit
   ``route`` override).  Missing process quantities fall back to equal mass
   shares, because the DAG currently leaves most ``kg_per_kg_main_feed`` values
   null.
2. Place tier-0 mining/feedstock stations from the asteroid table.
3. Walk the recipe tree bottom-up.  For every process node, gather the outputs
   of its child stations as weighted points and run the same weighted Weber solve.
   The parent station sits at the weighted centre of its inputs.
4. Return the production tree and station list.

This is a planning prototype, not a process simulation: capacity is a simple
limiting-input calculation and equipment, utilities and time are not yet
scheduled.
"""

from __future__ import annotations

import json
import math
import re
import time
import base64
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Iterable, Mapping, Sequence

import numpy as np

from .stations import (
    MAX_STATIONS,
    RESTARTS,
    MAX_ITER,
    SQRT_125,
    SQRT_2,
    TOP_MEMBERS,
    V_EARTH_KMS,
    StationPlanner,
    _weber_cost,
    _weber_pp,
    _weber,
    _wrap,
)

#: Common material components -> planner elements with approximate mass shares.
COMPOUND_ELEMENTS: dict[str, dict[str, float]] = {
    "H2O": {"water": 1.0},
    "CO2": {"CO2": 1.0},
    "CO": {"C": 12.011 / 28.010, "O": 15.999 / 28.010},
    "CH4": {"C": 12.011 / 16.043, "H": 4.032 / 16.043},
    "CH3OH": {"C": 12.011 / 32.042, "H": 4.032 / 32.042, "O": 15.999 / 32.042},
    "NH3": {"N": 14.007 / 17.031, "H": 3.024 / 17.031},
    "N2": {"N": 1.0},
    "O2": {"O": 1.0},
    "H2": {"H": 1.0},
    "Fe3O4": {"Fe": 0.724, "O": 0.276},
    "Fe2O3": {"Fe": 0.699, "O": 0.301},
    "SiO2": {"Si": 0.467, "O": 0.533},
    "Al2O3": {"Al": 0.529, "O": 0.471},
    "MgO": {"Mg": 0.603, "O": 0.397},
    "TiO2": {"Ti": 0.599, "O": 0.401},
    "Cr2O3": {"Cr": 0.684, "O": 0.316},
    "P2O5": {"P": 0.436, "O": 0.564},
}

#: Name fragments used when a material has no component list.
NAME_ELEMENTS: tuple[tuple[str, str], ...] = (
    ("water", "water"),
    ("ice", "water"),
    ("carbon", "C"),
    ("graphite", "C"),
    ("methane", "C"),
    ("silicon", "Si"),
    ("silica", "Si"),
    ("alumina", "Al"),
    ("aluminium", "Al"),
    ("aluminum", "Al"),
    ("iron", "Fe"),
    ("nickel", "Ni"),
    ("cobalt", "Co"),
    ("magnesium", "Mg"),
    ("titanium", "Ti"),
    ("chromium", "Cr"),
    ("phosph", "P"),
    ("nitrogen", "N"),
    ("oxygen", "O"),
    ("hydrogen", "H"),
)

ELEMENT_SYMBOL = re.compile(r"[A-Z][a-z]?")

#: Roles that do not represent consumed material flow.
NON_MATERIAL_ROLES = (
    "catalyst",
    "catalytic",
    "information",
    "equipment",
    "configuration",
    "design",
)


@dataclass
class Recipe:
    """One process normalised to one unit of its target material."""

    process_id: str
    target: str
    inputs: dict[str, float] = field(default_factory=dict)  # kg input / kg target
    outputs: dict[str, float] = field(default_factory=dict)  # kg output / kg target
    equipment: dict[str, float] = field(default_factory=dict)
    group: str | None = None
    facility: str | None = None
    quantities_inferred: bool = False


@dataclass
class RecipeNode:
    """A material in the expanded recipe tree."""

    material: str
    demand: float
    process_id: str | None = None
    recipe: Recipe | None = None
    children: list["RecipeNode"] = field(default_factory=list)
    tier: int = 0
    is_raw: bool = False
    is_external: bool = False
    group: str | None = None
    facility: str | None = None
    stations: list[dict] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "material": self.material,
            "demand": self.demand,
            "process": self.process_id,
            "tier": self.tier,
            "is_raw": self.is_raw,
            "is_external": self.is_external,
            "group": self.group,
            "facility": self.facility,
            "inputs": {child.material: child.demand for child in self.children},
            "stations": self.stations,
            "children": [child.to_dict() for child in self.children],
        }


def _walk(node: RecipeNode) -> Iterable[RecipeNode]:
    yield node
    for child in node.children:
        yield from _walk(child)


def _walk_postorder(node: RecipeNode) -> Iterable[RecipeNode]:
    for child in node.children:
        yield from _walk_postorder(child)
    yield node


def _embed_orbits(
    a: np.ndarray,
    e: np.ndarray,
    i_deg: np.ndarray,
    phase: np.ndarray,
    trip_years: float,
) -> np.ndarray:
    """The same five-dimensional embedding used by the single-tier planner."""
    trip_years = max(float(trip_years), 0.1)
    q = (2 / 3) * a**1.5 / (2 * math.pi * trip_years)
    return np.column_stack(
        [
            SQRT_125 * np.log(a),
            SQRT_2 * e,
            SQRT_2 * np.sin(np.radians(i_deg)),
            q * np.cos(phase),
            q * np.sin(phase),
        ]
    )


class RecipeGraph:
    """Expand a product's manufacturing DAG into a recipe tree."""

    def __init__(self, manufacturing: dict, elements: Sequence[str]):
        self.manufacturing = manufacturing
        self.elements = list(elements)
        self.element_set = set(self.elements)
        self.processes: dict[str, dict] = manufacturing.get("processes", {})
        self.materials: dict[str, dict] = manufacturing.get("materials", {})
        self.product_catalogue: dict[str, dict] = manufacturing.get("product_catalogue", {})
        self.external_resources: dict[str, dict] = manufacturing.get("external_resources", {})
        self.producers: dict[str, list[str]] = {}
        for pid, process in self.processes.items():
            for output in process.get("outputs", []) or []:
                material = output.get("material_id")
                if material:
                    self.producers.setdefault(material, []).append(pid)
        self.facility_of_process: dict[str, str] = {}
        for facility, profile in manufacturing.get("facility_profiles", {}).items():
            for pid in profile.get("candidate_process_ids", []) or []:
                self.facility_of_process.setdefault(pid, facility)

    # ------------------------------------------------------------- materials
    @lru_cache(maxsize=None)
    def material_components(self, material_id: str) -> dict[str, float]:
        """Element mass fractions for a raw material, or ``{}`` if unknown."""
        material = self.materials.get(material_id, {})
        composition = material.get("composition", {}) or {}
        components = composition.get("components") or []
        fractions = composition.get("component_mass_fractions")

        mapped: dict[str, float] = {}
        if components:
            if isinstance(fractions, Mapping):
                weights = [float(fractions.get(c, 0.0) or 0.0) for c in components]
            elif isinstance(fractions, Sequence) and not isinstance(fractions, (str, bytes)):
                weights = [float(v or 0.0) for v in fractions]
            else:
                weights = [1.0 / len(components)] * len(components)
            total = sum(weights)
            if total <= 0:
                weights = [1.0 / len(components)] * len(components)
                total = 1.0
            for component, weight in zip(components, weights):
                share = weight / total
                for element, fraction in self._component_elements(str(component)).items():
                    mapped[element] = mapped.get(element, 0.0) + share * fraction

        if not mapped:
            for fragment, element in NAME_ELEMENTS:
                if fragment in material_id.lower() and element in self.element_set:
                    mapped[element] = 1.0
                    break
        if not mapped:
            for symbol in ELEMENT_SYMBOL.findall(material_id):
                if symbol in self.element_set:
                    mapped[symbol] = 1.0
                    break
        return mapped

    def _component_elements(self, component: str) -> dict[str, float]:
        if component in self.element_set:
            return {component: 1.0}
        if component in COMPOUND_ELEMENTS:
            return {
                element: fraction
                for element, fraction in COMPOUND_ELEMENTS[component].items()
                if element in self.element_set
            }
        # Last resort: a symbol embedded in the component name.
        for symbol in ELEMENT_SYMBOL.findall(component):
            if symbol in self.element_set:
                return {symbol: 1.0}
        return {}

    def is_raw(self, material_id: str) -> bool:
        return not self.producers.get(material_id) and bool(self.material_components(material_id))

    def is_external(self, material_id: str) -> bool:
        return not self.producers.get(material_id) and not self.material_components(material_id)

    # --------------------------------------------------------------- recipes
    @lru_cache(maxsize=None)
    def recipe(self, process_id: str, target: str) -> Recipe:
        process = self.processes[process_id]
        inputs: dict[str, float] = {}
        inferred = False
        for entry in process.get("inputs", []) or []:
            if not entry.get("required", True):
                continue
            if entry.get("consumed") is False:
                continue
            role = str(entry.get("role", "")).lower()
            if any(word in role for word in NON_MATERIAL_ROLES):
                continue
            material = entry.get("material_id")
            if not material:
                continue
            quantity = entry.get("kg_per_kg_main_feed")
            if quantity is None:
                quantity = entry.get("quantity_per_batch")
            if quantity is None:
                quantity = 1.0
                inferred = True
            inputs[material] = inputs.get(material, 0.0) + float(quantity)

        outputs: dict[str, float] = {}
        for entry in process.get("outputs", []) or []:
            material = entry.get("material_id")
            if not material:
                continue
            quantity = entry.get("kg_per_kg_main_feed")
            if quantity is None:
                quantity = entry.get("quantity_per_batch")
            if quantity is None:
                quantity = 1.0
                inferred = True
            outputs[material] = outputs.get(material, 0.0) + float(quantity)

        target_output = outputs.get(target)
        if target_output is None:
            # The target may be a downstream material not explicitly listed;
            # treat the process as yielding one unit of it.
            target_output = 1.0
            outputs[target] = 1.0
            inferred = True
        if target_output <= 0:
            target_output = 1.0
        inputs = {name: value / target_output for name, value in inputs.items()}
        outputs = {name: value / target_output for name, value in outputs.items()}
        outputs[target] = 1.0

        equipment: dict[str, float] = {}
        for item in process.get("equipment_ids", []) or []:
            equipment[str(item)] = 1.0
        for item in process.get("site_equipment_ids", []) or []:
            equipment[str(item)] = 1.0

        return Recipe(
            process_id=process_id,
            target=target,
            inputs=inputs,
            outputs=outputs,
            equipment=equipment,
            group=process.get("group"),
            facility=self.facility_of_process.get(process_id),
            quantities_inferred=inferred,
        )

    def _producer_score(self, process_id: str, material: str) -> float:
        recipe = self.recipe(process_id, material)
        score = 0.0
        for input_material in recipe.inputs:
            if self.is_raw(input_material):
                score += 2.0
            elif self.producers.get(input_material):
                score += 1.0
            else:
                score -= 0.25
        if self.processes[process_id].get("group") == "feedstock_qualification":
            score += 0.1
        return score

    def choose_producer(self, material: str, route: Mapping[str, str] | None = None) -> str | None:
        producers = self.producers.get(material, [])
        if not producers:
            return None
        if route and material in route:
            chosen = route[material]
            if chosen not in producers:
                raise ValueError(f"{chosen!r} does not produce {material!r}")
            return chosen
        return max(producers, key=lambda pid: (self._producer_score(pid, material), pid))

    # -------------------------------------------------------------- expansion
    def expand(
        self,
        product_id: str,
        demand: float = 1.0,
        *,
        route: Mapping[str, str] | None = None,
        max_nodes: int = 5000,
    ) -> RecipeNode:
        product = self.product_catalogue.get(product_id)
        if product is None:
            raise KeyError(f"unknown product {product_id!r}")
        target = product.get("target_material_id")
        if not target:
            raise KeyError(f"product {product_id!r} has no target_material_id")
        counter = [0]
        root = self._expand(target, float(demand), route or {}, (), counter, max_nodes)
        return root

    def _expand(
        self,
        material: str,
        demand: float,
        route: Mapping[str, str],
        stack: tuple[str, ...],
        counter: list[int],
        max_nodes: int,
    ) -> RecipeNode:
        counter[0] += 1
        if counter[0] > max_nodes:
            return RecipeNode(material=material, demand=demand, is_external=True, tier=0)
        if material in stack:
            # A generation-separated feedback edge: treat it as an Earth import.
            return RecipeNode(material=material, demand=demand, is_external=True, tier=0)

        process_id = self.choose_producer(material, route)
        if process_id is None:
            components = self.material_components(material)
            return RecipeNode(
                material=material,
                demand=demand,
                tier=0,
                is_raw=bool(components),
                is_external=not components,
            )

        recipe = self.recipe(process_id, material)
        node = RecipeNode(
            material=material,
            demand=demand,
            process_id=process_id,
            recipe=recipe,
            group=recipe.group,
            facility=recipe.facility,
        )
        for input_material, quantity in recipe.inputs.items():
            child = self._expand(
                input_material,
                demand * quantity,
                route,
                stack + (material,),
                counter,
                max_nodes,
            )
            node.children.append(child)
        local_tiers = [child.tier for child in node.children if not child.is_external]
        node.tier = 1 + (max(local_tiers) if local_tiers else -1)
        return node


@dataclass
class SourcePoint:
    """A weighted supply point for one tier of the facility network."""

    a: float
    e: float
    i_deg: float
    phase: float
    weight: float
    material: str
    amount: dict[str, float] = field(default_factory=dict)
    origin: str = ""
    index: int | None = None
    asteroid_indices: list[int] = field(default_factory=list)


class HierarchicalPlanner:
    """Recursive weighted geometric-median station placement along the manufacturing DAG."""

    def __init__(self, planner: StationPlanner, recipes: RecipeGraph):
        self.planner = planner
        self.recipes = recipes

    @classmethod
    def from_files(cls, asteroids_path: str | Path, root: str | Path) -> "HierarchicalPlanner":
        planner = StationPlanner.from_files(asteroids_path, root)
        mfg_path = Path(root) / "Space_Industrial_Manufacturing_DAG.json"
        manufacturing = json.loads(mfg_path.read_text(encoding="utf-8"))
        recipes = RecipeGraph(manufacturing, planner.sampling.elements)
        return cls(planner, recipes)

    # ---------------------------------------------------------------- helpers
    def _asteroid_rows(
        self,
        include_outer: bool,
        mask: np.ndarray | None,
    ) -> np.ndarray:
        planned = self.planner.valid.copy()
        if mask is not None:
            planned &= mask.astype(bool)
        if not include_outer:
            planned &= ~self.planner.asteroids.outer
        return np.flatnonzero(planned)

    def _raw_sources(
        self,
        root: RecipeNode,
        rows: np.ndarray,
        trip_years: float,
        *,
        grade_override: np.ndarray | None = None,
    ) -> list[SourcePoint]:
        demand: dict[str, float] = {}
        for node in _walk(root):
            if not node.is_raw:
                continue
            for element, fraction in self.recipes.material_components(node.material).items():
                demand[element] = demand.get(element, 0.0) + node.demand * fraction
        total_demand = sum(demand.values())
        if total_demand <= 0:
            return []

        sm = self.planner.sampling
        scen = self.planner.scenario[rows]
        mass = self.planner.mass[rows]
        grade = sm.grade if grade_override is None else grade_override
        available = np.zeros((len(rows), len(sm.elements)))
        for element, required in demand.items():
            if element not in sm.elements:
                continue
            e = sm.elements.index(element)
            scenario = np.maximum(scen, 0)
            available[:, e] = mass * grade[scenario, e] / 1000.0
        if available.size == 0:
            return []
        shares = np.array(
            [demand.get(element, 0.0) / total_demand for element in sm.elements]
        )
        weight = available @ shares
        keep = weight > 0
        if not keep.any():
            return []
        rows = rows[keep]
        available = available[keep]
        weight = weight[keep]
        a = self.planner.asteroids.a[rows]
        e = self.planner.asteroids.e[rows]
        inc = self.planner.asteroids.i_deg[rows]
        phase = self.planner.phase[rows]
        X = _embed_orbits(a, e, inc, phase, trip_years)
        of, cX, cw = self.planner._cells(X, phase, weight)
        amounts = np.zeros((len(cw), len(sm.elements)))
        np.add.at(amounts, of, available)
        sources: list[SourcePoint] = []
        for c in range(len(cw)):
            if cw[c] <= 0:
                continue
            station_a = math.exp(cX[c, 0] / SQRT_125)
            sources.append(
                SourcePoint(
                    a=station_a,
                    e=max(0.0, cX[c, 1] / SQRT_2),
                    i_deg=math.degrees(math.asin(min(1.0, max(0.0, cX[c, 2] / SQRT_2)))),
                    phase=math.atan2(cX[c, 4], cX[c, 3]),
                    weight=float(cw[c]),
                    material="raw",
                    amount={
                        element: float(amounts[c, e])
                        for e, element in enumerate(sm.elements)
                        if amounts[c, e] > 0
                    },
                    origin="asteroid-cell",
                    index=None,
                    asteroid_indices=rows[of == c].astype(int).tolist(),
                )
            )
        return sources

    def _place_sources(
        self,
        sources: Sequence[SourcePoint],
        k: int,
        trip_years: float,
        *,
        tier: int,
        process_id: str | None,
        material: str,
        rng: np.random.Generator,
    ) -> list[dict]:
        usable = [source for source in sources if source.weight > 0]
        if not usable:
            return []
        k = int(min(max(k, 1), MAX_STATIONS, len(usable)))
        a = np.array([source.a for source in usable], dtype=float)
        e = np.array([source.e for source in usable], dtype=float)
        inc = np.array([source.i_deg for source in usable], dtype=float)
        phase = np.array([source.phase for source in usable], dtype=float)
        w = np.array([source.weight for source in usable], dtype=float)
        X = _embed_orbits(a, e, inc, phase, trip_years)

        best, best_i, iterations = None, math.inf, 0
        for _ in range(RESTARTS):
            C, labels, it = _weber(X, w, _weber_pp(X, w, k, rng), MAX_ITER)
            iterations += it
            cost = _weber_cost(X, w, labels, C)
            if cost < best_i:
                best, best_i = C, cost
        C, labels, it = _weber(X, w, best, MAX_ITER)
        iterations += it

        held = np.bincount(labels, weights=w, minlength=k)
        order = np.argsort(-held, kind="stable")
        rank = np.empty(k, dtype=np.int64)
        rank[order] = np.arange(k)
        C = C[order]
        labels = rank[labels]
        held = held[order]
        total_w = float(held.sum())

        result: list[dict] = []
        for c in range(k):
            members = np.flatnonzero(labels == c)
            if members.size == 0:
                continue
            station_a = math.exp(C[c, 0] / SQRT_125)
            v = V_EARTH_KMS / math.sqrt(station_a)
            lon = math.atan2(C[c, 4], C[c, 3])
            dv = v * np.sqrt(((X[members] - C[c]) ** 2).sum(1))
            wm = w[members]
            station_held = wm.sum()
            if station_held > 0:
                order_dv = np.argsort(dv)
                cum = np.cumsum(wm[order_dv])
                dv_median = float(dv[order_dv][np.searchsorted(cum, station_held / 2)])
            else:
                dv_median = 0.0
            top = members[np.argsort(-wm, kind="stable")[:TOP_MEMBERS]]
            top = top[w[top] > 0]
            top_dv = v * np.sqrt(((X[top] - C[c]) ** 2).sum(1))
            amount: dict[str, float] = {}
            for j in members:
                for name, value in usable[j].amount.items():
                    amount[name] = amount.get(name, 0.0) + value
            result.append(
                {
                    "tier": tier,
                    "process": process_id,
                    "material": material,
                    "a": station_a,
                    "e": max(0.0, C[c, 1] / SQRT_2),
                    "i": math.degrees(math.asin(min(1.0, max(0.0, C[c, 2] / SQRT_2)))),
                    "longitude": math.degrees(lon),
                    "members": int(len(members)),
                    "share": float(station_held / total_w) if total_w > 0 else 0.0,
                    "dvMedian": dv_median,
                    "output": amount,
                    "asteroidIndices": [index for j in members for index in usable[j].asteroid_indices],
                    "topMembers": [
                        {
                            "index": int(usable[j].index) if usable[j].index is not None else int(j),
                            "origin": usable[j].origin,
                            "tonnes": float(w[j]),
                            "dv": float(d),
                            "offsetDeg": float(np.degrees(_wrap(usable[j].phase - lon))),
                        }
                        for j, d in zip(top, top_dv)
                    ],
                    "iterations": iterations,
                }
            )
        return result

    def _process_sources(self, node: RecipeNode, tier0: Sequence[dict]) -> tuple[list[SourcePoint], dict[str, float]]:
        sources: list[SourcePoint] = []
        external: dict[str, float] = {}
        for child in node.children:
            required_kg = child.demand
            if child.is_external:
                external[child.material] = external.get(child.material, 0.0) + required_kg
                continue
            required_t = required_kg / 1000.0
            if child.is_raw:
                components = self.recipes.material_components(child.material)
                for station in tier0:
                    available = sum(
                        fraction * station["output"].get(element, 0.0)
                        for element, fraction in components.items()
                    )
                    weight = min(available, required_t)
                    if weight <= 0:
                        continue
                    sources.append(
                        SourcePoint(
                            a=station["a"],
                            e=station["e"],
                            i_deg=station["i"],
                            phase=math.radians(station["longitude"]),
                            weight=weight,
                            material=child.material,
                            amount={child.material: available},
                            origin="tier0",
                            index=None,
                        )
                    )
            else:
                for station in child.stations:
                    available = station["output"].get(child.material, 0.0)
                    weight = min(available, required_t)
                    if weight <= 0:
                        continue
                    sources.append(
                        SourcePoint(
                            a=station["a"],
                            e=station["e"],
                            i_deg=station["i"],
                            phase=math.radians(station["longitude"]),
                            weight=weight,
                            material=child.material,
                            amount={child.material: available},
                            origin=f"tier{child.tier}",
                            index=None,
                        )
                    )
        return sources, external

    def _station_outputs(self, node: RecipeNode, stations: Sequence[dict]) -> None:
        recipe = node.recipe
        if recipe is None:
            return
        local_names = {
            child.material for child in node.children if not child.is_external
        }
        local_inputs = {
            name: quantity
            for name, quantity in recipe.inputs.items()
            if name in local_names and quantity > 0
        }
        for station in stations:
            inputs = {
                name: min(value, node.demand * recipe.inputs.get(name, 0.0) / 1000.0)
                for name, value in station["output"].items()
                if name in recipe.inputs
            }
            if local_inputs:
                capacity_kg = min(
                    inputs.get(name, 0.0) * 1000.0 / quantity
                    for name, quantity in local_inputs.items()
                )
            else:
                capacity_kg = node.demand
            station["inputs"] = inputs
            station["output"] = {
                name: capacity_kg * quantity / 1000.0
                for name, quantity in recipe.outputs.items()
            }

    # ------------------------------------------------------------------- main
    def plan(
        self,
        product_id: str,
        stations: int = 3,
        trip_years: float = 2.0,
        include_outer: bool = False,
        draws: int = 0,
        mask: np.ndarray | None = None,
        seed: int = 7,
        route: Mapping[str, str] | None = None,
        stations_per_tier: Sequence[int] | None = None,
    ) -> dict:
        if draws:
            raise ValueError("Monte Carlo is not implemented for the tiered planner yet")
        t0 = time.perf_counter()
        k = int(min(max(stations, 1), MAX_STATIONS))
        trip_years = max(float(trip_years), 0.1)
        rng = np.random.default_rng(seed)
        root = self.recipes.expand(product_id, route=route)
        max_tier = max((node.tier for node in _walk(root)), default=0)
        if stations_per_tier is None:
            k_by_tier = [k] * (max_tier + 1)
        else:
            k_by_tier = [int(min(max(v, 1), MAX_STATIONS)) for v in stations_per_tier]
            if not k_by_tier:
                k_by_tier = [k]
            if len(k_by_tier) <= max_tier:
                k_by_tier.extend([k_by_tier[-1]] * (max_tier + 1 - len(k_by_tier)))

        rows = self._asteroid_rows(include_outer, mask)
        tier0: list[dict] = []
        if rows.size:
            raw_sources = self._raw_sources(root, rows, trip_years)
            tier0 = self._place_sources(
                raw_sources,
                k_by_tier[0],
                trip_years,
                tier=0,
                process_id=None,
                material="raw feedstocks",
                rng=rng,
            )

        for node in _walk_postorder(root):
            if node.is_raw or node.is_external or node.recipe is None:
                continue
            sources, _ = self._process_sources(node, tier0)
            if not sources:
                node.stations = []
                continue
            node.stations = self._place_sources(
                sources,
                k_by_tier[node.tier] if node.tier < len(k_by_tier) else k,
                trip_years,
                tier=node.tier,
                process_id=node.process_id,
                material=node.material,
                rng=rng,
            )
            self._station_outputs(node, node.stations)

        tier_groups: dict[int, list[dict]] = {}
        for node in _walk(root):
            for station in node.stations:
                station["nodeMaterial"] = node.material
                station["nodeProcess"] = node.process_id
                tier_groups.setdefault(station["tier"], []).append(station)
        for station in tier0:
            station["nodeMaterial"] = "raw feedstocks"
            station["nodeProcess"] = None

        asteroid_assignment = np.full(self.planner.asteroids.count, 255, dtype=np.uint8)
        for station_index, station in enumerate(tier0):
            asteroid_assignment[np.asarray(station.pop("asteroidIndices", []), dtype=np.int64)] = station_index
        for station in (station for group in tier_groups.values() for station in group):
            station.pop("asteroidIndices", None)
        tier_groups.setdefault(0, []).extend(tier0)

        tiers = [
            {
                "tier": tier,
                "stations": tier_groups.get(tier, []),
            }
            for tier in range(max_tier + 1)
        ]
        return {
            "product": product_id,
            "productLabel": self.recipes.product_catalogue.get(product_id, {}).get("label", product_id),
            "tree": root.to_dict(),
            "tiers": tiers,
            "stations": [station for tier in tiers for station in tier["stations"]],
            "asteroidAssignment": base64.b64encode(asteroid_assignment.tobytes()).decode("ascii"),
            "draws": 0,
            "tripYears": trip_years,
            "ms": (time.perf_counter() - t0) * 1000,
        }
