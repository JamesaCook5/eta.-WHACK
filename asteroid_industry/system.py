"""High-level asteroid -> feedstock -> industrial output assessment."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from typing import Iterable, Mapping, Sequence

import numpy as np

from .asteroid import Asteroid, ResourceEstimate, estimate_resources
from .composition import CompositionModel
from .model import IndustrialModel, ProductionPotential, ProductionResult, RequiredInputs
from .processes import ProcessGraph


@dataclass
class AsteroidAssessment:
    """What one asteroid can plausibly feed into the process DAG."""

    asteroid_id: str
    name: str
    surface_type: str
    mass_kg: float
    n_samples: int
    inventory_mean: dict[str, float] = field(default_factory=dict)
    produced_mean: dict[str, float] = field(default_factory=dict)
    terminal_outputs: dict[str, float] = field(default_factory=dict)
    producible_probability: dict[str, float] = field(default_factory=dict)
    potentials: dict[str, ProductionPotential] = field(default_factory=dict)
    blocked: dict[str, list[str]] = field(default_factory=dict)
    result: ProductionResult | None = None

    def summary(self) -> str:
        lines = [
            f"{self.name} [{self.surface_type}]  mass = {self.mass_kg:.3e} kg  "
            f"({self.n_samples} Monte Carlo sample(s))",
            "Terminal outputs (max units if dedicated to that product):",
        ]
        if self.terminal_outputs:
            for name in sorted(self.terminal_outputs, key=lambda k: -self.terminal_outputs[k]):
                probability = self.producible_probability.get(name, 1.0)
                lines.append(
                    f"  {name:<24} {self.terminal_outputs[name]:12.3e} units  "
                    f"({probability:.0%} of samples)"
                )
        else:
            lines.append("  (none)")
        if self.blocked:
            lines.append("Blocked processes:")
            for pid, reasons in sorted(self.blocked.items()):
                lines.append(f"  {pid}: {'; '.join(reasons)}")
        return "\n".join(lines)


class IndustrialSystem:
    """Bundle composition sampling, asteroid inventory and a process graph."""

    def __init__(
        self,
        graph: ProcessGraph,
        composition: CompositionModel | None = None,
        equipment: Mapping[str, float] | None = None,
        *,
        earth_inventory: Mapping[str, float] | None = None,
        earth_sourced: Iterable[str] | None = None,
    ):
        self.graph = graph
        self.composition = composition or CompositionModel()
        self.equipment = dict(equipment or {})
        self.earth_inventory = (
            None if earth_inventory is None else dict(earth_inventory)
        )
        # Extra names to treat as Earth imports, on top of process-level tags.
        self.earth_sourced = set(earth_sourced or ())

    # ------------------------------------------------------------- inventories
    def expected_inventory(self, asteroid: Asteroid) -> dict[str, float]:
        if not asteroid.mass_kg:
            raise ValueError(f"asteroid {asteroid.id!r} has no estimated mass")
        fractions = self.composition.expected_feedstocks(asteroid.surface_type)
        return {name: value * asteroid.mass_kg for name, value in fractions.items()}

    def resource_estimate(
        self,
        asteroid: Asteroid,
        n_samples: int = 1000,
        *,
        rng: np.random.Generator | None = None,
    ) -> ResourceEstimate:
        return estimate_resources(asteroid, self.composition, n_samples, rng=rng)

    # --------------------------------------------------------------- analysis
    def model(
        self,
        inventory: Mapping[str, float],
        equipment: Mapping[str, float] | None = None,
    ) -> IndustrialModel:
        return IndustrialModel(
            self.graph,
            inventory=inventory,
            equipment=self.equipment if equipment is None else equipment,
            earth_inventory=self.earth_inventory,
            earth_sourced=self.earth_sourced | self.graph.earth_materials,
        )

    def required_inputs(
        self,
        target: str,
        quantity: float = 1.0,
        *,
        route: Mapping[str, str] | None = None,
        manufacture_equipment: bool = False,
    ) -> RequiredInputs:
        return self.model({}).required_inputs(
            target,
            quantity,
            route=route,
            manufacture_equipment=manufacture_equipment,
        )

    def assess(
        self,
        asteroid: Asteroid,
        *,
        n_samples: int = 1,
        equipment: Mapping[str, float] | None = None,
        time_days: float | None = None,
        seed: int | None = None,
        rng: np.random.Generator | None = None,
    ) -> AsteroidAssessment:
        """Assess producible outputs for one asteroid.

        ``n_samples == 1`` uses the midpoint composition.  Larger values run a
        Monte Carlo over sampled, normalised mineral compositions.  For each
        terminal product, quantity is the maximum the asteroid could support if
        its inventory were dedicated to that product.
        """
        if not asteroid.mass_kg:
            raise ValueError(f"asteroid {asteroid.id!r} has no estimated mass")
        equipment = self.equipment if equipment is None else equipment

        if n_samples <= 1:
            inventory = self.expected_inventory(asteroid)
            model = self.model(inventory, equipment)
            reachable, blocked = model.reachability(assume_all_raw=False)

            # Equipment that is reachable (manufacturable) is assumed available
            # for the product calculation.  Its one-off material cost is not yet
            # subtracted from the asteroid budget.
            effective_equipment = dict(equipment)
            for item in self.graph.equipment_items:
                if item in reachable:
                    effective_equipment[item] = max(
                        effective_equipment.get(item, 0.0), 1.0
                    )
            model = self.model(inventory, effective_equipment)

            potentials: dict[str, ProductionPotential] = {}
            for target in sorted(self.graph.terminal_materials):
                if target not in reachable:
                    continue
                potential = model.max_production(target, time_days=time_days)
                if potential.feasible and potential.quantity > 0:
                    potentials[target] = potential

            terminal = {name: p.quantity for name, p in potentials.items()}
            return AsteroidAssessment(
                asteroid_id=asteroid.id,
                name=asteroid.name,
                surface_type=asteroid.surface_type,
                mass_kg=asteroid.mass_kg,
                n_samples=1,
                inventory_mean=inventory,
                produced_mean=dict(terminal),
                terminal_outputs=terminal,
                producible_probability={name: 1.0 for name in terminal},
                potentials=potentials,
                blocked=blocked,
            )

        rng = rng or np.random.default_rng(seed)
        names, fractions = self.composition.feedstock_matrix(
            asteroid.surface_type, n=n_samples, rng=rng
        )

        terminal_sum: dict[str, float] = defaultdict(float)
        terminal_hits: dict[str, int] = defaultdict(int)
        earth_sum: dict[str, dict[str, float]] = defaultdict(
            lambda: defaultdict(float)
        )
        earth_equipment_max: dict[str, dict[str, float]] = defaultdict(dict)
        blocked_threshold: dict[str, dict[str, int]] = defaultdict(
            lambda: defaultdict(int)
        )

        base_model = self.model({}, equipment)
        base_demands = {
            target: base_model.required_inputs(target, 1.0)
            for target in self.graph.terminal_materials
        }

        for row in fractions:
            inventory = {
                name: float(row[i]) * asteroid.mass_kg
                for i, name in enumerate(names)
            }
            model = self.model(inventory, equipment)
            reachable, blocked = model.reachability(assume_all_raw=False)

            effective_equipment = dict(equipment)
            for item in self.graph.equipment_items:
                if item in reachable:
                    effective_equipment[item] = max(
                        effective_equipment.get(item, 0.0), 1.0
                    )
            model = self.model(inventory, effective_equipment)

            for target in self.graph.terminal_materials:
                if target not in reachable:
                    continue
                potential = model.max_production(target, time_days=time_days)
                if potential.feasible and potential.quantity > 0:
                    terminal_sum[target] += potential.quantity
                    terminal_hits[target] += 1
                    for material, amount in potential.total_earth_inputs.items():
                        earth_sum[target][material] += amount
                    for item, amount in potential.earth_equipment.items():
                        earth_equipment_max[target][item] = max(
                            earth_equipment_max[target].get(item, 0.0), amount
                        )

            for pid, reasons in blocked.items():
                for reason in reasons:
                    blocked_threshold[pid][reason] += 1

        inv_mean = {
            name: float(fractions[:, i].mean()) * asteroid.mass_kg
            for i, name in enumerate(names)
        }
        blocked = {}
        for pid, reasons in blocked_threshold.items():
            blocked[pid] = [
                f"{reason} ({count}/{n_samples} samples)"
                for reason, count in reasons.items()
            ]

        potentials: dict[str, ProductionPotential] = {}
        for target, total in terminal_sum.items():
            mean_quantity = total / n_samples
            base = base_demands[target]
            total_earth = {
                material: amount / n_samples
                for material, amount in earth_sum[target].items()
            }
            potentials[target] = ProductionPotential(
                target=target,
                quantity=mean_quantity,
                per_unit_raw_inputs=dict(base.raw_inputs),
                total_raw_inputs={
                    material: required * mean_quantity
                    for material, required in base.raw_inputs.items()
                },
                per_unit_earth_inputs={
                    material: (
                        amount / mean_quantity if mean_quantity > 0 else 0.0
                    )
                    for material, amount in total_earth.items()
                },
                total_earth_inputs=total_earth,
                equipment=dict(base.equipment),
                earth_equipment=dict(earth_equipment_max[target]),
                feasible=mean_quantity > 0,
                probability=terminal_hits[target] / n_samples,
            )

        return AsteroidAssessment(
            asteroid_id=asteroid.id,
            name=asteroid.name,
            surface_type=asteroid.surface_type,
            mass_kg=asteroid.mass_kg,
            n_samples=n_samples,
            inventory_mean=inv_mean,
            produced_mean={
                name: terminal_sum[name] / n_samples for name in terminal_sum
            },
            terminal_outputs={
                name: terminal_sum[name] / n_samples for name in terminal_sum
            },
            producible_probability={
                name: terminal_hits[name] / n_samples for name in terminal_hits
            },
            potentials=potentials,
            blocked=blocked,
        )

    def assess_catalog(
        self,
        asteroids: Iterable[Asteroid],
        **kwargs,
    ) -> list[AsteroidAssessment]:
        return [self.assess(asteroid, **kwargs) for asteroid in asteroids]

    # ------------------------------------------------------------- spatial maps
    def spatial_maps(
        self,
        asteroids: Iterable[Asteroid],
        *,
        targets: Iterable[str] | None = None,
        **kwargs,
    ):
        """Aggregate output and Earth-demand maps over a set of asteroids.

        See :func:`asteroid_industry.spatial.build_spatial_maps`.
        """
        from .spatial import build_spatial_maps

        return build_spatial_maps(self, asteroids, targets=targets, **kwargs)

    def spatial_map(
        self,
        asteroids: Iterable[Asteroid],
        target: str,
        **kwargs,
    ):
        """Aggregate one target product's output/Earth-demand map."""
        return self.spatial_maps(
            asteroids, targets=[target], **kwargs
        )[target]

    def validate_against_composition(self) -> dict[str, list[str]]:
        """Report process feedstocks that the composition model cannot supply.

        Returns ``{"missing_from_composition": [...],
        "unused_asteroid_feedstocks": [...]}``.
        """
        feedstocks = set(self.composition.feedstocks)
        raw = (
            set(self.graph.raw_materials)
            - set(self.graph.equipment_items)
            - self.earth_sourced
        )
        return {
            "missing_from_composition": sorted(raw - feedstocks),
            "unused_asteroid_feedstocks": sorted(feedstocks - raw),
        }
