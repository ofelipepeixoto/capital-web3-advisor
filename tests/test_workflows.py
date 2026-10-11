import json
import unittest
from pathlib import Path


class WorkflowSafetyTests(unittest.TestCase):
    def test_templates_are_inactive_credentials_free_and_cannot_deliver(self):
        root = Path(__file__).resolve().parents[1] / "n8n" / "workflows"
        templates = list(root.glob("*.json"))
        self.assertEqual(len(templates), 5)
        allowed = {"n8n-nodes-base.manualTrigger", "n8n-nodes-base.set"}
        for path in templates:
            with self.subTest(path=path.name):
                template = json.loads(path.read_text(encoding="utf-8"))
                self.assertIs(template["active"], False)
                self.assertEqual(sum(node["type"] == "n8n-nodes-base.manualTrigger" for node in template["nodes"]), 1)
                for node in template["nodes"]:
                    self.assertIn(node["type"], allowed)
                    self.assertNotIn("credentials", node)
                preview = template["nodes"][1]["parameters"]["values"]["string"][0]["value"]
                prepared = json.loads(preview)
                self.assertIs(prepared["publish"], False)
                self.assertIs(prepared["notify_client"], False)
                self.assertEqual(prepared["backend_transport"], "not_configured")


if __name__ == "__main__":
    unittest.main()
