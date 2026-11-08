"""Figures for the methodology pages, built from the project's own data.

Run from the repo root (needs requirements.txt installed)::

    python tools/build_methodology_figures.py

Writes to ``UI Skeleton/public/images/methodology/``:

* ``process-network-full.svg`` — every process, material and piece of equipment
  in both DAG files, laid out left (asteroid ore) to right (finished products).
* ``monte-carlo.png`` — one Monte Carlo run of the station planner.
* ``stats.json`` — the counts quoted next to the figures.
"""

from __future__ import annotations

import json
import math
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
OUT = ROOT / "UI Skeleton" / "public" / "images" / "methodology"
ASTEROIDS = ROOT / "UI Skeleton" / "public" / "data" / "asteroids.json"
DAG_FILES = ["Asteroid_Chemical_DAG-2.json", "Space_Industrial_Manufacturing_DAG.json"]

# Site palette (UI Skeleton/app/globals.css).
BG = "#05070b"
SIGNAL = "#52cbff"
WHITE = "#ffffff"
MUTED = "#ffffff"
ORE = "#f2b866"
EARTH = "#ff7a7a"
PRODUCT = "#b69cff"
EQUIP = "#6ee7b7"



# ---------------------------------------------------------------- process network


def load_graph():
    """Bipartite graph: material/equipment nodes and process nodes."""
    kind: dict[str, str] = {}
    edges: set[tuple[str, str]] = set()
    n_proc = n_mat = n_equip = 0
    for f in DAG_FILES:
        d = json.loads((ROOT / f).read_text())
        for mid, m in d["materials"].items():
            k = m.get("kind") or "intermediate"
            if mid not in kind:
                n_mat += 1
            if k == "mineral_source_family":
                kind[mid] = "ore"
            elif k in ("external_supply_requirement", "upstream_model_boundary"):
                kind.setdefault(mid, "earth")
            elif k in ("component", "manufactured_equipment_for_future_generation", "digital_artifact"):
                kind[mid] = "product"
            else:
                kind.setdefault(mid, "material")
        for eid in d["equipment"]:
            if eid not in kind:
                n_equip += 1
            kind.setdefault(eid, "equipment")
        for pid, p in d["processes"].items():
            node = "proc:" + pid
            kind[node] = "process"
            n_proc += 1
            for i in p["inputs"]:
                edges.add((i["material_id"], node))
            for o in p["outputs"]:
                edges.add((node, o["material_id"]))
            for eid in (p.get("equipment_ids") or []) + (p.get("site_equipment_ids") or []):
                edges.add((eid, node))
    for a, b in edges:
        kind.setdefault(a, "material")
        kind.setdefault(b, "material")
    return kind, sorted(edges), {"processes": n_proc, "materials": n_mat, "equipment": n_equip}


def layer_nodes(kind, edges):
    succ, pred = defaultdict(list), defaultdict(list)
    for a, b in edges:
        succ[a].append(b)
        pred[b].append(a)
    # Drop the few back edges (recycle loops) so the layout is acyclic.
    state, back = {}, set()
    sys.setrecursionlimit(10000)

    def dfs(u):
        state[u] = 1
        for v in succ[u]:
            if state.get(v) == 1:
                back.add((u, v))
            elif v not in state:
                dfs(v)
        state[u] = 2

    for n in sorted(kind):
        if n not in state:
            dfs(n)
    fwd = [(a, b) for a, b in edges if (a, b) not in back]
    s2, indeg = defaultdict(list), defaultdict(int)
    for a, b in fwd:
        s2[a].append(b)
        indeg[b] += 1
    layer = {n: 0 for n in kind}
    queue = [n for n in kind if indeg[n] == 0]
    while queue:
        u = queue.pop()
        for v in s2[u]:
            layer[v] = max(layer[v], layer[u] + 1)
            indeg[v] -= 1
            if indeg[v] == 0:
                queue.append(v)
    # Pull sources (equipment, Earth supplies) next to their first use.
    for n in kind:
        if not any(True for a, _ in fwd if a == n) or pred[n]:
            continue
    for n in kind:
        if not pred[n] and succ[n] and kind[n] != "ore":
            layer[n] = max(0, min(layer[v] for v in succ[n]) - 1)
    for n in kind:
        if kind[n] == "ore":
            layer[n] = 0
    return layer, fwd


def order_layers(layer, edges, sweeps=12):
    layers = defaultdict(list)
    for n, l in layer.items():
        layers[l].append(n)
    nbrs = defaultdict(list)
    for a, b in edges:
        nbrs[a].append(b)
        nbrs[b].append(a)
    pos = {}
    for l in layers:
        layers[l].sort()
        for i, n in enumerate(layers[l]):
            pos[n] = i / max(1, len(layers[l]) - 1)
    L = max(layers) + 1
    for s in range(sweeps):
        rng = range(1, L) if s % 2 == 0 else range(L - 2, -1, -1)
        for l in rng:
            def bary(n):
                ps = [pos[m] for m in nbrs[n] if abs(layer[m] - l) == 1]
                return sum(ps) / len(ps) if ps else pos[n]
            layers[l].sort(key=bary)
            for i, n in enumerate(layers[l]):
                pos[n] = i / max(1, len(layers[l]) - 1)
    return layers


def process_network_svg(stats_out: dict) -> None:
    kind, edges, counts = load_graph()
    layer, fwd = layer_nodes(kind, edges)
    layers = order_layers(layer, fwd)
    L = max(layers) + 1
    W, H, pad = 2400, 1300, 40
    tallest = max(len(v) for v in layers.values())
    xy = {}
    for l, nodes in layers.items():
        n = len(nodes)
        span = (H - 2 * pad) * min(1.0, 0.25 + 0.75 * n / tallest)
        for i, node in enumerate(nodes):
            y = H / 2 + (i - (n - 1) / 2) * (span / max(1, n - 1)) if n > 1 else H / 2
            xy[node] = (pad + (l / max(1, L - 1)) ** 0.55 * (W - 2 * pad), y)
    colours = {"ore": ORE, "process": SIGNAL, "material": "#cfd6de", "earth": EARTH, "product": PRODUCT, "equipment": EQUIP}
    radius = {"ore": 6, "process": 2.6, "material": 2.2, "earth": 2.2, "product": 3.2, "equipment": 2.2}
    by_kind = defaultdict(int)
    for k in kind.values():
        by_kind[k] += 1
    TOP, BOTTOM = 110, 130  # room for the labels
    Hs = H + TOP + BOTTOM
    font = 'font-family="Inter, Helvetica, Arial, sans-serif"'
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {Hs}" preserveAspectRatio="xMidYMid meet">']
    out.append(f'<g transform="translate(0 {TOP})"><g fill="none" stroke-width="0.6" stroke="#7fb6d9" stroke-opacity="0.13">')
    for a, b in edges:
        (x1, y1), (x2, y2) = xy[a], xy[b]
        mx = (x1 + x2) / 2
        out.append(f'<path d="M{x1:.1f} {y1:.1f}C{mx:.1f} {y1:.1f} {mx:.1f} {y2:.1f} {x2:.1f} {y2:.1f}"/>')
    out.append("</g><g>")
    for n, (x, y) in xy.items():
        k = kind[n]
        out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{radius[k]:.1f}" fill="{colours[k]}" fill-opacity="0.85"/>')
    out.append("</g></g>")
    # Scale: how many things, and how many steps deep.
    out.append(
        f'<text x="{pad}" y="70" {font} font-size="56" fill="#ffffff">{len(kind):,} nodes, {len(edges):,} links</text>'
        f'<text x="{W - pad}" y="70" {font} font-size="46" fill="#ffffff" text-anchor="end">'
        f'{by_kind["ore"]} asteroid ores on the left, {by_kind["product"]} components and products on the right</text>'
    )
    base = TOP + H + 30
    out.append(f'<path d="M{pad} {base}H{W - pad}" stroke="#3a414b" stroke-width="2"/>')
    for step in [1, 5, 10, 25, 50, 75, L]:
        x = pad + ((step - 1) / max(1, L - 1)) ** 0.55 * (W - 2 * pad)
        anchor = "start" if step == 1 else "end" if step == L else "middle"
        out.append(f'<path d="M{x:.1f} {base}v14" stroke="#3a414b" stroke-width="2"/>')
        out.append(f'<text x="{x:.1f}" y="{base + 62}" {font} font-size="44" fill="#ffffff" text-anchor="{anchor}">step {step}</text>')
    out.append("</svg>")
    (OUT / "process-network-full.svg").write_text("".join(out))
    stats_out["network"] = {
        "processes": counts["processes"],
        "materials": counts["materials"],
        "equipment": counts["equipment"],
        "nodes": len(kind),
        "edges": len(edges),
        "layers": L,
        "ores": by_kind["ore"],
        "earthInputs": by_kind["earth"],
        "products": by_kind["product"],
    }


# ---------------------------------------------------------------- station planner


def planner():
    from asteroid_industry.stations import StationPlanner

    return StationPlanner.from_files(ASTEROIDS, ROOT)


def style(plt):
    plt.rcParams.update({
        "figure.facecolor": "none", "axes.facecolor": "none", "savefig.facecolor": "none",
        "axes.edgecolor": "#3a414b", "axes.labelcolor": MUTED, "xtick.color": MUTED, "ytick.color": MUTED,
        "text.color": WHITE, "axes.titlecolor": WHITE, "font.family": "DejaVu Sans", "font.size": 14,
        "axes.titlesize": 15, "axes.titlelocation": "left", "axes.titlepad": 12,
        "grid.color": "#ffffff", "grid.alpha": 0.07, "axes.grid": True, "axes.spines.top": False,
        "axes.spines.right": False, "legend.frameon": False, "svg.fonttype": "path",
    })


def station_count_sweep(p, stats_out: dict, product="semiconductors") -> None:
    """Asteroids per station and typical Δv as stations are added (numbers quoted in the text)."""
    ks = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 250]
    rows = []
    for k in ks:
        r = p.plan(product, stations=k, draws=0)
        st = r["stations"]
        carriers = sum(s["members"] for s in st)
        share = np.array([s["share"] for s in st])
        dv = np.array([s["dvMedian"] for s in st])
        rows.append({
            "k": k,
            "perStation": carriers / k,
            "dvMedian": float((share * dv).sum()),
            "dvWorst": float(dv.max()),
        })
        print(f"  k={k:>3}: {carriers / k:>9.0f} asteroids/station, median Δv {rows[-1]['dvMedian']:.2f} km/s")
    stats_out["stations"] = {"product": product, "tripYears": 2.0, "sweep": rows}


def monte_carlo_figure(p, stats_out: dict, product="semiconductors", k=6, draws=1000) -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    style(plt)
    sm = p.sampling
    rng = np.random.default_rng(3)

    # (a) Dirichlet resampling of one taxonomic type's mineral mix.
    types = list(p.model["types"])
    t = types.index("C")
    nz = np.flatnonzero(sm.type_minerals[t] > 0.02)
    g = rng.gamma(sm.type_kappa[t] * sm.type_minerals[t], size=(4000, sm.type_minerals.shape[1]))
    mix = g / g.sum(1, keepdims=True)
    minerals = list(p.model["mineral_yield_wt_pct"])

    # (b, c) A full run of the planner.
    r = p.plan(product, stations=k, draws=draws, seed=7)
    st = r["stations"]

    drift = []
    for cloud, s in zip(r["cloud"], st):
        pts = np.asarray(cloud).reshape(-1, 2)
        a = np.hypot(pts[:, 0], pts[:, 1])
        dlon = (np.degrees(np.arctan2(pts[:, 1], pts[:, 0])) - s["longitude"] + 180) % 360 - 180
        drift.append({"lonDeg": float(np.percentile(np.abs(dlon), 95)), "aPct": float(np.percentile(np.abs((a / s["a"] - 1) * 100), 95))})

    fig, (ax, ax2) = plt.subplots(1, 2, figsize=(11, 5.2), gridspec_kw={"width_ratios": [1.2, 1], "wspace": 0.45})
    order = nz[np.argsort(-sm.type_minerals[t, nz])]
    lo, hi = np.percentile(mix[:, order] * 100, [5, 95], axis=0)
    plain = {"hydrated_phyllosilicates": "Water-bearing clay", "organic_matter": "Organic matter"}
    names = [plain.get(minerals[m], minerals[m].replace("_", " ").capitalize()) for m in order]
    for i, m in enumerate(order):
        ax.plot([lo[i], hi[i]], [i, i], color=SIGNAL, lw=8, alpha=0.45, solid_capstyle="round")
        ax.scatter([sm.type_minerals[t, m] * 100], [i], color=WHITE, s=40, zorder=3)
        ax.text(hi[i] + 2, i, f"{lo[i]:.0f} to {hi[i]:.0f}%", va="center", color=MUTED, fontsize=12)
    ax.set_yticks(range(len(order)), names)
    ax.invert_yaxis()
    ax.set_xlim(0, 100)
    ax.set(xlabel="Share of the rock (%)", title=f"What a C-type is made of, over {draws:,} runs")
    ax.grid(axis="y", alpha=0)

    shares = np.array([s["share"] for s in st]) * 100
    los = np.array([s["ranges"]["share"]["lo"] for s in st]) * 100
    his = np.array([s["ranges"]["share"]["hi"] for s in st]) * 100
    y = np.arange(len(st))
    ax2.barh(y, shares, color=SIGNAL, alpha=0.35, height=0.6)
    ax2.errorbar(shares, y, xerr=[shares - los, his - shares], fmt="none", ecolor=WHITE, elinewidth=1.6, capsize=5)
    for i in y:
        ax2.text(his[i] + 0.8, i, f"{los[i]:.1f} to {his[i]:.1f}%", va="center", color=MUTED, fontsize=12)
    ax2.set_yticks(y, [f"Station {i + 1}" for i in y])
    ax2.invert_yaxis()
    ax2.set_xlim(0, max(his) * 1.35)
    ax2.set(xlabel="Share of the material (%)", title="Each station's share")
    ax2.grid(axis="y", alpha=0)
    fig.text(0.01, -0.04, "Dot or bar: the usual value.  Shaded line or whiskers: the range in 90% of runs.", color=MUTED, fontsize=12)
    fig.savefig(OUT / "monte-carlo.png", dpi=180, transparent=True, bbox_inches="tight")
    plt.close(fig)

    # Every run's station positions, relative to each station's usual spot.
    palette = [SIGNAL, ORE, PRODUCT, EQUIP, EARTH, "#ffd84d"]
    fig, ax = plt.subplots(figsize=(11, 6))
    for c, (cloud, s) in enumerate(zip(r["cloud"], st)):
        pts = np.asarray(cloud).reshape(-1, 2)
        a = np.hypot(pts[:, 0], pts[:, 1])
        dlon = (np.degrees(np.arctan2(pts[:, 1], pts[:, 0])) - s["longitude"] + 180) % 360 - 180
        da = (a / s["a"] - 1) * 100
        ax.scatter(dlon, da, s=7, color=palette[c % len(palette)], alpha=0.45, linewidths=0, label=f"Station {c + 1}")
    ax.axhline(0, color=MUTED, lw=0.8, alpha=0.6)
    ax.axvline(0, color=MUTED, lw=0.8, alpha=0.6)
    ax.scatter([0], [0], s=70, color=WHITE, zorder=5)
    ax.annotate("usual position", (0, 0), xytext=(14, -22), textcoords="offset points", color=WHITE, fontsize=12)
    ax.set(xlabel="Moved along its orbit (degrees)", ylabel="Moved closer or further from the Sun (%)",
           title=f"Where each station lands in {draws:,} runs (one dot per run)")
    leg = ax.legend(loc="upper right", ncols=3, fontsize=12, markerscale=3, handletextpad=0.3, columnspacing=1.2)
    for h in leg.legend_handles:
        h.set_alpha(1)
    fig.savefig(OUT / "monte-carlo-cloud.png", dpi=180, transparent=True, bbox_inches="tight")
    plt.close(fig)
    stats_out["monteCarlo"] = {
        "product": product,
        "stations": k,
        "draws": draws,
        "ms": round(r["ms"]),
        "shares": [{"nominal": s["share"], **s["ranges"]["share"]} for s in st],
        "drift": drift,
    }


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    stats: dict = {}
    print("process network…")
    process_network_svg(stats)
    print(" ", stats["network"])
    p = planner()
    print("station sweep…")
    station_count_sweep(p, stats)
    print("monte carlo…")
    monte_carlo_figure(p, stats)
    (OUT / "stats.json").write_text(json.dumps(stats, indent=2))
    print("wrote", OUT)


if __name__ == "__main__":
    main()
