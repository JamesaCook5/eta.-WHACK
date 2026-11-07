"""
Visualise a random sample of the unified catalogue in a heliocentric ecliptic
frame with matplotlib.

    python visualise_asteroids.py
    python visualise_asteroids.py --input dataset_filtered_unified.parquet \
        --n 2000 --seed 42 --output asteroids_2000.png

Requires: duckdb, numpy, matplotlib
"""

from __future__ import annotations

import argparse
import math

import duckdb
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.lines import Line2D
from matplotlib.patches import Circle

# J2000 mean obliquity: EQJ2000 -> ecliptic.
EPS = math.radians(23.4392911)

# Planet semi-major axes (AU) for reference rings.
PLANETS = {
    "Mercury": 0.387,
    "Venus": 0.723,
    "Earth": 1.000,
    "Mars": 1.524,
    "Jupiter": 5.203,
    "Saturn": 9.537,
    "Uranus": 19.191,
    "Neptune": 30.069,
}

# Bright palette for taxonomic complexes on a dark background.
COLORS = {
    "C": "#9aa0a6",
    "S": "#ff9f43",
    "X": "#b388ff",
    "B": "#4dabf7",
    "D": "#c98a5e",
    "V": "#69db7c",
    "L": "#f783ac",
    "U": "#adb5bd",
    "K": "#38d9a9",
    "A": "#ffd43b",
    "Ch": "#e599f7",
    "P": "#ffa8a8",
    "Q": "#ff8787",
    "M": "#9775fa",
    "E": "#8ce99a",
}
OTHER_COLOR = "#6e7681"


def load_sample(path: str, n: int, seed: int):
    con = duckdb.connect()
    rows = con.execute(
        f"""
        SELECT id, class, "taxonomy.complex", "taxonomy.class",
               position, "diameter.value"
        FROM read_parquet(?)
        USING SAMPLE {int(n)} ROWS (reservoir, {int(seed)})
        """,
        [path],
    ).fetchall()
    con.close()
    return rows


def to_ecliptic(positions: np.ndarray) -> np.ndarray:
    """Rotate N x 3 EQJ2000 vectors into the J2000 ecliptic frame."""
    x = positions[:, 0]
    y = positions[:, 1] * math.cos(EPS) + positions[:, 2] * math.sin(EPS)
    z = -positions[:, 1] * math.sin(EPS) + positions[:, 2] * math.cos(EPS)
    return np.column_stack([x, y, z])


def make_plot(rows, epoch: float, out_path: str, n: int, seed: int) -> None:
    pos = to_ecliptic(np.array([r[4] for r in rows], dtype=float))
    x, y, z = pos[:, 0], pos[:, 1], pos[:, 2]
    r_cyl = np.hypot(x, y)
    r_3d = np.linalg.norm(pos, axis=1)
    lon = np.arctan2(y, x)

    # Prefer the taxonomic complex; fall back to the class letter.
    labels = np.array(
        [
            (r[2] or r[3] or "?")
            for r in rows
        ],
        dtype=object,
    )
    diameters = np.array([r[5] for r in rows], dtype=float)
    order = np.argsort(r_3d)  # draw far objects first

    # Marker size scales with log diameter, so large bodies stand out.
    sizes = np.full(len(rows), 14.0)
    valid = np.isfinite(diameters) & (diameters > 0)
    if valid.sum() > 1:
        ld = np.log10(diameters[valid])
        sizes[valid] = 12.0 + 55.0 * (ld - ld.min()) / (ld.max() - ld.min())

    counts = {}
    for lab in labels:
        counts[lab] = counts.get(lab, 0) + 1
    top = [lab for lab, _ in sorted(counts.items(), key=lambda kv: -kv[1])[:10]]
    color_for = {
        lab: COLORS.get(lab, OTHER_COLOR) for lab in counts
    }

    plt.rcParams.update(
        {
            "figure.facecolor": "#0d1117",
            "axes.facecolor": "#0d1117",
            "savefig.facecolor": "#0d1117",
            "axes.edgecolor": "#30363d",
            "axes.labelcolor": "#e6edf3",
            "text.color": "#e6edf3",
            "xtick.color": "#8b949e",
            "ytick.color": "#8b949e",
            "grid.color": "#21262d",
            "font.size": 10,
        }
    )

    fig = plt.figure(figsize=(16, 8.2))
    gs = fig.add_gridspec(1, 2, width_ratios=[1.0, 1.12], wspace=0.22)
    ax1 = fig.add_subplot(gs[0, 0])
    ax2 = fig.add_subplot(gs[0, 1], projection="polar")

    # ---------------------------------------------------------------- panel 1
    # Inner solar system, top-down ecliptic view.
    lim = 6.0
    ax1.set_aspect("equal")
    ax1.set_xlim(-lim, lim)
    ax1.set_ylim(-lim, lim)
    ax1.set_xlabel("x — ecliptic (AU)")
    ax1.set_ylabel("y — ecliptic (AU)")
    ax1.grid(True, alpha=0.5)

    for name, au in PLANETS.items():
        if au <= lim:
            ax1.add_patch(
                Circle(
                    (0, 0),
                    au,
                    fill=False,
                    color="#6e7681",
                    lw=0.8,
                    alpha=0.55,
                    ls="--",
                )
            )
            if name in ("Earth", "Mars", "Jupiter"):
                ax1.text(
                    au * 0.71, au * 0.71, name, color="#8b949e", fontsize=8, alpha=0.9
                )

    ax1.scatter([0], [0], s=90, color="#ffd43b", zorder=5, ec="#fff3bf", lw=0.5)
    ax1.text(0.12, -0.32, "Sun", color="#ffd43b", fontsize=9)

    inner = r_cyl <= lim
    for lab in top:
        m = inner & (labels == lab)
        if m.any():
            ax1.scatter(
                x[m],
                y[m],
                s=sizes[m],
                c=color_for[lab],
                alpha=0.72,
                linewidths=0,
                zorder=3,
            )
    other = inner & ~np.isin(labels, top)
    if other.any():
        ax1.scatter(
            x[other],
            y[other],
            s=sizes[other],
            c=OTHER_COLOR,
            alpha=0.55,
            linewidths=0,
            zorder=2,
        )

    # ---------------------------------------------------------------- panel 2
    # All objects on a log-radial polar plot.
    ax2.set_theta_zero_location("E")
    ax2.set_theta_direction(1)
    ax2.set_rscale("log")
    ax2.set_rlim(0.2, 120)
    ax2.grid(True, color="#21262d", alpha=0.8)

    for name, au in PLANETS.items():
        theta = np.linspace(0, 2 * math.pi, 400)
        ax2.plot(theta, np.full_like(theta, au), color="#6e7681", lw=0.7, ls="--", alpha=0.45)
    for name in ("Earth", "Jupiter", "Neptune"):
        au = PLANETS[name]
        ax2.text(
            math.radians(65),
            au,
            f" {name}",
            color="#8b949e",
            fontsize=8,
            alpha=0.9,
            va="center",
        )

    for lab in top:
        m = labels == lab
        if m.any():
            ax2.scatter(
                lon[m],
                r_cyl[m],
                s=sizes[m],
                c=color_for[lab],
                alpha=0.78,
                linewidths=0,
                zorder=3,
            )
    other = ~np.isin(labels, top)
    if other.any():
        ax2.scatter(
            lon[other],
            r_cyl[other],
            s=sizes[other],
            c=OTHER_COLOR,
            alpha=0.55,
            linewidths=0,
            zorder=2,
        )

    # Thin dotted markers for the outer few objects so they are not lost.
    ax2.scatter(
        lon,
        r_cyl,
        s=1.0,
        c="#e6edf3",
        alpha=0.25,
        linewidths=0,
        zorder=1,
    )

    # ---------------------------------------------------------------- legends
    handles = [
        Line2D(
            [0],
            [0],
            marker="o",
            color="none",
            markerfacecolor=color_for[lab],
            markeredgecolor="none",
            markersize=7,
            label=f"{lab}  ({counts[lab]})",
        )
        for lab in top
    ]
    if any(lab not in top for lab in counts):
        n_other = sum(counts[lab] for lab in counts if lab not in top)
        handles.append(
            Line2D(
                [0],
                [0],
                marker="o",
                color="none",
                markerfacecolor=OTHER_COLOR,
                markeredgecolor="none",
                markersize=7,
                label=f"other  ({n_other})",
            )
        )

    fig.legend(
        handles=handles,
        loc="lower center",
        ncol=len(handles) if len(handles) <= 7 else (len(handles) + 1) // 2,
        frameon=False,
        title="taxonomic complex  (sample count)",
        bbox_to_anchor=(0.5, 0.005),
        fontsize=9,
        title_fontsize=9,
    )

    fig.suptitle(
        f"{n:,} random objects at a common epoch  •  JD {epoch:.1f} "
        f"({_jd_to_date(epoch)})  •  heliocentric ecliptic frame  •  seed {seed}",
        y=0.985,
        fontsize=13,
        color="#e6edf3",
    )
    fig.text(
        0.5,
        0.125,
        "Marker size ∝ log(diameter).  Left: inner solar system.  "
        "Right: entire sample out to the Kuiper Belt on a log-radial polar view.",
        ha="center",
        color="#8b949e",
        fontsize=9,
    )

    fig.subplots_adjust(left=0.06, right=0.98, top=0.88, bottom=0.19)
    # Align the two panel headings explicitly (polar titles sit differently).
    for ax, heading in (
        (ax1, f"Inner solar system  (|x|, |y| ≤ {lim:g} AU)"),
        (ax2, "Full catalogue  (heliocentric radius, log scale)"),
    ):
        bbox = ax.get_position()
        fig.text(
            (bbox.x0 + bbox.x1) / 2,
            0.925,
            heading,
            ha="center",
            va="bottom",
            fontsize=11,
            color="#e6edf3",
        )
    fig.savefig(out_path, dpi=200)
    plt.close(fig)
    print(f"wrote {out_path}")


def _jd_to_date(jd: float):
    import datetime

    return (datetime.datetime(1970, 1, 1) + datetime.timedelta(days=jd - 2440587.5)).strftime(
        "%Y-%m-%d"
    )


def _main() -> None:
    parser = argparse.ArgumentParser(description="Plot a random sample of the catalogue.")
    parser.add_argument("--input", default="dataset_filtered_unified.parquet")
    parser.add_argument("--output", default="asteroids_2000.png")
    parser.add_argument("--n", type=int, default=2000)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument(
        "--epoch",
        type=float,
        default=2461300.5,
        help="epoch label to show in the title (JD)",
    )
    args = parser.parse_args()

    rows = load_sample(args.input, args.n, args.seed)
    make_plot(rows, args.epoch, args.output, args.n, args.seed)


if __name__ == "__main__":
    _main()
