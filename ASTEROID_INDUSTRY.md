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

## Matplotlib maps

Generate both visualisations from the unified positions and the chemical and
manufacturing JSON DAGs:

```bash
python -m pip install -r requirements.txt
python visualise_industry.py
```

- `plots/asteroid_industrial_outputs.png`: all positioned asteroids, coloured by
  their **complete set of industrial outputs**.
- `plots/asteroid_raw_materials.png`: all positioned asteroids, coloured by
  their **complete set of raw material outputs**.

Each figure contains one position graph and a legend. The legend spells out
every output set; asteroids sharing a colour have exactly the same set of
potential output families. Common outputs may be listed once in the legend,
with each colour explicitly representing `Common + additions`.
Unknown composition and a known composition
with no supported output route have separate legend entries. There is no
sampling, preselected asteroid or selected product.

Both Matplotlib windows open by default. Hover over a point for the asteroid's
name, taxonomy scenario and full output set. The default polar graph uses
ecliptic longitude and logarithmic projected radius in AU to include the main
belt and distant objects in the same view.

```bash
# Save the two PNGs without opening windows.
python visualise_industry.py --save-only

# Optional full-extent Cartesian position graph.
python visualise_industry.py --projection cartesian
```

These plots show **material contributions**, using the actual chemical and
manufacturing JSON maps. A product is included when any ore-derived constituent
can reach it through the material graph. For example, asteroid iron can supply a
part in a spacecraft even when its batteries, electronics and other ingredients
are imported. The plot does not require a complete locally supplied recipe.

`asteroid_industry/contributions.py` tracks local source/element ancestry through
chemical products and assembly constituents. Known product formulas constrain
element flow: hydrogen used to reduce imported iron ore does not make the iron
asteroid-derived. Equipment, working inventories, information and nonconsumed
catalysts do not carry product ancestry; wash water alone does not make a cleaned
wafer local. Unknown compositions remain possible links requiring verification.

Explicitly blocked recipes remain visible as prospective applications and are
recorded in `MaterialContribution.blocked_processes`. Output sets therefore
include future or incomplete designs and do not certify an executable plant.
For complete-recipe checks, `output_routes(..., strict=True)` retains the
previous conservative dependency calculation.

`asteroid_mineral_lookup.json` is loaded with `--material-index`. Its
`types.*.resource_presence` records supplement a missing source qualitatively:
C, B and P have class-level planning assumptions for free/near-surface water
ice; Ch/Cgh retain structurally bound water in hydrated minerals, and D already
has ice in its mineral fractions. Positive-weight blend components inherit the
presence assumptions. Existing abundances, including explicit zeroes, take
precedence; no extra kilograms or bulk percentages are invented.

The ice flags are requested class-level assumptions based on detections or
spectral interpretations on some members, not measurements on every body.
Sources and their scope are recorded next to each flag, including
[Rivkin & DeMeo on hydrated classes and ice interpretations](https://agupubs.onlinelibrary.wiley.com/doi/full/10.1029/2018JE005584)
and [Licandro et al. on Cybele](https://doi.org/10.1051/0004-6361/201015339).
Unknown taxonomy remains unresolved.

The colours identify **output sets**, not output counts, kilograms or product
units. The JSON DAGs leave recovery yields, input masses, quality and capacities
unassigned. A candidate contribution does not establish a qualified plant
or a measured indigenous fraction. Each output is considered separately; shared
feedstock cannot be allocated to all outputs at once.

## Constituent supply maps and utility

```bash
python visualise_constituents.py
```

This opens **one image with three position graphs**: batteries, semiconductors,
and bulk metals (an equal-weight average of aluminium, steel and titanium).
All 65,128 positioned asteroids are included. A shared continuous blue-to-white
legend replaces overlapping output-set colours. Grey marks unresolved taxonomy.
Hover for the score, supported/missing constituents and individual metal scores.
The PNG and machine-readable class scores are saved as
`plots/asteroid_constituent_supply.png` and `.json`.

The default **abundance coverage** score is:

```text
element credit = min(indexed content per tonne / fixed element benchmark, 1)
input-family score = mean of its constituent credits
product score = weighted mean of its input-family scores
```

Each element's fixed benchmark is its best mean content across the indexed
asteroid classes. This makes an abundant useful constituent worth more than a
trace, while capping surplus so extra iron cannot fill a lithium deficit.
Blue is zero credited supply; white means every modelled benchmark is met.
The scale is fixed across panels, rather than rescaled to make each panel's
best asteroid white. Inputs without a quantified content remain in the
denominator and receive no credit. The current index has no quantified
B, Cu, F, Li or Mn supply, so complete coverage is not established.

`industrial_input_profiles.json` defines the reference input families and
editable weights. Families get equal weight by default; their constituents
share that weight. Battery scoring covers LFP cell materials and pack alloy;
semiconductor scoring covers specified die, dopants, dielectrics and package
materials. These are explicit reference scopes, not complete engineering BOMs.
Each profile lists omitted requirements and the corresponding DAG material IDs.

```bash
# Three separate metal views in one image.
python visualise_constituents.py --products aluminium steel titanium

# Simple family-balanced coverage of quantified constituent types.
python visualise_constituents.py --metric count

# Composition sensitivity, with mean scores and p10/p90 exported to JSON.
python visualise_constituents.py --samples 500 --concentration 100 --seed 42 \
    --save-only --output plots/asteroid_constituent_supply_mc.png
```

The quantity proxy comes from the mineral index's numerical content/yield
entries, converted into elemental kg per tonne of feed. Water and CO2 are split
by molecular mass, without counting their atoms twice. Unspecified contents and
presence-only ice assumptions add no invented mass. These figures therefore
measure indexed resource suitability, not total asteroid wealth, qualified
recovery, production capacity or economic value.

Optional Monte Carlo draws perturb mineral proportions with a Dirichlet
distribution. Its concentration is an editable **sensitivity assumption**, not
a calibrated geological uncertainty model. Missing minerals stay missing and
unresolved mass remains unresolved. All products use the same mixture draws for
each class, preserving cross-product correlation. Asteroids of the same known
class receive the same expected score; individual assays would be needed to
justify different compositions for individual objects.

`asteroid_industry/valuation.py` also provides a demand-based utility for future
facility/supply-chain models:

```python
from asteroid_industry.valuation import capped_inventory_utility

utility = capped_inventory_utility(
    inventory_kg={"Fe": 800, "C": 100},
    demand_kg={"Fe": 600, "C": 200},
)  # 0.75: all iron demand and half the carbon demand are covered
```

For a candidate facility, sum allocated supplier inventories **before** applying
the caps. Complementary asteroids can then fill each other's gaps. Allocate
shared resources between products before adding product utilities; the three
displayed suitability scores are not simultaneous production commitments.

A facility-placement objective can maximise expected fulfilled-demand value,
minus mining, transport, refining and facility costs, with a penalty for unmet
demand in poor composition scenarios. It needs product demand/BOM quantities,
recoveries, accessible mining rates, equipment/energy capacity and orbital
transfer costs. Current position alone is not a travel-cost estimate. The
scoring and Monte Carlo interfaces are available now; those missing engineering
and cost parameters are not fabricated by these plots.

## Tests

```bash
python -m unittest discover -s tests
```
