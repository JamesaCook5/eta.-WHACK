"""Three product-specific asteroid supply maps on a shared blue-to-white scale.

    python visualise_constituents.py
    python visualise_constituents.py --products aluminium steel titanium
    python visualise_constituents.py --metric count
    python visualise_constituents.py --samples 500 --save-only

All positioned asteroids are included. White means every modelled constituent
meets its fixed reference benchmark. It does not mean a complete qualified
factory can operate locally. Equal part weights and benchmark assumptions are
editable in industrial_input_profiles.json.
"""

from __future__ import annotations

import argparse
import json
import math
import textwrap
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.colors import LinearSegmentedColormap, Normalize
from matplotlib.lines import Line2D

from asteroid_industry.contributions import apply_resource_index
from asteroid_industry.valuation import assess_supply, fixed_benchmarks, mineral_content_matrix, profile_weights
from visualise_asteroids import _jd_to_date, to_ecliptic
from visualise_industry import BG, FG, GREY, MUTED, ROOT, load_asteroids


def required_profiles(selected, profiles):
    result = set()

    def visit(key):
        if key not in result:
            result.add(key)
            for child in profiles[key].get("profiles", {}):
                visit(child)

    for key in selected:
        visit(key)
    return sorted(result)


def assess_catalogue(asteroids, chemical, index, profiles, selected, *, samples=0, concentration=100, seed=42):
    minerals, elements, matrix = mineral_content_matrix(index)
    benchmarks = fixed_benchmarks(chemical, minerals, elements, matrix)
    keys = required_profiles(selected, profiles)
    weights = {key: profile_weights(key, profiles) for key in keys}
    assessments = {}
    for code in sorted({a["type"] for a in asteroids}):
        scenario = chemical["taxonomy_scenarios"].get(code, {})
        # Restart the same class-specific RNG for each product: all panels and
        # child profiles see the SAME mineral-mixture draws, including covariance.
        seed_sequence = np.random.SeedSequence([seed, *code.encode("utf-8")])
        assessments[code] = {
            key: assess_supply(scenario, weights[key], minerals, elements, matrix, benchmarks,
                               samples=samples, concentration=concentration,
                               rng=np.random.default_rng(seed_sequence))
            for key in keys
        }
    return assessments, benchmarks, weights


class SupplyFigure:
    def __init__(self, asteroids, assessments, profiles, selected, *, epoch, metric="abundance", samples=0):
        self.asteroids, self.assessments = asteroids, assessments
        self.profiles, self.selected, self.metric = profiles, selected, metric
        self.positions = to_ecliptic(np.array([a["position"] for a in asteroids]))
        radius = np.hypot(self.positions[:, 0], self.positions[:, 1])
        if np.any(radius <= 0):
            raise ValueError("Log-radius plots need positive projected distances")
        self.plot_positions = np.column_stack((np.arctan2(self.positions[:, 1], self.positions[:, 0]), radius))
        self.fig, self.axes = plt.subplots(1, 3, figsize=(20, 9.5), subplot_kw={"projection": "polar"})
        self.fig.canvas.manager.set_window_title("Asteroid constituent supply — three product views")
        self.fig.subplots_adjust(left=0.045, right=0.975, top=0.75, bottom=0.24, wspace=0.24)
        cmap = LinearSegmentedColormap.from_list("supply_blue_white", ["#002dff", "#438fff", "#94c5ff", "#ffffff"])
        norm = Normalize(0, 1)
        self.scatter_indices = {}
        self.tooltips = {}
        for ax, key in zip(self.axes, selected):
            values = np.array([self.value(assessments[a["type"]][key]) for a in asteroids])
            known = np.flatnonzero(np.isfinite(values))
            order = known[np.argsort(values[known], kind="stable")]
            points = self.plot_positions[order]
            scatter = ax.scatter(points[:, 0], points[:, 1], c=values[order], cmap=cmap, norm=norm,
                                 s=3.5, alpha=1.0, linewidths=0, zorder=3, rasterized=True)
            self.scatter_indices[ax] = (scatter, order)
            unknown = np.flatnonzero(~np.isfinite(values))
            ax.scatter(self.plot_positions[unknown, 0], self.plot_positions[unknown, 1],
                       s=4, color="#8c939d", marker="x", linewidths=0.35, alpha=0.65, zorder=2)
            ax.set_theta_zero_location("E")
            ax.set_rscale("log")
            ax.set_rlim(float(radius.min()) * 0.8, float(radius.max()) * 1.12)
            ticks = [v for v in (0.25, 0.5, 1, 3, 10, 30, 100) if ax.get_rmin() <= v <= ax.get_rmax()]
            ax.set_yticks(ticks, [f"{v:g} AU" for v in ticks], fontsize=7)
            ax.set_rlabel_position(75)
            ax.set_thetagrids(range(0, 360, 45), fontsize=8)
            ax.grid(alpha=0.35)
            bounds = ax.get_position()
            heading = profiles[key]["title"]
            if key == "bulk_metals":
                heading += " · Al / steel / Ti"
            self.fig.text((bounds.x0 + bounds.x1) / 2, 0.815, heading,
                          ha="center", fontsize=15, weight="bold")
            tooltip = ax.annotate("", xy=(0, 0), xytext=(9, 9), textcoords="offset points", fontsize=8,
                                  color=FG, bbox={"boxstyle": "round,pad=0.6", "fc": BG, "ec": MUTED, "alpha": 0.97},
                                  zorder=10, annotation_clip=False)
            tooltip.set_visible(False)
            self.tooltips[ax] = tooltip
        self.fig.suptitle("Asteroid constituent supply", x=0.045, y=0.98, ha="left", fontsize=22, weight="bold")
        mode = "capped abundance coverage" if metric == "abundance" else "constituent-count coverage"
        sampling = f"Monte Carlo mean · {samples} composition draws per class" if samples else "Indexed mean compositions"
        self.fig.text(0.045, 0.91,
                      f"All {len(asteroids):,} asteroids · {mode} · {sampling}\n"
                      f"JD {epoch:.1f} ({_jd_to_date(epoch)}) · same positions and 0–1 scale in every panel",
                      fontsize=10, color=MUTED, va="top", linespacing=1.7)
        cax = self.fig.add_axes([0.24, 0.12, 0.52, 0.022])
        colorbar = self.fig.colorbar(scatter, cax=cax, orientation="horizontal")
        colorbar.set_ticks([0, 0.25, 0.5, 0.75, 1], labels=["0", "0.25", "0.50", "0.75", "1"])
        scale_label = ("Blue: no credited supply  →  White: all modelled constituent benchmarks covered"
                       if metric == "abundance" else "Blue: no indexed constituents  →  White: all modelled constituents indexed")
        colorbar.set_label(scale_label, fontsize=10, labelpad=9)
        self.fig.legend(handles=[Line2D([], [], color="#8c939d", marker="x", ls="", markersize=5,
                                       label="Unresolved composition")], loc="lower center",
                        bbox_to_anchor=(0.5, 0.165), frameon=False, fontsize=9)
        note = ("Fixed reference: best indexed content per tonne for each element. Equal input-family weights; surplus is capped."
                if metric == "abundance" else "Equal input-family weights, shared among each family's constituents. Only quantified indexed contents earn credit.")
        self.fig.text(0.045, 0.022,
                      note + "\nResource-suitability proxy; grade, recovery, production rate, transport and cost are not scored. Presence-only ice adds no assumed mass.",
                      color=MUTED, fontsize=9, va="bottom", linespacing=1.6)
        self.fig.canvas.mpl_connect("motion_notify_event", self.on_hover)

    def value(self, assessment):
        if assessment is None:
            return np.nan
        return assessment.mean if self.metric == "abundance" else assessment.count_coverage

    def on_hover(self, event):
        for ax, key in zip(self.axes, self.selected):
            tooltip = self.tooltips[ax]
            if ax.bbox.contains(event.x, event.y):
                scatter, indices = self.scatter_indices[ax]
                hit, details = scatter.contains(event)
                if hit:
                    candidates = indices[details["ind"]]
                    pixels = ax.transData.transform(self.plot_positions[candidates])
                    index = int(candidates[np.argmin(np.sum((pixels - [event.x, event.y]) ** 2, axis=1))])
                    asteroid = self.asteroids[index]
                    assessment = self.assessments[asteroid["type"]][key]
                    supported = [e for e, info in assessment.constituents.items() if info["has_indexed_quantity"]]
                    missing = [e for e in assessment.constituents if e not in supported]
                    label = (f"{asteroid['name']} [{asteroid['type']}]\n{self.profiles[key]['title']}: {self.value(assessment):.3f}\n"
                             f"Indexed constituents: {len(supported)}/{len(assessment.constituents)}\n"
                             + textwrap.fill("No quantified supply: " + (", ".join(missing) or "none"), 42))
                    if assessment.p90 > assessment.p10 and self.metric == "abundance":
                        label += f"\nSensitivity p10–p90: {assessment.p10:.3f}–{assessment.p90:.3f}"
                    for child in self.profiles[key].get("profiles", {}):
                        label += f"\n{self.profiles[child]['title']}: {self.value(self.assessments[asteroid['type']][child]):.3f}"
                    tooltip.xy = self.plot_positions[index]
                    tooltip.set_text(label)
                    tooltip.set_visible(True)
                    self.fig.canvas.draw_idle()
                    continue
            if tooltip.get_visible():
                tooltip.set_visible(False)
                self.fig.canvas.draw_idle()


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--input", type=Path, default=ROOT / "dataset_filtered_unified.parquet")
    parser.add_argument("--chemical-dag", type=Path, default=ROOT / "Asteroid_Chemical_DAG-2.json")
    parser.add_argument("--material-index", type=Path, default=ROOT / "asteroid_mineral_lookup.json")
    parser.add_argument("--profiles", type=Path, default=ROOT / "industrial_input_profiles.json")
    parser.add_argument("--products", nargs=3, default=["batteries", "semiconductors", "bulk_metals"], metavar="PROFILE")
    parser.add_argument("--metric", choices=["abundance", "count"], default="abundance")
    parser.add_argument("--samples", type=int, default=0, help="Optional Monte Carlo mixture draws per class")
    parser.add_argument("--concentration", type=float, default=100, help="Dirichlet sensitivity concentration; not measured uncertainty")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--output", type=Path, default=ROOT / "plots/asteroid_constituent_supply.png")
    display = parser.add_mutually_exclusive_group()
    display.add_argument("--show", dest="show", action="store_true", default=True)
    display.add_argument("--save-only", dest="show", action="store_false")
    args = parser.parse_args()
    if args.samples < 0 or args.seed < 0 or not math.isfinite(args.concentration) or args.concentration <= 0:
        parser.error("--samples and --seed must be nonnegative; --concentration must be finite and positive")
    if not args.show:
        plt.switch_backend("Agg")
    index = json.loads(args.material_index.read_text())
    chemical = apply_resource_index(json.loads(args.chemical_dag.read_text()), index)
    definitions = json.loads(args.profiles.read_text())
    profiles = definitions["profiles"]
    if any(key not in profiles for key in args.products):
        parser.error("Choose three profiles from: " + ", ".join(profiles))
    try:
        asteroids, epoch = load_asteroids(args.input, chemical["taxonomy_scenarios"])
        assessments, benchmarks, weights = assess_catalogue(
            asteroids, chemical, index, profiles, args.products, samples=args.samples,
            concentration=args.concentration, seed=args.seed,
        )
    except ValueError as exc:
        parser.error(str(exc))
    plt.rcParams.update({
        "figure.facecolor": BG, "axes.facecolor": BG, "savefig.facecolor": BG,
        "text.color": FG, "axes.labelcolor": FG, "axes.edgecolor": GREY,
        "xtick.color": MUTED, "ytick.color": MUTED, "grid.color": GREY,
        "font.family": "DejaVu Sans", "font.size": 10,
    })
    view = SupplyFigure(asteroids, assessments, profiles, args.products, epoch=epoch, metric=args.metric, samples=args.samples)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    view.fig.savefig(args.output, dpi=180)
    report = args.output.with_suffix(".json")
    report.write_text(json.dumps({
        "epoch_jd": epoch, "asteroid_count": len(asteroids), "products": args.products,
        "metric": args.metric, "samples": args.samples, "concentration": args.concentration if args.samples else None,
        "seed": args.seed, "reference_basis": definitions["reference_basis"],
        "uncertainty_note": "Optional Dirichlet sensitivity model, not calibrated geological confidence intervals.",
        "benchmarks_kg_per_tonne": benchmarks,
        "profiles": {key: profiles[key] for key in weights}, "constituent_weights": weights,
        "scores_by_taxonomy": {code: {key: result.to_dict() if result else None for key, result in values.items()}
                               for code, values in assessments.items()},
    }, indent=2, allow_nan=False) + "\n")
    print(f"wrote {args.output} ({len(asteroids):,} asteroids, three product views)")
    print(f"wrote {report}")
    if args.show:
        plt.show()
    else:
        plt.close(view.fig)


if __name__ == "__main__":
    main()
