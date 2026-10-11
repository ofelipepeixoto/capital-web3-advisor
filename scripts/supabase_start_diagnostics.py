"""Emit fixed diagnostic categories, never raw CLI logs or credentials."""
from pathlib import Path
import re
import sys

data = Path(sys.argv[1]).read_text(errors="replace")
categories = {
    "image download": r"failed to pull|pull access denied|manifest unknown|toomanyrequests",
    "network connection": r"connection refused|dial tcp|network.*unreachable|TLS handshake",
    "startup timeout": r"timed out|timeout|deadline exceeded",
    "service health": r"unhealthy|health check failed|failed.*healthy",
    "port conflict": r"address already in use|port is already allocated",
    "migration syntax": r"syntax error",
    "missing SQL relation": r"relation .* does not exist",
    "SQL permissions": r"permission denied",
    "disk capacity": r"no space left|disk.*full",
}
found = [name for name, pattern in categories.items() if re.search(pattern, data, re.I)]
print("Disposable startup diagnostic categories: " + (", ".join(found) or "unclassified"))
states = sorted(set(re.findall(r"SQLSTATE\s+([A-Z0-9]{5})\b", data)))
if states:
    print("Database SQLSTATE: " + ", ".join(states))
for phase in ("Starting database", "Applying migration", "Starting containers", "Waiting for health"):
    if phase.lower() in data.lower():
        print("Observed startup phase: " + phase)
