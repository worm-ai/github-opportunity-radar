# Great Expectations uint8 ordering experiment

This is a bounded reproduction of the public Great Expectations issue used by
the opportunity `d44e11501754ca6b52ba18b1e4e4c4dd`. It runs only against a
fixed local environment and does not change the application database.

The run compares the original `ExpectColumnValuesToBeIncreasing` result with
an adjacent-value comparison that uses ordering directly and never subtracts
unsigned values. The inputs are exactly the reported decreasing `uint8`
sample, an increasing `uint8` control, and a decreasing `int64` control.

Run from the repository root:

```powershell
& .data/experiments/actual-ecommerce-noter/python/python.exe -X utf8 experiments/uint8-gx/run.py
```

The script writes its reproducible result under `.data/experiments/uint8-gx/`.
The Python packages are deliberately kept outside the project source tree in
`.data/experiments/uint8-gx-dependencies/`.
