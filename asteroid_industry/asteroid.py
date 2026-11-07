"""Asteroid catalogue adapter and resource inventory estimates."""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field
from typing import Iterable, Iterator, Mapping

import numpy as np

from .composition import DEFAULT_DENSITY, CompositionModel, normalize_surface_type


@dataclass
class Asteroid:
    """A catalogue object, reduced to the fields the industrial model needs."""

    id: str
    name: str
    surface_type: str
    diameter_km: float | None = None
    density_kg_m3: float | None = None
    mass_kg: float | None = None
    orbital_class: str | None = None
    taxonomy_class: str | None = None
    # Heliocentric EQJ2000 position in AU, if known.  Used by spatial maps.
    position_au: tuple[float, float, float] | None = None
    velocity_au_day: tuple[float, float, float] | None = None

    def __post_init__(self) -> None:
        if self.mass_kg is None and self.diameter_km and self.density_kg_m3:
            self.mass_kg = self.volume_m3 * self.density_kg_m3
        if self.position_au is not None:
            self.position_au = tuple(float(x) for x in self.position_au)
            if len(self.position_au) != 3:
                raise ValueError("position_au must contain three components")

    @property
    def volume_m3(self) -> float:
        if not self.diameter_km:
            return 0.0
        radius_m = self.diameter_km * 500.0  # km diameter -> m radius
        return (4.0 / 3.0) * math.pi * radius_m**3

    def __repr__(self) -> str:
        mass = "?" if self.mass_kg is None else f"{self.mass_kg:.3e}"
        return (
            f"Asteroid(id={self.id!r}, name={self.name!r}, "
            f"type={self.surface_type!r}, diameter_km={self.diameter_km!r}, "
            f"mass_kg={mass})"
        )


class AsteroidCatalog:
    """In-memory view of the project's parquet asteroid catalogue."""

    def __init__(self, asteroids: Iterable[Asteroid]):
        self.asteroids: list[Asteroid] = list(asteroids)
        self._by_id = {a.id: a for a in self.asteroids}
        self._by_name = {a.name: a for a in self.asteroids if a.name}

    def __len__(self) -> int:
        return len(self.asteroids)

    def __iter__(self) -> Iterator[Asteroid]:
        return iter(self.asteroids)

    def __getitem__(self, index: int) -> Asteroid:
        return self.asteroids[index]

    def get(self, key: str) -> Asteroid | None:
        return self._by_id.get(key) or self._by_name.get(key)

    def require(self, key: str) -> Asteroid:
        asteroid = self.get(key)
        if asteroid is None:
            raise KeyError(f"asteroid not found: {key!r}")
        return asteroid

    def sample(self, n: int, seed: int | None = None) -> list[Asteroid]:
        rng = random.Random(seed)
        if n >= len(self.asteroids):
            return list(self.asteroids)
        return rng.sample(self.asteroids, n)

    def with_mass(self) -> "AsteroidCatalog":
        return AsteroidCatalog(a for a in self.asteroids if a.mass_kg)

    @classmethod
    def from_parquet(
        cls,
        path: str,
        *,
        limit: int | None = None,
        where: str | None = None,
        density_map: Mapping[str, float] | None = None,
    ) -> "AsteroidCatalog":
        """Load asteroid id/name/type/diameter/density/mass from a parquet file.

        The query is deliberately explicit so it also works with the original
        unfiltered dataset as well as ``dataset_filtered_unified.parquet``.
        """
        try:
            import duckdb
        except ImportError as exc:  # pragma: no cover
            raise ImportError("AsteroidCatalog.from_parquet needs duckdb") from exc

        density_map = dict(density_map or DEFAULT_DENSITY)
        sql = """
            SELECT id, name, "class", "taxonomy.complex", "taxonomy.class",
                   "diameter.value", "density.value", "mass.value",
                   position, velocity
            FROM read_parquet(?)
        """
        if where:
            sql += f" WHERE {where}"
        if limit:
            sql += f" LIMIT {int(limit)}"

        con = duckdb.connect()
        rows = con.execute(sql, [path]).fetchall()
        con.close()

        asteroids: list[Asteroid] = []
        for row in rows:
            (
                ident,
                name,
                orbital_class,
                complex_type,
                taxonomy_class,
                diameter,
                density,
                mass,
                position,
                velocity,
            ) = row
            surface_type = normalize_surface_type(complex_type or taxonomy_class)
            density_value = (
                float(density)
                if density is not None and float(density) > 0
                else float(density_map.get(surface_type, 2500.0))
            )
            diameter_value = float(diameter) if diameter is not None else None
            mass_value = (
                float(mass) if mass is not None and float(mass) > 0 else None
            )
            asteroids.append(
                Asteroid(
                    id=str(ident),
                    name=str(name or ident),
                    surface_type=surface_type,
                    diameter_km=diameter_value,
                    density_kg_m3=density_value,
                    mass_kg=mass_value,
                    orbital_class=orbital_class,
                    taxonomy_class=taxonomy_class,
                    position_au=(
                        tuple(float(x) for x in position)
                        if position is not None
                        else None
                    ),
                    velocity_au_day=(
                        tuple(float(x) for x in velocity)
                        if velocity is not None
                        else None
                    ),
                )
            )
        return cls(asteroids)


@dataclass
class ResourceEstimate:
    """Monte Carlo feedstock inventory for one asteroid, in kilograms."""

    asteroid_id: str
    name: str
    surface_type: str
    mass_kg: float
    mean: dict[str, float] = field(default_factory=dict)
    p10: dict[str, float] = field(default_factory=dict)
    p90: dict[str, float] = field(default_factory=dict)

    def summary(self) -> str:
        lines = [
            f"{self.name} [{self.surface_type}]  mass = {self.mass_kg:.3e} kg",
            "feedstock            mean kg        p10 kg        p90 kg",
        ]
        for name in sorted(self.mean, key=lambda k: -self.mean[k]):
            lines.append(
                f"  {name:<18} {self.mean[name]:12.3e}  "
                f"{self.p10[name]:12.3e}  {self.p90[name]:12.3e}"
            )
        return "\n".join(lines)


def estimate_resources(
    asteroid: Asteroid,
    composition: CompositionModel,
    n_samples: int = 1000,
    *,
    rng: np.random.Generator | None = None,
) -> ResourceEstimate:
    """Estimate feedstock mass ranges available on an asteroid.

    Compositions are sampled from the asteroid's surface-type ranges, normalised
    to unit mass fraction, multiplied by the object's estimated bulk mass, and
    aggregated into industrial feedstock classes.
    """
    if not asteroid.mass_kg:
        raise ValueError(f"asteroid {asteroid.id!r} has no estimated mass")

    names, fractions = composition.feedstock_matrix(
        asteroid.surface_type, n=n_samples, rng=rng
    )
    masses = fractions * asteroid.mass_kg  # (n_samples, n_feedstocks)

    return ResourceEstimate(
        asteroid_id=asteroid.id,
        name=asteroid.name,
        surface_type=asteroid.surface_type,
        mass_kg=asteroid.mass_kg,
        mean={name: float(masses[:, i].mean()) for i, name in enumerate(names)},
        p10={name: float(np.percentile(masses[:, i], 10)) for i, name in enumerate(names)},
        p90={name: float(np.percentile(masses[:, i], 90)) for i, name in enumerate(names)},
    )
