"""Authorized, non-custodial advisory workflow for a local fictional demo.

All state lives in memory and is reset when AdvisoryService is constructed.
Principals must be resolved by the server. This module does not authenticate real
people, call an API, sign a transaction, or provide durable storage.
"""

from __future__ import annotations

import hashlib
import json
import threading
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any


class ServiceError(Exception):
    status_code = 400
    code = "service_error"


class NotFound(ServiceError):
    """Intentionally indistinguishable absence and authorization failure."""

    status_code = 404
    code = "not_found"

    def __init__(self) -> None:
        super().__init__("Recurso não disponível.")


class Forbidden(NotFound):
    """Compatibility name; still deliberately returns the generic 404."""


class ValidationError(ServiceError):
    status_code = 400
    code = "invalid_input"


class Conflict(ServiceError):
    status_code = 409
    code = "workflow_conflict"


@dataclass(frozen=True)
class Principal:
    subject: str
    role: str


_DEMO_IDENTITIES = {
    "ana": Principal("ana", "consultant"),
    "rui": Principal("rui", "reviewer"),
    "client-a": Principal("client-a", "client"),
    "client-b": Principal("client-b", "client"),
}
_PERSONA_ALIASES = {
    "consultant": "ana", "staff-ana": "ana", "reviewer": "rui",
    "staff-rui": "rui", "client_a": "client-a", "client_b": "client-b",
}


def resolve_demo_principal(persona: str) -> Principal:
    """Fixed local-demo personas; never use this as production authentication."""
    if not isinstance(persona, str):
        raise NotFound()
    key = _PERSONA_ALIASES.get(persona, persona)
    if key not in _DEMO_IDENTITIES:
        raise NotFound()
    return _DEMO_IDENTITIES[key]


@dataclass(frozen=True)
class _Case:
    id: str
    tenant_id: str
    label: str
    consultants: frozenset[str]
    reviewers: frozenset[str]


@dataclass(frozen=True)
class _ReportVersion:
    id: str
    case_id: str
    version: int
    payload_json: str
    content_hash: str
    created_by: str
    created_at: str


@dataclass(frozen=True)
class _Approval:
    report_id: str
    version: int
    content_hash: str
    subject: str
    approved_at: str


@dataclass(frozen=True)
class _Publication:
    recipients: frozenset[str]
    published_at: str
    revoked_at: str | None = None


class AdvisoryService:
    """Every public operation rechecks identity, assignment and visibility."""

    _RESERVED_FIELDS = frozenset({
        "approved", "approval", "approvals", "approved_by", "approved_at",
        "review", "reviewed", "reviewer", "reviewer_id", "human_approved",
        "model_approved", "published", "publication", "published_at",
        "status", "state", "recipients", "signature", "permissions",
        "can_approve", "can_publish", "tenant_id", "created_by", "id",
        "report_id", "case_id", "version", "content_hash", "is_latest",
    })
    MAX_DOCUMENT_BYTES = 128_000
    MAX_MESSAGE_CHARS = 4_000

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._cases = {
            "case-a": _Case("case-a", "tenant-a", "Caso fictício A",
                            frozenset({"ana"}), frozenset({"rui"})),
            "case-b": _Case("case-b", "tenant-b", "Caso fictício B",
                            frozenset(), frozenset()),
        }
        self._memberships = {("case-a", "client-a"): True,
                             ("case-b", "client-b"): True}
        self._reports: dict[str, _ReportVersion] = {}
        self._latest: dict[str, str] = {}
        self._approvals: dict[str, _Approval] = {}
        self._publications: dict[str, _Publication] = {}
        self._receipts: dict[tuple[str, str], dict[str, Any]] = {}
        self._clarifications: dict[str, list[dict[str, Any]]] = {}
        self._audit_events: list[dict[str, Any]] = []
        now = self._now()
        for case_id, creator in (("case-a", "ana"), ("case-b", "demo-setup")):
            letter = case_id.rsplit("-", 1)[1]
            payload = {
                "title": f"Relatório demonstrativo {letter.upper()}",
                "summary": "Cenário fictício para validar revisão e acesso.",
                "risk_level": "moderado",
                "findings": [{"severity": "moderada", "description":
                              "Revisar concentração e permissões de contratos."}],
                "actions": ["Validar os dados antes de decidir qualquer alocação."],
                "sources": [],
                "limitations": ["Dados fictícios; sem execução de transações."],
            }
            document, _ = self._normalize_payload(payload)
            report = self._new_version(case_id, document, creator, now)
            self._reports[report.id] = report
            self._latest[case_id] = report.id
        initial = self._reports["report-b-v1"]
        self._approvals[initial.id] = _Approval(initial.id, initial.version,
                                              initial.content_hash,
                                              "reviewer-demo-b", now)
        self._publications[initial.id] = _Publication(frozenset({"client-b"}), now)

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).isoformat(timespec="milliseconds")

    @staticmethod
    def resolve_demo_principal(persona: str) -> Principal:
        return resolve_demo_principal(persona)

    @staticmethod
    def _copy(value: Any) -> Any:
        return json.loads(json.dumps(value, ensure_ascii=False, allow_nan=False))

    def _known_identity(self, principal: Principal) -> None:
        if not isinstance(principal, Principal):
            raise NotFound()
        expected = _DEMO_IDENTITIES.get(principal.subject)
        if expected is None or expected.role != principal.role:
            raise NotFound()

    def _case_allowed(self, principal: Principal, case: _Case) -> bool:
        if principal.role == "consultant":
            return principal.subject in case.consultants
        if principal.role == "reviewer":
            return principal.subject in case.reviewers
        if principal.role == "client":
            return self._memberships.get((case.id, principal.subject), False)
        return False

    def _require_case(self, principal: Principal, case_id: str) -> _Case:
        self._known_identity(principal)
        if not isinstance(case_id, str):
            raise NotFound()
        case = self._cases.get(case_id)
        if case is None or not self._case_allowed(principal, case):
            raise NotFound()
        return case

    def _require_staff(self, principal: Principal, case: _Case,
                       reviewer_only: bool = False) -> None:
        allowed_roles = {"reviewer"} if reviewer_only else {"consultant", "reviewer"}
        if principal.role not in allowed_roles or not self._case_allowed(principal, case):
            raise NotFound()

    def _customer_visible(self, principal: Principal, report: _ReportVersion) -> bool:
        publication = self._publications.get(report.id)
        return bool(publication and publication.revoked_at is None
                    and principal.subject in publication.recipients
                    and self._memberships.get((report.case_id, principal.subject), False))

    def _require_report(self, principal: Principal, report_id: str) -> _ReportVersion:
        self._known_identity(principal)
        if not isinstance(report_id, str):
            raise NotFound()
        report = self._reports.get(report_id)
        if report is None:
            raise NotFound()
        self._require_case(principal, report.case_id)
        if principal.role == "client" and not self._customer_visible(principal, report):
            raise NotFound()
        return report

    def _status(self, report: _ReportVersion) -> str:
        publication = self._publications.get(report.id)
        if publication:
            return "revoked" if publication.revoked_at else "published"
        return "approved" if report.id in self._approvals else "draft"

    def _assert_current(self, report: _ReportVersion) -> None:
        if self._latest.get(report.case_id) != report.id:
            raise Conflict("Esta versão foi substituída. Revise a versão atual.")
        if self._status(report) == "revoked":
            raise Conflict("Versão revogada. Crie uma nova versão para nova revisão.")

    def _valid_approval(self, report: _ReportVersion) -> _Approval | None:
        approval = self._approvals.get(report.id)
        if approval and (approval.report_id == report.id
                         and approval.version == report.version
                         and approval.content_hash == report.content_hash):
            return approval
        return None

    def _audit(self, principal: Principal, action: str, report: _ReportVersion,
               **metadata: Any) -> None:
        # Explicit fields only: no payload, clarification text, token or secret.
        self._audit_events.append({
            "id": f"audit-{uuid.uuid4().hex}", "at": self._now(),
            "actor": principal.subject, "role": principal.role, "action": action,
            "case_id": report.case_id, "report_id": report.id,
            "version": report.version, **metadata,
        })

    def _report_view(self, principal: Principal, report: _ReportVersion) -> dict[str, Any]:
        payload = json.loads(report.payload_json)
        status = self._status(report)
        approval = self._valid_approval(report)
        publication = self._publications.get(report.id)
        latest = self._latest.get(report.case_id) == report.id
        reviewer = principal.role == "reviewer"
        staff = principal.role in {"consultant", "reviewer"}
        permissions = {
            "approve": reviewer and latest and status in {"draft", "approved"},
            "publish": reviewer and latest and bool(approval) and status in {"approved", "published"},
            "revoke": reviewer and status in {"published", "revoked"},
            "acknowledge": principal.role == "client" and status == "published",
            "clarify": principal.role == "client" and status == "published",
            "create_draft": staff,
        }
        recipients = sorted(publication.recipients) if publication else []
        if principal.role == "client":
            recipients = [principal.subject] if principal.subject in recipients else []
            # Customer projections must not reveal a newer private draft.
            visible_versions = [item.version for item in self._reports.values()
                                if item.case_id == report.case_id
                                and self._customer_visible(principal, item)]
            latest = bool(visible_versions and report.version == max(visible_versions))
        notes = self._clarifications.get(report.id, [])
        if principal.role == "client":
            notes = [item for item in notes if item["created_by"] == principal.subject]
        title = payload.get("title")
        if not isinstance(title, str) or not title.strip():
            title = f"Relatório v{report.version}"
        view = {
            "id": report.id, "report_id": report.id, "case_id": report.case_id,
            "version": report.version, "title": title, "status": status,
            "state": status, "payload": payload, "content": self._copy(payload),
            "created_at": report.created_at, "created_by": report.created_by,
            "content_hash": report.content_hash, "is_latest": latest,
            "review": {"status": "approved" if approval else "pending",
                       "approved_by": approval.subject if approval else None,
                       "approved_at": approval.approved_at if approval else None},
            "publication": {"status": status,
                            "published_at": publication.published_at if publication else None,
                            "revoked_at": publication.revoked_at if publication else None,
                            "recipients": recipients},
            "permissions": permissions,
            "clarifications": self._copy(notes),
            "receipt": self._copy(self._receipts.get((principal.subject, report.id))),
        }
        view.update({f"can_{key}": value for key, value in permissions.items()})
        return view

    def list_cases(self, principal: Principal) -> list[dict[str, Any]]:
        with self._lock:
            self._known_identity(principal)
            results = []
            for case in self._cases.values():
                if not self._case_allowed(principal, case):
                    continue
                reports = [report for report in self._reports.values()
                           if report.case_id == case.id and
                           (principal.role != "client" or self._customer_visible(principal, report))]
                reports.sort(key=lambda report: report.version)
                results.append({"id": case.id, "case_id": case.id, "label": case.label,
                                "name": case.label, "report_count": len(reports),
                                "latest_report_id": reports[-1].id if reports else None,
                                "can_create_draft": principal.role in {"consultant", "reviewer"}})
            return results

    def list_reports(self, principal: Principal,
                     case_id: str | None = None) -> list[dict[str, Any]]:
        with self._lock:
            self._known_identity(principal)
            if case_id is not None:
                self._require_case(principal, case_id)
            results = []
            for report in self._reports.values():
                if case_id is not None and report.case_id != case_id:
                    continue
                case = self._cases[report.case_id]
                if not self._case_allowed(principal, case):
                    continue
                if principal.role == "client" and not self._customer_visible(principal, report):
                    continue
                results.append(self._report_view(principal, report))
            return results

    def get_report(self, principal: Principal, report_id: str) -> dict[str, Any]:
        with self._lock:
            report = self._require_report(principal, report_id)
            return self._report_view(principal, report)

    def approve_report(self, principal: Principal, report_id: str) -> dict[str, Any]:
        with self._lock:
            report = self._require_report(principal, report_id)
            self._require_staff(principal, self._cases[report.case_id], reviewer_only=True)
            self._assert_current(report)
            if self._valid_approval(report) is None:
                self._approvals[report.id] = _Approval(report.id, report.version,
                                                     report.content_hash,
                                                     principal.subject, self._now())
                self._audit(principal, "approve", report)
            return self._report_view(principal, report)

    def publish_report(self, principal: Principal, report_id: str,
                       recipients: list[str]) -> dict[str, Any]:
        with self._lock:
            report = self._require_report(principal, report_id)
            case = self._cases[report.case_id]
            self._require_staff(principal, case, reviewer_only=True)
            self._assert_current(report)
            if self._valid_approval(report) is None:
                raise Conflict("A versão precisa de revisão humana antes da publicação.")
            if not isinstance(recipients, (list, tuple)) or not recipients:
                raise ValidationError("Informe ao menos um destinatário autorizado.")
            if any(not isinstance(subject, str) for subject in recipients):
                raise ValidationError("Destinatários inválidos.")
            recipients_set = frozenset(recipients)
            # Validate the complete set before creating any grant.
            for subject in recipients_set:
                identity = _DEMO_IDENTITIES.get(subject)
                if (identity is None or identity.role != "client"
                        or not self._memberships.get((case.id, subject), False)):
                    raise NotFound()
            existing = self._publications.get(report.id)
            if existing:
                if existing.recipients != recipients_set:
                    raise Conflict("Destinatários já definidos. Crie uma nova versão para nova publicação.")
                return self._report_view(principal, report)
            self._publications[report.id] = _Publication(recipients_set, self._now())
            self._audit(principal, "publish", report, recipient_count=len(recipients_set))
            return self._report_view(principal, report)

    def revoke_report(self, principal: Principal, report_id: str) -> dict[str, Any]:
        with self._lock:
            report = self._require_report(principal, report_id)
            self._require_staff(principal, self._cases[report.case_id], reviewer_only=True)
            publication = self._publications.get(report.id)
            if publication is None:
                raise Conflict("A versão ainda não foi publicada.")
            if publication.revoked_at is None:
                self._publications[report.id] = _Publication(
                    frozenset(), publication.published_at, self._now())
                self._audit(principal, "revoke", report)
            return self._report_view(principal, report)

    def acknowledge_report(self, principal: Principal, report_id: str) -> dict[str, Any]:
        with self._lock:
            report = self._require_report(principal, report_id)
            if principal.role != "client":
                raise NotFound()
            key = (principal.subject, report.id)
            if key not in self._receipts:
                self._receipts[key] = {
                    "id": f"receipt-{uuid.uuid4().hex}", "report_id": report.id,
                    "subject": principal.subject, "acknowledged_at": self._now(),
                    "status": "acknowledged", "is_approval": False,
                    "meaning": "Confirmação de recebimento; não autoriza operações financeiras.",
                }
                self._audit(principal, "acknowledge", report)
            return self._copy(self._receipts[key])

    def clarify_report(self, principal: Principal, report_id: str,
                       message: str) -> dict[str, Any]:
        with self._lock:
            report = self._require_report(principal, report_id)
            if principal.role != "client":
                raise NotFound()
            if not isinstance(message, str) or not message.strip():
                raise ValidationError("Escreva a dúvida que deseja encaminhar.")
            if len(message) > self.MAX_MESSAGE_CHARS:
                raise ValidationError("A dúvida excede o limite de tamanho.")
            item = {"id": f"clarification-{uuid.uuid4().hex}", "report_id": report.id,
                    "case_id": report.case_id, "message": message.strip(),
                    "created_by": principal.subject, "created_at": self._now(),
                    "status": "open"}
            self._clarifications.setdefault(report.id, []).append(item)
            self._audit(principal, "clarify", report, clarification_id=item["id"])
            return self._copy(item)

    def _normalize_payload(self, payload: dict[str, Any]) -> tuple[str, int]:
        if not isinstance(payload, dict):
            raise ValidationError("O relatório deve ser um objeto JSON.")
        if any(not isinstance(key, str) for key in payload):
            raise ValidationError("Campos do relatório inválidos.")
        if "schema_version" in payload:
            # Structured draft status describes data quality, not publication.
            # Keep the validated contract intact; approval stays exclusively in
            # the server-owned envelope. The closed schema forbids model review.
            from .adapters import InvalidReport, validate_report
            try:
                validate_report(payload)
            except (InvalidReport, RecursionError) as exc:
                raise ValidationError("O relatório não atende ao contrato estruturado.") from exc
            filtered = dict(payload)
        else:
            filtered = {key: value for key, value in payload.items()
                        if key not in self._RESERVED_FIELDS}
        if not filtered:
            raise ValidationError("Informe o conteúdo do relatório.")
        try:
            document = json.dumps(filtered, ensure_ascii=False, sort_keys=True,
                                  separators=(",", ":"), allow_nan=False)
        except (TypeError, ValueError, RecursionError) as exc:
            raise ValidationError("O relatório deve conter somente dados JSON válidos.") from exc
        if len(document.encode("utf-8")) > self.MAX_DOCUMENT_BYTES:
            raise ValidationError("O relatório excede o limite de tamanho.")
        return document, len(payload) - len(filtered)

    def _new_version(self, case_id: str, document: str,
                     subject: str, now: str) -> _ReportVersion:
        previous = self._reports.get(self._latest.get(case_id, ""))
        version = previous.version + 1 if previous else 1
        letter = case_id.rsplit("-", 1)[1]
        return _ReportVersion(f"report-{letter}-v{version}", case_id, version,
                              document, hashlib.sha256(document.encode("utf-8")).hexdigest(),
                              subject, now)

    def create_draft(self, principal: Principal, case_id: str,
                     payload: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            case = self._require_case(principal, case_id)
            self._require_staff(principal, case)
            document, ignored = self._normalize_payload(payload)
            report = self._new_version(case_id, document, principal.subject, self._now())
            self._reports[report.id] = report
            self._latest[case_id] = report.id
            self._audit(principal, "create_draft", report, ignored_metadata_fields=ignored)
            return self._report_view(principal, report)

    def download_report(self, principal: Principal, report_id: str) -> dict[str, Any]:
        """JSON-safe download envelope; the HTTP layer controls content headers."""
        with self._lock:
            report = self._require_report(principal, report_id)
            self._audit(principal, "download", report)
            return {"filename": f"{report.id}.json", "mime_type": "application/json",
                    "report": self._report_view(principal, report)}

    def list_audit(self, principal: Principal,
                   case_id: str | None = None) -> list[dict[str, Any]]:
        with self._lock:
            self._known_identity(principal)
            if principal.role not in {"consultant", "reviewer"}:
                raise NotFound()
            if case_id is not None:
                case = self._require_case(principal, case_id)
                self._require_staff(principal, case)
            events = [event for event in self._audit_events
                      if (case_id is None or event["case_id"] == case_id)
                      and self._case_allowed(principal, self._cases[event["case_id"]])]
            return self._copy(events)
