"""What it costs each month to run MTRX Horizyn and its three apps.

Rough numbers from each app's own docs (see docs/RUNNING-MTRX-HORIZYN.md,
section 6), in US dollars. Prices change: check the provider's pricing page
before signing up. The console shows this list, so a change here is a change
there.
"""

# (what, low, high, note). Both ends equal means a fixed price.
MONTHLY = (
    ("MTRX Horizyn server (Render starter + disk)", 7, 7,
     "The free plan has no disk, so approved devices would be forgotten."),
    ("CyberLogix server (Render starter + disk)", 7, 7,
     "Must not sleep: a sleeping server watches no freezers."),
    ("OmniArmor server", 0, 7, "A free-tier server works to start."),
    ("RankUp hosting (Cloudflare Pages)", 0, 0, ""),
    ("RankUp database (Supabase Pro)", 25, 25,
     "Needed before real families: daily backups."),
    ("Email", 0, 0, "Most email services have a free tier."),
    ("Domain", 1, 2, "About $10–15 a year, shown per month."),
)

# Paid per use, so they have no monthly figure.
PER_USE = (
    ("Text messages and calls (CyberLogix, Twilio)",
     "Pay per message; CyberLogix caps spending per business."),
    ("Stripe", "A fee per payment, no monthly fee."),
    ("Ask Genesis (AI help, Anthropic)",
     "Pay per answer; off until set up, and capped per day by GENESIS_AI_DAILY_CAP_USD."),
)


def summary() -> dict:
    return {
        "monthly": [{"what": w, "low": lo, "high": hi, "note": n} for w, lo, hi, n in MONTHLY],
        "per_use": [{"what": w, "note": n} for w, n in PER_USE],
        "total_low": sum(lo for _, lo, _, _ in MONTHLY),
        "total_high": sum(hi for _, _, hi, _ in MONTHLY),
    }
