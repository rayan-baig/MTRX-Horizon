"""The part every watcher reports to: decides, remembers, and tells the buddy.

Mail, the browser extension, the clipboard and the "check a link" box all hand
what they see to Guardian.see(). It runs the engine, writes the event log,
and, when something is bad enough and hasn't just been shown, puts an alert
on the queue the buddy reads.
"""

import queue
import threading
import time

from . import engine, events, policy as policy_mod

REPEAT_SECONDS = 6 * 3600   # the same link or message isn't alerted twice in this time


class Guardian:
    def __init__(self, pol: policy_mod.Policy | None = None):
        self.policy = pol or policy_mod.load()
        self.alerts: "queue.Queue[engine.Verdict]" = queue.Queue()
        self.notices: "queue.Queue[str]" = queue.Queue()   # short things for the buddy to say
        self._seen: dict[str, float] = {}
        self._lock = threading.Lock()
        self.counts = {"checked": 0, "warned": 0}

    def reload(self):
        self.policy = policy_mod.load()

    @property
    def paused(self) -> bool:
        return self.policy.paused_until > time.time()

    def _should_alert(self, verdict: engine.Verdict, key: str) -> bool:
        wanted = ("danger",) if self.policy.alert_on == "danger" else ("danger", "caution")
        if verdict.level not in wanted or self.paused:
            return False
        now = time.time()
        with self._lock:
            for k, t in list(self._seen.items()):
                if now - t > REPEAT_SECONDS:
                    del self._seen[k]
            if key in self._seen:
                return False
            self._seen[key] = now
        return True

    def see(self, msg: engine.Message, alert: bool = True) -> engine.Verdict:
        verdict = engine.check_message(msg, self.policy)
        self.counts["checked"] += 1
        key = verdict.worst_link or f"{msg.sender_address}|{msg.subject}|{hash(msg.text)}"
        if alert and self._should_alert(verdict, key):
            self.counts["warned"] += 1
            events.record(self.policy.events_path, verdict, "warned")
            self.alerts.put(verdict)
        return verdict

    def note(self, verdict: engine.Verdict, action: str):
        """The person did something with an alert: reported, dismissed, trusted."""
        events.record(self.policy.events_path, verdict, action)
