"""Economic invariants and fail-closed boundaries for deterministic analytics."""

import json
from decimal import Decimal
import unittest

from capital_web3.risk import (
    RiskValidationError, calculate_nav, classic_il, clamm_inventory,
    concentration, simulate_clamm, stress_scenario,
)


NOW = "2026-10-11T02:00:00Z"


def record(exposure, token, quantity, **metadata):
    return {"exposure_id": exposure, "token_id": token, "quantity": quantity, **metadata}


def quote(value, observed_at=NOW, **metadata):
    return {"value": value, "observed_at": observed_at, **metadata}


class PortfolioTests(unittest.TestCase):
    def setUp(self):
        self.positions = [record("btc-wallet", "btc", "0.1", network="bitcoin"),
                          record("usdc-wallet", "usdc", "1000", network="ethereum")]
        self.debts = [record("usdc-debt", "usdc", "500")]
        self.prices = {"btc": quote("60000"), "usdc": quote("1")}

    def test_nav_subtracts_debt_and_is_json_serializable(self):
        result = calculate_nav(self.positions, self.debts, self.prices, as_of=NOW)
        self.assertEqual(result["total_assets"], "7000")
        self.assertEqual(result["total_debts"], "500")
        self.assertEqual(result["nav"], "6500")
        self.assertEqual(json.loads(json.dumps(result)), result)

    def test_receipt_and_underlying_double_count_is_rejected(self):
        positions = [record("aave-deposit", "usdc", "100", kind="underlying"),
                     record("aave-deposit", "ausdc", "100", kind="receipt")]
        with self.assertRaises(RiskValidationError) as caught:
            calculate_nav(positions, [], {"usdc": quote("1"), "ausdc": quote("1")}, as_of=NOW)
        self.assertEqual(caught.exception.code, "duplicate_exposure")

    def test_distinct_claims_in_same_asset_are_not_collapsed(self):
        result = calculate_nav([record("one", "usdc", "100"), record("two", "usdc", "100")],
                               [], self.prices, as_of=NOW)
        self.assertEqual(result["nav"], "200")

    def test_missing_and_stale_debt_quotes_fail_closed(self):
        for prices, code in [({"btc": quote("60000")}, "missing_price"),
                             ({**self.prices, "usdc": quote("1", "2026-10-11T01:54:59Z")}, "stale_price")]:
            with self.subTest(code=code), self.assertRaises(RiskValidationError) as caught:
                calculate_nav(self.positions, self.debts, prices, as_of=NOW)
            self.assertEqual(caught.exception.code, code)

    def test_inclusive_freshness_boundary_timezone_and_future_quote(self):
        result = calculate_nav([record("one", "btc", "1")], [],
                               {"btc": quote("10", "2026-10-10T22:55:00-03:00")}, as_of=NOW)
        self.assertEqual(result["nav"], "10")
        with self.assertRaises(RiskValidationError) as caught:
            calculate_nav(self.positions, [], {**self.prices, "btc": quote("10", "2026-10-11T02:00:01Z")}, as_of=NOW)
        self.assertEqual(caught.exception.code, "future_price")

    def test_naive_timestamps_and_currency_mismatch_rejected(self):
        with self.assertRaises(RiskValidationError):
            calculate_nav(self.positions, [], self.prices, as_of="2026-10-11T02:00:00")
        with self.assertRaises(RiskValidationError) as caught:
            calculate_nav(self.positions, [], {**self.prices, "btc": quote("10", currency="EUR")}, as_of=NOW)
        self.assertEqual(caught.exception.code, "currency_mismatch")

    def test_invalid_numeric_values_and_bool_age_rejected(self):
        for value in [True, False, 1, 1.2, None, "NaN", "sNaN", "Infinity", "-Infinity", "", " 1", "1_0", "-1", "1e10000"]:
            with self.subTest(value=value), self.assertRaises(RiskValidationError):
                calculate_nav([record("x", "btc", value)], [], self.prices, as_of=NOW)
        with self.assertRaises(RiskValidationError):
            calculate_nav(self.positions, [], self.prices, as_of=NOW, max_age_seconds=True)
        for value in ["0", "-1", True, "NaN"]:
            with self.subTest(price=value), self.assertRaises(RiskValidationError):
                calculate_nav([record("x", "btc", "1")], [], {"btc": quote(value)}, as_of=NOW)

    def test_small_amounts_remain_exact_and_negative_nav_is_valid(self):
        result = calculate_nav([record("one", "x", "0.123456789123456789")],
                               [record("debt", "x", "1")], {"x": quote("0.123456789123456789")}, as_of=NOW)
        self.assertEqual(result["total_assets"], "0.015241578780673678515622620750190521")
        self.assertEqual(result["nav"], "-0.108215210342783110484377379249809479")
        self.assertLess(Decimal(result["nav"]), 0)

    def test_concentration_uses_gross_assets_and_exposes_unclassified(self):
        result = concentration(self.positions, self.prices, as_of=NOW, dimension="network")
        self.assertEqual(result["denominator"], "gross_asset_value")
        self.assertEqual(result["total_assets"], "7000")
        self.assertEqual(result["groups"][0]["group"], "bitcoin")
        with self.assertRaises(RiskValidationError):
            concentration(self.positions, self.prices, as_of=NOW, dimension="not-a-dimension")
        incomplete = concentration(self.positions, self.prices, as_of=NOW, dimension="issuer")
        self.assertEqual(incomplete["unclassified_value"], "7000")
        self.assertEqual(incomplete["groups"][0]["weight"], "1")

    def test_stress_marks_assets_and_debts_with_same_prices(self):
        result = stress_scenario(self.positions, self.debts, self.prices,
                                 {"btc": "-0.5", "usdc": "-0.1"}, as_of=NOW)
        self.assertEqual(result["scenario"]["total_assets"], "3900")
        self.assertEqual(result["scenario"]["total_debts"], "450")
        self.assertEqual(result["scenario"]["nav"], "3450")
        self.assertEqual(result["nav_change"], "-3050")
        self.assertIsNone(result["probability"])
        json.dumps(result)

    def test_total_loss_stress_and_invalid_shocks(self):
        result = stress_scenario([record("one", "btc", "1")], [], self.prices, {"btc": "-1"}, as_of=NOW)
        self.assertEqual(result["scenario"]["nav"], "0")
        for shocks in [{"btc": "-1.01"}, {"btcc": "-0.5"}, {"btc": True}]:
            with self.subTest(shocks=shocks), self.assertRaises(RiskValidationError):
                stress_scenario(self.positions, [], self.prices, shocks, as_of=NOW)
        with self.assertRaises(RiskValidationError):
            stress_scenario(self.positions, [], {"btc": quote("60000", "2026-10-11T01:00:00Z"),
                                               "usdc": quote("1")}, {}, as_of=NOW)

    def test_extreme_supported_values_do_not_erase_small_claims(self):
        positions = [record("large", "x", "1e100"), record("small", "y", "1e-100")]
        prices = {"x": quote("1e100"), "y": quote("1e-100")}
        result = calculate_nav(positions, [], prices, as_of=NOW)
        self.assertEqual(result["nav"], "1" + "0" * 200 + "." + "0" * 199 + "1")
        scenario = stress_scenario(positions, [], prices, {"x": "1e100"}, as_of=NOW)
        self.assertTrue(scenario["scenario"]["nav"].endswith("." + "0" * 199 + "1"))

    def test_empty_portfolio_and_duplicate_liability_claim(self):
        self.assertEqual(calculate_nav([], [], {}, as_of=NOW)["nav"], "0")
        self.assertEqual(concentration([], {}, as_of=NOW)["groups"], [])
        with self.assertRaises(RiskValidationError) as caught:
            calculate_nav([record("same", "usdc", "100")], [record("same", "usdc", "100")],
                          self.prices, as_of=NOW)
        self.assertEqual(caught.exception.code, "duplicate_exposure")


class AMMTests(unittest.TestCase):
    def assertDecimalClose(self, actual, expected, tolerance="1e-40"):
        self.assertLessEqual(abs(Decimal(actual) - Decimal(expected)), Decimal(tolerance))

    def test_classic_il_identity_doubling_quadrupling_and_symmetry(self):
        self.assertEqual(classic_il("1")["il_fraction"], "0")
        self.assertDecimalClose(classic_il("2")["il_fraction"], "-0.0571909584179366341322075171935346142868854164154")
        self.assertEqual(classic_il("4")["il_fraction"], "-0.2")
        self.assertEqual(classic_il("2")["il_fraction"], classic_il("0.5")["il_fraction"])

    def test_clamm_inventory_inside_and_both_outside_boundaries(self):
        # Range sqrt bounds 1 and 3; current sqrt price 2; L=6.
        inside = clamm_inventory("4", "1", "9", "6")
        self.assertDecimalClose(inside["token0"], "1")
        self.assertEqual(inside["token1"], "6")
        self.assertDecimalClose(inside["value_token1"], "10")
        self.assertTrue(inside["active"])
        below = clamm_inventory("0.25", "1", "9", "6")
        self.assertDecimalClose(below["token0"], "4")
        self.assertEqual(below["token1"], "0")
        self.assertFalse(below["active"])
        above = clamm_inventory("16", "1", "9", "6")
        self.assertEqual(above["token0"], "0")
        self.assertEqual(above["token1"], "12")
        self.assertFalse(above["active"])
        self.assertTrue(clamm_inventory("1", "1", "9", "6")["active"])
        self.assertFalse(clamm_inventory("9", "1", "9", "6")["active"])

    def test_clamm_benchmark_uses_actual_initial_inventory(self):
        # Initial inventory is (1,6), NOT a 50/50 value mix (4,6).
        result = simulate_clamm("4", "16", "1", "9", "6")
        self.assertDecimalClose(result["hold_value_token1"], "22")
        self.assertEqual(result["lp_value_token1"], "12")
        self.assertDecimalClose(result["il_fraction"], "-0.45454545454545454545454545454545454545454545454545")
        self.assertEqual(result["final"]["range_status"], "above")
        below = simulate_clamm("4", "0.25", "1", "9", "6")
        self.assertDecimalClose(below["hold_value_token1"], "6.25")
        self.assertDecimalClose(below["lp_value_token1"], "1")
        self.assertDecimalClose(below["il_fraction"], "-0.84")
        json.dumps(result)

    def test_clamm_initial_outside_range_and_no_price_change(self):
        same = simulate_clamm("4", "4", "1", "9", "6")
        self.assertEqual(same["il_fraction"], "0")
        # Entire path outside range: inventory unchanged, identical to HODL.
        outside = simulate_clamm("16", "25", "1", "9", "6")
        self.assertEqual(outside["il_fraction"], "0")
        outside = simulate_clamm("0.25", "0.5", "1", "9", "6")
        self.assertEqual(outside["il_fraction"], "0")

    def test_amm_numeric_and_range_validation(self):
        for value in [True, "NaN", "Infinity", "0", "-1", 2.0]:
            with self.subTest(value=value), self.assertRaises(RiskValidationError):
                classic_il(value)
            with self.subTest(price=value), self.assertRaises(RiskValidationError):
                clamm_inventory(value, "1", "9", "6")
        for lower, upper, liquidity in [("9", "1", "6"), ("1", "1", "6"),
                                         ("0", "9", "6"), ("1", "9", "0"), ("1", "9", True)]:
            with self.subTest(bounds=(lower, upper, liquidity)), self.assertRaises(RiskValidationError):
                simulate_clamm("4", "16", lower, upper, liquidity)

    def test_narrow_supported_range_keeps_positive_inventory_and_benchmark(self):
        upper = "1." + "0" * 98 + "1"
        result = simulate_clamm("1", upper, "1", upper, "1")
        self.assertGreater(Decimal(result["initial"]["token0"]), 0)
        self.assertGreater(Decimal(result["hold_value_token1"]), 0)
        self.assertGreater(Decimal(result["final"]["token1"]), 0)
        self.assertEqual(result["final"]["token0"], "0")


if __name__ == "__main__":
    unittest.main()
