"""Asteroid resource -> industrial process graph modelling.

Public API
----------
CompositionModel       Surface type -> mineral mass-fraction ranges / samples.
Asteroid               A catalogue object with diameter, density and mass.
AsteroidCatalog        Adapter for the project's parquet dataset.
Process, ProcessGraph  Unit-operation DAG with material and equipment flows.
IndustrialModel        Forward material-flow simulation and backward demand.
IndustrialSystem       High-level: asteroid -> feedstock inventory -> products.
StationPlanner         Weighted k-means station placement per product,
                       with composition-only Monte Carlo ranges (served by .api).
HierarchicalPlanner    Recursive tiered station placement over the manufacturing
                       DAG, with fallback process quantities and route selection.
build_product_supply   Product -> asteroid element supply model from the DAGs.
"""

from .composition import (
    DEFAULT_DENSITY,
    DEFAULT_FEEDSTOCK_MAP,
    SURFACE_COMPOSITION_RANGES,
    CompositionModel,
    normalize_surface_type,
)
from .asteroid import Asteroid, AsteroidCatalog, ResourceEstimate, estimate_resources
from .processes import Process, ProcessGraph
from .model import IndustrialModel, ProductionPotential, ProductionResult, RequiredInputs
from .system import AsteroidAssessment, IndustrialSystem
from .product_supply import build_product_supply
from .stations import StationPlanner
from .hierarchy import HierarchicalPlanner, Recipe, RecipeGraph, RecipeNode
from .spatial import (
    SpatialBin,
    SpatialMap,
    build_spatial_map,
    build_spatial_maps,
    plot_spatial_map,
)

__all__ = [
    "CompositionModel",
    "normalize_surface_type",
    "SURFACE_COMPOSITION_RANGES",
    "DEFAULT_FEEDSTOCK_MAP",
    "DEFAULT_DENSITY",
    "Asteroid",
    "AsteroidCatalog",
    "ResourceEstimate",
    "estimate_resources",
    "Process",
    "ProcessGraph",
    "IndustrialModel",
    "ProductionResult",
    "ProductionPotential",
    "RequiredInputs",
    "IndustrialSystem",
    "AsteroidAssessment",
    "SpatialBin",
    "SpatialMap",
    "build_spatial_map",
    "build_spatial_maps",
    "plot_spatial_map",
    "build_product_supply",
    "StationPlanner",
    "HierarchicalPlanner",
    "Recipe",
    "RecipeGraph",
    "RecipeNode",
]
