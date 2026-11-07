"""Surface type -> bulk mineral composition ranges.

The numbers below are deliberately rough, editable, literature-flavoured
placeholders.  They are mass-fraction ranges, not volume fractions.  Monte
Carlo sampling draws uniformly from each range and then normalises the sampled
row so that the mineral fractions sum to 1.

Replace or extend ``SURFACE_COMPOSITION_RANGES`` with your own mineral list and
ranges when available.  Every surface type must map to a non-empty dict of
``mineral -> (low, high)``.
"""

from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path
from typing import Mapping, Sequence

import numpy as np

# Canonical mineral / volatile names used by the default model.
MINERALS = (
    "olivine",
    "pyroxene",
    "plagioclase",
    "serpentine",
    "magnetite",
    "troilite",
    "fe_ni_metal",
    "carbon",
    "water_ice",
    "ammonia",
    "methane",
    "salts",
    "phosphate",
    "other_silicate",
)

# Mass-fraction ranges by taxonomic complex.  The ranges need not sum to 1;
# each sample is normalised.  ``other_silicate`` is the undifferentiated
# remainder and can be large for primitive bodies.
SURFACE_COMPOSITION_RANGES: dict[str, dict[str, tuple[float, float]]] = {
    "C": {
        "olivine": (0.05, 0.20),
        "pyroxene": (0.02, 0.15),
        "plagioclase": (0.00, 0.05),
        "serpentine": (0.15, 0.35),
        "magnetite": (0.02, 0.10),
        "troilite": (0.02, 0.08),
        "fe_ni_metal": (0.00, 0.05),
        "carbon": (0.01, 0.08),
        "water_ice": (0.03, 0.18),
        "ammonia": (0.00, 0.03),
        "methane": (0.00, 0.02),
        "salts": (0.00, 0.02),
        "phosphate": (0.00, 0.01),
        "other_silicate": (0.05, 0.20),
    },
    "S": {
        "olivine": (0.25, 0.45),
        "pyroxene": (0.20, 0.35),
        "plagioclase": (0.05, 0.15),
        "serpentine": (0.00, 0.05),
        "magnetite": (0.01, 0.05),
        "troilite": (0.02, 0.08),
        "fe_ni_metal": (0.05, 0.20),
        "carbon": (0.00, 0.02),
        "water_ice": (0.00, 0.03),
        "ammonia": (0.00, 0.01),
        "methane": (0.00, 0.01),
        "salts": (0.00, 0.01),
        "phosphate": (0.00, 0.01),
        "other_silicate": (0.05, 0.15),
    },
    "M": {
        "olivine": (0.02, 0.10),
        "pyroxene": (0.02, 0.10),
        "plagioclase": (0.00, 0.03),
        "serpentine": (0.00, 0.03),
        "magnetite": (0.01, 0.05),
        "troilite": (0.01, 0.05),
        "fe_ni_metal": (0.65, 0.90),
        "carbon": (0.00, 0.02),
        "water_ice": (0.00, 0.02),
        "ammonia": (0.00, 0.01),
        "methane": (0.00, 0.01),
        "salts": (0.00, 0.01),
        "phosphate": (0.00, 0.01),
        "other_silicate": (0.02, 0.10),
    },
    "X": {
        "olivine": (0.10, 0.25),
        "pyroxene": (0.10, 0.25),
        "plagioclase": (0.02, 0.08),
        "serpentine": (0.02, 0.10),
        "magnetite": (0.01, 0.05),
        "troilite": (0.01, 0.05),
        "fe_ni_metal": (0.20, 0.50),
        "carbon": (0.01, 0.05),
        "water_ice": (0.00, 0.05),
        "ammonia": (0.00, 0.01),
        "methane": (0.00, 0.01),
        "salts": (0.00, 0.01),
        "phosphate": (0.00, 0.01),
        "other_silicate": (0.05, 0.15),
    },
    "B": {
        "olivine": (0.05, 0.15),
        "pyroxene": (0.02, 0.10),
        "plagioclase": (0.00, 0.04),
        "serpentine": (0.20, 0.40),
        "magnetite": (0.02, 0.08),
        "troilite": (0.01, 0.05),
        "fe_ni_metal": (0.00, 0.04),
        "carbon": (0.02, 0.10),
        "water_ice": (0.08, 0.25),
        "ammonia": (0.00, 0.04),
        "methane": (0.00, 0.02),
        "salts": (0.00, 0.03),
        "phosphate": (0.00, 0.01),
        "other_silicate": (0.05, 0.20),
    },
    "D": {
        "olivine": (0.05, 0.15),
        "pyroxene": (0.03, 0.12),
        "plagioclase": (0.00, 0.03),
        "serpentine": (0.10, 0.25),
        "magnetite": (0.01, 0.05),
        "troilite": (0.01, 0.05),
        "fe_ni_metal": (0.00, 0.04),
        "carbon": (0.05, 0.20),
        "water_ice": (0.03, 0.15),
        "ammonia": (0.00, 0.03),
        "methane": (0.00, 0.02),
        "salts": (0.00, 0.02),
        "phosphate": (0.00, 0.01),
        "other_silicate": (0.15, 0.35),
    },
    "P": {
        "olivine": (0.05, 0.15),
        "pyroxene": (0.03, 0.12),
        "plagioclase": (0.00, 0.03),
        "serpentine": (0.10, 0.25),
        "magnetite": (0.01, 0.05),
        "troilite": (0.01, 0.05),
        "fe_ni_metal": (0.00, 0.04),
        "carbon": (0.05, 0.15),
        "water_ice": (0.05, 0.15),
        "ammonia": (0.00, 0.03),
        "methane": (0.00, 0.02),
        "salts": (0.00, 0.02),
        "phosphate": (0.00, 0.01),
        "other_silicate": (0.20, 0.40),
    },
    "V": {
        "olivine": (0.02, 0.10),        "pyroxene": (0.35, 0.55),
        "plagioclase": (0.20, 0.35),
        "serpentine": (0.00, 0.02),
        "magnetite": (0.01, 0.05),
        "troilite": (0.01, 0.05),
        "fe_ni_metal": (0.02, 0.08),
        "carbon": (0.00, 0.01),
        "water_ice": (0.00, 0.02),
        "ammonia": (0.00, 0.01),
        "methane": (0.00, 0.01),
        "salts": (0.00, 0.01),
        "phosphate": (0.00, 0.01),
        "other_silicate": (0.02, 0.10),
    },
    "L": {
        "olivine": (0.45, 0.65),
        "pyroxene": (0.10, 0.25),
        "plagioclase": (0.05, 0.15),
        "serpentine": (0.00, 0.03),
        "magnetite": (0.01, 0.04),
        "troilite": (0.01, 0.05),
        "fe_ni_metal": (0.02, 0.08),
        "carbon": (0.00, 0.01),
        "water_ice": (0.00, 0.02),
        "ammonia": (0.00, 0.01),
        "methane": (0.00, 0.01),
        "salts": (0.00, 0.01),
        "phosphate": (0.00, 0.01),
        "other_silicate": (0.02, 0.10),
    },
    "K": {
        "olivine": (0.10, 0.20),
        "pyroxene": (0.05, 0.15),
        "plagioclase": (0.01, 0.05),
        "serpentine": (0.20, 0.40),
        "magnetite": (0.01, 0.05),
        "troilite": (0.01, 0.05),
        "fe_ni_metal": (0.00, 0.04),
        "carbon": (0.01, 0.05),
        "water_ice": (0.02, 0.10),
        "ammonia": (0.00, 0.02),
        "methane": (0.00, 0.01),
        "salts": (0.00, 0.02),
        "phosphate": (0.00, 0.01),
        "other_silicate": (0.10, 0.25),
    },
    "A": {
        "olivine": (0.60, 0.80),
        "pyroxene": (0.05, 0.15),
        "plagioclase": (0.02, 0.08),
        "serpentine": (0.00, 0.02),
        "magnetite": (0.01, 0.04),
        "troilite": (0.01, 0.04),
        "fe_ni_metal": (0.02, 0.08),
        "carbon": (0.00, 0.01),
        "water_ice": (0.00, 0.01),
        "ammonia": (0.00, 0.01),
        "methane": (0.00, 0.01),
        "salts": (0.00, 0.01),
        "phosphate": (0.00, 0.01),
        "other_silicate": (0.02, 0.08),
    },
    "Q": {
        "olivine": (0.25, 0.40),
        "pyroxene": (0.20, 0.30),
        "plagioclase": (0.05, 0.12),
        "serpentine": (0.00, 0.03),
        "magnetite": (0.01, 0.05),
        "troilite": (0.02, 0.08),
        "fe_ni_metal": (0.10, 0.20),
        "carbon": (0.00, 0.02),
        "water_ice": (0.00, 0.02),
        "ammonia": (0.00, 0.01),
        "methane": (0.00, 0.01),
        "salts": (0.00, 0.01),
        "phosphate": (0.00, 0.01),
        "other_silicate": (0.05, 0.15),
    },
    "E": {
        "olivine": (0.05, 0.15),
        "pyroxene": (0.50, 0.70),
        "plagioclase": (0.00, 0.04),
        "serpentine": (0.00, 0.02),
        "magnetite": (0.01, 0.04),
        "troilite": (0.02, 0.08),
        "fe_ni_metal": (0.10, 0.25),
        "carbon": (0.00, 0.01),
        "water_ice": (0.00, 0.01),
        "ammonia": (0.00, 0.01),
        "methane": (0.00, 0.01),
        "salts": (0.00, 0.01),
        "phosphate": (0.00, 0.01),
        "other_silicate": (0.02, 0.08),
    },
    # Fallback / unclassified: a generic chondritic-ish mix.
    "U": {
        "olivine": (0.15, 0.30),
        "pyroxene": (0.15, 0.30),
        "plagioclase": (0.03, 0.10),
        "serpentine": (0.05, 0.20),
        "magnetite": (0.01, 0.06),
        "troilite": (0.01, 0.06),
        "fe_ni_metal": (0.05, 0.15),
        "carbon": (0.01, 0.05),
        "water_ice": (0.01, 0.06),
        "ammonia": (0.00, 0.02),
        "methane": (0.00, 0.01),
        "salts": (0.00, 0.02),
        "phosphate": (0.00, 0.01),
        "other_silicate": (0.10, 0.25),
    },
}

# Rough bulk densities (kg/m^3) used when the catalogue has no density value.
DEFAULT_DENSITY: dict[str, float] = {
    "C": 1500.0,
    "B": 1400.0,
    "D": 1300.0,
    "P": 1200.0,
    "Ch": 1500.0,
    "S": 2800.0,
    "Q": 3000.0,
    "L": 2900.0,
    "V": 3000.0,
    "A": 2900.0,
    "K": 2600.0,
    "X": 4000.0,
    "M": 5000.0,
    "E": 3500.0,
    "U": 2500.0,
}

# Mineral -> industrial feedstock class.  Replace with your own raw
# ore / chemical mapping when the full mineral list is ready.
DEFAULT_FEEDSTOCK_MAP: dict[str, str] = {
    "olivine": "silicate_ore",
    "pyroxene": "silicate_ore",
    "plagioclase": "silicate_ore",
    "serpentine": "silicate_ore",
    "other_silicate": "silicate_ore",
    "magnetite": "metal_ore",
    "troilite": "sulfide_ore",
    "fe_ni_metal": "metal_ore",
    "carbon": "carbon",
    "water_ice": "water",
    "ammonia": "ammonia",
    "methane": "methane",
    "salts": "salts",
    "phosphate": "phosphate",
}


def normalize_surface_type(surface_type: str | None) -> str:
    """Map a taxonomic class/complex onto a key in the composition table.

    Exact keys win.  Otherwise the first letter is used (e.g. ``Sq`` -> ``S``,
    ``Cgh`` -> ``C``).  Unknown or missing types fall back to ``U``.
    """
    if not surface_type:
        return "U"
    key = surface_type.strip()
    if key in SURFACE_COMPOSITION_RANGES:
        return key
    first = key[0].upper()
    if first in SURFACE_COMPOSITION_RANGES:
        return first
    return "U"


class CompositionModel:
    """Sample and aggregate bulk mineral mass fractions by surface type."""

    def __init__(
        self,
        ranges: Mapping[str, Mapping[str, tuple[float, float]]] | None = None,
        feedstock_map: Mapping[str, str] | None = None,
        *,
        seed: int | None = None,
    ):
        self.ranges = {
            surface: dict(minerals)
            for surface, minerals in (ranges or SURFACE_COMPOSITION_RANGES).items()
        }
        self.feedstock_map = dict(feedstock_map or DEFAULT_FEEDSTOCK_MAP)
        self._rng = np.random.default_rng(seed)
        # Stable ordering for arrays.
        self.feedstocks = sorted(set(self.feedstock_map.values()))

    @classmethod
    def from_taxonomy_json(
        cls,
        path: str | Path,
        *,
        uncertainty: float = 0.20,
        feedstock_map: Mapping[str, str] | None = None,
        seed: int | None = None,
    ) -> "CompositionModel":
        """Build a model from ``AsteroidMaterialsTaxinomy.json``-style data.

        The JSON file gives point-estimate bulk abundances in wt%.  Each value
        is turned into a range of ``value * (1 +/- uncertainty)`` and the
        element/compound names are mapped onto industrial feedstock classes.
        ``PGM_ppm`` is converted from ppm to wt% before normalisation.

        The loader also creates aggregate ``C``, ``S``, ``M``, ``X`` and ``U``
        entries from the finer subtypes so the catalogue's taxonomic complexes
        can be looked up directly.
        """
        data = json.loads(Path(path).read_text())
        types = data.get("types", data)
        fields = [
            "H2O",
            "C",
            "N",
            "S",
            "Fe_metal",
            "Ni",
            "Co",
            "silicates",
            "PGM_ppm",
        ]
        scale = {"PGM_ppm": 1.0e-4}  # ppm -> wt%

        raw: dict[str, dict[str, tuple[float, float]]] = {}
        for name, values in types.items():
            if not isinstance(values, Mapping):
                continue
            ranges: dict[str, tuple[float, float]] = {}
            for field in fields:
                value = values.get(field)
                if not isinstance(value, (int, float)):
                    continue
                abundance = float(value) * scale.get(field, 1.0)
                if abundance <= 0:
                    continue
                ranges[field] = (
                    max(0.0, abundance * (1.0 - uncertainty)),
                    abundance * (1.0 + uncertainty),
                )
            if ranges:
                raw[name] = ranges

        # Aggregate the finer JSON types onto the coarse catalogue complexes.
        aliases = {
            "C": ["Cb", "Cg", "Ch", "Cgh", "C"],
            "S": ["S", "Sq", "Sr"],
            "M": ["M", "M_iron"],
            "X": ["Xe", "Xk", "Xc", "Xt"],
        }
        for parent, children in aliases.items():
            if parent in raw:
                continue
            child_ranges = [raw[child] for child in children if child in raw]
            if not child_ranges:
                continue
            keys = set().union(*(set(r) for r in child_ranges))
            raw[parent] = {
                key: (
                    sum(r[key][0] for r in child_ranges if key in r)
                    / sum(1 for r in child_ranges if key in r),
                    sum(r[key][1] for r in child_ranges if key in r)
                    / sum(1 for r in child_ranges if key in r),
                )
                for key in keys
            }

        if "U" not in raw:
            generic = [raw[name] for name in ("C", "S", "M", "X") if name in raw]
            if generic:
                keys = set().union(*(set(r) for r in generic))
                raw["U"] = {
                    key: (
                        sum(r[key][0] for r in generic if key in r)
                        / sum(1 for r in generic if key in r),
                        sum(r[key][1] for r in generic if key in r)
                        / sum(1 for r in generic if key in r),
                    )
                    for key in keys
                }

        default_feedstocks = {
            "H2O": "water",
            "C": "carbon",
            "N": "ammonia",
            "S": "sulfide_ore",
            "Fe_metal": "metal_ore",
            "Ni": "metal_ore",
            "Co": "metal_ore",
            "silicates": "silicate_ore",
            "PGM_ppm": "pgm",
        }
        return cls(
            ranges=raw,
            feedstock_map=feedstock_map or default_feedstocks,
            seed=seed,
        )

    # ------------------------------------------------------------------ raw
    def _key(self, surface_type: str | None) -> str:
        if not surface_type:
            return "U" if "U" in self.ranges else next(iter(self.ranges))
        key = surface_type.strip()
        if key in self.ranges:
            return key
        first = key[0].upper()
        if first in self.ranges:
            return first
        return "U" if "U" in self.ranges else next(iter(self.ranges))

    def minerals_for(self, surface_type: str | None) -> list[str]:
        surface = self._key(surface_type)
        return sorted(self.ranges[surface])

    def expected(self, surface_type: str | None) -> dict[str, float]:
        """Midpoint composition, normalised to sum to 1."""
        surface = self._key(surface_type)
        ranges = self.ranges[surface]
        values = {m: (lo + hi) / 2.0 for m, (lo, hi) in ranges.items()}
        total = sum(values.values())
        return {m: v / total for m, v in values.items()}

    def sample_matrix(
        self,
        surface_type: str | None,
        n: int = 1,
        rng: np.random.Generator | None = None,
    ) -> tuple[list[str], np.ndarray]:
        """Draw ``n`` composition rows.

        Returns ``(minerals, fractions)`` where ``fractions`` has shape
        ``(n, len(minerals))`` and every row sums to 1.
        """
        if n < 1:
            raise ValueError("n must be >= 1")
        surface = self._key(surface_type)
        ranges = self.ranges[surface]
        minerals = sorted(ranges)
        lows = np.array([ranges[m][0] for m in minerals], dtype=float)
        highs = np.array([ranges[m][1] for m in minerals], dtype=float)
        rng = rng or self._rng
        x = rng.uniform(lows, highs, size=(n, len(minerals)))
        totals = x.sum(axis=1, keepdims=True)
        if np.any(totals <= 0):
            raise ValueError(f"composition ranges for {surface!r} cannot be sampled")
        return minerals, x / totals

    def sample(
        self,
        surface_type: str | None,
        n: int = 1,
        rng: np.random.Generator | None = None,
    ) -> list[dict[str, float]]:
        minerals, matrix = self.sample_matrix(surface_type, n, rng)
        return [dict(zip(minerals, row)) for row in matrix]

    # -------------------------------------------------------------- feedstock
    def to_feedstocks(self, composition: Mapping[str, float]) -> dict[str, float]:
        """Aggregate a mineral composition into industrial feedstock classes."""
        out: dict[str, float] = defaultdict(float)
        for mineral, fraction in composition.items():
            out[self.feedstock_map.get(mineral, mineral)] += float(fraction)
        return dict(out)

    def expected_feedstocks(self, surface_type: str | None) -> dict[str, float]:
        return self.to_feedstocks(self.expected(surface_type))

    def feedstock_matrix(
        self,
        surface_type: str | None,
        n: int = 1,
        rng: np.random.Generator | None = None,
    ) -> tuple[list[str], np.ndarray]:
        """Draw composition samples and aggregate directly to feedstocks.

        Returns ``(feedstocks, fractions)`` with shape ``(n, len(feedstocks))``.
        """
        minerals, matrix = self.sample_matrix(surface_type, n, rng)
        # Build a mineral -> feedstock one-hot matrix.
        names = sorted({self.feedstock_map.get(m, m) for m in minerals})
        index = {f: i for i, f in enumerate(names)}
        agg = np.zeros((len(minerals), len(names)), dtype=float)
        for j, mineral in enumerate(minerals):
            feedstock = self.feedstock_map.get(mineral, mineral)
            agg[j, index[feedstock]] = 1.0
        return names, matrix @ agg

    def expected_feedstock_fractions(self, surface_type: str | None) -> dict[str, float]:
        return self.expected_feedstocks(surface_type)
