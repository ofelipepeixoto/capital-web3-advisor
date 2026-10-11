"""Run repository SQL against the disposable CLI database, without logging keys."""
import json
import os
from pathlib import Path
import subprocess
from urllib.parse import urlparse, unquote

root = Path(__file__).resolve().parents[1]
status = json.loads(Path(os.environ["CAPITAL_SUPABASE_STATUS_FILE"]).read_text())
url = urlparse(status["DB_URL"])
if url.hostname not in {"127.0.0.1", "localhost"} or url.port != 54322:
    raise SystemExit("Refusing a database outside disposable loopback Supabase")
env = {**os.environ, "PGPASSWORD": unquote(url.password or ""),
       "PGHOST": url.hostname, "PGPORT": str(url.port),
       "PGUSER": unquote(url.username or ""), "PGDATABASE": url.path.lstrip("/")}
for path in sorted((root / "supabase/tests").glob("*.sql")):
    print(f"Running transactional SQL suite: {path.name}", flush=True)
    subprocess.run(["psql", "-X", "-v", "ON_ERROR_STOP=1", "-f", str(path)],
                   env=env, check=True)
