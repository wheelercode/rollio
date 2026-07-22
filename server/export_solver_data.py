from __future__ import annotations

import json

from solver import FINAL_SOLUTION_PATH, load_final_solution


OUTPUT_PATH = FINAL_SOLUTION_PATH.with_name("solution.json")


def main() -> None:
    solution = load_final_solution()

    if solution is None:
        raise SystemExit(
            "No compatible completed solver solution was found. "
            "Run: python solver.py"
        )

    payload = {
        "format": "rollio-optimal-play-v1",
        "values_by_remaining": solution.values_by_remaining,
        "start_values": solution.start_values,
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    with OUTPUT_PATH.open("w", encoding="utf-8") as file:
        json.dump(payload, file, separators=(",", ":"))

    print(f"Exported browser solver data to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
