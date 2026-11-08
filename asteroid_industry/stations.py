"""Station placement for one product: weighted k-means plus a Monte Carlo over
asteroid composition.

Space
-----
Every planned asteroid is a point in a velocity-like space, so squared distance
stands for the Δv² needed to get from a station to it::

    x = (√1.25 ln a, √2 e, √2 sin i, q cos θ, q sin θ)

The first three are the Zappalà family metric (orbit size, shape, tilt, in
units of the orbital speed v). θ is the body's heliocentric ecliptic longitude
at the dataset epoch; catching up Δθ along an orbit within a trip time T costs
about (2/3)·a·Δθ / T, which in units of v is q·Δθ with q = (2/3)·P / (2π·T),
P the orbital period. Points on a circle of radius q give that cost for small
Δθ and keep the space Euclidean, so plain k-means applies.

Clustering
----------
Weight w_j = tonnes of the product's asteroid-sourced elements in body j (mass
x grade; bodies counted up to ``MINING_DIAMETER_CAP_KM`` across). Weighted
k-means: every planned asteroid belongs to its nearest station (no distance
limit, no sharing; on an exact tie the later station takes it) and each station
sits at the w-weighted mean of its asteroids. k-means++ starts, several
restarts on a grid summary of the asteroids, best kept, then refined on every
asteroid.

Output
------
A station yields what its asteroids contain: for every element, Σ mass x grade
over its members, so co-products come out in the minerals' own ratio.

Monte Carlo
-----------
Each draw resamples every taxonomic type's mineral mix from a Dirichlet around
the lookup's values (concentration set by its confidence grade) and the blend
weights of mixed classes. All asteroids of a class share a draw. k-means is
re-run per draw on the grid summary, warm-started from the nominal stations so
station k stays station k. All draws run together as arrays. Ranges are the
5th-95th percentiles.
"""

from __future__ import annotations

import base64
import json
import math
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import numpy as np

V_EARTH_KMS = 29.78
MINING_DIAMETER_CAP_KM = 100.0
CONFIDENCE_KAPPA = {"H": 200.0, "M": 60.0, "L": 25.0, "VL": 10.0}
BLEND_KAPPA = 10.0
RESTARTS = 6
MAX_ITER = 60
MC_MAX_ITER = 15
MC_BATCH = 100
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

    def sample_grades(self, draws: int, rng: np.random.Generator) -> np.ndarray:
        """(draws, S, E) grades in kg/t with every type's mix and every blend resampled."""
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
        mix = blend @ type_mix  # (draws, S, M)
        grade = mix @ self.mineral_yield * 1000.0
        if self.h_index >= 0 and self.water_index >= 0:
            grade[..., self.h_index] += grade[..., self.water_index] * self.h_in_water
        # Scenarios that can't be resampled (no or unresolved bases) keep their nominal grades.
        fixed = self.blend.sum(axis=1) == 0
        grade[:, fixed] = self.grade[fixed]
        return grade


# ---------------------------------------------------------------- weighted k-means


def _assign(X: np.ndarray, C: np.ndarray) -> np.ndarray:
    """Nearest centre per point; on an exact tie the later centre wins."""
    d = ((X[:, None, :] - C[None, :, :]) ** 2).sum(-1)
    k = C.shape[0]
    return (k - 1 - np.argmin(d[:, ::-1], axis=1)).astype(np.int64)


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


# ---------------------------------------------------------------- planner


def _b64(arr: np.ndarray) -> str:
    return base64.b64encode(np.ascontiguousarray(arr).tobytes()).decode("ascii")


def _range(values: np.ndarray) -> dict:
    lo, mid, hi = np.percentile(values, [5, 50, 95], axis=0)
    return {"lo": float(lo), "mid": float(mid), "hi": float(hi)}


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
    def _cells(X: np.ndarray, phase: np.ndarray, w: np.ndarray, scen: np.ndarray, mass: np.ndarray, S: int):
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
        cell_scen = np.zeros((n_cells, S))
        has = scen >= 0
        np.add.at(cell_scen, (of[has], scen[has]), mass[has] / 1000.0)  # kilotonnes, so grades in kg/t give tonnes
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
    ) -> dict:
        t0 = time.perf_counter()
        sm = self.sampling
        product = self.products[product_id]
        k = int(min(max(stations, 1), 32))
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

        # 1. Restarts of weighted k-means++ on the cells, best kept; 2. refine on every asteroid.
        best, best_i, iterations = None, math.inf, 0
        for _ in range(RESTARTS):
            C, lab, it = _lloyd(cX, cw, _kmeans_pp(cX, cw, k, rng), MAX_ITER)
            iterations += it
            I = _inertia(cX, cw, lab, C)
            if I < best_i:
                best, best_i = C, I
        C, labels, it = _lloyd(X, w, best, MAX_ITER)
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
            self._monte_carlo(base, rows, of, cX, cell_scen, C, labels, req, int(draws), rng)
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

    def _monte_carlo(self, base, rows, of, cX, cell_scen, C0, labels, req, draws, rng) -> None:
        """Re-run k-means on the cells for resampled compositions; add ranges, stability and the cloud."""
        sm = self.sampling
        k, dim = C0.shape
        n_cells = len(cX)
        E = len(sm.elements)
        start = _assign(cX, C0)
        stay = np.zeros((n_cells, k))
        a_d = np.zeros((draws, k))
        lon_d = np.zeros((draws, k))
        share_d = np.zeros((draws, k))
        out_d = np.zeros((draws, k, E))
        nominal_lon = np.arctan2(C0[:, 4], C0[:, 3])

        for b0 in range(0, draws, MC_BATCH):
            D = min(MC_BATCH, draws - b0)
            grade = sm.sample_grades(D, rng)  # (D, S, E)
            cw = (grade[..., req].sum(-1) @ cell_scen.T)  # (D, cells), tonnes of inputs
            lab = np.broadcast_to(start, (D, n_cells)).copy()
            C = np.broadcast_to(C0, (D, k, dim)).copy()
            offset = (np.arange(D) * k)[:, None]
            cXf = cX.astype(np.float32)
            cwf = cw.astype(np.float32)
            weighted_x = cwf[:, :, None] * cXf[None]  # (D, cells, dim), fixed for the batch
            # Iterate only the draws that are still changing.
            active = np.arange(D)
            for _ in range(MC_MAX_ITER):
                A = len(active)
                idx = (lab[active] + offset[:A]).ravel()
                wk = np.bincount(idx, weights=cwf[active].ravel(), minlength=A * k).reshape(A, k)
                sums = np.stack(
                    [np.bincount(idx, weights=weighted_x[active, :, t].ravel(), minlength=A * k) for t in range(dim)],
                    axis=1,
                ).reshape(A, k, dim)
                full = wk > 0
                C[active] = np.where(full[..., None], sums / np.where(full, wk, 1.0)[..., None], C[active])
                Ca = C[active].astype(np.float32)
                # Squared distance up to the per-cell constant |x|², which doesn't change the argmin.
                # (Exact float ties don't occur here, so the plain argmin is used.)
                d = (Ca**2).sum(-1)[:, None, :] - 2 * (cXf @ Ca.transpose(0, 2, 1))  # (A, cells, k)
                new = np.argmin(d, axis=2)
                changed = (new != lab[active]).any(axis=1)
                lab[active] = new
                active = active[changed]
                if len(active) == 0:
                    break
            idx = (lab + offset).ravel()
            wk = np.bincount(idx, weights=cw.ravel(), minlength=D * k).reshape(D, k)
            stay += np.bincount((np.arange(n_cells)[None, :] * k + lab).ravel(), minlength=n_cells * k).reshape(n_cells, k)
            onehot = np.zeros((D, k, n_cells))
            onehot[np.arange(D)[:, None], lab, np.arange(n_cells)[None, :]] = 1.0
            out_d[b0 : b0 + D] = (onehot @ cell_scen) @ grade  # (D, k, E) tonnes per element
            share_d[b0 : b0 + D] = wk / np.maximum(wk.sum(1, keepdims=True), 1e-300)
            a_d[b0 : b0 + D] = np.exp(C[..., 0] / SQRT_125)
            lon = np.arctan2(C[..., 4], C[..., 3])
            # Relative to nominal and unwrapped, so ranges don't jump at ±180°.
            lon_d[b0 : b0 + D] = nominal_lon + _wrap(lon - nominal_lon)

        for c, st in enumerate(base["stations"]):
            st["ranges"] = {
                "a": _range(a_d[:, c]),
                "longitude": {key: math.degrees(v) for key, v in _range(lon_d[:, c]).items()},
                "share": _range(share_d[:, c]),
                "output": [_range(out_d[:, c, e]) for e in range(E)],
            }
        stability = np.zeros(self.asteroids.count, dtype=np.uint8)
        stability[rows] = np.round(255 * stay[of, labels] / draws).astype(np.uint8)
        cloud_a = a_d
        cloud = [
            np.round(np.column_stack([cloud_a[:, c] * np.cos(lon_d[:, c]), cloud_a[:, c] * np.sin(lon_d[:, c])]).ravel(), 4).tolist()
            for c in range(k)
        ]
        base.update(stability=_b64(stability), cloud=cloud, draws=draws)


def iter_products(model: dict) -> Iterable[str]:
    return (p["id"] for p in model["products"])
