PYTHON ?= python3

.PHONY: test check demo mcp
test:
	$(PYTHON) -m unittest discover -s tests -v
check: test
	$(PYTHON) scripts/check_repository.py
	@if test -f tests/test_ui_session.cjs; then node tests/test_ui_session.cjs; fi
demo:
	$(PYTHON) -m capital_web3.server
mcp:
	$(PYTHON) -m capital_web3.mcp
