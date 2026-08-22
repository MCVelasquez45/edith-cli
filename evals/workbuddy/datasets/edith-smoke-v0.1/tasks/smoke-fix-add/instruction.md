The repository in the current directory contains `calc.py` with two arithmetic
bugs:

1. `add(a, b)` currently subtracts instead of adding.
2. `average(values)` divides by a hard-coded `2` instead of `len(values)`.

Fix both bugs in `calc.py` so the functions behave as their names and
docstrings describe. Then run the test suite with `python -m pytest tests/ -q`
and confirm every test passes. Do not modify the tests.
