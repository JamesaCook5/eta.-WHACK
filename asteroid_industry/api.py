"""HTTP API for the station planner.

Run from the repo root::

    pip install -r requirements.txt
    uvicorn asteroid_industry.api:app --port 8000

The UI (Next.js) proxies ``/api/planner/*`` to this server (see
``UI Skeleton/next.config.mjs``; set ``PLANNER_URL`` to change where).

Environment
-----------
ETA_ROOT           Repo root holding the DAG files (default: this package's parent).
ETA_ASTEROIDS      Asteroid table shared with the UI, so indices line up
                   (default: ``$ETA_ROOT/UI Skeleton/public/data/asteroids.json``).
"""

from __future__ import annotations

import base64
import json
import os
from collections import OrderedDict
from functools import lru_cache
from pathlib import Path
from threading import Lock

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .hierarchy import HierarchicalPlanner, RecipeGraph
from .stations import MAX_STATIONS, PlanCancelled, StationPlanner

ROOT = Path(os.environ.get("ETA_ROOT", Path(__file__).resolve().parents[1]))
ASTEROIDS = Path(os.environ.get("ETA_ASTEROIDS", ROOT / "UI Skeleton" / "public" / "data" / "asteroids.json"))
CACHE_SIZE = 64

app = FastAPI(title="eta. station planner", version="1.0")


@lru_cache(maxsize=1)
def planner() -> StationPlanner:
    return StationPlanner.from_files(ASTEROIDS, ROOT)


@lru_cache(maxsize=1)
def recipes() -> RecipeGraph:
    manufacturing = json.loads(
        (ROOT / "Space_Industrial_Manufacturing_DAG.json").read_text(encoding="utf-8")
    )
    return RecipeGraph(manufacturing, planner().sampling.elements)


@lru_cache(maxsize=1)
def hierarchy() -> HierarchicalPlanner:
    return HierarchicalPlanner(planner(), recipes())


class PlanRequest(BaseModel):
    product: str
    stations: int = Field(3, ge=1, le=MAX_STATIONS)
    trip_years: float = Field(2.0, ge=0.1, le=20.0)
    include_outer: bool = False
    draws: int = Field(1000, ge=0, le=5000)
    #: Filter mask over the asteroid table as base64 packed bits (numpy bit order); omit for all.
    mask: str | None = None


class HierarchyRequest(BaseModel):
    product: str
    stations: int = Field(3, ge=1, le=MAX_STATIONS)
    trip_years: float = Field(2.0, ge=0.1, le=20.0)
    include_outer: bool = False
    stations_per_tier: list[int] | None = None
    #: Optional material -> process override, for choosing among alternative recipes.
    route: dict[str, str] | None = None
    mask: str | None = None
    #: The map needs station positions, quantities, and assignments; ``full`` also
    #: returns the recipe tree, grouped stations, and detailed member records.
    full: bool = False


#: Station fields the map uses.
_SLIM_STATION_KEYS = ("tier", "process", "material", "a", "e", "i", "longitude", "members", "share", "dvMedian", "inputs", "output")


def _slim_hierarchy(result: dict) -> dict:
    """Drop bulky map data while keeping the quantities shown in station details."""
    out = {k: v for k, v in result.items() if k not in ("tree", "tiers", "stations")}
    out["stations"] = [
        {k: round(s[k], 5) if isinstance(s[k], float) else s[k] for k in _SLIM_STATION_KEYS if k in s}
        for s in result["stations"]
    ]
    return out


_cache: OrderedDict[tuple, dict] = OrderedDict()
_lock = Lock()
# Monte Carlo runs are numbered; a newer one makes older ones stop between batches
# (the UI only ever wants its latest request, and a 200-station run takes seconds).
_latest_run = 0


def _decode_mask(p: StationPlanner, text: str | None) -> np.ndarray | None:
    if not text:
        return None
    try:
        bits = np.unpackbits(np.frombuffer(base64.b64decode(text), dtype=np.uint8))
    except Exception as err:  # pragma: no cover - malformed input
        raise HTTPException(400, f"Bad mask: {err}") from err
    if len(bits) < p.asteroids.count:
        raise HTTPException(400, "Mask is shorter than the asteroid table")
    return bits[: p.asteroids.count].astype(bool)


@app.get("/health")
def health() -> dict:
    p = planner()
    return {"ok": True, "asteroids": p.asteroids.count, "products": len(p.products)}


@app.post("/plan")
def plan(req: PlanRequest) -> dict:
    """Stations for one product. A plain ``def`` so FastAPI runs it in a worker thread."""
    p = planner()
    if req.product not in p.products:
        raise HTTPException(404, f"Unknown product {req.product!r}")
    mask = _decode_mask(p, req.mask)
    key = (
        req.product,
        req.stations,
        round(req.trip_years, 4),
        req.include_outer,
        req.draws,
        req.mask,
    )
    with _lock:
        if key in _cache:
            _cache.move_to_end(key)
            return _cache[key]
    global _latest_run
    cancelled = None
    if req.draws > 0:
        with _lock:
            _latest_run += 1
            run = _latest_run
        cancelled = lambda: run != _latest_run  # noqa: E731
    try:
        result = p.plan(
            req.product,
            req.stations,
            req.trip_years,
            req.include_outer,
            req.draws,
            mask,
            cancelled=cancelled,
        )
    except PlanCancelled:
        raise HTTPException(409, "Superseded by a newer request") from None
    with _lock:
        _cache[key] = result
        while len(_cache) > CACHE_SIZE:
            _cache.popitem(last=False)
    return result


@app.post("/plan/hierarchy")
def plan_hierarchy(req: HierarchyRequest) -> dict:
    """Tiered stations for a product whose manufacture needs intermediates."""
    h = hierarchy()
    if req.product not in h.recipes.product_catalogue:
        raise HTTPException(404, f"Unknown product {req.product!r}")
    mask = _decode_mask(h.planner, req.mask)
    route_key = tuple(sorted((req.route or {}).items()))
    tier_key = tuple(req.stations_per_tier or ())
    key = (
        "hierarchy",
        req.product,
        req.stations,
        round(req.trip_years, 4),
        req.include_outer,
        tier_key,
        route_key,
        req.mask,
    )
    with _lock:
        if key in _cache:
            _cache.move_to_end(key)
            return _cache[key] if req.full else _slim_hierarchy(_cache[key])
    try:
        result = h.plan(
            req.product,
            req.stations,
            req.trip_years,
            req.include_outer,
            0,
            mask,
            route=req.route,
            stations_per_tier=req.stations_per_tier,
        )
    except (KeyError, ValueError) as err:
        raise HTTPException(400, str(err)) from err
    with _lock:
        _cache[key] = result
        while len(_cache) > CACHE_SIZE:
            _cache.popitem(last=False)
    return result if req.full else _slim_hierarchy(result)
