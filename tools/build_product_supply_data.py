"""Write the product supply model to UI Skeleton/public/data/product-supply.json.

The model itself is built by ``asteroid_industry.product_supply``; the UI
reads this file for the product picker (products, groups, imported inputs).
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from asteroid_industry.product_supply import build_product_supply  # noqa: E402

OUTPUT_PATH = ROOT / "UI Skeleton/public/data/product-supply.json"


def main() -> None:
    out = build_product_supply(ROOT)
    OUTPUT_PATH.write_text(json.dumps(out, separators=(",", ":")))
    print(
        f"wrote {OUTPUT_PATH} ({OUTPUT_PATH.stat().st_size / 1024:.1f} KB, "
        f"{len(out['products'])} products, {len(out['scenarios'])} scenarios)"
    )


if __name__ == "__main__":
    main()
