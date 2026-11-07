"""
Put every object in the catalogue at one common time.

The input columns `position` and `velocity` are heliocentric state vectors in the
equatorial J2000 frame (AU and AU/day) at each row's own `ref_epoch`.  This module
propagates each state vector to a single target epoch using universal-variable
two-body (Keplerian) propagation around the Sun.  The output frame is the same
heliocentric inertial frame (EQJ2000 axes, Sun fixed at the origin), just at a
common epoch.

Usage from Python
-----------------
    from unify_epoch import propagate_state, unify_parquet

    # One object: propagate 100 days forward.
    r, v = propagate_state([1, 0, 0], [0, 0.017, 0], 100.0)

    # Whole file: default target = most common ref_epoch in the file.
    unify_parquet("dataset_filtered.parquet", "dataset_filtered_unified.parquet")

Usage from the shell
--------------------
    python unify_epoch.py dataset_filtered.parquet dataset_filtered_unified.parquet
    python unify_epoch.py dataset.parquet dataset_unified.parquet --epoch 2461300.5

Requires: duckdb  (pip install duckdb)
"""

from __future__ import annotations

import argparse
import csv
import math
import os
import tempfile
from typing import Iterable, Sequence

# Gaussian gravitational constant k = 0.01720209895 AU^(3/2)/day.
# mu = k^2, in AU^3/day^2.
MU_SUN = 0.0002959122082855911

# J2000 mean obliquity, used only by the helper that converts EQJ2000 -> ecliptic.
OBLIQUITY_J2000_DEG = 23.4392911


def _stumpff(z: float) -> tuple[float, float]:
    """Stumpff functions C(z) and S(z)."""
    if z > 1.0e-8:
        sz = math.sqrt(z)
        return (1.0 - math.cos(sz)) / z, (sz - math.sin(sz)) / (sz * sz * sz)
    if z < -1.0e-8:
        sz = math.sqrt(-z)
        return (math.cosh(sz) - 1.0) / (-z), (math.sinh(sz) - sz) / (sz * sz * sz)
    # Series around z = 0 (avoids catastrophic cancellation).
    return (
        1.0 / 2.0 - z / 24.0 + z * z / 720.0 - z**3 / 40320.0,
        1.0 / 6.0 - z / 120.0 + z * z / 5040.0 - z**3 / 362880.0,
    )


def _dot(a: Sequence[float], b: Sequence[float]) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _norm(a: Sequence[float]) -> float:
    return math.sqrt(_dot(a, a))


def _initial_chi(r0: float, rv0: float, alpha: float, dt: float, mu: float) -> float:
    """Vallado-style starting guess for the universal anomaly chi."""
    if alpha > 1.0e-8:  # elliptic
        return math.sqrt(mu) * dt * alpha
    if alpha < -1.0e-8:  # hyperbolic
        a = 1.0 / alpha
        numerator = -2.0 * mu * alpha * dt
        denominator = rv0 + math.copysign(math.sqrt(-mu * a), dt) * (1.0 - r0 * alpha)
        return math.copysign(math.sqrt(-a) * math.log(numerator / denominator), dt)
    # Near-parabolic: good enough as a seed.
    return math.sqrt(mu) * dt / r0


def propagate_state(
    position: Sequence[float],
    velocity: Sequence[float],
    dt_days: float,
    mu: float = MU_SUN,
    tol: float = 1.0e-11,
    max_iter: int = 100,
) -> tuple[list[float], list[float]]:
    """Propagate a heliocentric state vector by ``dt_days`` days.

    Parameters
    ----------
    position : length-3 sequence
        Heliocentric position in AU (EQJ2000).
    velocity : length-3 sequence
        Heliocentric velocity in AU/day (EQJ2000).
    dt_days : float
        Time step in days. Negative propagates backwards.
    mu : float
        Gravitational parameter of the Sun in AU^3/day^2.

    Returns
    -------
    (position, velocity) : tuple[list[float], list[float]]
        Propagated heliocentric state in AU and AU/day, same inertial frame.
    """
    r0v = [float(position[0]), float(position[1]), float(position[2])]
    v0v = [float(velocity[0]), float(velocity[1]), float(velocity[2])]

    if not all(math.isfinite(x) for x in r0v + v0v):
        raise ValueError("position and velocity must be finite")

    if dt_days == 0.0:
        return r0v, v0v

    r0 = _norm(r0v)
    v0 = _norm(v0v)
    if r0 == 0.0:
        raise ValueError("position vector must be non-zero")

    rv0 = _dot(r0v, v0v)
    alpha = 2.0 / r0 - v0 * v0 / mu
    sqrt_mu = math.sqrt(mu)

    chi = _initial_chi(r0, rv0, alpha, dt_days, mu)

    for _ in range(max_iter):
        z = alpha * chi * chi
        c, s = _stumpff(z)
        f = (
            (rv0 / sqrt_mu) * chi * chi * c
            + (1.0 - alpha * r0) * chi**3 * s
            + r0 * chi
            - sqrt_mu * dt_days
        )
        df = (
            (rv0 / sqrt_mu) * chi * (1.0 - z * s)
            + (1.0 - alpha * r0) * chi * chi * c
            + r0
        )
        if df == 0.0:
            break
        step = f / df
        chi -= step
        if abs(step) < tol:
            break
    else:
        raise RuntimeError("universal-variable Kepler solver did not converge")

    z = alpha * chi * chi
    c, s = _stumpff(z)

    f = 1.0 - chi * chi / r0 * c
    g = dt_days - chi**3 / sqrt_mu * s

    new_r = [f * r0v[i] + g * v0v[i] for i in range(3)]
    rmag = _norm(new_r)

    fdot = sqrt_mu / (rmag * r0) * (alpha * chi**3 * s - chi)
    gdot = 1.0 - chi * chi / rmag * c

    new_v = [fdot * r0v[i] + gdot * v0v[i] for i in range(3)]
    return new_r, new_v


def propagate_catalog(
    positions: Iterable[Sequence[float]],
    velocities: Iterable[Sequence[float]],
    epochs: Iterable[float],
    target_epoch: float,
    mu: float = MU_SUN,
) -> list[tuple[list[float], list[float]]]:
    """Vectorised-ish convenience wrapper over ``propagate_state``.

    Returns one ``(position, velocity)`` pair per input row.
    """
    out = []
    for r, v, epoch in zip(positions, velocities, epochs):
        out.append(propagate_state(r, v, target_epoch - epoch, mu=mu))
    return out


def equatorial_to_ecliptic(vec: Sequence[float]) -> list[float]:
    """Rotate an EQJ2000 vector into the J2000 ecliptic frame."""
    eps = math.radians(OBLIQUITY_J2000_DEG)
    ce, se = math.cos(eps), math.sin(eps)
    return [vec[0], vec[1] * ce + vec[2] * se, -vec[1] * se + vec[2] * ce]


def unify_parquet(
    input_path: str,
    output_path: str,
    target_epoch: float | None = None,
    *,
    compression: str = "ZSTD",
    row_group_size: int = 100_000,
    batch_size: int = 20_000,
) -> float:
    """Propagate every row of a parquet catalogue to one epoch.

    All original columns are preserved.  ``position``, ``velocity`` and
    ``ref_epoch`` are replaced by their propagated/common-epoch values.
    A new column ``propagated_from_epoch`` records the original epoch.

    Parameters
    ----------
    input_path, output_path : str
        Parquet paths.
    target_epoch : float, optional
        Target Julian date.  Defaults to the most common ``ref_epoch`` in the
        input (the catalogue's dominant epoch), which minimises propagation.
    compression : str
        Parquet compression codec (default ZSTD).
    row_group_size : int
        Output parquet row group size.

    Returns
    -------
    float
        The target epoch (Julian date) actually used.
    """
    try:
        import duckdb
    except ImportError as exc:  # pragma: no cover
        raise ImportError("unify_parquet needs duckdb: pip install duckdb") from exc

    con = duckdb.connect()

    if target_epoch is None:
        rows = con.execute(
            "SELECT ref_epoch FROM read_parquet(?) "
            "WHERE ref_epoch IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC LIMIT 1",
            [input_path],
        ).fetchall()
        row = rows[0] if rows else None
        if row is None:
            raise ValueError("no valid ref_epoch values in input")
        target_epoch = float(row[0])

    # Propagate in batches.  Results go through a temporary CSV because
    # DuckDB's row-at-a-time executemany is far too slow for million-row files.
    failures = 0
    tmp_fd, tmp_path = tempfile.mkstemp(prefix="unify_epoch_", suffix=".csv")
    os.close(tmp_fd)
    fmt = lambda x: format(float(x), ".17g")

    try:
        reader = con.cursor()
        result = reader.execute(
            """
            SELECT row_number() OVER () AS _row, position, velocity, ref_epoch
            FROM read_parquet(?)
            """,
            [input_path],
        )
        with open(tmp_path, "w", newline="") as fh:
            writer = csv.writer(fh)
            writer.writerow(
                ["_row", "px", "py", "pz", "vx", "vy", "vz", "propagated_from_epoch"]
            )
            while True:
                batch = result.fetchmany(batch_size)
                if not batch:
                    break
                for _row, position, velocity, epoch in batch:
                    empty = ["", "", "", "", "", ""]
                    if position is None or velocity is None or epoch is None:
                        writer.writerow(
                            [_row, *empty, "" if epoch is None else fmt(epoch)]
                        )
                        continue
                    try:
                        r, v = propagate_state(
                            position, velocity, target_epoch - float(epoch)
                        )
                        writer.writerow(
                            [
                                _row,
                                fmt(r[0]),
                                fmt(r[1]),
                                fmt(r[2]),
                                fmt(v[0]),
                                fmt(v[1]),
                                fmt(v[2]),
                                fmt(epoch),
                            ]
                        )
                    except Exception:
                        failures += 1
                        writer.writerow([_row, *empty, fmt(epoch)])

        con.execute(
            """
            CREATE TEMP TABLE _propagated AS
            SELECT _row,
                   CASE WHEN px IS NULL THEN NULL ELSE [px, py, pz] END AS position,
                   CASE WHEN vx IS NULL THEN NULL ELSE [vx, vy, vz] END AS velocity,
                   propagated_from_epoch
            FROM read_csv(?, header = true, columns = {
                '_row': 'BIGINT',
                'px': 'DOUBLE', 'py': 'DOUBLE', 'pz': 'DOUBLE',
                'vx': 'DOUBLE', 'vy': 'DOUBLE', 'vz': 'DOUBLE',
                'propagated_from_epoch': 'DOUBLE'
            })
            """,
            [tmp_path],
        )
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    if failures:
        print(f"warning: {failures} rows could not be propagated (set to NULL)")

    # Replace the three epoch-dependent columns in the full catalogue.
    con.execute(
        f"""
        COPY (
            SELECT * EXCLUDE (_row, p_position, p_velocity, p_from)
                   REPLACE (
                       p_position AS position,
                       p_velocity AS velocity,
                       ?::DOUBLE AS ref_epoch
                   ),
                   p_from AS propagated_from_epoch
            FROM (
                SELECT b.*,
                       p.position AS p_position,
                       p.velocity AS p_velocity,
                       p.propagated_from_epoch AS p_from
                FROM (
                    SELECT *, row_number() OVER () AS _row
                    FROM read_parquet(?)
                ) b
                LEFT JOIN _propagated p USING (_row)
            )
        ) TO ? (FORMAT PARQUET, COMPRESSION '{compression}',
                ROW_GROUP_SIZE {int(row_group_size)})
        """,
        [target_epoch, input_path, output_path],
    )

    return float(target_epoch)


def _main() -> None:
    parser = argparse.ArgumentParser(
        description="Propagate all heliocentric state vectors to one common epoch."
    )
    parser.add_argument("input", help="input parquet file")
    parser.add_argument("output", help="output parquet file")
    parser.add_argument(
        "--epoch",
        type=float,
        default=None,
        help="target Julian date (default: most common ref_epoch in input)",
    )
    args = parser.parse_args()

    used = unify_parquet(args.input, args.output, args.epoch)
    print(f"wrote {args.output} with all state vectors at JD {used}")


if __name__ == "__main__":
    _main()
