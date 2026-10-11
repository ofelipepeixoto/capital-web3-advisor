"""Local-only JSON-RPC/stdio MCP specimen over deterministic synthetic fixtures.

No client data, authentication, live provider, wallet signer, network transport,
paid inference or transaction capability is present. This limited implementation
has not been homologated with ChatGPT, the Responses API or an external MCP client.
"""

from __future__ import annotations

import copy
import json
import re
import sys
from decimal import Decimal, InvalidOperation
from typing import Any, TextIO

from . import risk


PROTOCOL_VERSION = "2025-06-18"
MAX_MESSAGE_CHARS = 65_536
FIXTURE_ID = "demo-wallet-001"
FIXTURE_AS_OF = "2026-10-11T00:00:00Z"
DECIMAL_PATTERN = r"^-?(?:0|[1-9][0-9]{0,17})(?:\.[0-9]{1,18})?$"
_DECIMAL_RE = re.compile(DECIMAL_PATTERN)

_POSITIONS = [
    {"exposure_id": "fixture-btc", "token_id": "mock:BTC", "quantity": "0.1"},
    {"exposure_id": "fixture-usd", "token_id": "mock:USD", "quantity": "4000"},
]
_DEBTS: list[dict[str, str]] = []
_PRICES = {
    "mock:BTC": {"value": "60000", "observed_at": FIXTURE_AS_OF},
    "mock:USD": {"value": "1", "observed_at": FIXTURE_AS_OF},
}


def _decimal_schema() -> dict[str, Any]:
    return {"type": "string", "pattern": DECIMAL_PATTERN, "maxLength": 38}


def _object_schema(properties: dict[str, Any]) -> dict[str, Any]:
    return {"type": "object", "properties": properties, "required": list(properties), "additionalProperties": False}


_TOOL_SPECS = [
    {
        "name": "get_wallet_positions",
        "description": "Return a fictitious local fixture, never an actual wallet or client's positions.",
        "inputSchema": _object_schema({"fixture_id": {"type": "string", "enum": [FIXTURE_ID]}}),
    },
    {
        "name": "simulate_lp_scenarios",
        "description": "Deterministic no-fee CLAMM scenarios from explicit decimal-string inputs; no trade.",
        "inputSchema": _object_schema({
            "initial_price": _decimal_schema(),
            "final_prices": {"type": "array", "minItems": 1, "maxItems": 8, "items": _decimal_schema()},
            "lower_price": _decimal_schema(),
            "upper_price": _decimal_schema(),
            "liquidity": _decimal_schema(),
        }),
    },
    {
        "name": "simulate_portfolio_stress",
        "description": "Stress the fixed fictitious portfolio using price shocks, not live client data.",
        "inputSchema": _object_schema({"btc_shock": _decimal_schema(), "usd_shock": _decimal_schema()}),
    },
]
for _tool in _TOOL_SPECS:
    _tool["annotations"] = {"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": False}


class InvalidArguments(ValueError):
    pass


def _exact_fields(value: Any, required: set[str], optional: set[str] | None = None) -> dict[str, Any]:
    if not isinstance(value, dict) or not required.issubset(value) or not set(value).issubset(required | (optional or set())):
        raise InvalidArguments("Missing or unexpected fields")
    return value


def _numeric(value: Any, *, nonnegative: bool = False, positive: bool = False) -> Decimal:
    if not isinstance(value, str) or len(value) > 38 or not _DECIMAL_RE.fullmatch(value):
        raise InvalidArguments("Only bounded plain decimal strings are accepted")
    try:
        number = Decimal(value)
    except InvalidOperation as error:
        raise InvalidArguments("Invalid decimal") from error
    if not number.is_finite() or (positive and number <= 0) or (nonnegative and number < 0):
        raise InvalidArguments("Decimal outside allowed domain")
    return number


def _tool_data(name: str, arguments: Any) -> dict[str, Any]:
    if name == "get_wallet_positions":
        args = _exact_fields(arguments, {"fixture_id"})
        if args["fixture_id"] != FIXTURE_ID or not isinstance(args["fixture_id"], str):
            raise InvalidArguments("Only the known synthetic fixture is available")
        return copy.deepcopy({
            "mode": "synthetic_fixture", "fixture_id": FIXTURE_ID, "as_of": FIXTURE_AS_OF,
            "positions": _POSITIONS, "debts": _DEBTS, "prices": _PRICES,
            "limitations": ["Not a blockchain query; no client identifiers or actual wallet addresses."],
        })
    if name == "simulate_lp_scenarios":
        args = _exact_fields(arguments, {"initial_price", "final_prices", "lower_price", "upper_price", "liquidity"})
        lower = _numeric(args["lower_price"], positive=True)
        upper = _numeric(args["upper_price"], positive=True)
        _numeric(args["initial_price"], positive=True)
        _numeric(args["liquidity"], nonnegative=True)
        if upper <= lower:
            raise InvalidArguments("upper_price must exceed lower_price")
        finals = args["final_prices"]
        if not isinstance(finals, list) or not 1 <= len(finals) <= 8:
            raise InvalidArguments("final_prices requires one to eight scenarios")
        for final in finals:
            _numeric(final, positive=True)
        return {
            "mode": "deterministic_local", "benchmark": "same_initial_tokens_hodl",
            "scenarios": [risk.simulate_clamm(args["initial_price"], final, args["lower_price"], args["upper_price"], args["liquidity"]) for final in finals],
            "limitations": ["No fees, rewards, gas, rebalance or hedge costs; normalized units are required."],
        }
    if name == "simulate_portfolio_stress":
        args = _exact_fields(arguments, {"btc_shock", "usd_shock"})
        for shock in args.values():
            amount = _numeric(shock)
            if not Decimal("-1") <= amount <= Decimal("10"):
                raise InvalidArguments("Synthetic price shocks must be between -1 and 10")
        return {
            "mode": "synthetic_fixture", "fixture_id": FIXTURE_ID,
            "result": risk.stress_scenario(
                copy.deepcopy(_POSITIONS), copy.deepcopy(_DEBTS), copy.deepcopy(_PRICES),
                {"mock:BTC": args["btc_shock"], "mock:USD": args["usd_shock"]},
                as_of=FIXTURE_AS_OF, currency="USD",
            ),
            "limitations": ["Only synthetic price shocks; no live portfolio or liquidation model."],
        }
    raise InvalidArguments("Unknown or forbidden tool")


def _error(request_id: Any, code: int, message: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}


def _result(request_id: Any, result: dict[str, Any]) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "result": result}


class LocalMCPServer:
    """Small stateful local specimen: initialize, initialized, list and call."""

    def __init__(self) -> None:
        self.initialized = False
        self.ready = False

    def handle(self, message: Any) -> dict[str, Any] | None:
        if not isinstance(message, dict):
            return _error(None, -32600, "Invalid request")
        request_id = message.get("id")
        if "id" in message and type(request_id) not in (str, int):
            return _error(None, -32600, "Invalid request identifier")
        has_id = "id" in message
        if message.get("jsonrpc") != "2.0" or not isinstance(message.get("method"), str) or set(message) - {"jsonrpc", "id", "method", "params"}:
            return _error(request_id, -32600, "Invalid request")
        method = message["method"]
        params = message.get("params", {})
        try:
            if method == "notifications/initialized" and not has_id:
                _exact_fields(params, set())
                if self.initialized:
                    self.ready = True
                return None
            if not has_id:
                # Notifications never invoke tools or create a response.
                return None
            if method == "initialize":
                if self.initialized:
                    return _error(request_id, -32600, "Already initialized")
                args = _exact_fields(params, {"protocolVersion", "capabilities", "clientInfo"})
                if not isinstance(args["protocolVersion"], str) or not isinstance(args["capabilities"], dict):
                    raise InvalidArguments("Invalid initialization")
                info = _exact_fields(args["clientInfo"], {"name", "version"}, {"title"})
                if not all(isinstance(item, str) and 0 < len(item) <= 100 for item in info.values()):
                    raise InvalidArguments("Invalid clientInfo")
                self.initialized = True
                return _result(request_id, {
                    "protocolVersion": PROTOCOL_VERSION, "capabilities": {"tools": {"listChanged": False}},
                    "serverInfo": {"name": "capital-web3-local-fixture", "version": "0.1.0"},
                    "instructions": "Local synthetic fixtures only. No authentication, live client data, paid API or execution. Not externally homologated.",
                })
            if not self.ready:
                return _error(request_id, -32000, "Complete initialize and notifications/initialized first")
            if method == "ping":
                _exact_fields(params, set())
                return _result(request_id, {})
            if method == "tools/list":
                _exact_fields(params, set())
                return _result(request_id, {"tools": copy.deepcopy(_TOOL_SPECS)})
            if method == "tools/call":
                args = _exact_fields(params, {"name", "arguments"})
                if not isinstance(args["name"], str) or args["name"] not in {item["name"] for item in _TOOL_SPECS}:
                    raise InvalidArguments("Unknown or forbidden tool")
                data = _tool_data(args["name"], args["arguments"])
                encoded = json.dumps(data, ensure_ascii=False, allow_nan=False, default=_json_decimal)
                # JSON roundtrip normalizes Decimal outputs to string quantities.
                structured = json.loads(encoded)
                return _result(request_id, {
                    "content": [{"type": "text", "text": encoded}],
                    "structuredContent": structured, "isError": False,
                })
            return _error(request_id, -32601, "Method not found")
        except InvalidArguments:
            return _error(request_id, -32602, "Invalid arguments: missing, unexpected or disallowed values")
        except (ValueError, ArithmeticError):
            return _result(request_id, {"content": [{"type": "text", "text": "Deterministic calculation rejected these inputs"}], "isError": True})
        except Exception:
            # Never expose source content, filesystem paths, secrets or tracebacks.
            return _error(request_id, -32603, "Internal local calculation error")


def _json_decimal(value: Any) -> str:
    if isinstance(value, Decimal) and value.is_finite():
        return format(value, "f")
    raise TypeError("Not a serializable deterministic result")


def _pairs_no_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON key")
        result[key] = value
    return result


def _reject_constant(value: str) -> None:
    raise ValueError("Non-finite JSON constant")


def run(stdin: TextIO | None = None, stdout: TextIO | None = None) -> None:
    """One newline-delimited JSON-RPC message per line; stdout stays protocol-only."""
    input_stream = stdin or sys.stdin
    output_stream = stdout or sys.stdout
    server = LocalMCPServer()
    while True:
        line = input_stream.readline(MAX_MESSAGE_CHARS + 1)
        if not line:
            break
        if len(line) > MAX_MESSAGE_CHARS:
            while line and not line.endswith("\n"):
                line = input_stream.readline(MAX_MESSAGE_CHARS + 1)
            response = _error(None, -32600, "Message exceeds local limit")
        else:
            try:
                message = json.loads(line, object_pairs_hook=_pairs_no_duplicates, parse_constant=_reject_constant)
                response = server.handle(message)
            except (json.JSONDecodeError, ValueError, RecursionError):
                response = _error(None, -32700, "Parse error")
        if response is not None:
            output_stream.write(json.dumps(response, ensure_ascii=False, allow_nan=False) + "\n")
            output_stream.flush()


if __name__ == "__main__":
    run()
