"""Run the demo process DAG against one asteroid from the catalogue.

    python examples/demo.py --name Ceres
    python examples/demo.py --name Bennu --samples 500
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Allow running from the repository root without installing the package.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from asteroid_industry import (  # noqa: E402
    AsteroidCatalog,
    CompositionModel,
    IndustrialSystem,
    ProcessGraph,
)
from examples.demo_processes import DEMO_EQUIPMENT, DEMO_PROCESSES  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default="dataset_filtered_unified.parquet")
    parser.add_argument("--name", default="Ceres")
    parser.add_argument("--samples", type=int, default=1)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--time-days", type=float, default=None)
    args = parser.parse_args()

    graph = ProcessGraph(DEMO_PROCESSES)
    system = IndustrialSystem(
        graph,
        composition=CompositionModel(seed=args.seed),
        equipment=DEMO_EQUIPMENT,
    )

    print(graph.describe())
    print()
    print("composition/feedstock check:")
    print(system.validate_against_composition())
    print()

    catalog = AsteroidCatalog.from_parquet(args.input)
    asteroid = catalog.require(args.name)
    print(f"assessing {asteroid}")
    assessment = system.assess(
        asteroid,
        n_samples=args.samples,
        time_days=args.time_days,
        seed=args.seed,
    )
    print(assessment.summary())
    print()

    for target in ("integrated_circuit", "drone", "spacecraft"):
        if target not in graph.terminal_materials:
            continue
        demand = system.required_inputs(target, 1.0)
        print(f"inputs for 1 unit of {target}:")
        print("  raw inputs:")
        for name, amount in sorted(demand.raw_inputs.items()):
            print(f"    {name:<20} {amount:12.4g}")
        print("  equipment:")
        for name, amount in sorted(demand.equipment.items()):
            print(f"    {name:<20} {amount:12.4g}")
        print("  Earth inputs:")
        for name, amount in sorted(demand.earth_inputs.items()):
            print(f"    {name:<20} {amount:12.4g}")
        print("  Earth equipment:")
        for name, amount in sorted(demand.earth_equipment.items()):
            print(f"    {name:<20} {amount:12.4g}")
        print("  byproducts:")
        for name, amount in sorted(demand.byproducts.items()):
            print(f"    {name:<20} {amount:12.4g}")
        print()


if __name__ == "__main__":
    main()
