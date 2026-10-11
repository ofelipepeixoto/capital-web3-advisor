"""Deterministic, read-only portfolio and AMM analytics.

All monetary inputs are finite decimal *strings*, never Python floats or bools.
Portfolio prices must carry UTC-aware timestamps. Missing, future or stale
prices fail closed. An ``exposure_id`` identifies one economic claim, not a
token ticker: a receipt and its represented underlying must share this ID and
must not both be included. Callers still need trustworthy look-through data;
different IDs cannot prove that two claims are economically independent.

No function selects assets, signs transactions, forecasts returns, or invokes
an AI model. Debt quantities must already include accrued interest. All prices
in a portfolio must use the specified reporting currency.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, localcontext
import re


_NUMBER = re.compile(r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?\Z")
_MAX_ITEMS = 10_000
_EXACT_PRECISION = 1024
_AMM_PRECISION = 160
_DIMENSIONS = {"token_id", "network", "protocol", "issuer", "bridge", "custodian", "strategy"}


class RiskValidationError(ValueError):
    """Invalid inputs or insufficient evidence; ``code`` is machine-readable."""

    def __init__(self, message: str, code: str = "invalid_input") -> None:
        super().__init__(message)
        self.code = code


def _decimal(value: object, field: str, *, positive: bool = False,
             nonnegative: bool = False) -> Decimal:
    if not isinstance(value, str) or len(value) > 220 or not _NUMBER.fullmatch(value):
        raise RiskValidationError(f"{field} must be a finite decimal string")
    try:
        result = Decimal(value)
    except InvalidOperation as exc:
        raise RiskValidationError(f"invalid {field}") from exc
    if not result.is_finite():
        raise RiskValidationError(f"{field} must be finite")
    # Bound resource use and preserve exact portfolio arithmetic in our context.
    decimal_tuple = result.as_tuple()
    if (len(decimal_tuple.digits) > 100 or not -199 <= decimal_tuple.exponent <= 100
            or (result and not -100 <= result.adjusted() <= 100)):
        raise RiskValidationError(f"{field} exceeds supported decimal bounds")
    if positive and result <= 0:
        raise RiskValidationError(f"{field} must be greater than zero")
    if nonnegative and result < 0:
        raise RiskValidationError(f"{field} must be nonnegative")
    return result


def _string(value: Decimal) -> str:
    if not value.is_finite():
        raise RiskValidationError("calculation produced a nonfinite value")
    if value == 0:
        return "0"
    text = format(value, "f")
    return text.rstrip("0").rstrip(".") if "." in text else text


def _identifier(value: object, field: str) -> str:
    if not isinstance(value, str) or not value or value != value.strip() or len(value) > 256:
        raise RiskValidationError(f"{field} must be a nonempty, trimmed string")
    return value


def _timestamp(value: object, field: str) -> datetime:
    if not isinstance(value, str) or len(value) > 64:
        raise RiskValidationError(f"{field} must be an ISO 8601 timestamp")
    try:
        result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise RiskValidationError(f"invalid {field} timestamp") from exc
    if result.tzinfo is None or result.utcoffset() is None:
        raise RiskValidationError(f"{field} must include a timezone")
    return result.astimezone(timezone.utc)


def _age_limit(max_age_seconds: object) -> timedelta:
    if isinstance(max_age_seconds, bool) or not isinstance(max_age_seconds, int):
        raise RiskValidationError("max_age_seconds must be an integer")
    if not 0 <= max_age_seconds <= 31_536_000:
        raise RiskValidationError("max_age_seconds must be between 0 and one year")
    return timedelta(seconds=max_age_seconds)


def _records(items: object, label: str) -> list[dict]:
    if isinstance(items, (str, bytes)) or not isinstance(items, Sequence):
        raise RiskValidationError(f"{label} must be a sequence of records")
    if len(items) > _MAX_ITEMS:
        raise RiskValidationError(f"too many {label}")
    output = []
    for index, item in enumerate(items):
        if not isinstance(item, Mapping):
            raise RiskValidationError(f"{label}[{index}] must be a record")
        record = {
            "exposure_id": _identifier(item.get("exposure_id"), "exposure_id"),
            "token_id": _identifier(item.get("token_id"), "token_id"),
            "quantity": _decimal(item.get("quantity"), "quantity", nonnegative=True),
        }
        for field in _DIMENSIONS - {"token_id"}:
            if field in item:
                record[field] = _identifier(item[field], field)
        if "kind" in item:
            record["kind"] = _identifier(item["kind"], "kind")
        output.append(record)
    return output


def _prepare(positions: object, debts: object, prices: object, *, as_of: str,
             max_age_seconds: int, currency: str) -> tuple[list[dict], list[dict], dict[str, Decimal], str]:
    at = _timestamp(as_of, "as_of")
    limit = _age_limit(max_age_seconds)
    currency = _identifier(currency, "currency")
    if not isinstance(prices, Mapping):
        raise RiskValidationError("prices must be a mapping keyed by token_id")
    assets, liabilities = _records(positions, "positions"), _records(debts, "debts")
    seen: set[str] = set()
    for record in assets + liabilities:
        exposure = record["exposure_id"]
        if exposure in seen:
            raise RiskValidationError(
                f"duplicate economic exposure_id: {exposure}; include one representation only",
                "duplicate_exposure",
            )
        seen.add(exposure)
    values: dict[str, Decimal] = {}
    for token_id in sorted({record["token_id"] for record in assets + liabilities}):
        quote = prices.get(token_id)
        if quote is None:
            raise RiskValidationError(f"missing price for {token_id}", "missing_price")
        if not isinstance(quote, Mapping):
            raise RiskValidationError(f"price for {token_id} must be a timestamped record")
        value = _decimal(quote.get("value"), f"price[{token_id}]", positive=True)
        observed = _timestamp(quote.get("observed_at"), f"observed_at[{token_id}]")
        if observed > at:
            raise RiskValidationError(f"future price for {token_id}", "future_price")
        if at - observed > limit:
            raise RiskValidationError(f"stale price for {token_id}", "stale_price")
        if "currency" in quote and quote["currency"] != currency:
            raise RiskValidationError(f"currency mismatch for {token_id}", "currency_mismatch")
        values[token_id] = value
    return assets, liabilities, values, at.isoformat().replace("+00:00", "Z")


def _value_records(records: list[dict], values: dict[str, Decimal]) -> tuple[list[dict], Decimal]:
    total = Decimal(0)
    output = []
    for record in records:
        value = record["quantity"] * values[record["token_id"]]
        total += value
        rendered = {key: (_string(val) if isinstance(val, Decimal) else val)
                    for key, val in record.items()}
        rendered.update(price=_string(values[record["token_id"]]), value=_string(value))
        output.append(rendered)
    return output, total


def _nav(assets: list[dict], debts: list[dict], values: dict[str, Decimal],
         as_of: str, currency: str) -> dict:
    with localcontext() as context:
        context.prec = _EXACT_PRECISION
        positions, total_assets = _value_records(assets, values)
        liabilities, total_debts = _value_records(debts, values)
        return {
            "as_of": as_of, "currency": currency, "total_assets": _string(total_assets),
            "total_debts": _string(total_debts), "nav": _string(total_assets - total_debts),
            "positions": positions, "debts": liabilities,
        }


def calculate_nav(positions: Sequence[Mapping], debts: Sequence[Mapping], prices: Mapping,
                  *, as_of: str, max_age_seconds: int = 300, currency: str = "USD") -> dict:
    """Value assets minus debt using fresh timestamped quotes, or raise.

    Each record requires ``exposure_id``, ``token_id`` and decimal-string
    ``quantity`` >= 0. Optional dimensions: network, protocol, issuer, bridge,
    custodian, strategy. ``prices[token_id]`` requires decimal-string ``value``
    > 0 and timezone-aware ISO ``observed_at``; optional ``currency`` must match.
    ``as_of`` is the explicit analysis clock; timestamps after it are rejected.
    The inclusive maximum quote age is ``max_age_seconds`` (default 300).
    Independent assets and debt need distinct IDs. Wrapped/receipt look-through
    aliases must use the same ID to reject double-counting. Negative NAV is valid.
    """
    assets, liabilities, values, timestamp = _prepare(
        positions, debts, prices, as_of=as_of, max_age_seconds=max_age_seconds, currency=currency)
    return _nav(assets, liabilities, values, timestamp, currency)


def concentration(positions: Sequence[Mapping], prices: Mapping, *, as_of: str,
                  max_age_seconds: int = 300, currency: str = "USD",
                  dimension: str = "token_id") -> dict:
    """Return concentration against gross asset value, never net NAV.

    ``dimension`` is token_id/network/protocol/issuer/bridge/custodian/strategy.
    Missing metadata stays explicit in the ``unclassified`` group and in
    ``unclassified_value``. Group weights sum to one for nonzero portfolios.
    Shared dependencies must be populated by the caller; this function does not
    infer issuers or assign safety ratings. Fresh-price rules match calculate_nav.
    """
    if not isinstance(dimension, str) or dimension not in _DIMENSIONS:
        raise RiskValidationError("unsupported concentration dimension")
    assets, _, values, timestamp = _prepare(
        positions, [], prices, as_of=as_of, max_age_seconds=max_age_seconds, currency=currency)
    with localcontext() as context:
        context.prec = _EXACT_PRECISION
        grouped: dict[str, Decimal] = {}
        unclassified = Decimal(0)
        total = Decimal(0)
        for record in assets:
            value = record["quantity"] * values[record["token_id"]]
            group = record.get(dimension)
            if group is None:
                group = "unclassified"
                unclassified += value
            grouped[group] = grouped.get(group, Decimal(0)) + value
            total += value
        groups = []
        for group, value in sorted(grouped.items(), key=lambda item: (-item[1], item[0])):
            # Ratio outputs use bounded analytical precision, exact totals above.
            with localcontext() as ratio_context:
                ratio_context.prec = _AMM_PRECISION
                weight = value / total if total else Decimal(0)
                groups.append({"group": group, "value": _string(value),
                               "weight": _string(weight), "percent": _string(weight * 100)})
        return {"as_of": timestamp, "currency": currency, "dimension": dimension,
                "denominator": "gross_asset_value", "total_assets": _string(total),
                "unclassified_value": _string(unclassified), "groups": groups}


def stress_scenario(positions: Sequence[Mapping], debts: Sequence[Mapping], prices: Mapping,
                    shocks: Mapping, *, as_of: str, max_age_seconds: int = 300,
                    currency: str = "USD") -> dict:
    """Apply deterministic fractional price shocks to both assets and debt.

    ``shocks[token_id] = '-0.50'`` means a 50% price decline; ``'1'`` means
    doubling; ``'-1'`` models total value loss. Shocks below -1 or for an unknown
    portfolio token fail. Unspecified tokens retain their base quote. Freshness
    is checked on all base quotes before any scenario calculation. Synthetic
    zero prices are allowed only inside stress results. This is a static mark-to-
    market scenario, NOT a probability, forecast or liquidation/AMM-path model.
    LPs and nonlinear derivatives must be repriced by their own model first.
    """
    assets, liabilities, values, timestamp = _prepare(
        positions, debts, prices, as_of=as_of, max_age_seconds=max_age_seconds, currency=currency)
    if not isinstance(shocks, Mapping):
        raise RiskValidationError("shocks must be a mapping keyed by token_id")
    changes: dict[str, Decimal] = {}
    for token_id, shock in shocks.items():
        _identifier(token_id, "shock token_id")
        if token_id not in values:
            raise RiskValidationError(f"shock token not in portfolio: {token_id}")
        parsed = _decimal(shock, f"shock[{token_id}]")
        if parsed < -1:
            raise RiskValidationError("price shocks cannot be below -100%")
        changes[token_id] = parsed
    with localcontext() as context:
        context.prec = _EXACT_PRECISION
        stressed = {token: price * (1 + changes.get(token, Decimal(0)))
                    for token, price in values.items()}
        base = _nav(assets, liabilities, values, timestamp, currency)
        scenario = _nav(assets, liabilities, stressed, timestamp, currency)
        change = Decimal(scenario["nav"]) - Decimal(base["nav"])
        return {"model": "static_price_stress", "base": base, "scenario": scenario,
                "shocks": {token: _string(change) for token, change in sorted(changes.items())},
                "nav_change": _string(change), "probability": None}


def classic_il(price_ratio: str) -> dict:
    """Compute 2*sqrt(r)/(1+r)-1 for a full-range 50/50 constant-product LP.

    ``r`` is final/initial *relative* token price, > 0. No fees, flows, rewards,
    taxes, gas or rebalance. ``il_fraction`` compares LP value to holding the
    initial assets; negative values mean underperformance, not necessarily an
    absolute cash loss. ``divergence_loss_fraction`` uses the positive convention.
    Decimal square roots/division use 160 significant digits.
    """
    ratio = _decimal(price_ratio, "price_ratio", positive=True)
    with localcontext() as context:
        context.prec = _AMM_PRECISION
        relative_value = 2 * ratio.sqrt() / (1 + ratio)
        il = relative_value - 1
        return {"model": "constant_product_50_50_fee_free", "price_ratio": _string(ratio),
                "lp_over_hold": _string(relative_value), "il_fraction": _string(il),
                "il_percent": _string(il * 100), "divergence_loss_fraction": _string(-il)}


def _clamm_parameters(price: str, lower_price: str, upper_price: str,
                      liquidity: str) -> tuple[Decimal, Decimal, Decimal, Decimal]:
    p = _decimal(price, "price", positive=True)
    lower = _decimal(lower_price, "lower_price", positive=True)
    upper = _decimal(upper_price, "upper_price", positive=True)
    amount = _decimal(liquidity, "liquidity", positive=True)
    if lower >= upper:
        raise RiskValidationError("lower_price must be less than upper_price")
    return p, lower, upper, amount


def _inventory(price: Decimal, lower: Decimal, upper: Decimal,
               liquidity: Decimal) -> tuple[Decimal, Decimal, str]:
    bounded = min(max(price, lower), upper)
    root, root_lower, root_upper = bounded.sqrt(), lower.sqrt(), upper.sqrt()
    token0 = liquidity * (1 / root - 1 / root_upper)
    token1 = liquidity * (root - root_lower)
    status = "below" if price < lower else "above" if price >= upper else "inside"
    return token0, token1, status


def clamm_inventory(price: str, lower_price: str, upper_price: str, liquidity: str) -> dict:
    """Inventory for one fee-free constant-product concentrated position.

    Price is token1 per token0; range is [lower_price, upper_price). Liquidity L
    must be in units consistent with these normalized prices and amounts, NOT
    a raw on-chain integer mixed with human prices. For q=clamp(p,a,b),
    x=L*(1/sqrt(q)-1/sqrt(b)); y=L*(sqrt(q)-sqrt(a)). Below the range all
    principal is token0; at/above its upper bound all is token1. No swaps fees
    accrue out of range; existing accrued fees are excluded from this model.
    This continuous analytical model does not reproduce tick rounding, hooks,
    dynamic fees or protocol execution. Arithmetic uses 160 significant digits.
    """
    p, lower, upper, amount = _clamm_parameters(price, lower_price, upper_price, liquidity)
    with localcontext() as context:
        context.prec = _AMM_PRECISION
        token0, token1, status = _inventory(p, lower, upper, amount)
        return {"price": _string(p), "lower_price": _string(lower), "upper_price": _string(upper),
                "liquidity": _string(amount), "token0": _string(token0), "token1": _string(token1),
                "value_token1": _string(token0 * p + token1), "range_status": status,
                "active": status == "inside"}


def simulate_clamm(initial_price: str, final_price: str, lower_price: str,
                   upper_price: str, liquidity: str) -> dict:
    """Compare a static CLAMM position with HODL of its exact initial inventory.

    Inputs/units/precision match clamm_inventory. Both initial and final price
    may be outside the range. HODL is x_initial*final_price+y_initial; it is NOT
    assumed 50/50. No fees, incentives, costs, deposits, withdrawals or active
    rebalancing. Outputs are relative opportunity cost, not an absolute-loss
    promise. Positive prices and liquidity guarantee a positive benchmark.
    """
    initial, lower, upper, amount = _clamm_parameters(
        initial_price, lower_price, upper_price, liquidity)
    final = _decimal(final_price, "final_price", positive=True)
    with localcontext() as context:
        context.prec = _AMM_PRECISION
        x0, y0, _ = _inventory(initial, lower, upper, amount)
        x1, y1, _ = _inventory(final, lower, upper, amount)
        lp_value = final * x1 + y1
        hold_value = final * x0 + y0
        relative = lp_value / hold_value
        il = relative - 1
        return {"model": "concentrated_constant_product_fee_free",
                "initial": clamm_inventory(initial_price, lower_price, upper_price, liquidity),
                "final": clamm_inventory(final_price, lower_price, upper_price, liquidity),
                "hold_value_token1": _string(hold_value), "lp_value_token1": _string(lp_value),
                "lp_over_hold": _string(relative), "il_fraction": _string(il),
                "il_percent": _string(il * 100), "value_vs_hold_token1": _string(lp_value - hold_value)}
