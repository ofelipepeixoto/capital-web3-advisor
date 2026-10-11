# Capital Web3

Read README.md and docs/architecture.md before implementation. This repository
is a synthetic local test environment, not a production financial service.

- No live financial operations, custody, seed phrases, signing or transaction execution.
- No real customer data, private annexes, API keys or secret .env files in public Git.
- Authorization, calculations and publication remain server controlled.
- Model output never approves or publishes a report.
- Each customer receives only the permitted, reviewed, published version.
- Keep live paid integrations disabled until persistent budgets and authorization exist.
- Run `make check`; explain any tests not executed, especially Supabase/n8n/cloud.
- Use coherent reviewable PRs; human review is required before merge or production.
- Do not silently change public-source licensing or cloud configuration.
