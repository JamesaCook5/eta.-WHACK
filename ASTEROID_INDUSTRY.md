# Asteroid → industry model

`asteroid_industry` is a small Python library for:

1. mapping an asteroid's surface taxonomic type to a **bulk mineral / element composition** (mass fractions),
2. Monte-Carlo sampling and normalising that composition,
3. converting diameter + density into a **feedstock inventory in kg**,
4. representing a **DAG of unit operations** (inputs + reusable equipment → outputs),
5. computing what terminal products an asteroid could support and what raw inputs / equipment a product needs.

It is intentionally data-first: the process dictionary and composition tables are
plain Python dictionaries that you can replace with your real industrial data.

## Layout

| File | Purpose |
|---|---|
| `asteroid_industry/composition.py` | mineral/feedstock composition ranges, Monte Carlo sampling, optional `AsteroidMaterialsTaxinomy.json` loader |
| `asteroid_industry/asteroid.py` | parquet catalogue adapter, asteroid mass, resource estimates |
| `asteroid_industry/processes.py` | `Process` + validated `ProcessGraph` DAG |
| `asteroid_industry/model.py` | forward greedy simulation, backward demand expansion, reachability, max-production |
| `asteroid_industry/system.py` | `IndustrialSystem`: asteroid → inventory → terminal outputs |
| `examples/demo_processes.py` | illustrative unit-operation DAG |
| `examples/demo.py` | end-to-end example against the project parquet |

## Quick start

```python
from asteroid_industry import (
    AsteroidCatalog,
    CompositionModel,
    IndustrialSystem,
    ProcessGraph,
)
from examples.demo_processes import DEMO_EQUIPMENT, DEMO_PROCESSES

graph = ProcessGraph(DEMO_PROCESSES)
system = IndustrialSystem(
    graph,
    composition=CompositionModel(seed=1),
    equipment=DEMO_EQUIPMENT,
)

catalog = AsteroidCatalog.from_parquet("dataset_filtered_unified.parquet")
asteroid = catalog.require("Psyche")

assessment = system.assess(asteroid, n_samples=500, seed=1)
print(assessment.summary())

# What does one unit of a product require?
demand = system.required_inputs("drone", 1.0)
print(demand.raw_inputs)
print(demand.equipment)
```

Run the example:

```bash
python examples/demo.py --name Psyche --samples 500
```

## Composition model

The default table is `SURFACE_COMPOSITION_RANGES`: `surface_type -> {mineral: (low, high)}`.
Sampling draws uniformly from each range and normalises the row to sum to 1, so
the result is a valid bulk mass-fraction composition.

If you have the project's `AsteroidMaterialsTaxinomy.json`, you can use its
point-estimate bulk abundances instead:

```python
composition = CompositionModel.from_taxonomy_json(
    "AsteroidMaterialsTaxinomy.json",
    uncertainty=0.20,   # +/- 20% around each point estimate
    seed=1,
)
```

The loader maps:

```
H2O -> water           C -> carbon          N -> ammonia
S -> sulfide_ore       Fe_metal/Ni/Co -> metal_ore
silicates -> silicate_ore                   PGM_ppm -> pgm
```

You can override this with `feedstock_map=...`.

`estimate_resources(asteroid, composition, n_samples=...)` returns mean, p10 and
p90 mass (kg) for every feedstock.

## Process DAG format

```python
PROCESSES = {
    "comminution": {
        "inputs":    {"silicate_ore": 100.0},
        "outputs":   {"powdered_silicate": 100.0},
        "equipment": {"crusher": 1},
        "throughput_kg_per_day": 1000.0,   # optional capacity parameter
        "energy_kwh_per_kg": 0.02,         # optional
        "notes": "...",
    },
}
```

- Quantities are per batch in consistent units (kg for materials, items for
  equipment / products if you choose).
- `equipment` is **reusable capital equipment**, not consumed.
- Equipment can be produced by another process (the demo manufactures a
  `crusher` and a `wafer_saw`). This creates a dependency edge in the DAG.
- The graph rejects cycles and unknown topology.

## Analysis modes

- `ProcessGraph.describe()` — topological order, raw and terminal materials.
- `IndustrialModel.reachability()` — qualitative set of producible materials.
- `IndustrialModel.required_inputs(target, quantity)` — backward expansion to
  raw feedstocks, equipment and byproducts.
- `IndustrialModel.max_production(target)` — maximum target units if the
  asteroid inventory is dedicated to that product.
- `IndustrialSystem.assess(asteroid, n_samples=N)` — Monte Carlo over
  compositions, returning per-product production probability and quantities.

### Important modelling limits (v1)

- `max_production` assumes the whole inventory is dedicated to one product; it
  does not solve a multi-product allocation problem.
- Equipment manufacturing is assumed to be possible if it is reachable, but its
  one-off material cost is not yet subtracted from the asteroid budget.
- `forward_closure` is a greedy single-pass simulator; it is useful for linear
  chains but is not a substitute for an LP/MILP planner when processes compete
  for the same feedstock.
- Planetary perturbations, travel time, delta-v, mining rate and capital
  depreciation are not modelled yet.

## Tests

```bash
python -m unittest discover -s tests
```
