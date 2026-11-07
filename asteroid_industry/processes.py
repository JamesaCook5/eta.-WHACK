"""Unit-operation process DAG.

A process consumes material inputs, requires reusable equipment, and produces
material outputs.  Equipment may itself be produced by another process; in that
case it becomes available to later processes in the DAG.

Process dictionary format
-------------------------
```python
{
    "comminution": {
        "inputs":    {"silicate_ore": 100.0},
        "outputs":   {"powdered_silicate": 100.0},
        "equipment": {"crusher": 1},
        "earth_inputs": {"earth_lubricant": 0.5},   # optional, imported from Earth
        "earth_equipment": {"earth_controller": 1}, # optional, imported capital
        "throughput_kg_per_day": 1000.0,   # optional
        "energy_kwh_per_kg": 0.02,         # optional
        "notes": "unit operation",
    },
}
```
Quantities are in kilograms (or any consistent mass unit) and are per batch.
``throughput_kg_per_day`` and ``energy_kwh_per_kg`` are optional metadata used
by the model when a time window is supplied.

``earth_inputs`` and ``earth_equipment`` are materials/capital that must be
imported from Earth.  They are consumed/provided like ordinary inputs/equipment
but are kept separate in demand analysis so a supply-chain map can distinguish
asteroid-derived feedstocks from Earth imports.  A name may not appear in both
``inputs`` and ``earth_inputs`` (or both ``equipment`` and ``earth_equipment``).
"""

from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass, field, replace
from typing import Mapping


@dataclass
class Process:
    id: str
    inputs: dict[str, float] = field(default_factory=dict)
    outputs: dict[str, float] = field(default_factory=dict)
    equipment: dict[str, float] = field(default_factory=dict)
    earth_inputs: dict[str, float] = field(default_factory=dict)
    earth_equipment: dict[str, float] = field(default_factory=dict)
    throughput_kg_per_day: float | None = None
    energy_kwh_per_kg: float | None = None
    notes: str = ""

    def __post_init__(self) -> None:
        self.inputs = {str(k): float(v) for k, v in self.inputs.items()}
        self.outputs = {str(k): float(v) for k, v in self.outputs.items()}
        self.equipment = {str(k): float(v) for k, v in self.equipment.items()}
        self.earth_inputs = {
            str(k): float(v) for k, v in self.earth_inputs.items()
        }
        self.earth_equipment = {
            str(k): float(v) for k, v in self.earth_equipment.items()
        }
        overlap = set(self.inputs) & set(self.earth_inputs)
        if overlap:
            raise ValueError(
                f"process {self.id!r}: materials cannot be both asteroid and "
                f"Earth inputs: {sorted(overlap)}"
            )
        overlap = set(self.equipment) & set(self.earth_equipment)
        if overlap:
            raise ValueError(
                f"process {self.id!r}: equipment cannot be both local and "
                f"Earth equipment: {sorted(overlap)}"
            )
        for label, quantities in (
            ("input", self.inputs),
            ("output", self.outputs),
            ("equipment", self.equipment),
            ("earth input", self.earth_inputs),
            ("earth equipment", self.earth_equipment),
        ):
            for name, value in quantities.items():
                if value <= 0:
                    raise ValueError(
                        f"process {self.id!r}: {label} {name!r} must be > 0"
                    )

    @property
    def input_mass(self) -> float:
        """Asteroid-derived input mass (used for throughput capacity)."""
        return sum(self.inputs.values())

    @property
    def earth_input_mass(self) -> float:
        return sum(self.earth_inputs.values())

    @property
    def total_input_mass(self) -> float:
        return self.input_mass + self.earth_input_mass

    @property
    def output_mass(self) -> float:
        return sum(self.outputs.values())

    @property
    def mass_balance(self) -> float | None:
        """Output mass / total input mass, or None when there are no inputs."""
        return (
            self.output_mass / self.total_input_mass
            if self.total_input_mass
            else None
        )

    @classmethod
    def from_dict(cls, process_id: str, data: Mapping) -> "Process":
        if not isinstance(data, Mapping):
            raise TypeError(f"process {process_id!r} must be a mapping")
        return cls(
            id=process_id,
            inputs=dict(data.get("inputs", {})),
            outputs=dict(data.get("outputs", {})),
            equipment=dict(data.get("equipment", data.get("machinery", {}))),
            earth_inputs=dict(data.get("earth_inputs", {})),
            earth_equipment=dict(
                data.get("earth_equipment", data.get("earth_machinery", {}))
            ),
            throughput_kg_per_day=data.get(
                "throughput_kg_per_day", data.get("throughput")
            ),
            energy_kwh_per_kg=data.get("energy_kwh_per_kg", data.get("energy")),
            notes=str(data.get("notes", "")),
        )

    def as_dict(self) -> dict:
        out = {
            "inputs": dict(self.inputs),
            "outputs": dict(self.outputs),
        }
        if self.equipment:
            out["equipment"] = dict(self.equipment)
        if self.earth_inputs:
            out["earth_inputs"] = dict(self.earth_inputs)
        if self.earth_equipment:
            out["earth_equipment"] = dict(self.earth_equipment)
        if self.throughput_kg_per_day is not None:
            out["throughput_kg_per_day"] = self.throughput_kg_per_day
        if self.energy_kwh_per_kg is not None:
            out["energy_kwh_per_kg"] = self.energy_kwh_per_kg
        if self.notes:
            out["notes"] = self.notes
        return out


class ProcessGraph:
    """Validated DAG of composable unit operations."""

    def __init__(self, processes: Mapping[str, Process | Mapping]):
        self.processes: dict[str, Process] = {}
        for process_id, data in processes.items():
            if isinstance(data, Process):
                process = data if data.id == process_id else replace(data, id=process_id)
            else:
                process = Process.from_dict(process_id, data)
            self.processes[process_id] = process

        self.producers: dict[str, list[str]] = defaultdict(list)
        self.consumers: dict[str, list[str]] = defaultdict(list)
        self.equipment_consumers: dict[str, list[str]] = defaultdict(list)
        self.materials: set[str] = set()
        self.equipment_items: set[str] = set()
        # Names explicitly tagged as Earth-sourced somewhere in the graph.
        self.earth_material_inputs: set[str] = set()
        self.earth_equipment_items: set[str] = set()

        for process_id, process in self.processes.items():
            for material in process.inputs:
                self.materials.add(material)
                self.consumers[material].append(process_id)
            for material in process.earth_inputs:
                self.materials.add(material)
                self.consumers[material].append(process_id)
                self.earth_material_inputs.add(material)
            for material in process.outputs:
                self.materials.add(material)
                self.producers[material].append(process_id)
            for item in process.equipment:
                self.equipment_items.add(item)
                self.equipment_consumers[item].append(process_id)
            for item in process.earth_equipment:
                self.equipment_items.add(item)
                self.equipment_consumers[item].append(process_id)
                self.earth_equipment_items.add(item)

        self._order = self._topological_order()

    # ------------------------------------------------------------- structure
    def _topological_order(self) -> list[str]:
        """Kahn topological sort over process dependencies.

        An edge A -> B exists when A produces a material or equipment item that
        B consumes/requires.
        """
        edges: dict[str, set[str]] = {pid: set() for pid in self.processes}
        indegree: dict[str, int] = {pid: 0 for pid in self.processes}

        for consumer_id, process in self.processes.items():
            dependencies: set[str] = set()
            for material in process.inputs:
                dependencies.update(self.producers.get(material, ()))
            for item in process.equipment:
                dependencies.update(self.producers.get(item, ()))
            # Earth inputs/equipment are imported, so they never create a
            # dependency on a process in this graph.
            if consumer_id in dependencies:
                raise ValueError(
                    f"process {consumer_id!r} depends on itself (material recycle "
                    "loops are not supported yet)"
                )
            for producer_id in dependencies:
                if consumer_id not in edges[producer_id]:
                    edges[producer_id].add(consumer_id)
                    indegree[consumer_id] += 1

        queue = deque(pid for pid, degree in indegree.items() if degree == 0)
        order: list[str] = []
        while queue:
            pid = queue.popleft()
            order.append(pid)
            for nxt in sorted(edges[pid]):
                indegree[nxt] -= 1
                if indegree[nxt] == 0:
                    queue.append(nxt)

        if len(order) != len(self.processes):
            cycle = sorted(pid for pid, degree in indegree.items() if degree > 0)
            raise ValueError(f"process graph contains a cycle: {cycle}")
        return order

    @property
    def order(self) -> list[str]:
        return list(self._order)

    @property
    def earth_materials(self) -> set[str]:
        """All materials/equipment explicitly tagged as Earth-sourced."""
        return self.earth_material_inputs | self.earth_equipment_items

    @property
    def asteroid_raw_materials(self) -> set[str]:
        """Raw materials the asteroid must supply (excludes Earth imports)."""
        return {
            material
            for material in self.materials | self.equipment_items
            if not self.producers.get(material)
            and material not in self.earth_materials
        }

    @property
    def raw_materials(self) -> set[str]:
        """Raw materials the asteroid must supply (Earth imports excluded)."""
        return self.asteroid_raw_materials

    @property
    def terminal_materials(self) -> set[str]:
        """Materials not consumed as a material input or equipment requirement."""
        consumed = set(self.consumers) | set(self.equipment_consumers)
        candidates = set(self.materials) | self.produced_equipment
        return {material for material in candidates if material not in consumed}

    @property
    def produced_equipment(self) -> set[str]:
        return {item for item in self.equipment_items if self.producers.get(item)}

    def producers_of(self, material: str) -> list[str]:
        return list(self.producers.get(material, ()))

    def consumers_of(self, material: str) -> list[str]:
        return list(self.consumers.get(material, ()))

    def process(self, process_id: str) -> Process:
        return self.processes[process_id]

    # --------------------------------------------------------------- reports
    def describe(self) -> str:
        lines = [f"ProcessGraph: {len(self.processes)} processes, "
                 f"{len(self.materials)} materials, "
                 f"{len(self.equipment_items)} equipment items"]
        lines.append("Topological order: " + " -> ".join(self.order))
        lines.append("Raw materials: " + ", ".join(sorted(self.raw_materials)))
        lines.append("Earth-sourced: " + ", ".join(sorted(self.earth_materials)))
        lines.append("Terminal materials: " + ", ".join(sorted(self.terminal_materials)))
        return "\n".join(lines)

    def as_dict(self) -> dict[str, dict]:
        return {pid: process.as_dict() for pid, process in self.processes.items()}
