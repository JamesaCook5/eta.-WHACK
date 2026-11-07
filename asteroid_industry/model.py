"""Material-flow model over a unit-operation process DAG."""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Iterable, Mapping

from .processes import Process, ProcessGraph


@dataclass
class ProductionResult:
    """Snapshot of one forward simulation."""

    inventory_start: dict[str, float]
    equipment_start: dict[str, float]
    inventory_end: dict[str, float] = field(default_factory=dict)
    equipment_end: dict[str, float] = field(default_factory=dict)
    produced: dict[str, float] = field(default_factory=dict)
    consumed: dict[str, float] = field(default_factory=dict)
    earth_consumed: dict[str, float] = field(default_factory=dict)
    runs: dict[str, float] = field(default_factory=dict)
    blocked: dict[str, list[str]] = field(default_factory=dict)
    time_days: float | None = None

    def producible(self) -> set[str]:
        return {name for name, amount in self.produced.items() if amount > 0}

    def terminal_outputs(self, graph: ProcessGraph) -> dict[str, float]:
        terminal = graph.terminal_materials
        return {
            name: amount
            for name, amount in self.produced.items()
            if amount > 0 and name in terminal
        }

    def to_dict(self) -> dict:
        return {
            "time_days": self.time_days,
            "produced": dict(self.produced),
            "consumed": dict(self.consumed),
            "earth_consumed": dict(self.earth_consumed),
            "runs": dict(self.runs),
            "blocked": {k: list(v) for k, v in self.blocked.items()},
            "inventory_end": dict(self.inventory_end),
            "equipment_end": dict(self.equipment_end),
        }


@dataclass
class RequiredInputs:
    """Backward demand expansion for one target material."""

    target: str
    quantity: float
    raw_inputs: dict[str, float] = field(default_factory=dict)
    earth_inputs: dict[str, float] = field(default_factory=dict)
    equipment: dict[str, float] = field(default_factory=dict)
    earth_equipment: dict[str, float] = field(default_factory=dict)
    processes: dict[str, float] = field(default_factory=dict)
    byproducts: dict[str, float] = field(default_factory=dict)
    manufactured_equipment: dict[str, float] = field(default_factory=dict)

    def missing(
        self,
        available_materials: Mapping[str, float] | None = None,
        available_equipment: Mapping[str, float] | None = None,
    ) -> "RequiredInputs":
        """Return a copy with available inventory/equipment subtracted."""
        materials = dict(available_materials or {})
        equipment = dict(available_equipment or {})
        raw = {
            name: max(0.0, amount - materials.get(name, 0.0))
            for name, amount in self.raw_inputs.items()
        }
        equip = {
            name: max(0.0, amount - equipment.get(name, 0.0))
            for name, amount in self.equipment.items()
        }
        return RequiredInputs(
            target=self.target,
            quantity=self.quantity,
            raw_inputs={k: v for k, v in raw.items() if v > 0},
            earth_inputs=dict(self.earth_inputs),
            equipment={k: v for k, v in equip.items() if v > 0},
            earth_equipment=dict(self.earth_equipment),
            processes=dict(self.processes),
            byproducts=dict(self.byproducts),
            manufactured_equipment=dict(self.manufactured_equipment),
        )

    def to_dict(self) -> dict:
        return {
            "target": self.target,
            "quantity": self.quantity,
            "raw_inputs": dict(self.raw_inputs),
            "earth_inputs": dict(self.earth_inputs),
            "equipment": dict(self.equipment),
            "earth_equipment": dict(self.earth_equipment),
            "processes": dict(self.processes),
            "byproducts": dict(self.byproducts),
            "manufactured_equipment": dict(self.manufactured_equipment),
        }


@dataclass
class ProductionPotential:
    """Maximum amount of one target that a fixed inventory can support.

    This assumes the asteroid's inventory is dedicated to this target, which is
    the right first-pass question when comparing possible products.  It does not
    solve a multi-product allocation problem (yet).
    """

    target: str
    quantity: float
    per_unit_raw_inputs: dict[str, float] = field(default_factory=dict)
    total_raw_inputs: dict[str, float] = field(default_factory=dict)
    per_unit_earth_inputs: dict[str, float] = field(default_factory=dict)
    total_earth_inputs: dict[str, float] = field(default_factory=dict)
    equipment: dict[str, float] = field(default_factory=dict)
    earth_equipment: dict[str, float] = field(default_factory=dict)
    limiting_inputs: list[str] = field(default_factory=list)
    feasible: bool = False
    probability: float = 1.0
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "target": self.target,
            "quantity": self.quantity,
            "per_unit_raw_inputs": dict(self.per_unit_raw_inputs),
            "total_raw_inputs": dict(self.total_raw_inputs),
            "per_unit_earth_inputs": dict(self.per_unit_earth_inputs),
            "total_earth_inputs": dict(self.total_earth_inputs),
            "equipment": dict(self.equipment),
            "earth_equipment": dict(self.earth_equipment),
            "limiting_inputs": list(self.limiting_inputs),
            "feasible": self.feasible,
            "probability": self.probability,
            "notes": list(self.notes),
        }


class IndustrialModel:
    """Run the process DAG against a feedstock inventory.

    Forward mode answers *what can this asteroid produce?*  Backward mode
    answers *what inputs and equipment are needed to make a target?*
    """

    def __init__(
        self,
        graph: ProcessGraph,
        inventory: Mapping[str, float] | None = None,
        equipment: Mapping[str, float] | None = None,
        *,
        earth_inventory: Mapping[str, float] | None = None,
        earth_sourced: Iterable[str] | None = None,
    ):
        self.graph = graph
        self.inventory = {
            str(k): float(v) for k, v in (inventory or {}).items() if float(v) > 0
        }
        self.equipment = {
            str(k): float(v) for k, v in (equipment or {}).items() if float(v) > 0
        }
        # ``None`` means "Earth supply is unlimited" (useful for demand maps).
        self.earth_inventory: dict[str, float] | None = (
            None
            if earth_inventory is None
            else {
                str(k): float(v)
                for k, v in earth_inventory.items()
                if float(v) > 0
            }
        )
        # Materials/equipment that must be imported from Earth even if they
        # appear in ordinary ``inputs``/``equipment`` entries.
        self.earth_sourced: set[str] = set(earth_sourced or ())

    # ---------------------------------------------------------------- forward
    def forward_closure(
        self,
        time_days: float | None = None,
        *,
        max_scale: float | None = None,
    ) -> ProductionResult:
        """Run every process once, in topological order.

        Each process is scaled by the most limiting input.  Equipment is
        reusable and is not consumed; if a process produces equipment, that
        equipment becomes available to later processes.  With ``time_days`` set,
        per-process throughput (and the number of machines) caps the batch scale.
        """
        inventory = defaultdict(float, self.inventory)
        equipment = defaultdict(float, self.equipment)
        earth_inventory = (
            None
            if self.earth_inventory is None
            else defaultdict(float, self.earth_inventory)
        )
        produced: dict[str, float] = defaultdict(float)
        consumed: dict[str, float] = defaultdict(float)
        earth_consumed: dict[str, float] = defaultdict(float)
        runs: dict[str, float] = {}
        blocked: dict[str, list[str]] = {}

        for process_id in self.graph.order:
            process = self.graph.process(process_id)
            earth_inputs = dict(process.earth_inputs)
            for name, required in process.inputs.items():
                if name in self.earth_sourced:
                    earth_inputs[name] = earth_inputs.get(name, 0.0) + required
            local_inputs = {
                name: required
                for name, required in process.inputs.items()
                if name not in self.earth_sourced
            }
            local_equipment = {
                item: required
                for item, required in process.equipment.items()
                if item not in self.earth_sourced
            }

            missing_equipment = [
                item
                for item, required in local_equipment.items()
                if equipment.get(item, 0.0) < required
            ]
            if missing_equipment:
                blocked[process_id] = [
                    f"missing equipment: {', '.join(sorted(missing_equipment))}"
                ]
                continue

            missing_inputs = [
                name
                for name, required in local_inputs.items()
                if inventory.get(name, 0.0) < required
            ]
            if missing_inputs:
                blocked[process_id] = [
                    f"missing input: {', '.join(sorted(missing_inputs))}"
                ]
                continue

            if earth_inventory is not None:
                missing_earth = [
                    name
                    for name, required in earth_inputs.items()
                    if earth_inventory.get(name, 0.0) < required
                ]
                if missing_earth:
                    blocked[process_id] = [
                        "missing earth input: "
                        + ", ".join(sorted(missing_earth))
                    ]
                    continue

            ratios = [
                inventory[name] / required
                for name, required in local_inputs.items()
            ]
            if earth_inventory is not None:
                ratios.extend(
                    earth_inventory[name] / required
                    for name, required in earth_inputs.items()
                )
            scale = min(ratios) if ratios else 1.0

            if time_days is not None and process.throughput_kg_per_day is not None:
                if process.total_input_mass > 0:
                    capacity = (
                        process.throughput_kg_per_day
                        * time_days
                        / process.total_input_mass
                    )
                    if local_equipment:
                        machine_factor = min(
                            equipment.get(item, 0.0) / required
                            for item, required in local_equipment.items()
                        )
                        capacity *= machine_factor
                    scale = min(scale, capacity)

            if max_scale is not None:
                scale = min(scale, max_scale)

            if scale <= 1e-15:
                blocked[process_id] = ["scale is zero"]
                continue

            for name, required in local_inputs.items():
                amount = required * scale
                inventory[name] -= amount
                consumed[name] += amount
            for name, required in earth_inputs.items():
                amount = required * scale
                if earth_inventory is not None:
                    earth_inventory[name] -= amount
                earth_consumed[name] += amount
            for name, yielded in process.outputs.items():
                amount = yielded * scale
                produced[name] += amount
                if name in self.graph.equipment_items:
                    equipment[name] += amount
                else:
                    inventory[name] += amount
            runs[process_id] = scale

        return ProductionResult(
            inventory_start=dict(self.inventory),
            equipment_start=dict(self.equipment),
            inventory_end={k: v for k, v in inventory.items() if v > 1e-12},
            equipment_end={k: v for k, v in equipment.items() if v > 1e-12},
            produced={k: v for k, v in produced.items() if v > 1e-12},
            consumed={k: v for k, v in consumed.items() if v > 1e-12},
            earth_consumed={
                k: v for k, v in earth_consumed.items() if v > 1e-12
            },
            runs=runs,
            blocked=blocked,
            time_days=time_days,
        )

    def reachability(
        self,
        *,
        assume_all_raw: bool = True,
        assume_all_equipment: bool = False,
        assume_all_earth: bool = True,
    ) -> tuple[set[str], dict[str, list[str]]]:
        """Boolean reachability plus final per-process blocking reasons.

        Earth inputs/equipment are assumed importable by default.  Set
        ``assume_all_earth=False`` to require them in the model's
        ``earth_inventory`` / ``equipment`` instead.
        """
        available: set[str] = set(self.inventory)
        equipment: set[str] = set(self.equipment)
        if assume_all_raw:
            available.update(self.graph.raw_materials)
        if assume_all_equipment:
            equipment.update(self.graph.equipment_items)
        if assume_all_earth:
            available.update(self.graph.earth_material_inputs)
            equipment.update(self.graph.earth_equipment_items)

        produced: set[str] = set()
        blocked: dict[str, list[str]] = {}
        changed = True
        while changed:
            changed = False
            for process_id in self.graph.order:
                process = self.graph.process(process_id)
                local_equipment = [
                    item
                    for item in process.equipment
                    if item not in self.earth_sourced
                ]
                if not assume_all_earth:
                    local_equipment.extend(process.earth_equipment)
                missing_equipment = [
                    item for item in local_equipment if item not in equipment
                ]
                if missing_equipment:
                    blocked[process_id] = [
                        "missing equipment: " + ", ".join(sorted(missing_equipment))
                    ]
                    continue

                required_inputs = [
                    name
                    for name in process.inputs
                    if name not in self.earth_sourced
                ]
                if not assume_all_earth:
                    required_inputs.extend(process.earth_inputs)
                missing_inputs = [
                    name for name in required_inputs if name not in available
                ]
                if missing_inputs:
                    blocked[process_id] = [
                        "missing input: " + ", ".join(sorted(missing_inputs))
                    ]
                    continue
                blocked.pop(process_id, None)
                for output in process.outputs:
                    if output not in produced:
                        produced.add(output)
                        changed = True
                        if output in self.graph.equipment_items:
                            equipment.add(output)
                        else:
                            available.add(output)
        return produced, blocked

    def reachable_materials(
        self,
        *,
        assume_all_raw: bool = True,
        assume_all_equipment: bool = False,
        assume_all_earth: bool = True,
    ) -> set[str]:
        """Boolean reachability, ignoring quantities.

        ``assume_all_raw`` seeds every raw material (materials not produced by
        any process).  ``assume_all_equipment`` seeds every equipment item.
        ``assume_all_earth`` treats all Earth-tagged imports as available.
        """
        produced, _ = self.reachability(
            assume_all_raw=assume_all_raw,
            assume_all_equipment=assume_all_equipment,
            assume_all_earth=assume_all_earth,
        )
        return produced

    # --------------------------------------------------------------- backward
    def required_inputs(
        self,
        target: str,
        quantity: float = 1.0,
        *,
        route: Mapping[str, str] | None = None,
        manufacture_equipment: bool = False,
        _stack: tuple[str, ...] = (),
        _result: RequiredInputs | None = None,
    ) -> RequiredInputs:
        """Expand demand for ``quantity`` of ``target`` back to raw inputs.

        If several processes produce the same material, the first one in the
        graph is used unless ``route`` maps ``material -> process_id``.  When
        ``manufacture_equipment`` is true, required equipment that has a producer
        is recursively expanded instead of being reported as an external item.
        """
        if quantity <= 0:
            raise ValueError("quantity must be > 0")
        if _result is None:
            _result = RequiredInputs(target=target, quantity=quantity)
        route = route or {}

        producers = self.graph.producers_of(target)
        if not producers:
            _result.raw_inputs[target] = _result.raw_inputs.get(target, 0.0) + quantity
            return _result

        process_id = route.get(target, producers[0])
        if process_id not in producers:
            raise ValueError(f"{process_id!r} does not produce {target!r}")
        if process_id in _stack:
            raise ValueError(f"cycle while expanding {target!r}: {_stack + (process_id,)}")

        process: Process = self.graph.process(process_id)
        yield_per_batch = process.outputs[target]
        scale = quantity / yield_per_batch
        _result.processes[process_id] = _result.processes.get(process_id, 0.0) + scale

        for input_name, required in process.inputs.items():
            amount = required * scale
            if input_name in self.earth_sourced:
                _result.earth_inputs[input_name] = (
                    _result.earth_inputs.get(input_name, 0.0) + amount
                )
            else:
                self.required_inputs(
                    input_name,
                    amount,
                    route=route,
                    manufacture_equipment=manufacture_equipment,
                    _stack=_stack + (process_id,),
                    _result=_result,
                )

        for input_name, required in process.earth_inputs.items():
            _result.earth_inputs[input_name] = (
                _result.earth_inputs.get(input_name, 0.0) + required * scale
            )

        for output_name, yielded in process.outputs.items():
            if output_name != target:
                _result.byproducts[output_name] = (
                    _result.byproducts.get(output_name, 0.0) + yielded * scale
                )

        for item, required in process.earth_equipment.items():
            _result.earth_equipment[item] = max(
                _result.earth_equipment.get(item, 0.0), required
            )

        for item, required in process.equipment.items():
            if item in self.earth_sourced:
                _result.earth_equipment[item] = max(
                    _result.earth_equipment.get(item, 0.0), required
                )
            elif manufacture_equipment and self.graph.producers_of(item):
                self.required_inputs(
                    item,
                    required,
                    route=route,
                    manufacture_equipment=True,
                    _stack=_stack + (process_id,),
                    _result=_result,
                )
                _result.manufactured_equipment[item] = (
                    _result.manufactured_equipment.get(item, 0.0) + required
                )
            else:
                _result.equipment[item] = max(
                    _result.equipment.get(item, 0.0), required
                )

        return _result

    def can_produce(self, target: str, quantity: float = 1.0) -> bool:
        """Whether the inventory can produce at least ``quantity`` of target."""
        result = self.required_inputs(target, quantity)
        if any(
            self.inventory.get(name, 0.0) < amount
            for name, amount in result.raw_inputs.items()
        ):
            return False
        if any(
            self.equipment.get(name, 0.0) < amount
            for name, amount in result.equipment.items()
        ):
            return False
        return True

    def max_production(
        self,
        target: str,
        *,
        route: Mapping[str, str] | None = None,
        inventory: Mapping[str, float] | None = None,
        equipment: Mapping[str, float] | None = None,
        time_days: float | None = None,
    ) -> ProductionPotential:
        """Maximum target units supported by the available inventory.

        The calculation dedicates all available raw material to this target and
        ignores competition with other products.  It is deliberately a
        first-pass "what could this asteroid support?" measure, not an optimal
        multi-product plan.
        """
        inv = self.inventory if inventory is None else inventory
        equip = self.equipment if equipment is None else equipment
        demand = self.required_inputs(target, 1.0, route=route)

        if not demand.raw_inputs:
            # Target is already available or the recipe has no asteroid-derived
            # inputs.  In the latter case Earth-only recipes are not bounded by
            # the asteroid inventory.
            available = float(inv.get(target, 0.0))
            notes = [] if available > 0 else [f"no inventory of {target}"]
            if available <= 0 and demand.earth_inputs:
                notes.append(
                    "no asteroid-derived inputs; Earth-only recipe is not bounded"
                )
            return ProductionPotential(
                target=target,
                quantity=available,
                per_unit_earth_inputs=dict(demand.earth_inputs),
                total_earth_inputs={
                    name: required * available
                    for name, required in demand.earth_inputs.items()
                },
                equipment=dict(demand.equipment),
                earth_equipment=dict(demand.earth_equipment),
                feasible=available > 0,
                notes=notes,
            )

        ratios = {
            name: float(inv.get(name, 0.0)) / required
            for name, required in demand.raw_inputs.items()
        }
        minimum = min(ratios.values())
        limiting = [
            name for name, ratio in ratios.items() if abs(ratio - minimum) <= 1e-12
        ]
        notes: list[str] = []
        missing_equipment = [
            name
            for name, required in demand.equipment.items()
            if float(equip.get(name, 0.0)) < required
        ]
        if missing_equipment:
            notes.append("missing equipment: " + ", ".join(sorted(missing_equipment)))

        if minimum <= 0 or missing_equipment:
            return ProductionPotential(
                target=target,
                quantity=0.0,
                per_unit_raw_inputs=dict(demand.raw_inputs),
                total_raw_inputs={},
                per_unit_earth_inputs=dict(demand.earth_inputs),
                total_earth_inputs={},
                equipment=dict(demand.equipment),
                earth_equipment=dict(demand.earth_equipment),
                limiting_inputs=limiting,
                feasible=False,
                notes=notes,
            )

        if time_days is not None:
            for process_id, batches_per_unit in demand.processes.items():
                process = self.graph.process(process_id)
                if (
                    process.throughput_kg_per_day is None
                    or process.total_input_mass <= 0
                    or batches_per_unit <= 0
                ):
                    continue
                local_equipment = {
                    item: required
                    for item, required in process.equipment.items()
                    if item not in self.earth_sourced
                }
                machine_factor = 1.0
                if local_equipment:
                    machine_factor = min(
                        float(equip.get(item, 0.0)) / required
                        for item, required in local_equipment.items()
                    )
                capacity_batches = (
                    process.throughput_kg_per_day
                    * time_days
                    * machine_factor
                    / process.total_input_mass
                )
                capacity_units = capacity_batches / batches_per_unit
                if capacity_units < minimum:
                    minimum = capacity_units
                    notes.append(f"limited by throughput of {process_id}")

        return ProductionPotential(
            target=target,
            quantity=minimum,
            per_unit_raw_inputs=dict(demand.raw_inputs),
            total_raw_inputs={
                name: required * minimum
                for name, required in demand.raw_inputs.items()
            },
            per_unit_earth_inputs=dict(demand.earth_inputs),
            total_earth_inputs={
                name: required * minimum
                for name, required in demand.earth_inputs.items()
            },
            equipment=dict(demand.equipment),
            earth_equipment=dict(demand.earth_equipment),
            limiting_inputs=limiting,
            feasible=minimum > 0,
            notes=notes,
        )

    def bottlenecks(
        self, result: ProductionResult | None = None
    ) -> dict[str, list[str]]:
        return dict((result or self.forward_closure()).blocked)
