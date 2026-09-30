"""Turns the drafts `nav init` and `credit init` write into the demo pair's mandates."""
import json, sys

def patch(path, f):
    d = json.load(open(path)); f(d)
    open(path, "w").write(json.dumps(d, indent=2, sort_keys=True) + "\n")

HOUR = 36_000  # DAA: testnet-10 runs 10 blocks a second

def credit(d):
    d["name"] = "Dawns demo credit vault"
    d["objective"] = ("Demo on an accelerated clock: an hour stands in for a month. Fixed-term loans to three named "
                      "test borrowers (Dawns-held keys) for 1, 2 and 4 hours at 1%, 2% and 4%, roughly 12% a year at "
                      "the month scale. The borrowers repay on schedule; everything else is the covenant's.")
    names = ["Borrower A (test key)", "Borrower B (test key)", "Borrower C (test key)"]
    terms = [(4000, 1 * HOUR, 100), (3000, 2 * HOUR, 200), (2500, 4 * HOUR, 400)]
    for b, n, (cap, term, rate) in zip(d["borrowers"], names, terms):
        b.update({"label": n, "capBps": cap, "termDaa": term, "interestBps": rate})
    d.update({"reserveFloorBps": 1000, "maxPerMoveSompi": 500 * 10**8, "epochLimitSompi": 2000 * 10**8,
              "maxFeeSompi": 5_000_000, "maxMarkStepBps": 1000, "graceDaa": HOUR, "markdownPeriodDaa": HOUR})

def nav(d):
    d["name"] = "Dawns demo vault"
    d["objective"] = ("Demo on an accelerated clock: 60% of the vault lends through the Dawns demo credit vault, where "
                      "an hour stands in for a month; 15% and 15% sit in two test wallets. Deposit test KAS, watch the "
                      "share price climb as the loans repay, redeem at NAV.")
    labels = ["Strategy A (test wallet)", "Strategy B (test wallet)", "Lending via the demo credit vault"]
    for dst, lab, cap in zip(d["destinations"], labels, [2000, 2000, 6000]):
        dst.update({"label": lab, "capBps": cap})
    d.update({"reserveFloorBps": 1000, "maxPerMoveSompi": 500 * 10**8, "epochLimitSompi": 2000 * 10**8, "maxMarkStepBps": 1000})

which = sys.argv[1]
if which == "credit":
    patch("demo-credit/credit-mandate.json", credit)
    json.dump({"note": "Demo: lends idle cash, accrues interest in the marks, test borrowers repay on schedule.",
               "liquidBps": 1000, "minLoanKas": "5", "testBorrowersRepay": True},
              open("demo-credit/credit-strategy.json", "w"), indent=2)
elif which == "nav":
    patch("demo/nav-mandate.json", nav)
