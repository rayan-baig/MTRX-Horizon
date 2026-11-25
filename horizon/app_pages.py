"""The simple page for each app, and its demo (1.30.0).

Clicking an app on the home page opens its simple page first: what it does
in one sentence, three steps, one picture, and two buttons (the demo, and
opening it). The demo is a pretend, hands-on version that runs in the
browser (static/js/app-demo.js) with pretend data: nothing is saved or sent.
"""

# The order every list shows them in.
ORDER = ("rankup", "cyberlogix", "omniarmor", "genesis", "orbyt", "pilot")

APPS = {
    "rankup": {
        "name": "RankUp", "full": "RankUp", "color": "green",
        "icon": "/static/img/rankup-icon.svg",
        "one": "Kids do chores and earn points, levels and games.",
        "who": "For families",
        "steps": [("✅", "A grown-up adds chores"),
                  ("🧹", "Kids do them and tap Done"),
                  ("🏆", "They earn coins and level up")],
        "shots": ["/static/img/rankup-screen-1.webp", "/static/img/rankup-screen-2.webp"],
        "kind": "app",
    },
    "cyberlogix": {
        "name": "CyberLogix", "full": "CyberLogix AI", "color": "blue",
        "icon": "/static/img/cyberlogix-icon.svg",
        "one": "Texts you when a fridge or freezer gets too warm.",
        "who": "For restaurants, cafés and shops",
        "steps": [("🌡️", "A sensor watches the fridge"),
                  ("📱", "Too warm? You get a text"),
                  ("📋", "Everything is saved for inspectors")],
        "shots": ["/static/img/cyberlogix-screen-1.webp", "/static/img/cyberlogix-screen-2.webp"],
        "kind": "app",
    },
    "omniarmor": {
        "name": "OmniArmor", "full": "OmniArmor.ai", "color": "violet",
        "icon": "/static/img/omniarmor-icon.svg",
        "one": "A safety checklist that remembers every deadline for you.",
        "who": "For small businesses and schools",
        "steps": [("📝", "Pick your kind of business"),
                  ("📅", "Enter when you last did each check"),
                  ("🟢", "It shows what's due and what's fine")],
        "shots": ["/static/img/omniarmor-screen-1.webp", "/static/img/omniarmor-screen-2.webp"],
        "kind": "app",
    },
    "genesis": {
        "name": "Genesis", "full": "Genesis", "color": "gold",
        "icon": "",
        "one": "Turns your idea into a simple plan, step by step.",
        "who": "For anyone with an idea (free)",
        "steps": [("💡", "Write your idea"),
                  ("🗺️", "Get a step-by-step plan"),
                  ("✔️", "Tick off steps as you go")],
        "shots": [],
        "kind": "tool",
    },
    "orbyt": {
        "name": "Orbyt", "full": "Orbyt", "color": "teal",
        "icon": "",
        "one": "Send your idea to MTRX Horizyn, and a real person replies.",
        "who": "For people with ideas, and businesses",
        "steps": [("🛤️", "Pick what you want to do"),
                  ("✉️", "Write a short note"),
                  ("💬", "We reply within 7 days")],
        "shots": [],
        "kind": "tool",
    },
    "pilot": {
        "name": "Pilot", "full": "Pilot", "color": "sky",
        "icon": "/static/pilot/pilot-robot-112.webp",
        "one": "A friendly robot helper that answers questions on every page.",
        "who": "On every app, and on your Mac",
        "steps": [("🤖", "Tap the robot"),
                  ("❓", "Ask a question or tap a button"),
                  ("⚡", "Get an answer straight away")],
        "shots": [],
        "kind": "helper",
    },
}


def get(key: str):
    """One app's page data, or None."""
    return APPS.get(key)


def listing() -> list:
    """Every app, in order, with its key."""
    return [{"key": k, **APPS[k]} for k in ORDER]
