"""Spatial maps of industrial output and Earth-import demand.

The industrial model answers *what can one asteroid make?*  This module answers
*where, across the catalogue, are those outputs and the Earth materials needed
to process them?*

A map is built by assessing every asteroid in an iterable, then binning the
results by position.  Four binning modes are provided:

``radius``
    Heliocentric distance shells (default 0.5 AU).
``longitude``
    Ecliptic longitude sectors (default 30 degrees), all radii combined.
``cylindrical``
    Radius shell x longitude sector.  This is the most useful "map" view.
``cartesian``
    3-D Cartesian voxels (default 0.5 AU).

Only ``n_samples == 1`` deterministic assessments are needed for a first map;
Monte Carlo assessments also work and their averaged potentials are used.
"""

from __future__ import annotations

import csv
import math
from collections import defaultdict
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Iterable, Literal, Mapping, Sequence

import numpy as np

if TYPE_CHECKING:  # pragma: no cover - typing only
    from .asteroid import Asteroid
    from .model import ProductionPotential
    from .system import IndustrialSystem

Binning = Literal["radius", "longitude", "cylindrical", "cartesian"]
Frame = Literal["equatorial", "ecliptic"]

OBLIQUITY_J2000_DEG = 23.4392911

PLANETS = {
    "Mercury": 0.387,
    "Venus": 0.723,
    "Earth": 1.000,
    "Mars": 1.524,
    "Jupiter": 5.203,
    "Saturn": 9.537,
    "Uranus": 19.191,
    "Neptune": 30.069,
}


def _to_ecliptic(position: Sequence[float]) -> tuple[float, float, float]:
    """Rotate an EQJ2000 vector into the J2000 ecliptic frame."""
    eps = math.radians(OBLIQUITY_J2000_DEG)
    ce, se = math.cos(eps), math.sin(eps)
    x, y, z = (float(position[0]), float(position[1]), float(position[2]))
    return x, y * ce + z * se, -y * se + z * ce


def _frame_position(
    position: Sequence[float], frame: Frame
) -> tuple[float, float, float]:
    return _to_ecliptic(position) if frame == "ecliptic" else tuple(
        float(x) for x in position
    )


def _bin_for(
    position: Sequence[float],
    *,
    binning: Binning,
    frame: Frame,
    radius_step_au: float,
    longitude_step_deg: float,
    cell_size_au: float,
) -> tuple[tuple, str, tuple[float, float, float]]:
    """Return ``(key, label, nominal_center)`` for one position."""
    if radius_step_au <= 0 or longitude_step_deg <= 0 or cell_size_au <= 0:
        raise ValueError("binning steps must be positive")

    x, y, z = _frame_position(position, frame)
    radius = math.sqrt(x * x + y * y + z * z)
    longitude_deg = math.degrees(math.atan2(y, x))

    shell = int(math.floor(radius / radius_step_au))
    shell_lo = shell * radius_step_au
    shell_hi = shell_lo + radius_step_au
    shell_label = f"{shell_lo:g}-{shell_hi:g} AU"
    shell_center = shell_lo + radius_step_au / 2.0

    sector = int(
        math.floor((longitude_deg + 180.0) / longitude_step_deg)
    )
    sector_lo = -180.0 + sector * longitude_step_deg
    sector_hi = sector_lo + longitude_step_deg
    sector_mid = math.radians((sector_lo + sector_hi) / 2.0)
    sector_label = f"{sector_lo:g} to {sector_hi:g} deg"
    sector_center = (
        math.cos(sector_mid) * shell_center,
        math.sin(sector_mid) * shell_center,
        0.0,
    )

    if binning == "radius":
        return ("r", shell), shell_label, (shell_center, 0.0, 0.0)
    if binning == "longitude":
        return (
            ("lon", sector),
            sector_label,
            (math.cos(sector_mid), math.sin(sector_mid), 0.0),
        )
    if binning == "cylindrical":
        return (
            ("cyl", shell, sector),
            f"{shell_label}, {sector_label}",
            sector_center,
        )
    if binning == "cartesian":
        ix = int(math.floor(x / cell_size_au))
        iy = int(math.floor(y / cell_size_au))
        iz = int(math.floor(z / cell_size_au))
        center = (
            (ix + 0.5) * cell_size_au,
            (iy + 0.5) * cell_size_au,
            (iz + 0.5) * cell_size_au,
        )
        label = (
            f"x[{ix * cell_size_au:g},{ix * cell_size_au + cell_size_au:g}] "
            f"y[{iy * cell_size_au:g},{iy * cell_size_au + cell_size_au:g}] "
            f"z[{iz * cell_size_au:g},{iz * cell_size_au + cell_size_au:g}]"
        )
        return ("xyz", ix, iy, iz), label, center
    raise ValueError(f"unknown binning mode: {binning!r}")


@dataclass
class SpatialBin:
    """Aggregated output and Earth-import demand in one spatial cell."""

    key: tuple
    label: str
    center_au: tuple[float, float, float]
    asteroid_ids: list[str] = field(default_factory=list)
    count: int = 0
    total_mass_kg: float = 0.0
    output_kg: float = 0.0
    earth_inputs: dict[str, float] = field(default_factory=dict)
    earth_equipment: dict[str, float] = field(default_factory=dict)
    limiting_inputs: dict[str, int] = field(default_factory=dict)

    def add(self, asteroid: "Asteroid", potential: "ProductionPotential") -> None:
        self.asteroid_ids.append(asteroid.id)
        self.total_mass_kg += float(asteroid.mass_kg or 0.0)
        self.output_kg += float(potential.quantity)

        # Running mean position, so radius shells and lonely cells still have a
        # meaningful point to draw.
        n = self.count + 1
        if asteroid.position_au is not None:
            cx, cy, cz = self.center_au
            x, y, z = (float(v) for v in asteroid.position_au)
            self.center_au = (
                (cx * self.count + x) / n,
                (cy * self.count + y) / n,
                (cz * self.count + z) / n,
            )
        self.count = n

        for material, amount in potential.total_earth_inputs.items():
            self.earth_inputs[material] = (
                self.earth_inputs.get(material, 0.0) + amount
            )
        for item, amount in potential.earth_equipment.items():
            self.earth_equipment[item] = (
                self.earth_equipment.get(item, 0.0) + amount
            )
        for material in potential.limiting_inputs:
            self.limiting_inputs[material] = (
                self.limiting_inputs.get(material, 0) + 1
            )

    def to_dict(self) -> dict:
        return {
            "label": self.label,
            "center_au": list(self.center_au),
            "asteroid_count": self.count,
            "total_mass_kg": self.total_mass_kg,
            "output_kg": self.output_kg,
            "earth_inputs": dict(self.earth_inputs),
            "earth_equipment": dict(self.earth_equipment),
            "limiting_inputs": dict(self.limiting_inputs),
            "asteroid_ids": list(self.asteroid_ids),
        }


@dataclass
class SpatialMap:
    """One product's spatial output map and its Earth-import demand."""

    target: str
    binning: Binning
    frame: Frame
    bins: dict[tuple, SpatialBin] = field(default_factory=dict)
    asteroid_count: int = 0
    assessed_count: int = 0
    missing_position: int = 0

    # ------------------------------------------------------------- aggregates
    @property
    def total_output_kg(self) -> float:
        return sum(bin.output_kg for bin in self.bins.values())

    def total_earth_inputs(self) -> dict[str, float]:
        totals: dict[str, float] = defaultdict(float)
        for bin in self.bins.values():
            for material, amount in bin.earth_inputs.items():
                totals[material] += amount
        return dict(totals)

    def total_earth_equipment(self) -> dict[str, float]:
        totals: dict[str, float] = defaultdict(float)
        for bin in self.bins.values():
            for item, amount in bin.earth_equipment.items():
                totals[item] += amount
        return dict(totals)

    def top_bins(self, n: int = 10) -> list[SpatialBin]:
        return sorted(
            self.bins.values(), key=lambda bin: bin.output_kg, reverse=True
        )[:n]

    # --------------------------------------------------------------- reports
    def to_records(self) -> list[dict]:
        records = []
        for bin in self.bins.values():
            record = bin.to_dict()
            record["target"] = self.target
            record["binning"] = self.binning
            record["frame"] = self.frame
            records.append(record)
        return records

    def to_csv(self, path: str) -> None:
        records = self.to_records()
        if not records:
            with open(path, "w", newline="") as fh:
                csv.writer(fh).writerow(["target"])
            return

        earth_names = sorted(
            {name for record in records for name in record["earth_inputs"]}
        )
        equipment_names = sorted(
            {name for record in records for name in record["earth_equipment"]}
        )
        columns = [
            "target",
            "binning",
            "frame",
            "label",
            "center_x_au",
            "center_y_au",
            "center_z_au",
            "asteroid_count",
            "total_mass_kg",
            "output_kg",
            *[f"earth_input_{name}" for name in earth_names],
            *[f"earth_equipment_{name}" for name in equipment_names],
            "asteroid_ids",
        ]
        with open(path, "w", newline="") as fh:
            writer = csv.writer(fh)
            writer.writerow(columns)
            for record in records:
                writer.writerow(
                    [
                        record["target"],
                        record["binning"],
                        record["frame"],
                        record["label"],
                        *record["center_au"],
                        record["asteroid_count"],
                        record["total_mass_kg"],
                        record["output_kg"],
                        *[
                            record["earth_inputs"].get(name, 0.0)
                            for name in earth_names
                        ],
                        *[
                            record["earth_equipment"].get(name, 0.0)
                            for name in equipment_names
                        ],
                        ";".join(record["asteroid_ids"]),
                    ]
                )

    def summary(self, top: int = 10) -> str:
        lines = [
            f"SpatialMap target={self.target!r} binning={self.binning} "
            f"frame={self.frame}",
            f"  asteroids assessed: {self.assessed_count} "
            f"(missing position: {self.missing_position})",
            f"  populated bins: {len(self.bins)}",
            f"  total output: {self.total_output_kg:.3e} units",
        ]
        earth = self.total_earth_inputs()
        if earth:
            lines.append("  Earth material demand:")
            for name in sorted(earth, key=lambda k: -earth[k]):
                lines.append(f"    {name:<24} {earth[name]:12.3e} kg")
        equipment = self.total_earth_equipment()
        if equipment:
            lines.append("  Earth equipment demand:")
            for name in sorted(equipment, key=lambda k: -equipment[k]):
                lines.append(f"    {name:<24} {equipment[name]:12.3g} units")
        if self.bins:
            lines.append("  top bins by output:")
            for bin in self.top_bins(top):
                lines.append(
                    f"    {bin.label:<32} {bin.output_kg:12.3e} units  "
                    f"({bin.count} objects)"
                )
        return "\n".join(lines)


def build_spatial_maps(
    system: "IndustrialSystem",
    asteroids: Iterable["Asteroid"],
    *,
    targets: Iterable[str] | None = None,
    n_samples: int = 1,
    equipment: Mapping[str, float] | None = None,
    time_days: float | None = None,
    binning: Binning = "cylindrical",
    radius_step_au: float = 0.5,
    longitude_step_deg: float = 30.0,
    cell_size_au: float = 0.5,
    frame: Frame = "ecliptic",
    seed: int | None = None,
    rng: np.random.Generator | None = None,
    progress: bool = False,
) -> dict[str, SpatialMap]:
    """Build one spatial map per terminal product.

    Each asteroid is assessed once.  For every requested target, the asteroid's
    dedicated-inventory potential is added to its spatial bin.  Earth inputs and
    Earth equipment are kept separate from asteroid-derived feedstocks.
    """
    target_list = sorted(
        set(targets)
        if targets is not None
        else set(system.graph.terminal_materials)
    )
    if not target_list:
        return {}

    bins_by_target: dict[str, dict[tuple, SpatialBin]] = {
        target: {} for target in target_list
    }
    stats = {
        target: {"asteroid_count": 0, "assessed_count": 0, "missing": 0}
        for target in target_list
    }
    rng = rng or np.random.default_rng(seed)

    for index, asteroid in enumerate(asteroids):
        if asteroid.position_au is None:
            for target in target_list:
                stats[target]["missing"] += 1
            continue
        assessment = system.assess(
            asteroid,
            n_samples=n_samples,
            equipment=equipment,
            time_days=time_days,
            rng=rng,
        )
        for target in target_list:
            stats[target]["asteroid_count"] += 1
            potential = assessment.potentials.get(target)
            if (
                potential is None
                or not potential.feasible
                or potential.quantity <= 0
            ):
                continue
            key, label, center = _bin_for(
                asteroid.position_au,
                binning=binning,
                frame=frame,
                radius_step_au=radius_step_au,
                longitude_step_deg=longitude_step_deg,
                cell_size_au=cell_size_au,
            )
            bin = bins_by_target[target].get(key)
            if bin is None:
                bin = SpatialBin(key=key, label=label, center_au=center)
                bins_by_target[target][key] = bin
            bin.add(asteroid, potential)
            stats[target]["assessed_count"] += 1

        if progress and (index + 1) % 1000 == 0:
            print(f"  assessed {index + 1:,} asteroids...")

    return {
        target: SpatialMap(
            target=target,
            binning=binning,
            frame=frame,
            bins=bins_by_target[target],
            asteroid_count=stats[target]["asteroid_count"],
            assessed_count=stats[target]["assessed_count"],
            missing_position=stats[target]["missing"],
        )
        for target in target_list
    }


def build_spatial_map(
    system: "IndustrialSystem",
    asteroids: Iterable["Asteroid"],
    target: str,
    **kwargs,
) -> SpatialMap:
    """Build one target product's spatial map."""
    return build_spatial_maps(
        system, asteroids, targets=[target], **kwargs
    )[target]


def plot_spatial_map(
    spatial_map: SpatialMap,
    output_path: str,
    *,
    metric: Literal["output", "earth", "earth_equipment"] = "output",
    earth_material: str | None = None,
    title: str | None = None,
    dpi: int = 200,
) -> None:
    """Plot a top-down map of output or Earth-import demand.

    Requires matplotlib.  The plot is a convenience view; the numerical result
    is always available through :meth:`SpatialMap.to_records`.
    """
    try:
        import matplotlib.pyplot as plt
        from matplotlib.patches import Circle
    except ImportError as exc:  # pragma: no cover
        raise ImportError("plot_spatial_map needs matplotlib") from exc

    bins = [bin for bin in spatial_map.bins.values() if bin.count > 0]
    if not bins:
        raise ValueError("spatial map has no populated bins")

    points = np.array([bin.center_au for bin in bins], dtype=float)
    if spatial_map.frame == "equatorial":
        eps = math.radians(OBLIQUITY_J2000_DEG)
        ce, se = math.cos(eps), math.sin(eps)
        x = points[:, 0]
        y = points[:, 1] * ce + points[:, 2] * se
    else:
        x, y = points[:, 0], points[:, 1]

    if metric == "output":
        values = np.array([bin.output_kg for bin in bins], dtype=float)
        value_label = f"{spatial_map.target} output (units)"
    elif metric == "earth":
        if earth_material is None:
            values = np.array(
                [sum(bin.earth_inputs.values()) for bin in bins], dtype=float
            )
            value_label = "Earth material demand (kg)"
        else:
            values = np.array(
                [bin.earth_inputs.get(earth_material, 0.0) for bin in bins],
                dtype=float,
            )
            value_label = f"Earth demand: {earth_material} (kg)"
    elif metric == "earth_equipment":
        values = np.array(
            [sum(bin.earth_equipment.values()) for bin in bins], dtype=float
        )
        value_label = "Earth equipment demand (units)"
    else:
        raise ValueError(f"unknown metric: {metric!r}")

    positive = values[values > 0]
    if len(positive):
        lo, hi = positive.min(), positive.max()
        if hi > lo:
            sizes = 20.0 + 380.0 * (
                (np.log10(np.maximum(values, lo)) - math.log10(lo))
                / (math.log10(hi) - math.log10(lo))
            )
        else:
            sizes = np.full(len(values), 120.0)
    else:
        sizes = np.full(len(values), 60.0)

    plt.rcParams.update(
        {
            "figure.facecolor": "#0d1117",
            "axes.facecolor": "#0d1117",
            "savefig.facecolor": "#0d1117",
            "axes.edgecolor": "#30363d",
            "axes.labelcolor": "#e6edf3",
            "text.color": "#e6edf3",
            "xtick.color": "#8b949e",
            "ytick.color": "#8b949e",
            "grid.color": "#21262d",
        }
    )
    fig, ax = plt.subplots(figsize=(9.5, 8.2))
    ax.set_aspect("equal")
    ax.grid(True, alpha=0.5)

    view = max(2.5, float(np.percentile(np.abs(np.concatenate([x, y])), 99)) * 1.25)
    ax.set_xlim(-view, view)
    ax.set_ylim(-view, view)
    ax.set_xlabel("x (AU)")
    ax.set_ylabel("y (AU)")

    for name, au in PLANETS.items():
        if au <= view:
            ax.add_patch(
                Circle(
                    (0, 0),
                    au,
                    fill=False,
                    color="#6e7681",
                    lw=0.7,
                    alpha=0.45,
                    ls="--",
                )
            )
            if name in ("Earth", "Mars", "Jupiter"):
                ax.text(
                    au * 0.71,
                    au * 0.71,
                    name,
                    color="#8b949e",
                    fontsize=8,
                )

    scatter = ax.scatter(
        x,
        y,
        s=sizes,
        c=values,
        cmap="viridis",
        alpha=0.82,
        edgecolors="none",
        zorder=3,
    )
    ax.scatter([0], [0], s=90, color="#ffd43b", zorder=5)
    fig.colorbar(scatter, ax=ax, label=value_label, shrink=0.82)
    ax.set_title(
        title
        or (
            f"{spatial_map.target}: {value_label}  "
            f"({spatial_map.assessed_count} assessed, "
            f"{len(spatial_map.bins)} bins)"
        )
    )
    fig.tight_layout()
    fig.savefig(output_path, dpi=dpi)
    plt.close(fig)
