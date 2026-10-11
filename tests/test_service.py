import concurrent.futures
import json
import unittest

from capital_web3.service import (
    AdvisoryService, Conflict, NotFound, Principal, ValidationError,
    resolve_demo_principal,
)


class AdvisoryServiceTests(unittest.TestCase):
    def setUp(self):
        self.service = AdvisoryService()
        self.ana = resolve_demo_principal("ana")
        self.rui = resolve_demo_principal("rui")
        self.client_a = resolve_demo_principal("client-a")
        self.client_b = resolve_demo_principal("client-b")
        self.report_a = "report-a-v1"
        self.report_b = "report-b-v1"

    def publish_a(self):
        self.service.approve_report(self.rui, self.report_a)
        return self.service.publish_report(self.rui, self.report_a, ["client-a"])

    def test_initial_visibility(self):
        self.assertEqual(["case-a"], [x["id"] for x in self.service.list_cases(self.ana)])
        self.assertEqual([], self.service.list_reports(self.client_a))
        self.assertEqual([self.report_b], [x["id"] for x in self.service.list_reports(self.client_b)])
        self.assertEqual("published", self.service.get_report(self.client_b, self.report_b)["status"])
        self.assertIsNone(self.service.list_cases(self.client_a)[0]["latest_report_id"])

    def test_generic_notfound_for_cross_tenant_and_missing(self):
        messages = []
        for report_id in (self.report_a, "unknown-report"):
            with self.assertRaises(NotFound) as caught:
                self.service.get_report(self.client_b, report_id)
            messages.append((caught.exception.code, str(caught.exception)))
        self.assertEqual(messages[0], messages[1])
        with self.assertRaises(NotFound):
            self.service.list_reports(self.client_a, "case-b")
        with self.assertRaises(NotFound):
            self.service.download_report(self.client_a, self.report_b)

    def test_every_client_action_rejects_other_tenant(self):
        self.publish_a()
        actions = [
            lambda: self.service.get_report(self.client_b, self.report_a),
            lambda: self.service.approve_report(self.client_b, self.report_a),
            lambda: self.service.publish_report(self.client_b, self.report_a, ["client-b"]),
            lambda: self.service.revoke_report(self.client_b, self.report_a),
            lambda: self.service.acknowledge_report(self.client_b, self.report_a),
            lambda: self.service.clarify_report(self.client_b, self.report_a, "Dúvida"),
            lambda: self.service.download_report(self.client_b, self.report_a),
            lambda: self.service.create_draft(self.client_b, "case-a", {"title": "X"}),
        ]
        for action in actions:
            with self.subTest(action=action):
                with self.assertRaises(NotFound):
                    action()

    def test_unassigned_staff_is_denied_on_all_paths(self):
        actions = [
            lambda: self.service.get_report(self.rui, self.report_b),
            lambda: self.service.approve_report(self.rui, self.report_b),
            lambda: self.service.publish_report(self.rui, self.report_b, ["client-b"]),
            lambda: self.service.revoke_report(self.rui, self.report_b),
            lambda: self.service.download_report(self.rui, self.report_b),
            lambda: self.service.list_reports(self.rui, "case-b"),
            lambda: self.service.create_draft(self.ana, "case-b", {"title": "X"}),
            lambda: self.service.list_audit(self.ana, "case-b"),
        ]
        for action in actions:
            with self.assertRaises(NotFound):
                action()

    def test_caller_cannot_spoof_a_known_role(self):
        forged = Principal("client-a", "reviewer")
        with self.assertRaises(NotFound):
            self.service.list_reports(forged)
        with self.assertRaises(NotFound):
            self.service.approve_report(forged, self.report_a)
        with self.assertRaises(NotFound):
            self.service.list_cases(Principal("unassigned", "consultant"))

    def test_unapproved_publication_is_blocked(self):
        with self.assertRaises(Conflict):
            self.service.publish_report(self.rui, self.report_a, ["client-a"])
        self.assertEqual("draft", self.service.get_report(self.rui, self.report_a)["status"])
        self.assertEqual([], self.service.list_reports(self.client_a))

    def test_only_reviewer_can_approve_and_publish(self):
        with self.assertRaises(NotFound):
            self.service.approve_report(self.ana, self.report_a)
        self.service.approve_report(self.rui, self.report_a)
        with self.assertRaises(NotFound):
            self.service.publish_report(self.ana, self.report_a, ["client-a"])
        self.publish_a()
        with self.assertRaises(NotFound):
            self.service.approve_report(self.client_a, self.report_a)

    def test_recipient_validation_is_atomic_and_case_bound(self):
        self.service.approve_report(self.rui, self.report_a)
        for recipients in (["client-a", "client-b"], ["client-a", "ana"], ["unknown"]):
            with self.assertRaises(NotFound):
                self.service.publish_report(self.rui, self.report_a, recipients)
            self.assertEqual("approved", self.service.get_report(self.rui, self.report_a)["status"])
            self.assertEqual([], self.service.list_reports(self.client_a))
        self.publish_a()
        self.assertEqual(["client-a"], self.service.get_report(self.rui, self.report_a)["publication"]["recipients"])

    def test_inactive_membership_denies_visibility_and_publication(self):
        self.service._memberships[("case-a", "client-a")] = False
        self.service.approve_report(self.rui, self.report_a)
        with self.assertRaises(NotFound):
            self.service.publish_report(self.rui, self.report_a, ["client-a"])
        self.assertEqual([], self.service.list_cases(self.client_a))
        self.assertEqual([], self.service.list_reports(self.client_a))

    def test_new_version_never_inherits_approval_and_old_version_cannot_publish(self):
        original = self.service.approve_report(self.rui, self.report_a)
        draft = self.service.create_draft(self.ana, "case-a", original["payload"])
        self.assertEqual("report-a-v2", draft["id"])
        self.assertEqual(original["content_hash"], draft["content_hash"])
        self.assertEqual("draft", draft["status"])
        self.assertEqual("pending", draft["review"]["status"])
        self.assertFalse(draft["can_publish"])
        with self.assertRaises(Conflict):
            self.service.publish_report(self.rui, self.report_a, ["client-a"])
        with self.assertRaises(Conflict):
            self.service.approve_report(self.rui, self.report_a)
        with self.assertRaises(Conflict):
            self.service.publish_report(self.rui, draft["id"], ["client-a"])

    def test_model_flags_cannot_approve_or_publish(self):
        draft = self.service.create_draft(self.ana, "case-a", {
            "title": "Documento", "summary": "Conteúdo a revisar", "approved": True,
            "status": "published", "review": {"status": "approved"},
            "permissions": {"publish": True}, "recipients": ["client-a"],
        })
        self.assertEqual("draft", draft["status"])
        self.assertEqual("pending", draft["review"]["status"])
        for reserved in ("approved", "status", "review", "permissions", "recipients"):
            self.assertNotIn(reserved, draft["payload"])
        with self.assertRaises(Conflict):
            self.service.publish_report(self.rui, draft["id"], ["client-a"])

    def test_structured_contract_survives_persistence_without_model_approval(self):
        from capital_web3.adapters import MockAdvisorAdapter, validate_report
        structured = MockAdvisorAdapter().generate_report({})
        draft = self.service.create_draft(self.ana, "case-a", structured)
        self.assertEqual(structured, draft["payload"])
        validate_report(draft["payload"])
        self.assertEqual("degraded", draft["payload"]["status"])
        self.assertEqual("draft", draft["status"])
        self.assertFalse(draft["payload"]["human_review"]["approved"])
        self.assertEqual("pending", draft["review"]["status"])
        self.service.approve_report(self.rui, draft["id"])
        saved = self.service.get_report(self.rui, draft["id"])
        validate_report(saved["payload"])
        self.assertEqual("approved", saved["status"])
        self.assertFalse(saved["payload"]["human_review"]["approved"])
        structured["human_review"]["approved"] = True
        with self.assertRaises(ValidationError):
            self.service.create_draft(self.ana, "case-a", structured)

    def test_report_content_and_views_are_immutable_snapshots(self):
        payload = {"title": "Primeiro", "nested": {"values": [1]}}
        draft = self.service.create_draft(self.ana, "case-a", payload)
        payload["nested"]["values"].append(2)
        draft["payload"]["nested"]["values"].append(3)
        draft["content"]["title"] = "Alterado"
        draft["review"]["status"] = "approved"
        saved = self.service.get_report(self.rui, draft["id"])
        self.assertEqual({"title": "Primeiro", "nested": {"values": [1]}}, saved["payload"])
        self.assertEqual("pending", saved["review"]["status"])
        self.assertEqual(draft["content_hash"], saved["content_hash"])

    def test_customer_projection_does_not_reveal_a_new_private_draft(self):
        self.publish_a()
        self.service.create_draft(self.ana, "case-a", {"title": "Confidencial"})
        customer = self.service.get_report(self.client_a, self.report_a)
        self.assertTrue(customer["is_latest"])
        self.assertFalse(self.service.get_report(self.ana, self.report_a)["is_latest"])
        cases = self.service.list_cases(self.client_a)
        self.assertEqual(self.report_a, cases[0]["latest_report_id"])
        self.assertEqual(1, cases[0]["report_count"])
        self.assertEqual([self.report_a], [item["id"] for item in self.service.list_reports(self.client_a)])

    def test_revocation_removes_all_customer_paths(self):
        self.publish_a()
        self.service.acknowledge_report(self.client_a, self.report_a)
        self.service.clarify_report(self.client_a, self.report_a, "Esclarecimento")
        self.assertEqual("revoked", self.service.revoke_report(self.rui, self.report_a)["status"])
        self.assertEqual([], self.service.list_reports(self.client_a))
        for action in (
            lambda: self.service.get_report(self.client_a, self.report_a),
            lambda: self.service.download_report(self.client_a, self.report_a),
            lambda: self.service.acknowledge_report(self.client_a, self.report_a),
            lambda: self.service.clarify_report(self.client_a, self.report_a, "Nova dúvida"),
        ):
            with self.assertRaises(NotFound):
                action()
        with self.assertRaises(Conflict):
            self.service.publish_report(self.rui, self.report_a, ["client-a"])
        self.assertEqual("revoked", self.service.revoke_report(self.rui, self.report_a)["status"])

    def test_receipt_is_idempotent_and_does_not_change_approval(self):
        self.publish_a()
        prior = self.service.get_report(self.rui, self.report_a)["review"]
        first = self.service.acknowledge_report(self.client_a, self.report_a)
        second = self.service.acknowledge_report(self.client_a, self.report_a)
        self.assertEqual(first, second)
        self.assertFalse(first["is_approval"])
        events = self.service.list_audit(self.rui, "case-a")
        self.assertEqual(1, sum(x["action"] == "acknowledge" for x in events))
        self.assertEqual(prior, self.service.get_report(self.rui, self.report_a)["review"])
        with self.assertRaises(NotFound):
            self.service.acknowledge_report(self.ana, self.report_a)

    def test_clarification_is_visible_only_to_authorized_case_staff(self):
        self.publish_a()
        response = self.service.clarify_report(self.client_a, self.report_a, "Como interpretar o cenário?")
        self.assertEqual("open", response["status"])
        self.assertEqual(response, self.service.get_report(self.ana, self.report_a)["clarifications"][0])
        self.assertEqual(response, self.service.get_report(self.client_a, self.report_a)["clarifications"][0])
        response["message"] = "Mutação"
        self.assertNotEqual("Mutação", self.service.get_report(self.ana, self.report_a)["clarifications"][0]["message"])
        with self.assertRaises(ValidationError):
            self.service.clarify_report(self.client_a, self.report_a, " ")

    def test_audit_contains_metadata_only_and_has_rbac(self):
        draft = self.service.create_draft(self.ana, "case-a", {"title": "PRIVATE_REPORT_SENTINEL"})
        self.service.approve_report(self.rui, draft["id"])
        self.service.publish_report(self.rui, draft["id"], ["client-a"])
        self.service.clarify_report(self.client_a, draft["id"], "PRIVATE_MESSAGE_SENTINEL")
        events = self.service.list_audit(self.ana)
        text = json.dumps(events)
        self.assertNotIn("PRIVATE_REPORT_SENTINEL", text)
        self.assertNotIn("PRIVATE_MESSAGE_SENTINEL", text)
        events[0]["actor"] = "Mutated"
        self.assertNotEqual("Mutated", self.service.list_audit(self.ana)[0]["actor"])
        with self.assertRaises(NotFound):
            self.service.list_audit(self.client_a)

    def test_concurrent_receipts_and_drafts_are_consistent(self):
        self.publish_a()
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            receipts = list(pool.map(lambda _: self.service.acknowledge_report(self.client_a, self.report_a), range(24)))
        self.assertEqual(1, len({item["id"] for item in receipts}))
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            reports = list(pool.map(lambda i: self.service.create_draft(self.ana, "case-a", {"title": f"Versão {i}"}), range(24)))
        self.assertEqual(24, len({item["id"] for item in reports}))
        self.assertEqual(set(range(2, 26)), {item["version"] for item in reports})
        self.assertTrue(all(item["status"] == "draft" for item in reports))

    def test_service_resets_and_never_calls_external_api(self):
        self.publish_a()
        self.service.create_draft(self.ana, "case-a", {"title": "Temporário"})
        fresh = AdvisoryService()
        self.assertEqual("draft", fresh.get_report(self.rui, self.report_a)["status"])
        self.assertEqual(1, len(fresh.list_reports(self.ana)))
        self.assertEqual([], fresh.list_audit(self.rui))

    def test_invalid_document_rejected_without_version_increment(self):
        for payload in ([1], {"number": float("nan")}, {"object": object()}, {"title": "x" * 128001}):
            with self.assertRaises(ValidationError):
                self.service.create_draft(self.ana, "case-a", payload)
        draft = self.service.create_draft(self.rui, "case-a", {"title": "Válido"})
        self.assertEqual(2, draft["version"])


if __name__ == "__main__":
    unittest.main()
