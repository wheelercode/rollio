Rollio optimal-play debug UI

Files:
- Replace client.html
- Replace scripts/app.js
- Add scripts/solver-debug.js
- Add styles/solver-debug.css
- Add export_solver_data.py

Then run:
python export_solver_data.py

This creates:
solver_data/solution.json

Keep serving the project through Live Server as before. The debug panel reads the JSON tables directly in the browser and shows:
- optimal scoring dice selection
- optimal next decision: ROLL or BANK
- resulting turn score
- expected Roll/Bank actions remaining

The JSON export is generated from the persistent solution.pkl and does not recompute the solver.
