# Great Expectations uint8 ordering reproduction

This note records a fixed local experiment for the candidate built from Great
Expectations Issue #12331 and the Dagster project. It is technical evidence,
not market validation.

## Result

The isolated Windows run used Python 3.12.10 with
`great_expectations==1.24.0`, `pandas==2.2.3`, and `numpy==2.1.0`.

| Input | Great Expectations (`strictly=True`) | Direct adjacent ordering |
| --- | --- | --- |
| `uint8 [3, 2, 1]` | `success=true`, `unexpected_count=0` | `success=false`, 2 failing pairs |
| `uint8 [1, 2, 3]` | `success=true`, `unexpected_count=0` | `success=true`, 0 failing pairs |
| `int64 [3, 2, 1]` | `success=false`, `unexpected_count=2` | `success=false`, 2 failing pairs |

The public false positive is therefore reproducible. A comparator that checks
`previous < current` directly catches it without subtracting unsigned values.
The reproducible raw output and command are archived as technical experiment
`gx-uint8-ordering-20261022`.

## Adversarial review

This only establishes a narrow technical guard. It does not show that a
separate adapter is better than a local assertion, that Dagster integration is
needed, that the issue remains in all releases, or that data engineering teams
encounter the problem often enough to pay for it. The experiment used three
small synthetic Series and did not deploy a Dagster asset chain.

The candidate remains `marketStatus=unvalidated`. The next high-information
step is to refresh the upstream issue/release state and obtain authorized
evidence from a real workflow about frequency, operational cost, and whether a
local fix is sufficient. Until then, do not expand the adapter.
