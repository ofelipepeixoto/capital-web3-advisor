"""Small public-repository check; not a comprehensive secret/security scanner."""
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
excluded = {".git", "__pycache__", ".venv", "node_modules"}
errors = []
count = 0
for path in ROOT.rglob("*"):
    if not path.is_file() or excluded.intersection(path.relative_to(ROOT).parts):
        continue
    if path.name.startswith(".env") and path.name != ".env.example":
        errors.append(f"Unversionable environment file: {path.relative_to(ROOT)}")
    if path.suffix in {".pyc", ".sqlite", ".db", ".pem"}:
        errors.append(f"Unexpected binary/private file: {path.relative_to(ROOT)}")
    try:
        content = path.read_text(encoding="utf-8")
    except UnicodeError:
        errors.append(f"Unexpected binary: {path.relative_to(ROOT)}")
        continue
    if path.suffix == ".json":
        json.loads(content)
        count += 1
        if "n8n/workflows" in path.as_posix():
            workflow = json.loads(content)
            if workflow.get("active") is not False:
                errors.append(f"Workflow must remain inactive: {path.name}")
            if any(node.get("credentials") for node in workflow.get("nodes", [])):
                errors.append(f"Embedded credentials: {path.name}")
    if re.search(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----", content):
        errors.append(f"Private key marker: {path.relative_to(ROOT)}")
if errors:
    raise SystemExit("\n".join(errors))
print(f"Public-file check passed; {count} JSON files parsed. Limited structural inspection.")
