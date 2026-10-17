PYTHON ?= python3

.PHONY: test check demo mcp
test:
	$(PYTHON) -m unittest discover -s tests -v
check: test
	$(PYTHON) scripts/check_repository.py
	@if test -f tests/test_ui_session.cjs; then node tests/test_ui_session.cjs; fi
	node tests/test_ui_context.cjs
	@if test -f tests/test_api_staging.mjs; then node --test tests/test_api_staging.mjs; fi
	node --test tests/test_staging_client.mjs
	node --test tests/test_cofre.mjs tests/test_cofre_api.mjs tests/test_cofre_ui.mjs
demo:
	$(PYTHON) -m capital_web3.server
mcp:
	$(PYTHON) -m capital_web3.mcp
