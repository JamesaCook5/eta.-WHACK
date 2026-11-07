"""A small illustrative process DAG.

This is *not* a real industrial engineering model.  It exists to exercise the
library: two manufactured equipment items, several mineral/volatile feedstocks,
intermediate chemicals, and three terminal products (chips, drones, spacecraft).

Replace/extend this dictionary with your real unit-operation data.
"""

DEMO_PROCESSES = {
    # ---------------------------------------------------- equipment manufacture
    "make_crusher": {
        "inputs": {"metal_ore": 50.0, "carbon": 5.0},
        "outputs": {"crusher": 1.0},
        "equipment": {"assembly_line": 1, "furnace": 1},
        # Bearings are a placeholder Earth import.
        "earth_inputs": {"earth_bearings": 2.0},
        "throughput_kg_per_day": 100.0,
    },
    "make_wafer_saw": {
        "inputs": {"metal_ore": 20.0, "silicon_metal": 5.0},
        "outputs": {"wafer_saw": 1.0},
        "equipment": {"assembly_line": 1},
        "throughput_kg_per_day": 50.0,
    },
    # ---------------------------------------------------------- ore preparation
    "comminution": {
        "inputs": {"silicate_ore": 100.0},
        "outputs": {"powdered_silicate": 100.0},
        "equipment": {"crusher": 1},
        "throughput_kg_per_day": 1000.0,
        "energy_kwh_per_kg": 0.02,
    },
    "iron_beneficiation": {
        "inputs": {"metal_ore": 100.0},
        "outputs": {"iron_concentrate": 55.0, "tailings": 45.0},
        "equipment": {"crusher": 1, "magnetic_separator": 1},
        "throughput_kg_per_day": 800.0,
    },
    "metal_beneficiation": {
        "inputs": {"metal_ore": 100.0},
        "outputs": {"metal_concentrate": 100.0},
        "equipment": {"crusher": 1, "magnetic_separator": 1},
        "throughput_kg_per_day": 800.0,
    },
    # ------------------------------------------------------------- pyrometallurgy
    "smelt_iron": {
        "inputs": {"iron_concentrate": 100.0, "carbon": 15.0},
        "outputs": {"iron_metal": 60.0, "slag": 55.0},
        "equipment": {"furnace": 1},
        "throughput_kg_per_day": 500.0,
        "energy_kwh_per_kg": 1.8,
    },
    "refine_metal": {
        "inputs": {"metal_concentrate": 100.0},
        "outputs": {"iron_metal": 65.0, "nickel_metal": 8.0, "slag": 27.0},
        "equipment": {"furnace": 1},
        "throughput_kg_per_day": 500.0,
        "energy_kwh_per_kg": 1.5,
    },
    "silicon_reduction": {
        "inputs": {"powdered_silicate": 100.0, "carbon": 30.0},
        "outputs": {"silicon_metal": 20.0, "slag": 110.0},
        "equipment": {"arc_furnace": 1},
        "throughput_kg_per_day": 400.0,
        "energy_kwh_per_kg": 12.0,
    },
    # ------------------------------------------------------------ volatiles
    "water_electrolysis": {
        "inputs": {"water": 100.0},
        "outputs": {"hydrogen": 11.0, "oxygen": 89.0},
        "equipment": {"electrolyzer": 1},
        "throughput_kg_per_day": 200.0,
        "energy_kwh_per_kg": 4.0,
    },
    "polymer_synthesis": {
        "inputs": {"carbon": 10.0, "hydrogen": 2.0, "ammonia": 1.0},
        "outputs": {"photoresist": 5.0},
        "equipment": {"chemical_reactor": 1},
        "throughput_kg_per_day": 100.0,
    },
    # ---------------------------------------------------------- semiconductors
    "wafering": {
        "inputs": {"silicon_metal": 10.0},
        "outputs": {"silicon_wafer": 8.0},
        "equipment": {"wafer_saw": 1},
        "throughput_kg_per_day": 50.0,
    },
    "photolithography": {
        "inputs": {"silicon_wafer": 1.0, "photoresist": 0.1},
        "outputs": {"integrated_circuit": 0.5},
        "equipment": {"lithography_machine": 1, "cleanroom": 1},
        # Process gases and dopants are placeholders for Earth imports.
        "earth_inputs": {"earth_process_gases": 0.05},
        "throughput_kg_per_day": 20.0,
    },
    # ------------------------------------------------------- terminal products
    "drone_assembly": {
        "inputs": {
            "iron_metal": 10.0,
            "nickel_metal": 1.0,
            "silicon_wafer": 0.5,
            "integrated_circuit": 1.0,
        },
        "outputs": {"drone": 5.0},
        "equipment": {"assembly_line": 1},
        "earth_inputs": {"earth_avionics": 1.0},
        "throughput_kg_per_day": 100.0,
    },
    "spacecraft_assembly": {
        "inputs": {
            "iron_metal": 20.0,
            "nickel_metal": 2.0,
            "silicon_wafer": 1.0,
            "integrated_circuit": 2.0,
            "hydrogen": 5.0,
            "oxygen": 20.0,
        },
        "outputs": {"spacecraft": 5.0},
        "equipment": {"assembly_line": 1, "cleanroom": 1},
        "earth_inputs": {"earth_sealant": 2.0, "earth_avionics": 2.0},
        "earth_equipment": {"earth_flight_computer": 1},
        "throughput_kg_per_day": 100.0,
    },
}

# Externally supplied equipment (the "space station workshop" already exists).
DEMO_EQUIPMENT = {
    "assembly_line": 1,
    "furnace": 1,
    "magnetic_separator": 1,
    "arc_furnace": 1,
    "electrolyzer": 1,
    "chemical_reactor": 1,
    "lithography_machine": 1,
    "cleanroom": 1,
}
