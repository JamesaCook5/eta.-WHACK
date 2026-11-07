"""Build public/data/asteroids.json (the map's test dataset) from a ssoBFT-style Parquet file.

Usage:  python scripts/build_sample_dataset.py <input.parquet> [output.json] [--limit N]

Positions in ssoBFT's `position` column are heliocentric, equatorial J2000 (au).
The map is a top-down view of the ecliptic, so they are rotated about the x-axis
by the J2000 obliquity before export.
"""
import json
import math
import sys

import numpy as np
import pyarrow.parquet as pq

OBLIQUITY_J2000_DEG = 23.4392911

COLUMNS = {
    "number": "number",
    "name": "name",
    "a": "orbital_elements.semi_major_axis.value",
    "e": "orbital_elements.eccentricity.value",
    "i": "orbital_elements.inclination.value",
    "taxonomy_class": "taxonomy.class",
    "diameter_km": "diameter.value",
    "albedo": "albedo.value",
    "orbit_class": "class",
    "position": "position",
}


def clean(v, digits=None):
    if v is None:
        return None
    if isinstance(v, float):
        if math.isnan(v):
            return None
        return round(v, digits) if digits is not None else v
    if isinstance(v, (np.integer,)):
        return int(v)
    return v


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    limit = None
    if "--limit" in sys.argv:
        limit = int(sys.argv[sys.argv.index("--limit") + 1])
        args = [a for a in args if a != str(limit)]
    src = args[0]
    out = args[1] if len(args) > 1 else "public/data/asteroids.json"

    table = pq.read_table(src, columns=list(COLUMNS.values()))
    df = table.to_pandas()
    df = df[df["position"].notna()]
    if limit is not None and len(df) > limit:
        # Keep classified objects first, then sample the rest at random.
        df = df.sample(frac=1.0, random_state=0).sort_values(
            "taxonomy.class", key=lambda s: s.isna(), kind="stable").head(limit)

    eq = np.stack(df["position"].to_numpy())  # (n, 3) equatorial J2000, au
    eps = math.radians(OBLIQUITY_J2000_DEG)
    c, s = math.cos(eps), math.sin(eps)
    x = eq[:, 0]
    y = eq[:, 1] * c + eq[:, 2] * s
    z = -eq[:, 1] * s + eq[:, 2] * c

    records = []
    for k, row in enumerate(df.itertuples(index=False)):
        r = dict(zip(COLUMNS.keys(), row))
        records.append({
            "number": None if clean(r["number"]) is None else int(r["number"]),
            "name": clean(r["name"]),
            "x": round(float(x[k]), 5),
            "y": round(float(y[k]), 5),
            "z": round(float(z[k]), 5),
            "a": clean(r["a"], 5),
            "e": clean(r["e"], 5),
            "i": clean(r["i"], 4),
            "taxonomy_class": clean(r["taxonomy_class"]),
            "diameter_km": clean(r["diameter_km"], 3),
            "albedo": clean(r["albedo"], 4),
            "orbit_class": clean(r["orbit_class"]),
        })

    with open(out, "w") as f:
        json.dump(records, f, separators=(",", ":"))
    print(f"wrote {len(records)} records to {out}")


if __name__ == "__main__":
    main()
