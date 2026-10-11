import copy
import io
import json
import unittest

from capital_web3.mcp import FIXTURE_ID, LocalMCPServer, run


class MCPTests(unittest.TestCase):
    def setUp(self):
        self.server = LocalMCPServer()
        self.counter = 0

    def request(self, method, params=None):
        self.counter += 1
        return self.server.handle({"jsonrpc": "2.0", "id": self.counter, "method": method, "params": params or {}})

    def ready(self):
        response = self.request("initialize", {
            "protocolVersion": "2025-06-18", "capabilities": {},
            "clientInfo": {"name": "local-unit-test", "version": "0.1.0"},
        })
        self.assertIn("result", response)
        self.assertIsNone(self.server.handle({"jsonrpc": "2.0", "method": "notifications/initialized"}))

    def call(self, name, arguments):
        return self.request("tools/call", {"name": name, "arguments": arguments})

    def test_initialization_required_and_listing_has_only_readonly_tools(self):
        self.assertIn("error", self.request("tools/list"))
        self.ready()
        tools = self.request("tools/list")["result"]["tools"]
        self.assertEqual({t["name"] for t in tools}, {"get_wallet_positions", "simulate_lp_scenarios", "simulate_portfolio_stress"})
        for tool in tools:
            self.assertIs(tool["annotations"]["readOnlyHint"], True)
            self.assertIs(tool["inputSchema"]["additionalProperties"], False)
            self.assertEqual(set(tool["inputSchema"]["properties"]), set(tool["inputSchema"]["required"]))

    def test_fixture_only_no_live_client_wallet(self):
        self.ready()
        response = self.call("get_wallet_positions", {"fixture_id": FIXTURE_ID})
        self.assertIs(response["result"]["isError"], False)
        self.assertEqual(response["result"]["structuredContent"]["mode"], "synthetic_fixture")
        self.assertEqual(response["result"]["structuredContent"]["positions"][0]["token_id"], "mock:BTC")
        for arguments in ({"wallet_address": "0x123"}, {"fixture_id": "real-client"}, {"fixture_id": FIXTURE_ID, "tenant_id": "B"}):
            self.assertEqual(self.call("get_wallet_positions", arguments)["error"]["code"], -32602)

    def test_transaction_and_unknown_tools_are_blocked(self):
        self.ready()
        for name in ("execute_trade", "sign_transaction", "send_transaction", "withdraw", "unknown", "get_wallet_positions;publish"):
            with self.subTest(name=name):
                self.assertEqual(self.call(name, {})["error"]["code"], -32602)

    def test_malicious_numeric_and_extra_args_are_blocked(self):
        self.ready()
        valid = {"initial_price": "1", "final_prices": ["2"], "lower_price": "0.25", "upper_price": "4", "liquidity": "100"}
        for bad in ("NaN", "Infinity", "1e99999999", "__import__('os').system('whoami')", True, 2, "-1", "0"):
            arguments = copy.deepcopy(valid); arguments["initial_price"] = bad
            self.assertEqual(self.call("simulate_lp_scenarios", arguments)["error"]["code"], -32602)
        extra = copy.deepcopy(valid); extra["execute"] = True
        self.assertEqual(self.call("simulate_lp_scenarios", extra)["error"]["code"], -32602)
        too_many = copy.deepcopy(valid); too_many["final_prices"] = ["1"] * 9
        self.assertEqual(self.call("simulate_lp_scenarios", too_many)["error"]["code"], -32602)

    def test_deterministic_scenarios_return_protocol_content(self):
        self.ready()
        lp = self.call("simulate_lp_scenarios", {"initial_price": "1", "final_prices": ["0.1", "1", "5"], "lower_price": "0.25", "upper_price": "4", "liquidity": "100"})
        self.assertNotIn("error", lp)
        self.assertIs(lp["result"]["isError"], False)
        self.assertEqual(len(lp["result"]["structuredContent"]["scenarios"]), 3)
        stress = self.call("simulate_portfolio_stress", {"btc_shock": "-0.5", "usd_shock": "0"})
        self.assertIs(stress["result"]["isError"], False)
        self.assertEqual(stress["result"]["content"][0]["type"], "text")
        self.assertEqual(json.loads(stress["result"]["content"][0]["text"]), stress["result"]["structuredContent"])

    def test_stdio_never_executes_notifications_and_handles_invalid_json(self):
        source = io.StringIO('\n'.join([
            '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}',
            '{"jsonrpc":"2.0","method":"notifications/initialized"}',
            '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"execute_trade","arguments":{}}}',
            '{"jsonrpc":"2.0","id":2,"method":"tools/list"}',
            '{"jsonrpc":"2.0","id":3,"id":4,"method":"tools/list"}',
            'not json',
        ])+'\n')
        output = io.StringIO(); run(source, output)
        messages = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual(len(messages), 4)
        self.assertIn("result", messages[0]); self.assertIn("tools", messages[1]["result"])
        self.assertEqual(messages[2]["error"]["code"], -32700)
        self.assertEqual(messages[3]["error"]["code"], -32700)

    def test_oversized_message_fails_and_next_request_remains_parseable(self):
        source = io.StringIO('x'*70000+'\n'+json.dumps({"jsonrpc":"2.0","id":7,"method":"tools/list"})+'\n')
        output = io.StringIO(); run(source, output)
        messages = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual(len(messages), 2)
        self.assertEqual(messages[0]["error"]["code"], -32600)
        self.assertEqual(messages[1]["id"], 7)


if __name__ == "__main__":
    unittest.main()
