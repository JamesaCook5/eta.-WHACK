"""Station placement for one product: weighted k-median plus Monte Carlo over
asteroid composition.

Space
-----
Every planned asteroid is a point in a velocity-like space. Euclidean distance
approximates orbital transfer Δv from a station to a body::

    x = (√1.25 ln a, √2 e, √2 sin i, q cos θ, q sin θ)

The first three are the Zappalà family metric (orbit size, shape, tilt, in
units of the orbital speed v). θ is the body's heliocentric ecliptic longitude
at the dataset epoch; catching up Δθ along an orbit within a trip time T costs
about (2/3)·a·Δθ / T, which in units of v is q·Δθ with q = (2/3)·P / (2π·T),
P the orbital period. Points on a circle of radius q give that cost for small
Δθ and keep the space Euclidean, so the embedding supports Euclidean-distance optimization.

Clustering
----------
Weight w_j = tonnes of the product's asteroid-sourced elements in body j (mass
x grade; bodies counted up to ``MINING_DIAMETER_CAP_KM`` across).
The multi-source Weber heuristic assigns every planned asteroid to its nearest
station and updates each station to the weighted geometric median of its
assigned points. Weighted k-median++ starts are compared by linear travel cost
on a grid summary, then the best result is refined on every asteroid.

Output
------
A station yields what its asteroids contain: for every element, Σ mass x grade
over its members, so co-products come out in the minerals' own ratio.

Monte Carlo
-----------
Each draw resamples every taxonomic type's mineral mix from a Dirichlet around
the lookup's values (concentration set by its confidence grade) and the blend
weights of mixed classes.  Only the composition is resampled; asteroid
positions, masses and the class assignment are fixed.  Asteroids of the same
class share that class's draw, because individual assays are needed to justify
 per-object compositions. The flat planner re-runs its clustering per draw on the grid summary,
warm-started from the nominal stations so station k stays station k.  All draws
run together as arrays.  Ranges are the 5th-95th percentiles.
"""

from __future__ import annotations

import base64
import json
import math
import os
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable

import numpy as np

V_EARTH_KMS = 29.78
MINING_DIAMETER_CAP_KM = 100.0
CONFIDENCE_KAPPA = {"H": 200.0, "M": 60.0, "L": 25.0, "VL": 10.0}
BLEND_KAPPA = 10.0
RESTARTS = 3
MAX_ITER = 60
MC_MAX_ITER = 15
MC_BATCH = 50
#: Threads for the Monte Carlo batches.
MC_THREADS = max(1, min(8, os.cpu_count() or 1))
#: A rechecked cell is first compared with its this-many nearest nominal stations (exactness is checked).
MC_NEAREST = 8
#: Most stations a plan can have (assignment is uint8 with 255 meaning "not planned").
MAX_STATIONS = 250
#: Cap on station positions sent for the map cloud (stations × draws).
CLOUD_POINTS = 60_000
TOP_MEMBERS = 8
GRID = (32, 10, 10, 24)  # cells in ln a, e, sin i, longitude
SQRT_125 = math.sqrt(1.25)
SQRT_2 = math.sqrt(2.0)
OUTER_PREFIXES = ("Centaur", "KBO")


def _wrap(d: np.ndarray | float):
    """Angle difference wrapped to (-π, π]."""
    return (np.asarray(d) + np.pi) % (2 * np.pi) - np.pi


# ---------------------------------------------------------------- data


@dataclass
class AsteroidTable:
    """Column view of the shared asteroid file (same order as the UI's dataset)."""

    a: np.ndarray
    e: np.ndarray
    i_deg: np.ndarray
    x: np.ndarray
    y: np.ndarray
    diameter_km: np.ndarray
    albedo: np.ndarray
    taxonomy: list[str | None]
    outer: np.ndarray  # True for Centaurs and Kuiper-belt objects

    @property
    def count(self) -> int:
        return len(self.a)

    @classmethod
    def from_json(cls, path: str | Path) -> "AsteroidTable":
        rows = json.loads(Path(path).read_text())

        def col(key):
            return np.array([np.nan if r.get(key) is None else r[key] for r in rows], dtype=float)

        return cls(
            a=col("a"),
            e=col("e"),
            i_deg=col("i"),
            x=col("x"),
            y=col("y"),
            diameter_km=col("diameter_km"),
            albedo=col("albedo"),
            taxonomy=[r.get("taxonomy_class") for r in rows],
            outer=np.array([str(r.get("orbit_class") or "").startswith(OUTER_PREFIXES) for r in rows]),
        )


def scenario_key(model: dict, class_name: str | None, albedo: float) -> str | None:
    """Taxonomy scenario for an asteroid: its class, or class@X=P/M/E/? for X-bearing classes."""
    if not class_name:
        return None
    if class_name in model["scenarios"]:
        return class_name
    split = model["x_albedo_split"]
    if albedo is None or not np.isfinite(albedo):
        suffix = "?"
    elif albedo < split["P_below"]:
        suffix = "P"
    elif albedo <= split["E_above"]:
        suffix = "M"
    else:
        suffix = "E"
    key = f"{class_name}@X={suffix}"
    return key if key in model["scenarios"] else None


@dataclass
class SamplingModel:
    """The supply model as arrays: nominal grades and what the Monte Carlo resamples."""

    elements: list[str]
    labels: dict[str, str]
    scenario_keys: list[str]
    density: np.ndarray  # (S,) g/cm³
    grade: np.ndarray  # (S, E) kg per tonne, nominal
    mineral_yield: np.ndarray  # (M, E) mass fraction
    type_minerals: np.ndarray  # (B, M) mass fraction, rows sum to 1
    type_kappa: np.ndarray  # (B,)
    blend: np.ndarray  # (S, B) nominal blend weights (rows sum to 1); zero rows are not resampled
    h_index: int
    water_index: int
    h_in_water: float

    @classmethod
    def from_model(cls, model: dict) -> "SamplingModel":
        elements = [el["id"] for el in model["elements"]]
        E = len(elements)
        minerals = list(model["mineral_yield_wt_pct"])
        mineral_yield = np.zeros((len(minerals), E))
        for mi, m in enumerate(minerals):
            for el, y in model["mineral_yield_wt_pct"][m].items():
                if el in elements:
                    mineral_yield[mi, elements.index(el)] = y / 100
        types = list(model["types"])
        type_minerals = np.zeros((len(types), len(minerals)))
        type_kappa = np.zeros(len(types))
        for ti, t in enumerate(types):
            wt = model["types"][t]["minerals_wt_pct"]
            total = sum(wt.values()) or 1.0
            for m, v in wt.items():
                if m in minerals:
                    type_minerals[ti, minerals.index(m)] = v / total
            type_kappa[ti] = CONFIDENCE_KAPPA.get(model["types"][t]["confidence"], CONFIDENCE_KAPPA["L"])
        keys = list(model["scenarios"])
        grade = np.zeros((len(keys), E))
        density = np.zeros(len(keys))
        blend = np.zeros((len(keys), len(types)))
        for si, k in enumerate(keys):
            sc = model["scenarios"][k]
            density[si] = sc["density_g_cm3"]
            for e, el in enumerate(elements):
                grade[si, e] = sc["grade_kg_per_t"].get(el, 0.0)
            base = {b: w for b, w in (sc.get("base") or {}).items() if b in types}
            total = sum(base.values())
            if sc.get("resolved", True) and total > 0:
                for b, w in base.items():
                    blend[si, types.index(b)] = w / total
        return cls(
            elements=elements,
            labels={el["id"]: el["label"] for el in model["elements"]},
            scenario_keys=keys,
            density=density,
            grade=grade,
            mineral_yield=mineral_yield,
            type_minerals=type_minerals,
            type_kappa=type_kappa,
            blend=blend,
            h_index=elements.index("H") if "H" in elements else -1,
            water_index=elements.index("water") if "water" in elements else -1,
            h_in_water=float(model["h_in_water"]),
        )

    def _sample_class_mixes(self, draws: int, rng: np.random.Generator) -> np.ndarray:
        """(draws, S, M) class-level mineral mixes with every type and blend resampled."""
        B, M = self.type_minerals.shape
        type_mix = np.zeros((draws, B, M))
        for b in range(B):
            nz = self.type_minerals[b] > 0
            if not nz.any():
                continue
            g = rng.gamma(self.type_kappa[b] * self.type_minerals[b, nz], size=(draws, int(nz.sum())))
            type_mix[:, b, nz] = g / g.sum(axis=1, keepdims=True)
        blend = np.broadcast_to(self.blend, (draws, *self.blend.shape)).copy()
        for s in np.flatnonzero((self.blend > 0).sum(axis=1) > 1):
            nz = self.blend[s] > 0
            g = rng.gamma(BLEND_KAPPA * self.blend[s, nz], size=(draws, int(nz.sum())))
            blend[:, s, nz] = g / g.sum(axis=1, keepdims=True)
        return blend @ type_mix  # (draws, S, M)

    def _grades_from_mix(self, mix: np.ndarray) -> np.ndarray:
        """Mineral mixes (..., M) -> element grades (..., E) in kg per tonne."""
        grade = mix @ self.mineral_yield * 1000.0
        if self.h_index >= 0 and self.water_index >= 0:
            grade[..., self.h_index] += grade[..., self.water_index] * self.h_in_water
        return grade

    def sample_grades(self, draws: int, rng: np.random.Generator) -> np.ndarray:
        """(draws, S, E) class-level grades in kg/t."""
        grade = self._grades_from_mix(self._sample_class_mixes(draws, rng))
        # Scenarios that can't be resampled (no or unresolved bases) keep their nominal grades.
        fixed = self.blend.sum(axis=1) == 0
        grade[:, fixed] = self.grade[fixed]
        return grade


# ---------------------------------------------------------------- weighted k-median


def _assign(X: np.ndarray, C: np.ndarray, chunk: int = 16384) -> np.ndarray:
    """Nearest centre per point; on an exact tie the later centre wins.

    Uses |x − c|² = |x|² − 2x·c + |c|² and drops |x|² (the same for every centre),
    so the work is one matrix product per chunk of points.
    """
    k = C.shape[0]
    C_rev = C[::-1]
    c2 = (C_rev**2).sum(1)
    out = np.empty(len(X), dtype=np.int64)
    for i in range(0, len(X), chunk):
        d = c2[None, :] - 2.0 * (X[i : i + chunk] @ C_rev.T)
        out[i : i + chunk] = k - 1 - np.argmin(d, axis=1)
    return out


def _distances(X: np.ndarray, C: np.ndarray, chunk: int = 4096) -> np.ndarray:
    """Euclidean distance from every point to every centre, (n, k)."""
    out = np.empty((len(X), len(C)))
    for i in range(0, len(X), chunk):
        out[i : i + chunk] = np.sqrt(((X[i : i + chunk, None, :] - C[None]) ** 2).sum(-1))
    return out


def _update(X: np.ndarray, w: np.ndarray, labels: np.ndarray, C: np.ndarray) -> np.ndarray:
    """Weighted means; an empty station moves to the point contributing most to the inertia."""
    k = C.shape[0]
    W = np.bincount(labels, weights=w, minlength=k)
    S = np.stack([np.bincount(labels, weights=w * X[:, t], minlength=k) for t in range(X.shape[1])], axis=1)
    out = C.copy()
    full = W > 0
    out[full] = S[full] / W[full, None]
    for c in np.flatnonzero(~full):
        cost = w * ((X - out[labels]) ** 2).sum(1)
        out[c] = X[int(np.argmax(cost))]
    return out


def _lloyd(X: np.ndarray, w: np.ndarray, C: np.ndarray, max_iter: int):
    labels = _assign(X, C)
    it = 0
    for it in range(1, max_iter + 1):
        C = _update(X, w, labels, C)
        new = _assign(X, C)
        if np.array_equal(new, labels):
            break
        labels = new
    return C, labels, it


def _kmeans_pp(X: np.ndarray, w: np.ndarray, k: int, rng: np.random.Generator) -> np.ndarray:
    """Weighted k-means++: first centre ∝ w, then ∝ w x D²."""
    n = len(X)
    p = w / w.sum()
    C = [X[rng.choice(n, p=p)]]
    D = ((X - C[0]) ** 2).sum(1)
    for _ in range(1, k):
        score = w * D
        j = rng.choice(n, p=score / score.sum()) if score.sum() > 0 else int(rng.integers(n))
        C.append(X[j])
        D = np.minimum(D, ((X - X[j]) ** 2).sum(1))
    return np.array(C)


def _inertia(X, w, labels, C) -> float:
    return float((w * ((X - C[labels]) ** 2).sum(1)).sum())


def _geometric_median(X: np.ndarray, w: np.ndarray, initial: np.ndarray, max_iter: int = 12) -> np.ndarray:
    """Weighted geometric median via modified Weiszfeld iterations."""
    y = initial.astype(float, copy=True)
    if len(X) <= 1:
        return X[0].copy() if len(X) else y
    for _ in range(max_iter):
        delta = X - y
        distance = np.linalg.norm(delta, axis=1)
        coincident = distance <= 1e-12
        regular = ~coincident
        if not regular.any():
            return y
        inv = w[regular] / distance[regular]
        target = (X[regular] * inv[:, None]).sum(axis=0) / inv.sum()
        if coincident.any():
            residual = (delta[regular] * (w[regular] / distance[regular])[:, None]).sum(axis=0)
            residual_norm = np.linalg.norm(residual)
            coincident_weight = w[coincident].sum()
            if residual_norm <= coincident_weight:
                return y
            fraction = coincident_weight / residual_norm
            updated = (1.0 - fraction) * target + fraction * y
        else:
            updated = target
        if np.linalg.norm(updated - y) <= 1e-4 * (1.0 + np.linalg.norm(y)):
            return updated
        y = updated
    return y


def _weber_update(X: np.ndarray, w: np.ndarray, labels: np.ndarray, C: np.ndarray) -> np.ndarray:
    """Minimize weighted linear travel distance for fixed station assignments."""
    out = C.copy()
    for c in range(len(C)):
        members = labels == c
        if members.any():
            out[c] = _geometric_median(X[members], w[members], C[c])
        else:
            distances = np.linalg.norm(X - C[labels], axis=1)
            out[c] = X[int(np.argmax(w * distances))]
    return out


def _weber(X: np.ndarray, w: np.ndarray, C: np.ndarray, max_iter: int):
    """Lloyd-style k-median descent using nearest-station assignment and Weiszfeld centers."""
    labels = _assign(X, C)
    for iteration in range(1, max_iter + 1):
        C = _weber_update(X, w, labels, C)
        updated = _assign(X, C)
        if np.array_equal(updated, labels):
            break
        labels = updated
    return C, labels, iteration


def _weber_pp(X: np.ndarray, w: np.ndarray, k: int, rng: np.random.Generator) -> np.ndarray:
    """Weighted k-median++ seed points, with linear rather than squared distance."""
    n = len(X)
    C = [X[rng.choice(n, p=w / w.sum())]]
    distance = np.linalg.norm(X - C[0], axis=1)
    for _ in range(1, k):
        score = w * distance
        j = rng.choice(n, p=score / score.sum()) if score.sum() > 0 else int(rng.integers(n))
        C.append(X[j])
        distance = np.minimum(distance, np.linalg.norm(X - X[j], axis=1))
    return np.asarray(C)


def _weber_cost(X: np.ndarray, w: np.ndarray, labels: np.ndarray, C: np.ndarray) -> float:
    return float((w * np.linalg.norm(X - C[labels], axis=1)).sum())


# ---------------------------------------------------------------- planner


def _b64(arr: np.ndarray) -> str:
    return base64.b64encode(np.ascontiguousarray(arr).tobytes()).decode("ascii")


def _range(values: np.ndarray) -> dict:
    lo, mid, hi = np.percentile(values, [5, 50, 95], axis=0)
    return {"lo": float(lo), "mid": float(mid), "hi": float(hi)}


class PlanCancelled(Exception):
    """Raised inside plan() when ``cancelled()`` turns true (a newer request superseded this one)."""


class StationPlanner:
    """Plans stations for any product over a fixed asteroid table and supply model."""

    def __init__(self, asteroids: AsteroidTable, model: dict):
        self.asteroids = asteroids
        self.model = model
        self.sampling = SamplingModel.from_model(model)
        self.products = {p["id"]: p for p in model["products"]}
        t = asteroids
        index = {k: i for i, k in enumerate(self.sampling.scenario_keys)}
        self.scenario = np.array(
            [index.get(scenario_key(model, c, al), -1) for c, al in zip(t.taxonomy, t.albedo)], dtype=np.int64
        )
        D = np.minimum(np.nan_to_num(t.diameter_km, nan=0.0), MINING_DIAMETER_CAP_KM)
        dens = np.where(self.scenario >= 0, self.sampling.density[np.maximum(self.scenario, 0)], 0.0)
        # Rock mass counted for mining, tonnes (π/6 D³, km³ → m³, g/cm³ = t/m³).
        self.mass = np.where(self.scenario >= 0, math.pi / 6 * D**3 * 1e9 * dens, 0.0)
        self.orbit = np.column_stack(
            [SQRT_125 * np.log(t.a), SQRT_2 * t.e, SQRT_2 * np.sin(np.radians(t.i_deg))]
        )
        self.phase = np.arctan2(t.y, t.x)
        self.valid = np.isfinite(self.orbit).all(1) & np.isfinite(self.phase) & (t.a > 0)

    @classmethod
    def from_files(cls, asteroids_path: str | Path, root: str | Path) -> "StationPlanner":
        from .product_supply import build_product_supply

        return cls(AsteroidTable.from_json(asteroids_path), build_product_supply(root))

    # ------------------------------------------------------------ helpers

    def _embed(self, rows: np.ndarray, trip_years: float) -> np.ndarray:
        a = self.asteroids.a[rows]
        q = (2 / 3) * a**1.5 / (2 * math.pi * trip_years)
        ph = self.phase[rows]
        return np.column_stack([self.orbit[rows], q * np.cos(ph), q * np.sin(ph)])

    @staticmethod
    def _cells(
        X: np.ndarray,
        phase: np.ndarray,
        w: np.ndarray,
        scen: np.ndarray | None = None,
        mass: np.ndarray | None = None,
        S: int | None = None,
    ):
        """Grid summary of the asteroids: cells in (ln a, e, sin i, longitude)."""
        def bins(v, lo, hi, nb):
            return np.clip(((v - lo) / max(hi - lo, 1e-9) * nb).astype(np.int64), 0, nb - 1)

        na, ne, ni, nt = GRID
        key = (
            (bins(X[:, 0], X[:, 0].min(), X[:, 0].max(), na) * ne + bins(X[:, 1], 0, X[:, 1].max(), ne)) * ni
            + bins(X[:, 2], 0, X[:, 2].max(), ni)
        ) * nt + bins(phase, -math.pi, math.pi, nt)
        _, of = np.unique(key, return_inverse=True)
        n_cells = int(of.max()) + 1
        wt = np.where(w > 0, w, 1e-9)
        W = np.bincount(of, weights=wt, minlength=n_cells)
        cX = np.stack([np.bincount(of, weights=wt * X[:, t], minlength=n_cells) for t in range(X.shape[1])], 1)
        cX /= W[:, None]
        cw = np.bincount(of, weights=w, minlength=n_cells)
        if scen is None:
            return of, cX, cw
        cell_scen = np.zeros((n_cells, int(S)))
        has = scen >= 0
        np.add.at(cell_scen, (of[has], scen[has]), mass[has] / 1000.0)
        return of, cX, cw, cell_scen

    # ------------------------------------------------------------ main

    def plan(
        self,
        product_id: str,
        stations: int = 3,
        trip_years: float = 2.0,
        include_outer: bool = False,
        draws: int = 1000,
        mask: np.ndarray | None = None,
        seed: int = 7,
        cancelled: Callable[[], bool] | None = None,
    ) -> dict:
        t0 = time.perf_counter()
        sm = self.sampling
        product = self.products[product_id]
        k = int(min(max(stations, 1), MAX_STATIONS))
        trip_years = max(float(trip_years), 0.1)
        n_all = self.asteroids.count
        planned = self.valid.copy()
        if mask is not None:
            planned &= mask.astype(bool)
        if not include_outer:
            planned &= ~self.asteroids.outer
        rows = np.flatnonzero(planned)
        req = [sm.elements.index(el) for el in product["elements"] if el in sm.elements]
        scen = self.scenario[rows]
        mass = self.mass[rows]
        req_grade = sm.grade[:, req].sum(1) if req else np.zeros(len(sm.scenario_keys))
        w = np.where(scen >= 0, mass * req_grade[np.maximum(scen, 0)] / 1000.0, 0.0)

        inputs = []
        for el in product["elements"]:
            e = sm.elements.index(el)
            g = np.where(scen >= 0, sm.grade[np.maximum(scen, 0), e], 0.0)
            carrier = (g > 0) & (mass > 0)
            inputs.append({
                "id": el,
                "label": sm.labels.get(el, el),
                "carriers": int(carrier.sum()),
                "tonnes": float((mass * g / 1000.0)[carrier].sum()),
            })
        carries = np.zeros(n_all, dtype=np.uint8)
        carries[rows] = (w > 0).astype(np.uint8)
        base = {
            "product": product_id,
            "elements": sm.elements,
            "required": list(product["elements"]),
            "inputs": inputs,
            "stations": [],
            "assignment": None,
            "carries": _b64(carries),
            "stability": None,
            "cloud": None,
            "count": n_all,
            "draws": 0,
            "restarts": RESTARTS,
            "iterations": 0,
            "cells": 0,
            "tripYears": trip_years,
        }
        if not req or any(i["carriers"] == 0 for i in inputs) or w.sum() <= 0 or len(rows) < k:
            base["ms"] = (time.perf_counter() - t0) * 1000
            return base

        rng = np.random.default_rng(seed)
        X = self._embed(rows, trip_years)
        S = len(sm.scenario_keys)
        of, cX, cw, cell_scen = self._cells(X, self.phase[rows], w, scen, mass, S)

        # 1. Restarts of weighted k-median++ on the cells; 2. refine on every asteroid.
        best, best_i, iterations = None, math.inf, 0
        for _ in range(RESTARTS):
            C, lab, it = _weber(cX, cw, _weber_pp(cX, cw, k, rng), MAX_ITER)
            iterations += it
            cost = _weber_cost(cX, cw, lab, C)
            if cost < best_i:
                best, best_i = C, cost
        C, labels, it = _weber(X, w, best, MAX_ITER)
        iterations += it

        # Order stations by the tonnage they hold.
        held = np.bincount(labels, weights=w, minlength=k)
        order = np.argsort(-held, kind="stable")
        rank = np.empty(k, dtype=np.int64)
        rank[order] = np.arange(k)
        C = C[order]
        labels = rank[labels]
        held = held[order]
        total_w = float(held.sum())

        station_list = self._describe(rows, X, w, scen, mass, labels, C, total_w)
        assignment = np.full(n_all, 255, dtype=np.uint8)
        assignment[rows] = labels.astype(np.uint8)
        base.update(
            stations=station_list,
            assignment=_b64(assignment),
            iterations=iterations,
            cells=int(len(cX)),
        )

        if draws > 0:
            self._monte_carlo(base, rows, of, cX, cell_scen, C, labels, req, int(draws), rng, cancelled)
        base["ms"] = (time.perf_counter() - t0) * 1000
        return base

    def _describe(self, rows, X, w, scen, mass, labels, C, total_w) -> list[dict]:
        sm = self.sampling
        k = len(C)
        out_tonnes = np.zeros((k, len(sm.elements)))
        has = scen >= 0
        np.add.at(out_tonnes, labels[has], (mass[has, None] * sm.grade[scen[has]]) / 1000.0)
        q = np.hypot(X[:, 3], X[:, 4])
        result = []
        for c in range(k):
            a = math.exp(C[c, 0] / SQRT_125)
            v = V_EARTH_KMS / math.sqrt(a)
            lon = math.atan2(C[c, 4], C[c, 3])
            members = np.flatnonzero(labels == c)
            dv = v * np.sqrt(((X[members] - C[c]) ** 2).sum(1))
            wm = w[members]
            held = wm.sum()
            # Tonnage-weighted median Δv.
            pos = wm > 0
            order = np.argsort(dv[pos])
            cum = np.cumsum(wm[pos][order])
            dv_median = float(dv[pos][order][np.searchsorted(cum, held / 2)]) if held > 0 else 0.0
            top = members[np.argsort(-wm, kind="stable")[:TOP_MEMBERS]]
            top = top[w[top] > 0]
            top_dv = v * np.sqrt(((X[top] - C[c]) ** 2).sum(1))
            mean_q = float((wm * q[members]).sum() / held) if held > 0 else 0.0
            result.append({
                "a": a,
                "e": max(0.0, C[c, 1] / SQRT_2),
                "i": math.degrees(math.asin(min(1.0, max(0.0, C[c, 2] / SQRT_2)))),
                "longitude": math.degrees(lon),
                "members": int(len(members)),
                "share": float(held / total_w) if total_w > 0 else 0.0,
                "output": out_tonnes[c].tolist(),
                "dvMedian": dv_median,
                "bunching": min(1.0, math.hypot(C[c, 3], C[c, 4]) / mean_q) if mean_q > 0 else 0.0,
                "topMembers": [
                    {
                        "index": int(rows[j]),
                        "tonnes": float(w[j]),
                        "dv": float(d),
                        "offsetDeg": float(np.degrees(_wrap(self.phase[rows[j]] - lon))),
                    }
                    for j, d in zip(top, top_dv)
                ],
            })
        return result

    def _monte_carlo(
        self,
        base,
        rows,
        of,
        cX,
        cell_scen,
        C0,
        labels,
        req,
        draws,
        rng,
        cancelled=None,
    ) -> None:
        """Re-run the weighted k-median on cells for ranges, stability, and the cloud.

        Each draw is warm-started from the nominal stations, with Hamerly's bounds
        so a cell is only compared with every station when its
        nearest one could have changed: per cell an upper bound on the distance to
        its own station and a lower bound on the distance to any other. Draws move
        the stations only a little, so most cells are never rechecked. The result
        center updates use modified Weiszfeld iterations for weighted geometric medians.

        Only the modeled mineral compositions and mixed-class blend weights are
        resampled.  Asteroid identities, taxonomy, masses, and orbits remain
        fixed; bodies assigned to the same composition scenario share that
        scenario's draw.
        """
        sm = self.sampling
        k = C0.shape[0]
        n_cells = len(cX)
        E = len(sm.elements)
        S = cell_scen.shape[1]
        stay = np.zeros((n_cells, k))
        a_d = np.zeros((draws, k))
        lon_d = np.zeros((draws, k))
        share_d = np.zeros((draws, k))
        out_d = np.zeros((draws, k, E))
        nominal_lon = np.arctan2(C0[:, 4], C0[:, 3])

        # Distances to the nominal stations are the same for every draw: nearest, its distance, runner-up.
        dist0 = _distances(cX, C0)
        start = np.argmin(dist0, axis=1)
        upper0 = dist0[np.arange(n_cells), start]
        lower0 = np.partition(dist0, 1, axis=1)[:, 1] if k > 1 else np.full(n_cells, np.inf)
        # Each cell's nominal stations nearest first. A station outside a cell's first L
        # is at least (L-th nominal distance − how far any station has drifted) away.
        L = min(k, MC_NEAREST)
        order0 = np.argsort(dist0, axis=1, kind="stable")[:, :L]
        beyond0 = np.sort(dist0, axis=1)[:, L] if L < k else np.full(n_cells, np.inf)

        def cluster(cw: np.ndarray):
            """Warm-start the multi-source Weber solve for each draw's cell weights."""
            D = len(cw)
            lab = np.tile(start, (D, 1))
            upper = np.tile(upper0, (D, 1))
            lower = np.tile(lower0, (D, 1))
            C = np.tile(C0, (D, 1, 1))
            active = np.arange(D)  # draws still changing
            for _ in range(MC_MAX_ITER):
                A = len(active)
                la, ua, lb = lab[active], upper[active], lower[active]
                C_new = C[active].copy()
                for local, draw in enumerate(active):
                    for station in range(k):
                        members = la[local] == station
                        if members.any():
                            point_weights = cw[draw, members]
                            if point_weights.sum() > 0:
                                C_new[local, station] = _geometric_median(
                                    cX[members], point_weights, C[draw, station]
                                )
                moved = np.sqrt(((C_new - C[active]) ** 2).sum(-1))  # (A, k)
                C[active] = C_new
                ua += np.take_along_axis(moved, la, axis=1)
                lb -= moved.max(axis=1, keepdims=True)
                # Cells whose own station might no longer be nearest: tighten the upper bound first.
                ai, ci = np.nonzero(ua > lb)
                if ai.size:
                    ua[ai, ci] = np.sqrt(((C_new[ai, la[ai, ci]] - cX[ci]) ** 2).sum(-1))
                    keep = ua[ai, ci] > lb[ai, ci]
                    ai, ci = ai[keep], ci[keep]
                changed = np.zeros(A, dtype=bool)
                if ai.size:
                    # Compare with the cell's nearest nominal stations first.
                    drift = np.sqrt(((C_new - C0[None]) ** 2).sum(-1)).max(axis=1)  # (A,)
                    cand = order0[ci]  # (n, L)
                    dist = np.sqrt(((C_new[ai[:, None], cand] - cX[ci][:, None, :]) ** 2).sum(-1))  # (n, L)
                    j = np.argmin(dist, axis=1)
                    d_best = dist[np.arange(len(j)), j]
                    outside = beyond0[ci] - drift[ai]  # lower bound for every other station
                    sure = d_best <= outside
                    a_s, c_s, best = ai[sure], ci[sure], cand[sure, j[sure]]
                    changed[a_s[best != la[a_s, c_s]]] = True
                    la[a_s, c_s] = best
                    ua[a_s, c_s] = d_best[sure]
                    second = np.partition(dist[sure], 1, axis=1)[:, 1] if L > 1 else np.full(sure.sum(), np.inf)
                    lb[a_s, c_s] = np.minimum(second, outside[sure])
                    ai, ci = ai[~sure], ci[~sure]  # these need every station
                # The rest: every station, one matrix product per draw (|x−c|² = |x|² − 2x·c + |c|²).
                for a in np.unique(ai):
                    c_a = ci[ai == a]
                    Xa = cX[c_a]
                    d2 = (Xa**2).sum(1)[:, None] - 2.0 * (Xa @ C_new[a].T) + (C_new[a] ** 2).sum(1)[None, :]
                    best = np.argmin(d2, axis=1)
                    changed[a] |= bool((best != la[a, c_a]).any())
                    la[a, c_a] = best
                    ua[a, c_a] = np.sqrt(((C_new[a, best] - Xa) ** 2).sum(-1))  # exact
                    if k > 1:
                        second = np.sqrt(np.maximum(np.partition(d2, 1, axis=1)[:, 1], 0.0))
                        lb[a, c_a] = second - 1e-9 * (1.0 + second)  # margin for rounding in the product
                    else:
                        lb[a, c_a] = np.inf
                lab[active], upper[active], lower[active] = la, ua, lb
                active = active[changed]
                if len(active) == 0:
                    break
            return lab, C

        def run(grade: np.ndarray):
            if cancelled is not None and cancelled():
                raise PlanCancelled
            cw = grade[..., req].sum(-1) @ cell_scen.T  # (D, cells), tonnes of inputs
            return (cw, *cluster(cw))

        # Sample every batch up front (one RNG stream, so results don't depend on threading),
        # then cluster the batches in parallel: numpy releases the GIL in the heavy parts.
        batches = [(b0, min(MC_BATCH, draws - b0)) for b0 in range(0, draws, MC_BATCH)]
        grades = [sm.sample_grades(D, rng) for _, D in batches]
        with ThreadPoolExecutor(max_workers=MC_THREADS) as pool:
            results = list(pool.map(run, grades))
        for (b0, D), grade, (cw, lab, C) in zip(batches, grades, results):
            offset = (np.arange(D) * k)[:, None]
            idx = (lab + offset).ravel()
            wk = np.bincount(idx, weights=cw.ravel(), minlength=D * k).reshape(D, k)
            stay += np.bincount((np.arange(n_cells)[None, :] * k + lab).ravel(), minlength=n_cells * k).reshape(n_cells, k)
            # Rock mass per station and scenario, then tonnes per element.
            mass_ks = np.stack(
                [np.bincount(idx, weights=np.broadcast_to(cell_scen[:, s], (D, n_cells)).ravel(), minlength=D * k)
                 for s in range(S)], axis=1,
            ).reshape(D, k, S)
            out_d[b0 : b0 + D] = mass_ks @ grade
            share_d[b0 : b0 + D] = wk / np.maximum(wk.sum(1, keepdims=True), 1e-300)
            a_d[b0 : b0 + D] = np.exp(C[..., 0] / SQRT_125)
            lon = np.arctan2(C[..., 4], C[..., 3])
            # Relative to nominal and unwrapped, so ranges don't jump at ±180°.
            lon_d[b0 : b0 + D] = nominal_lon + _wrap(lon - nominal_lon)

        pct = lambda v: np.percentile(v, [5, 50, 95], axis=0)  # noqa: E731 - (3, …) lo/mid/hi
        a_p, lon_p, share_p, out_p = pct(a_d), np.degrees(pct(lon_d)), pct(share_d), pct(out_d)
        as_range = lambda r: {"lo": float(r[0]), "mid": float(r[1]), "hi": float(r[2])}  # noqa: E731
        for c, st in enumerate(base["stations"]):
            st["ranges"] = {
                "a": as_range(a_p[:, c]),
                "longitude": as_range(lon_p[:, c]),
                "share": as_range(share_p[:, c]),
                "output": [as_range(out_p[:, c, e]) for e in range(E)],
            }
        stability = np.zeros(self.asteroids.count, dtype=np.uint8)
        stability[rows] = np.round(255 * stay[of, labels] / draws).astype(np.uint8)
        shown = max(1, min(draws, CLOUD_POINTS // k))  # every draw for small k, a sample for large k
        cloud = [
            np.round(np.column_stack([a_d[:shown, c] * np.cos(lon_d[:shown, c]), a_d[:shown, c] * np.sin(lon_d[:shown, c])]).ravel(), 4).tolist()
            for c in range(k)
        ]
        base.update(stability=_b64(stability), cloud=cloud, draws=draws)


def iter_products(model: dict) -> Iterable[str]:
    return (p["id"] for p in model["products"])
