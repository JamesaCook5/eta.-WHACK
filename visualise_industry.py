"""Plot every asteroid, coloured by potential outputs using its ore materials.

    python visualise_industry.py
    python visualise_industry.py --save-only
    python visualise_industry.py --projection cartesian

Two figures: industrial output sets and raw-material output sets. Other recipe
ingredients can be supplied externally; partial local contributions count.
Each colour maps to an entire output set. Both windows open by default; hover
over an asteroid to see its name and outputs. No sampling or selected target.
"""

from __future__ import annotations

import argparse
import json
import math
import textwrap
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

import duckdb
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.lines import Line2D
from matplotlib.patches import Circle

from asteroid_industry.contributions import apply_resource_index, contribution_routes, source_minerals
from visualise_asteroids import PLANETS, _jd_to_date, to_ecliptic

ROOT = Path(__file__).resolve().parent
BG, FG, MUTED = "#0d1117", "#e6edf3", "#9ca9b8"
GREY = "#465364"


@dataclass(frozen=True)
class Route:
    """One structural recipe choice, with reusable equipment kept separate."""

    sources: frozenset[str] = frozenset()
    imports: frozenset[str] = frozenset()
    equipment: frozenset[str] = frozenset()
    processes: frozenset[str] = frozenset()
    conditional_imports: frozenset[str] = frozenset()


def dependency_routes(chemical: dict, manufacturing: dict, scenario: dict) -> dict[str, Route]:
    """Find candidate routes satisfying every required input of each recipe.

    All external stocks and installed equipment are assumed procurable. Recipes
    with an explicit design blocker are excluded. Alternatives are OR choices:
    keep the first reachable recipe, rather than unioning their input lists.
    This does not prove quality, capacity, indigenous content or plant feasibility.
    """
    external = chemical["external_resources"] | manufacturing["external_resources"]
    routes = {key: Route(imports=frozenset([key])) for key in external}
    for mineral, wt_pct in scenario.get("mineral_wt_pct", {}).items():
        source = chemical["mineral_types"].get(mineral, {}).get("source_material_id")
        if source and wt_pct > 0:
            routes[source] = Route(sources=frozenset([source]))

    pending = list((chemical["processes"] | manufacturing["processes"]).items())
    while pending:
        remaining = []
        changed = False
        for process_id, process in pending:
            if process.get("evidence_level", "").startswith("blocked"):
                continue
            if not set(process.get("class_element_requirements", [])).issubset(
                scenario.get("potential_elements_or_compounds", [])
            ):
                continue
            required = {
                port["material_id"] for port in process["inputs"]
                if port.get("required", True)
            } | {item["resource_id"] for item in process.get("inventories", [])}
            if not required.issubset(routes):
                remaining.append((process_id, process))
                continue
            dependencies = [routes[key] for key in sorted(required)]
            route = Route(
                sources=frozenset().union(*(r.sources for r in dependencies)),
                imports=frozenset().union(*(r.imports for r in dependencies)),
                equipment=frozenset(process.get("equipment_ids", []))
                | frozenset(process.get("site_equipment_ids", []))
                | frozenset().union(*(r.equipment for r in dependencies)),
                processes=frozenset([process_id])
                | frozenset().union(*(r.processes for r in dependencies)),
                conditional_imports=frozenset(
                    item["resource_id"] for item in process.get("conditional_auxiliary_inputs", [])
                ) | frozenset().union(*(r.conditional_imports for r in dependencies)),
            )
            for port in process["outputs"]:
                key = port["material_id"]
                if not port.get("excluded_from_feasible_path_if_blocked") and key not in routes:
                    routes[key] = route
                    changed = True
        if not changed:
            break
        pending = remaining
    return routes


def output_routes(chemical: dict, manufacturing: dict, scenario: dict, kind: str, *, strict=False) -> dict:
    routes = (dependency_routes(chemical, manufacturing, scenario) if strict
              else contribution_routes(chemical, manufacturing, scenario))
    catalogue = (manufacturing["product_catalogue"] if kind == "industrial"
                 else chemical["material_groups"])
    result = {}
    for key, entry in catalogue.items():
        targets = ([entry["target_material_id"]] if kind == "industrial" else entry["members"])
        options = [routes[target] for target in targets if target in routes and routes[target].sources]
        if options:
            result[key] = min(options, key=lambda r: (len(r.imports), len(r.processes), sorted(r.processes)))
    return result


def scenario_code(taxonomy: str | None, complex_type: str | None, scenarios: dict) -> str:
    """Prefer the detailed taxonomy; retain X ambiguity instead of assuming M."""
    for code in (taxonomy, complex_type):
        if code in scenarios:
            return code
        if code == "X" and "X@X=?" in scenarios:
            return "X@X=?"
    return "?"


def load_asteroids(path: Path, scenarios: dict) -> tuple[list[dict], float]:
    """Load the whole positioned catalogue at one shared epoch."""
    with duckdb.connect() as con:
        rows = con.execute(
            'SELECT id, name, "taxonomy.class", "taxonomy.complex", position, ref_epoch '
            'FROM read_parquet(?)', [str(path)],
        ).fetchall()
    asteroids = []
    for ident, name, taxonomy, complex_type, position, epoch in rows:
        if position is None or len(position) != 3 or not np.isfinite(position).all():
            continue
        if epoch is None or not math.isfinite(epoch):
            raise ValueError("Positions need a known ref_epoch; run unify_epoch.py first.")
        asteroids.append({
            "id": ident, "name": name or ident,
            "type": scenario_code(taxonomy, complex_type, scenarios),
            "position": position, "epoch": epoch,
        })
    if not asteroids:
        raise ValueError("No asteroids with finite three-dimensional positions.")
    epochs = np.array([a["epoch"] for a in asteroids])
    if np.ptp(epochs) > 1e-6:
        raise ValueError("Mixed position epochs; use dataset_filtered_unified.parquet.")
    skipped = len(rows) - len(asteroids)
    if skipped:
        print(f"Skipped {skipped:,} objects without finite positions.")
    return asteroids, float(epochs[0])


def group_output_sets(asteroids: list[dict], by_type: dict) -> dict:
    """Group by complete output identity; None means unknown, () means no route."""
    groups = defaultdict(list)
    for index, asteroid in enumerate(asteroids):
        outputs = by_type[asteroid["type"]]
        profile = None if outputs is None else tuple(sorted(outputs))
        groups[profile].append(index)
    return dict(groups)


def output_label(profile: tuple | None, kind: str) -> str:
    if profile is None:
        return "Unknown — unresolved asteroid composition"
    if not profile:
        return "No ore-derived material contribution"
    names = [key.replace("_", " ") if kind == "industrial" else key for key in profile]
    return textwrap.fill(", ".join(names), width=48, break_long_words=False, break_on_hyphens=False)


class IndustryFigure:
    """One position graph with a categorical legend of complete output sets."""

    def __init__(self, asteroids, chemical, manufacturing, *, kind, epoch, projection="polar"):
        self.asteroids, self.kind = asteroids, kind
        self.by_type = {}
        for code in sorted({a["type"] for a in asteroids}):
            scenario = chemical["taxonomy_scenarios"].get(code, {})
            known = bool(source_minerals(scenario))
            self.by_type[code] = output_routes(chemical, manufacturing, scenario, kind) if known else None
        self.groups = group_output_sets(asteroids, self.by_type)
        self.positions = to_ecliptic(np.array([a["position"] for a in asteroids]))
        x, y = self.positions[:, :2].T
        self.polar = projection == "polar"
        # The polar log radius keeps both the main belt and distant objects visible.
        # Radius is the top-down ecliptic projection, matching the Cartesian view.
        radius, longitude = np.hypot(x, y), np.arctan2(y, x)
        if self.polar and np.any(radius <= 0):
            raise ValueError("A zero projected radius cannot be plotted on a log-radius map; use --projection cartesian.")
        self.plot_positions = np.column_stack((longitude, radius)) if self.polar else np.column_stack((x, y))
        profiles = sorted((p for p in self.groups if p), key=lambda p: (-len(self.groups[p]), p))
        palette_order = list(range(0, 20, 2)) + list(range(1, 20, 2))
        colours = {
            p: (plt.get_cmap("tab20")(palette_order[i]) if len(profiles) <= 20
                else plt.get_cmap("hsv")(i / len(profiles)))
            for i, p in enumerate(profiles)
        }
        colours.update({None: "#abb2bc", (): "#465364"})
        legend_profiles = profiles + [p for p in ((), None) if p in self.groups]
        common = set.intersection(*(set(p) for p in profiles)) if profiles else set()
        # List shared outputs once inside the legend; every coloured profile
        # explicitly means Common plus its listed additions, never an output count.
        common = common if len(common) >= 4 else set()
        legend_title = "Each colour = this complete output set"
        if common:
            legend_title = "Each output set = Common + listed additions\n\nCommon:\n" + output_label(tuple(sorted(common)), kind)
        legend_labels = {}
        for profile in legend_profiles:
            if profile and common:
                additions = tuple(key for key in profile if key not in common)
                legend_labels[profile] = ("Common only" if not additions else
                                          textwrap.fill("Common + " + output_label(additions, kind).replace("\n", " "), 48))
            else:
                legend_labels[profile] = output_label(profile, kind)
        legend_lines = (sum(label.count("\n") + 1 for label in legend_labels.values())
                        + legend_title.count("\n") + 1)
        self.fig = plt.figure(figsize=(17, max(10, 2 + legend_lines * 0.25)), facecolor=BG)
        self.fig.canvas.manager.set_window_title(f"Asteroid {kind} output sets")
        self.ax = self.fig.add_axes([0.045, 0.08, 0.54, 0.76], projection="polar" if self.polar else None)
        if self.polar:
            self.ax.set_theta_zero_location("E")
            self.ax.set_rscale("log")
            self.ax.set_rlim(float(radius.min()) * 0.8, float(radius.max()) * 1.12)
            ticks = [v for v in (0.25, 0.5, 1, 2, 3, 5, 10, 30, 100)
                     if self.ax.get_rmin() <= v <= self.ax.get_rmax()]
            self.ax.set_yticks(ticks, [f"{v:g} AU" for v in ticks], fontsize=8)
            self.ax.set_rlabel_position(75)
            self.ax.set_thetagrids(range(0, 360, 45))
        else:
            limit = float(np.max(np.abs(self.positions[:, :2]))) * 1.05
            self.ax.set_aspect("equal")
            self.ax.set_xlim(-limit, limit)
            self.ax.set_ylim(-limit, limit)
            self.ax.set_xlabel("x · ecliptic (AU)")
            self.ax.set_ylabel("y · ecliptic (AU)")
        self.ax.grid(alpha=0.35)
        for name in ("Earth", "Jupiter", "Neptune"):
            distance = PLANETS[name]
            if self.polar:
                theta = np.linspace(0, 2 * math.pi, 400)
                self.ax.plot(theta, np.full_like(theta, distance), color=MUTED, lw=0.7, alpha=0.6, ls="--")
            else:
                self.ax.add_patch(Circle((0, 0), distance, fill=False, color=MUTED, lw=0.7, alpha=0.5, ls="--"))

        self.scatter_indices = {}
        for profile in sorted(self.groups, key=lambda p: -len(self.groups[p])):
            indices = np.array(self.groups[profile])
            positions = self.plot_positions[indices]
            scatter = self.ax.scatter(
                positions[:, 0], positions[:, 1], s=6, c=[colours[profile]],
                marker="x" if profile is None else "o", linewidths=0.5 if profile is None else 0,
                alpha=0.8, zorder=3 if profile else 2, rasterized=True,
            )
            self.scatter_indices[scatter] = indices

        handles = [Line2D([], [], color=colours[p], marker="x" if p is None else "o",
                          linestyle="", markersize=7, label=legend_labels[p]) for p in legend_profiles]
        self.fig.legend(handles=handles, loc="center left", bbox_to_anchor=(0.61, 0.49),
                        frameon=False, title=legend_title,
                        title_fontsize=10, fontsize=10, labelspacing=1.2, handletextpad=1.0)
        title = "Potential industrial output sets" if kind == "industrial" else "Potential raw material output sets"
        self.fig.suptitle(title, x=0.045, y=0.975, ha="left", fontsize=22, weight="bold")
        projection_label = "ecliptic longitude / projected radius (log scale)" if self.polar else "heliocentric ecliptic x / y"
        self.fig.text(0.045, 0.925,
                      f"All {len(asteroids):,} positioned asteroids · {projection_label}\n"
                      f"JD {epoch:.1f} ({_jd_to_date(epoch)}) · possible material contributions; other ingredients supplied",
                      color=MUTED, fontsize=10, linespacing=1.7, va="top")
        self.tooltip = self.ax.annotate(
            "", xy=(0, 0), xytext=(12, 12), textcoords="offset points", color=FG, fontsize=9,
            bbox={"boxstyle": "round,pad=0.6", "fc": BG, "ec": MUTED, "alpha": 0.96}, zorder=10,
            annotation_clip=False,
        )
        self.tooltip.set_visible(False)
        self.fig.canvas.mpl_connect("motion_notify_event", self.on_hover)

    def on_hover(self, event):
        if self.ax.bbox.contains(event.x, event.y):
            hits = []
            for scatter, indices in self.scatter_indices.items():
                hit, details = scatter.contains(event)
                if hit:
                    hits.extend(indices[details["ind"]])
            if hits:
                candidates = np.array(hits)
                pixels = self.ax.transData.transform(self.plot_positions[candidates])
                nearest = np.argmin(np.sum((pixels - [event.x, event.y]) ** 2, axis=1))
                index = int(candidates[nearest])
                asteroid = self.asteroids[index]
                outputs = self.by_type[asteroid["type"]]
                profile = None if outputs is None else tuple(sorted(outputs))
                self.tooltip.xy = self.plot_positions[index]
                self.tooltip.set_text(f"{asteroid['name']} [{asteroid['type']}]\n{output_label(profile, self.kind)}")
                self.tooltip.set_visible(True)
                self.fig.canvas.draw_idle()
                return
        if self.tooltip.get_visible():
            self.tooltip.set_visible(False)
            self.fig.canvas.draw_idle()


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--input", type=Path, default=ROOT / "dataset_filtered_unified.parquet")
    parser.add_argument("--chemical-dag", type=Path, default=ROOT / "Asteroid_Chemical_DAG-2.json")
    parser.add_argument("--manufacturing-dag", type=Path, default=ROOT / "Space_Industrial_Manufacturing_DAG.json")
    parser.add_argument("--material-index", type=Path, default=ROOT / "asteroid_mineral_lookup.json")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "plots")
    parser.add_argument("--projection", choices=("polar", "cartesian"), default="polar")
    display = parser.add_mutually_exclusive_group()
    display.add_argument("--show", action="store_true", dest="show", default=True, help="Open both windows (default)")
    display.add_argument("--save-only", action="store_false", dest="show", help="Save PNGs without opening windows")
    args = parser.parse_args()
    if not args.show:
        plt.switch_backend("Agg")
    chemical = json.loads(args.chemical_dag.read_text())
    manufacturing = json.loads(args.manufacturing_dag.read_text())
    chemical = apply_resource_index(chemical, json.loads(args.material_index.read_text()))
    try:
        asteroids, epoch = load_asteroids(args.input, chemical["taxonomy_scenarios"])
    except ValueError as exc:
        parser.error(str(exc))
    plt.rcParams.update({
        "figure.facecolor": BG, "axes.facecolor": BG, "savefig.facecolor": BG,
        "text.color": FG, "axes.labelcolor": FG, "axes.edgecolor": GREY,
        "xtick.color": MUTED, "ytick.color": MUTED, "grid.color": GREY,
        "font.family": "DejaVu Sans", "font.size": 10,
    })
    figures = [IndustryFigure(asteroids, chemical, manufacturing, kind=kind, epoch=epoch,
                              projection=args.projection) for kind in ("industrial", "raw")]
    args.output_dir.mkdir(parents=True, exist_ok=True)
    for figure, filename in zip(figures, ("asteroid_industrial_outputs.png", "asteroid_raw_materials.png")):
        output = args.output_dir / filename
        figure.fig.savefig(output, dpi=180)
        print(f"wrote {output} ({len(asteroids):,} asteroids, {len(figure.groups)} output sets)")
    if args.show:
        plt.show()
    else:
        for figure in figures:
            plt.close(figure.fig)


if __name__ == "__main__":
    main()
