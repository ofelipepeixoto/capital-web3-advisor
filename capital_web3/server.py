"""Loopback-only synthetic test server. Never expose this demo to the internet."""
import argparse
import hmac
import json
import re
import secrets
import threading
import time
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from .service import AdvisoryService, ServiceError, resolve_demo_principal
from .adapters import MockAdvisorAdapter
from .risk import calculate_nav, classic_il, simulate_clamm, stress_scenario

WEB_ROOT = Path(__file__).resolve().parents[1] / "apps" / "web"
MAX_BODY = 32768
AS_OF = "2026-10-11T00:00:00Z"  # Fixed fixture clock, not a market quote.
POSITIONS = [
    {"exposure_id": "spot-btc", "token_id": "BTC", "quantity": "0.1"},
    {"exposure_id": "spot-usdc", "token_id": "USDC", "quantity": "5000"},
]
DEBTS = [{"exposure_id": "debt-usdc", "token_id": "USDC", "quantity": "1000"}]
PRICES = {"BTC": {"value": "100000", "observed_at": AS_OF},
          "USDC": {"value": "1", "observed_at": AS_OF}}


class DemoServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address=("127.0.0.1", 8765)):
        if address[0] != "127.0.0.1":
            raise ValueError("Demo may bind only to 127.0.0.1")
        self.service = AdvisoryService()
        self.sessions = {}
        self.session_lock = threading.RLock()
        super().__init__(address, Handler)


class HTTPError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


class Handler(BaseHTTPRequestHandler):
    server: DemoServer

    def setup(self):
        super().setup()
        self.connection.settimeout(5)

    def log_message(self, *_args):
        pass  # No session, document or user data in HTTP access logs.

    def _guard_host(self):
        port = self.server.server_address[1]
        allowed = {f"127.0.0.1:{port}", f"localhost:{port}"}
        if self.headers.get("Host") not in allowed:
            raise HTTPError(403, "Origem local necessária.")
        origin = self.headers.get("Origin")
        if origin and origin != f"http://{self.headers['Host']}":
            raise HTTPError(403, "Origem inválida.")
        if self.headers.get("Sec-Fetch-Site") == "cross-site":
            raise HTTPError(403, "Origem inválida.")

    def _response(self, status, body, content_type="application/json; charset=utf-8", headers=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False, allow_nan=False).encode()
        elif isinstance(body, str):
            body = body.encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def _json(self):
        if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
            raise HTTPError(415, "Envie JSON.")
        if self.headers.get("Transfer-Encoding"):
            raise HTTPError(400, "Transferência não suportada.")
        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise HTTPError(400, "Tamanho inválido.") from None
        if size <= 0 or size > MAX_BODY:
            raise HTTPError(413, "Tamanho inválido.")
        try:
            result = json.loads(self.rfile.read(size), parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
        except (ValueError, UnicodeError):
            raise HTTPError(400, "JSON inválido.") from None
        if not isinstance(result, dict):
            raise HTTPError(400, "Objeto JSON necessário.")
        return result

    def _session(self, csrf=False):
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
            token = cookie["cw3_demo"].value
        except (KeyError, ValueError):
            raise HTTPError(401, "Inicie uma sessão fictícia.") from None
        with self.server.session_lock:
            session = self.server.sessions.get(token)
            if not session or session["expires"] <= time.monotonic():
                self.server.sessions.pop(token, None)
                raise HTTPError(401, "Sessão expirada.")
            if csrf and not hmac.compare_digest(self.headers.get("X-CSRF-Token", ""), session["csrf"]):
                raise HTTPError(403, "Confirmação de sessão inválida.")
            return session, token

    def do_GET(self):
        self._handle("GET")

    def do_POST(self):
        self._handle("POST")

    def _handle(self, method):
        try:
            self._guard_host()
            self._route(method)
        except HTTPError as exc:
            self._response(exc.status, {"error": exc.message})
        except ServiceError as exc:
            self._response(exc.status_code, {"error": str(exc), "code": exc.code})
        except (ValueError, TypeError):
            self._response(400, {"error": "Entrada inválida."})
        except Exception:
            self._response(500, {"error": "Falha interna na demonstração."})

    def _route(self, method):
        url = urlsplit(self.path)
        if method == "GET" and url.path in {"/", "/app.js", "/styles.css"}:
            names = {"/": ("index.html", "text/html"), "/app.js": ("app.js", "text/javascript"), "/styles.css": ("styles.css", "text/css")}
            name, mime = names[url.path]
            self._response(200, (WEB_ROOT / name).read_bytes(), mime + "; charset=utf-8")
            return
        if method == "GET" and url.path == "/health":
            self._response(200, {"status": "ok", "mode": "synthetic-local", "live_integrations": False})
            return
        if method == "POST" and url.path == "/api/demo/session":
            if self.headers.get("X-Demo-Intent") != "local-testing":
                raise HTTPError(403, "Sessão local necessária.")
            data = self._json()
            if set(data) != {"persona"}:
                raise HTTPError(400, "Somente a persona fictícia é aceita.")
            principal = resolve_demo_principal(data["persona"])
            token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
            with self.server.session_lock:
                now = time.monotonic()
                self.server.sessions = {k: v for k, v in self.server.sessions.items() if v["expires"] > now}
                if len(self.server.sessions) >= 100:
                    raise HTTPError(429, "Limite local de sessões atingido.")
                self.server.sessions[token] = {"principal": principal, "csrf": csrf, "expires": now + 3600}
            self._response(200, {"subject": principal.subject, "role": principal.role, "csrf_token": csrf}, headers={"Set-Cookie": f"cw3_demo={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600"})
            return
        if not url.path.startswith("/api/"):
            raise HTTPError(404, "Recurso não disponível.")
        session, token = self._session(csrf=method == "POST")
        principal, service = session["principal"], self.server.service
        if method == "GET" and url.path == "/api/session":
            self._response(200, {"subject": principal.subject, "role": principal.role, "csrf_token": session["csrf"]})
        elif method == "POST" and url.path == "/api/logout":
            self._json()
            with self.server.session_lock:
                self.server.sessions.pop(token, None)
            self._response(200, {"ok": True}, headers={"Set-Cookie": "cw3_demo=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"})
        elif method == "GET" and url.path == "/api/cases":
            self._response(200, service.list_cases(principal))
        elif method == "GET" and url.path == "/api/reports":
            query = parse_qs(url.query)
            if set(query) - {"case_id"}:
                raise HTTPError(400, "Filtro inválido.")
            self._response(200, service.list_reports(principal, query.get("case_id", [None])[0]))
        elif method == "GET" and url.path == "/api/risk":
            if principal.role not in {"consultant", "reviewer"}:
                raise HTTPError(404, "Recurso não disponível.")
            self._response(200, {"mode": "synthetic", "as_of": AS_OF,
                "nav": calculate_nav(POSITIONS, DEBTS, PRICES, as_of=AS_OF),
                "stress": stress_scenario(POSITIONS, DEBTS, PRICES, {"BTC": "-0.5"}, as_of=AS_OF),
                "il_50_50": classic_il("2"), "clamm": simulate_clamm("100", "400", "80", "120", "100")})
        else:
            match = re.fullmatch(r"/api/reports/([a-z0-9-]+)(?:/(download|approve|publish|revoke|receipt|clarify))?", url.path)
            draft = re.fullmatch(r"/api/cases/([a-z0-9-]+)/draft", url.path)
            if draft and method == "POST":
                data = self._json()
                if data:
                    raise HTTPError(400, "O rascunho usa apenas fixtures do servidor.")
                # Permission check before creating or reading analysis context.
                allowed = service.list_cases(principal)
                if principal.role not in {"consultant", "reviewer"} or not any(c.get("id", c.get("case_id")) == draft[1] for c in allowed):
                    raise HTTPError(404, "Recurso não disponível.")
                payload = MockAdvisorAdapter().generate_report({"mode": "synthetic"}, request_id=secrets.token_hex(8), as_of=AS_OF)
                self._response(201, service.create_draft(principal, draft[1], payload))
            elif match:
                report_id, action = match.groups()
                if method == "GET" and action is None:
                    self._response(200, service.get_report(principal, report_id))
                elif method == "GET" and action == "download":
                    result = service.download_report(principal, report_id)
                    content = json.dumps(result["report"], ensure_ascii=False, indent=2).encode()
                    self._response(200, content, "application/json; charset=utf-8", {"Content-Disposition": f'attachment; filename="{report_id}.json"'})
                elif method == "POST" and action in {"approve", "publish", "revoke", "receipt", "clarify"}:
                    data = self._json()
                    expected = {"publish": {"recipients"}, "clarify": {"message"}}.get(action, set())
                    if set(data) != expected:
                        raise HTTPError(400, "Campos inválidos.")
                    functions = {"approve": lambda: service.approve_report(principal, report_id),
                        "publish": lambda: service.publish_report(principal, report_id, data["recipients"]),
                        "revoke": lambda: service.revoke_report(principal, report_id),
                        "receipt": lambda: service.acknowledge_report(principal, report_id),
                        "clarify": lambda: service.clarify_report(principal, report_id, data["message"])}
                    self._response(200, functions[action]())
                else:
                    raise HTTPError(404, "Recurso não disponível.")
            else:
                raise HTTPError(404, "Recurso não disponível.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("Invalid port")
    server = DemoServer(("127.0.0.1", args.port))
    print(f"Capital Web3 — synthetic LOCAL demo: http://127.0.0.1:{args.port}", flush=True)
    print("No real auth, persistence, paid calls, wallet connections or financial execution.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
