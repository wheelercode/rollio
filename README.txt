Complete replacement files based on:
wheelercode/rollio
branch: optimal_play_ui
base SHA: aff4376e45da81c7c07b1b5f62dfb9bd2a6c1708

Replace:
- game.py
- solver.py
- scripts/solver-debug.js

Then remove the old incompatible solver data and recompute:

Remove-Item .\solver_data -Recurse -Force
python solver.py
python export_solver_data.py

The new solver format is version 3.

Rule:
A roll is a Rollio when it has no scoring selection that keeps the
turn score at or below target_score - player_score.
