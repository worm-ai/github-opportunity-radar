"""Reproduce the Great Expectations uint8 ordering report without a product adapter."""

from __future__ import annotations

import json
import platform
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEPENDENCIES = ROOT / ".data" / "experiments" / "uint8-gx-dependencies" / "site-packages"
OUTPUT = ROOT / ".data" / "experiments" / "uint8-gx"
sys.path.insert(0, str(DEPENDENCIES))

import great_expectations as gx  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from great_expectations.self_check.util import build_pandas_validator_with_data  # noqa: E402


def gx_result(values: list[int], dtype: str) -> dict:
    series = pd.Series(values, dtype=dtype)
    frame = pd.DataFrame({"value": series})
    validator = build_pandas_validator_with_data(frame)
    result = validator.expect_column_values_to_be_increasing(
        column="value", strictly=True, result_format="COMPLETE"
    ).to_json_dict()
    return {
        "dtype": str(series.dtype),
        "values": [int(value) for value in series.tolist()],
        "success": bool(result["success"]),
        "unexpected_count": int(result["result"]["unexpected_count"]),
        "element_count": int(result["result"]["element_count"]),
        "exception_info": result.get("exception_info"),
    }


def adjacent_result(values: list[int], dtype: str) -> dict:
    series = pd.Series(values, dtype=dtype)
    pairs = []
    for index, (previous, current) in enumerate(zip(series.tolist(), series.tolist()[1:]), start=1):
        passes = bool(previous < current)
        pairs.append(
            {
                "index": index,
                "previous": int(previous),
                "current": int(current),
                "passes": passes,
            }
        )
    return {
        "dtype": str(series.dtype),
        "values": [int(value) for value in series.tolist()],
        "success": all(pair["passes"] for pair in pairs),
        "unexpected_count": sum(not pair["passes"] for pair in pairs),
        "element_count": len(series),
        "pairs": pairs,
    }


def main() -> None:
    cases = [
        {"id": "uint8_decreasing", "values": [3, 2, 1], "dtype": "uint8"},
        {"id": "uint8_increasing", "values": [1, 2, 3], "dtype": "uint8"},
        {"id": "int64_decreasing", "values": [3, 2, 1], "dtype": "int64"},
    ]
    results = []
    for case in cases:
        results.append(
            {
                **case,
                "great_expectations": gx_result(case["values"], case["dtype"]),
                "adjacent_comparison": adjacent_result(case["values"], case["dtype"]),
            }
        )

    by_id = {case["id"]: case for case in results}
    checks = {
        "reported_uint8_false_positive_reproduced": (
            by_id["uint8_decreasing"]["great_expectations"]["success"] is True
            and by_id["uint8_decreasing"]["great_expectations"]["unexpected_count"] == 0
        ),
        "independent_comparator_blocks_uint8_decreasing": (
            by_id["uint8_decreasing"]["adjacent_comparison"]["success"] is False
            and by_id["uint8_decreasing"]["adjacent_comparison"]["unexpected_count"] == 2
        ),
        "independent_comparator_allows_uint8_increasing": (
            by_id["uint8_increasing"]["adjacent_comparison"]["success"] is True
            and by_id["uint8_increasing"]["adjacent_comparison"]["unexpected_count"] == 0
        ),
        "signed_control_fails_original_rule": (
            by_id["int64_decreasing"]["great_expectations"]["success"] is False
        ),
        "signed_control_fails_independent_comparator": (
            by_id["int64_decreasing"]["adjacent_comparison"]["success"] is False
        ),
    }
    if not all(checks.values()):
        raise AssertionError(checks)

    output = {
        "executedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "environment": {
            "python": sys.version.split()[0],
            "platform": platform.platform(),
            "numpy": np.__version__,
            "pandas": pd.__version__,
            "great_expectations": gx.__version__,
        },
        "question": "Does the fixed Great Expectations rule misclassify a decreasing uint8 column, and does direct adjacent ordering isolate it without rejecting controls?",
        "cases": results,
        "checks": checks,
        "interpretation": {
            "technical": "The original rule reproduces the reported uint8 false positive. Direct adjacent ordering catches the decreasing uint8 values and preserves the increasing control.",
            "product": "This only establishes a narrow technical guard. It does not establish that a separate adapter, Dagster integration, recurring user pain, or a paid market exists.",
        },
    }
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / "result.json").write_text(json.dumps(output, indent=2), encoding="utf-8")
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
