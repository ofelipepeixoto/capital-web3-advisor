"""Real loopback HTTP checks; no browser or external network is used."""

import http.client
import json
import threading
import unittest
from http.cookies import SimpleCookie

from capital_web3.adapters import validate_report
from capital_web3.server import DemoServer, MAX_BODY
from capital_web3.service import AdvisoryService


class DemoHTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = DemoServer(("127.0.0.1", 0))
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(
            target=cls.server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def setUp(self):
        self.server.service = AdvisoryService()
        with self.server.session_lock:
            self.server.sessions.clear()

    def request(self, method, path, *, data=None, session=None, headers=None,
                raw_body=None, csrf=True):
        request_headers = dict(headers or {})
        if session:
            request_headers.setdefault("Cookie", session["cookie"])
            if method == "POST" and csrf:
                request_headers.setdefault("X-CSRF-Token", session["csrf"])
        body = raw_body
        if data is not None:
            body = json.dumps(data, ensure_ascii=False).encode()
        if body is not None:
            request_headers.setdefault("Content-Type", "application/json")
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        try:
            connection.request(method, path, body=body, headers=request_headers)
            response = connection.getresponse()
            content = response.read()
            response_headers = {key.lower(): value for key, value in response.getheaders()}
            if response_headers.get("content-type", "").startswith("application/json"):
                content = json.loads(content)
            return response.status, response_headers, content
        finally:
            connection.close()

    def session(self, persona):
        status, headers, body = self.request(
            "POST", "/api/demo/session", data={"persona": persona},
            headers={"X-Demo-Intent": "local-testing"})
        self.assertEqual(200, status, body)
        cookie = SimpleCookie()
        cookie.load(headers["set-cookie"])
        return {"cookie": "cw3_demo=" + cookie["cw3_demo"].value,
                "csrf": body["csrf_token"], "body": body, "headers": headers}

    def test_health_and_assets_are_local_and_have_security_headers(self):
        status, headers, body = self.request("GET", "/health")
        self.assertEqual(200, status)
        self.assertEqual("synthetic-local", body["mode"])
        self.assertFalse(body["live_integrations"])
        self.assertEqual("no-store", headers["cache-control"])
        self.assertEqual("nosniff", headers["x-content-type-options"])
        self.assertEqual("DENY", headers["x-frame-options"])
        self.assertIn("default-src 'none'", headers["content-security-policy"])
        for path, mime in (("/", "text/html"), ("/app.js", "text/javascript"),
                           ("/styles.css", "text/css")):
            status, headers, body = self.request("GET", path)
            self.assertEqual(200, status)
            self.assertTrue(headers["content-type"].startswith(mime))
            self.assertGreater(len(body), 100)
        status, _, body = self.request("GET", "/app.js")
        source = body.decode()
        self.assertNotIn("innerHTML", source)
        self.assertIn("textContent", source)
        self.assertIn("r.permissions", source)
        self.assertIn("states[state]", source)
        self.assertIn("if(p.approve)", source)
        self.assertIn("if(p.publish)", source)
        self.assertIn("if(p.acknowledge)", source)

    def test_session_cookie_is_httponly_and_tokens_are_independent_random_values(self):
        first, second = self.session("ana"), self.session("ana")
        self.assertIn("HttpOnly", first["headers"]["set-cookie"])
        self.assertIn("SameSite=Strict", first["headers"]["set-cookie"])
        self.assertNotEqual(first["cookie"], second["cookie"])
        self.assertNotEqual(first["csrf"], second["csrf"])
        self.assertGreaterEqual(len(first["csrf"]), 40)
        self.assertNotEqual(first["cookie"].split("=", 1)[1], first["csrf"])
        status, _, body = self.request("GET", "/api/session", session=first)
        self.assertEqual(200, status)
        self.assertEqual({"subject": "ana", "role": "consultant", "csrf_token": first["csrf"]}, body)

    def test_identity_headers_do_not_override_server_session(self):
        client = self.session("client-a")
        forged = {"X-User-ID": "rui", "X-Principal": "rui", "X-Role": "reviewer",
                  "X-Tenant-ID": "tenant-b", "Authorization": "Bearer fake-rui"}
        status, _, body = self.request("GET", "/api/session", session=client, headers=forged)
        self.assertEqual(200, status)
        self.assertEqual("client-a", body["subject"])
        self.assertEqual("client", body["role"])
        status, _, _ = self.request("POST", "/api/reports/report-a-v1/approve",
                                    session=client, headers=forged, data={})
        self.assertEqual(404, status)
        status, _, _ = self.request("GET", "/api/reports", headers=forged)
        self.assertEqual(401, status)

    def test_clients_cannot_read_drafts_other_case_or_download(self):
        client_a, client_b = self.session("client-a"), self.session("client-b")
        status, _, body = self.request("GET", "/api/reports", session=client_a)
        self.assertEqual((200, []), (status, body))
        denial_messages = []
        for path in ("/api/reports/report-a-v1", "/api/reports/report-b-v1",
                     "/api/reports/does-not-exist", "/api/reports/report-b-v1/download",
                     "/api/reports?case_id=case-b"):
            status, _, body = self.request("GET", path, session=client_a)
            self.assertEqual(404, status)
            denial_messages.append(body["error"])
        self.assertEqual(1, len(set(denial_messages)))
        status, _, body = self.request("GET", "/api/reports", session=client_b)
        self.assertEqual(200, status)
        self.assertEqual(["report-b-v1"], [item["id"] for item in body])
        self.assertFalse(body[0]["permissions"]["approve"])
        self.assertFalse(body[0]["permissions"]["publish"])

    def test_review_publish_read_receipt_and_revocation_full_cycle(self):
        reviewer, consultant = self.session("rui"), self.session("ana")
        client = self.session("client-a")
        base = "/api/reports/report-a-v1"
        status, _, report = self.request("GET", base, session=reviewer)
        self.assertEqual(200, status)
        self.assertEqual("draft", report["state"])
        self.assertTrue(report["permissions"]["approve"])
        self.assertFalse(report["permissions"]["publish"])
        status, _, _ = self.request("POST", base + "/publish", session=reviewer,
                                    data={"recipients": ["client-a"]})
        self.assertEqual(409, status)
        status, _, _ = self.request("POST", base + "/approve", session=consultant, data={})
        self.assertEqual(404, status)
        status, _, report = self.request("POST", base + "/approve", session=reviewer, data={})
        self.assertEqual(200, status)
        self.assertEqual("approved", report["state"])
        self.assertTrue(report["permissions"]["publish"])
        status, _, _ = self.request("POST", base + "/publish", session=reviewer,
                                    data={"recipients": ["client-a", "client-b"]})
        self.assertEqual(404, status)
        status, _, report = self.request("POST", base + "/publish", session=reviewer,
                                        data={"recipients": ["client-a"]})
        self.assertEqual(200, status)
        self.assertEqual("published", report["state"])
        status, _, report = self.request("GET", base, session=client)
        self.assertEqual(200, status)
        self.assertTrue(report["permissions"]["acknowledge"])
        self.assertFalse(report["permissions"]["approve"])
        status, headers, downloaded = self.request("GET", base + "/download", session=client)
        self.assertEqual(200, status)
        self.assertIn('filename="report-a-v1.json"', headers["content-disposition"])
        self.assertEqual("report-a-v1", downloaded["id"])
        status, _, receipt = self.request("POST", base + "/receipt", session=client, data={})
        status2, _, repeated = self.request("POST", base + "/receipt", session=client, data={})
        self.assertEqual((200, 200), (status, status2))
        self.assertEqual(receipt, repeated)
        self.assertFalse(receipt["is_approval"])
        status, _, note = self.request("POST", base + "/clarify", session=client,
                                      data={"message": "Pode esclarecer as limitações?"})
        self.assertEqual(200, status)
        self.assertEqual("open", note["status"])
        status, _, report = self.request("POST", base + "/revoke", session=reviewer, data={})
        self.assertEqual(200, status)
        self.assertEqual("revoked", report["state"])
        for method, path, data in (("GET", base, None), ("GET", base + "/download", None),
                                   ("POST", base + "/receipt", {}),
                                   ("POST", base + "/clarify", {"message": "Nova dúvida"})):
            status, _, _ = self.request(method, path, session=client, data=data)
            self.assertEqual(404, status)

    def test_draft_endpoint_checks_case_assignment_and_contract(self):
        consultant, reviewer = self.session("ana"), self.session("rui")
        client = self.session("client-a")
        for principal, path in ((client, "/api/cases/case-a/draft"),
                                (consultant, "/api/cases/case-b/draft"),
                                (reviewer, "/api/cases/missing/draft")):
            status, _, _ = self.request("POST", path, session=principal, data={})
            self.assertEqual(404, status)
        status, _, _ = self.request("POST", "/api/cases/case-a/draft", session=consultant,
                                    data={"approved": True, "role": "reviewer"})
        self.assertEqual(400, status)
        status, _, report = self.request("POST", "/api/cases/case-a/draft",
                                        session=consultant, data={})
        self.assertEqual(201, status)
        self.assertEqual("case-a", report["case_id"])
        self.assertEqual("report-a-v2", report["id"])
        self.assertEqual("draft", report["state"])
        self.assertEqual("pending", report["review"]["status"])
        self.assertFalse(report["permissions"]["publish"])
        validate_report(report["payload"])
        self.assertFalse(report["payload"]["human_review"]["approved"])

    def test_dns_rebinding_host_and_foreign_origins_are_denied(self):
        client = self.session("client-b")
        for headers in ({"Host": f"attacker.invalid:{self.port}"},
                        {"Host": "localhost"},
                        {"Host": f"127.0.0.1:{self.port}", "Origin": "https://attacker.invalid"},
                        {"Origin": "null"}, {"Sec-Fetch-Site": "cross-site"}):
            status, _, _ = self.request("GET", "/api/session", session=client, headers=headers)
            self.assertEqual(403, status)
        status, _, _ = self.request("POST", "/api/demo/session", data={"persona": "rui"},
                                    headers={"X-Demo-Intent": "local-testing", "Origin": "https://attacker.invalid"})
        self.assertEqual(403, status)
        status, _, _ = self.request("GET", "/health", headers={"Host": f"localhost:{self.port}"})
        self.assertEqual(200, status)

    def test_csrf_is_required_and_bound_to_the_session(self):
        first, second = self.session("rui"), self.session("rui")
        base = "/api/reports/report-a-v1/approve"
        for extra_headers in ({}, {"X-CSRF-Token": "forged"}, {"X-CSRF-Token": second["csrf"]}):
            status, _, _ = self.request("POST", base, session=first, data={},
                                        csrf=False, headers=extra_headers)
            self.assertEqual(403, status)
        status, _, report = self.request("GET", "/api/reports/report-a-v1", session=first)
        self.assertEqual(200, status)
        self.assertEqual("draft", report["status"])

    def test_login_rejects_role_escalation_and_requires_explicit_demo_intent(self):
        status, _, _ = self.request("POST", "/api/demo/session", data={"persona": "rui"})
        self.assertEqual(403, status)
        for data in ({"persona": "client-a", "role": "reviewer"},
                     {"persona": "client-a", "subject": "rui"},
                     {"persona": "client-a", "tenant_id": "tenant-b"}):
            status, _, _ = self.request("POST", "/api/demo/session", data=data,
                                        headers={"X-Demo-Intent": "local-testing"})
            self.assertEqual(400, status)
        status, _, _ = self.request("POST", "/api/demo/session", data={"persona": "administrator"},
                                    headers={"X-Demo-Intent": "local-testing"})
        self.assertEqual(404, status)

    def test_oversized_invalid_json_and_nonobject_are_rejected(self):
        intent = {"X-Demo-Intent": "local-testing"}
        for body, expected in ((b"x" * (MAX_BODY + 1), 413), (b'{"persona":', 400),
                               (b"[]", 400), (b'{"persona":NaN}', 400)):
            status, _, _ = self.request("POST", "/api/demo/session", headers=intent, raw_body=body)
            self.assertEqual(expected, status)
        status, _, _ = self.request("POST", "/api/demo/session", headers={
            **intent, "Content-Type": "text/plain"}, raw_body=b'{"persona":"ana"}')
        self.assertEqual(415, status)

    def test_live_routes_and_post_download_are_not_available(self):
        reviewer = self.session("rui")
        for method, path, body in (("GET", "/api/live", None),
                                   ("POST", "/api/live", {}),
                                   ("POST", "/api/reports/report-a-v1/download", {})):
            status, _, _ = self.request(method, path, data=body, session=reviewer)
            self.assertEqual(404, status)

    def test_logout_invalidates_session_and_risk_view_is_staff_only(self):
        reviewer, client = self.session("rui"), self.session("client-b")
        status, _, _ = self.request("GET", "/api/risk", session=client)
        self.assertEqual(404, status)
        status, _, body = self.request("GET", "/api/risk", session=reviewer)
        self.assertEqual(200, status)
        self.assertEqual("synthetic", body["mode"])
        status, headers, _ = self.request("POST", "/api/logout", session=reviewer, data={})
        self.assertEqual(200, status)
        self.assertIn("Max-Age=0", headers["set-cookie"])
        status, _, _ = self.request("GET", "/api/session", session=reviewer)
        self.assertEqual(401, status)

    def test_server_refuses_nonloopback_binding(self):
        with self.assertRaises(ValueError):
            DemoServer(("0.0.0.0", 0))


if __name__ == "__main__":
    unittest.main()
