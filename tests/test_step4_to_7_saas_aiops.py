import sys
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from saas_app.aiops.engine import decide_fix_or_notify, detect_ewma_zscore_anomaly
from saas_app.ingest.auth import CollectorAuthError, sign_request, verify_collector_hmac


class TestStep4To7SaasAndAiops(unittest.TestCase):
    def test_hmac_verification_and_replay_rejection(self) -> None:
        key = "collector-secret-key"
        hmac_secret = "collector-hmac-secret"
        body = b'{"payload_id":"p1","samples":[]}'
        now = 1_700_000_000
        sig = sign_request(hmac_secret, now, body)

        # Valid signature within skew window passes
        verify_collector_hmac(key, key, hmac_secret, str(now), sig, body, now_epoch=now + 12)

        # Stale timestamp > 300s rejected
        with self.assertRaises(CollectorAuthError):
            verify_collector_hmac(key, key, hmac_secret, str(now - 360), sig, body, now_epoch=now)

        # Bad signature rejected
        with self.assertRaises(CollectorAuthError):
            verify_collector_hmac(key, key, hmac_secret, str(now), "0" * 64, body, now_epoch=now)

        # Wrong collector key rejected
        with self.assertRaises(CollectorAuthError):
            verify_collector_hmac("wrong-key", key, hmac_secret, str(now), sig, body, now_epoch=now)

    def test_ewma_zscore_anomaly_detection(self) -> None:
        history = [22.0, 23.1, 21.8, 22.4, 22.9, 21.5, 22.2]
        normal = detect_ewma_zscore_anomaly(history, 22.5)
        self.assertFalse(normal.is_anomaly)

        spike = detect_ewma_zscore_anomaly(history, 98.4)
        self.assertTrue(spike.is_anomaly)
        self.assertGreater(spike.z_score, 3.0)
        self.assertIn("sigma", spike.reason)

    def test_fix_or_notify_policy_decisions(self) -> None:
        action_entry = {"action_id": "flush_dns_cache", "risk_level": "low"}

        # Kill switch forces NOTIFY_ONLY
        res_kill = decide_fix_or_notify(
            "wan_latency",
            0.95,
            {"kill_switch": True, "mode": "auto_approved", "allowed_actions": ["flush_dns_cache"]},
            action_entry,
        )
        self.assertEqual(res_kill["decision_mode"], "NOTIFY_ONLY")

        # Low-risk + auto_approved + high confidence -> AUTO_FIX
        res_auto = decide_fix_or_notify(
            "wan_latency",
            0.92,
            {"kill_switch": False, "mode": "auto_approved", "allowed_actions": ["flush_dns_cache"]},
            action_entry,
        )
        self.assertEqual(res_auto["decision_mode"], "AUTO_FIX")

        # Approval required mode -> ASK_APPROVAL
        res_ask = decide_fix_or_notify(
            "wan_latency",
            0.92,
            {"kill_switch": False, "mode": "approval_required", "allowed_actions": ["flush_dns_cache"]},
            action_entry,
        )
        self.assertEqual(res_ask["decision_mode"], "ASK_APPROVAL")

        # Action absent from allow-list -> NOTIFY_ONLY
        res_blocked = decide_fix_or_notify(
            "wan_latency",
            0.95,
            {"kill_switch": False, "mode": "auto_approved", "allowed_actions": ["rotate_logs"]},
            action_entry,
        )
        self.assertEqual(res_blocked["decision_mode"], "NOTIFY_ONLY")


if __name__ == "__main__":
    unittest.main()
