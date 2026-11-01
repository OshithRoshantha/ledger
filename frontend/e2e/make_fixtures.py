"""Build realistic API responses for the Playwright screenshot run.

Runs the real FastAPI app against an in-memory Mongo (mongomock), fills seven salary cycles
(salary day 5), pins "today" to 12 Nov 2026 (day 8 of the Nov cycle) and writes each
response to e2e/fixtures/*.json.

    cd ledger/frontend
    ../backend/.venv/Scripts/python e2e/make_fixtures.py      (Windows)
    ../backend/.venv/bin/python e2e/make_fixtures.py          (Linux/macOS)
"""

import asyncio
import json
import os
import sys
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent.parent / "backend"))

from cryptography.fernet import Fernet  # noqa: E402

os.environ.update(
    ENV="test",
    JWT_SECRET="fixture-secret-" + "x" * 40,
    TOTP_ENC_KEY=Fernet.generate_key().decode(),
    ARGON2_TIME_COST="1",
    ARGON2_MEMORY_KIB="8192",
    ARGON2_PARALLELISM="1",
    RATE_LIMIT_ENABLED="false",
)

import pyotp  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from mongomock_motor import AsyncMongoMockClient  # noqa: E402

import app.services.clock as clock  # noqa: E402
from app.core import totp  # noqa: E402
from app.core.security import hash_secret  # noqa: E402
from app.db import init_db  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models import AuditLog, User  # noqa: E402
from app.seed import seed_user  # noqa: E402

TODAY = date(2026, 11, 12)
clock.today = lambda tz: TODAY

OUT = HERE / "fixtures"
API = "/api/v1"


async def main() -> None:
    await init_db(AsyncMongoMockClient(tz_aware=True)["fixtures"])
    secret = totp.new_secret()
    user = User(username="oshith", password_hash=hash_secret("fixture passphrase 123"), totp_secret_enc=totp.encrypt_secret(secret))
    await user.insert()
    await seed_user(user.id)

    app = create_app(init_database=False)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://test") as c:
        c.headers["x-csrf-token"] = (await c.get(f"{API}/auth/csrf")).json()["csrf"]
        r = await c.post(f"{API}/auth/login", json={"username": "oshith", "password": "fixture passphrase 123"})
        await c.post(f"{API}/auth/verify-2fa", json={"pre_auth_token": r.json()["pre_auth_token"], "code": pyotp.TOTP(secret).now()})

        async def post(path, body):
            res = await c.post(f"{API}{path}", json=body)
            assert res.status_code < 300, (path, res.text)
            return res.json()

        await post("/settings/onboarding", {"salary": 18_500_000, "last_salary_date": "2026-11-05", "salary_day": 5})
        cats = {x["name"]: x["id"] for x in (await c.get(f"{API}/categories")).json()}
        reasons = {x["name"]: x["id"] for x in (await c.get(f"{API}/reasons")).json()}
        sources = {x["name"]: x["id"] for x in (await c.get(f"{API}/income-sources")).json()}
        bills = {x["name"]: x["id"] for x in (await c.get(f"{API}/settings/fixed-expenses")).json()}
        uber, bank, mob, lmt = cats["Uber / PickMe"], cats["Bank & Cash Spending"], cats["Mobile Top-ups"], cats["LMT Top-ups"]

        # ---- six closed cycles: May - Oct 2026 (each 5th -> 4th of next month)
        for i, m in enumerate(range(5, 11)):
            ym = f"2026-{m:02d}"
            nxt = f"2026-{m + 1:02d}"
            await post("/income", {"source_id": sources["Salary"], "amount": 18_500_000, "date": f"{ym}-05"})
            if i in (2, 5):
                await post("/income", {"source_id": sources["Other Income"], "amount": 2_500_000 + i * 150_000, "date": f"{ym}-20", "note": "Freelance"})
            for name, bid in bills.items():
                amount = {"Electricity Bill": 190_000 + i * 15_000, "Water Bill": 185_000 + i * 5_000}.get(name)
                body = {"date": f"{ym}-{6 + i % 3:02d}"}
                if amount:
                    body["amount"] = amount
                await post(f"/fixed-expenses/{bid}/pay", body)
            for r_ in range(4 + i % 4):
                await post("/expenses", {"category_id": uber, "amount": 42_000 + r_ * 9_000 + i * 3_000, "date": f"{ym}-{8 + r_ * 3:02d}"})
            await post("/expenses", {"category_id": mob, "amount": 100_000, "date": f"{ym}-07"})
            await post("/expenses", {"category_id": lmt, "amount": 50_000 + i * 10_000, "date": f"{ym}-15"})
            for b in range(3 + i % 3):
                reason = ["Shopping", "Restaurant", "Day Out", "Groceries (extra)", "Fuel"][b % 5]
                method = ["card", "atm", "bank_transfer"][b % 3]
                await post("/expenses", {"category_id": bank, "amount": 180_000 + b * 70_000 + i * 20_000, "date": f"{ym}-{9 + b * 5:02d}",
                                         "method": method, "reason_id": reasons[reason]})
            # spending just before the next salary belongs to this cycle
            await post("/expenses", {"category_id": uber, "amount": 55_000, "date": f"{nxt}-03"})

        # ---- current cycle (Nov 2026, day 8); Nov salary was recorded by onboarding
        await post(f"/fixed-expenses/{bills['Foods & Households']}/pay", {"date": "2026-11-06"})
        await post(f"/fixed-expenses/{bills['Electricity Bill']}/pay", {"date": "2026-11-10", "amount": 285_000})
        await post(f"/fixed-expenses/{bills['Claude Pro']}/pay", {"date": "2026-11-07"})
        await post(f"/fixed-expenses/{bills['Broadband']}/pay", {"date": "2026-11-08"})
        for amount, d in ((48_000, "2026-11-05"), (61_000, "2026-11-07"), (39_500, "2026-11-09"), (72_000, "2026-11-12")):
            await post("/expenses", {"category_id": uber, "amount": amount, "date": d})
        await post("/expenses", {"category_id": bank, "amount": 510_000, "date": "2026-11-07", "method": "card", "reason_id": reasons["Restaurant"], "note": "Birthday dinner"})
        await post("/expenses", {"category_id": bank, "amount": 1_500_000, "date": "2026-11-08", "method": "atm", "reason_id": reasons["Shopping"]})
        await post("/expenses", {"category_id": bank, "amount": 150_000, "date": "2026-11-10", "method": "bank_transfer", "reason_id": reasons["Family"]})
        await post("/expenses", {"category_id": mob, "amount": 100_000, "date": "2026-11-06"})
        await post("/expenses", {"category_id": lmt, "amount": 60_000, "date": "2026-11-11"})

        # ---- plan: budgets + a goal
        await post("/budgets", {"target_type": "category", "target_id": uber, "amount": 400_000})
        await post("/budgets", {"target_type": "category", "target_id": lmt, "amount": 150_000})
        await post("/budgets", {"target_type": "reason", "target_id": reasons["Restaurant"], "amount": 600_000})
        await post("/budgets", {"target_type": "reason", "target_id": reasons["Shopping"], "amount": 1_200_000})
        await post("/goals", {"name": "Emergency fund", "target_amount": 50_000_000, "target_date": "2027-10-01", "saved_amount": 12_000_000,
                              "monthly_reserve": 2_000_000})

        await AuditLog.find(AuditLog.event == "login_password_ok").delete()

        OUT.mkdir(exist_ok=True)
        for old in OUT.glob("*.json"):
            old.unlink()
        dumps = {
            "me": "/auth/me",
            "settings": "/settings",
            "salary": "/settings/salary",
            "cycles": "/cycles?back=12",
            "resolve-nov": "/cycles/resolve?date=2026-11-12",
            "resolve-oct": "/cycles/resolve?date=2026-11-04",
            "overview-last": "/analytics/overview?compare=last",
            "overview-avg3": "/analytics/overview?compare=avg3",
            "overview-yoy": "/analytics/overview?compare=yoy",
            "tab-spending": "/analytics/spending?compare=last",
            "tab-bills": "/analytics/bills?months=12",
            "tab-trends": "/analytics/trends?months=12",
            "tab-plan": "/analytics/plan",
            "bills": "/fixed-expenses",
            "spending": "/spending/summary",
            "expenses-uber": f"/expenses?category_id={uber}",
            "expenses-bank": f"/expenses?category_id={bank}",
            "income": "/income",
            "categories": "/categories",
            "reasons": "/reasons",
            "sources": "/income-sources",
            "templates": "/settings/fixed-expenses",
            "activity": "/security/activity",
        }
        for name, path in dumps.items():
            res = await c.get(f"{API}{path}")
            assert res.status_code == 200, (path, res.text)
            (OUT / f"{name}.json").write_text(json.dumps(res.json(), indent=1), encoding="utf-8")
        sim = await post("/analytics/simulate", {"amount": 500_000, "category_id": bank, "reason_id": reasons["Restaurant"], "date": "2026-11-12"})
        (OUT / "simulate.json").write_text(json.dumps(sim, indent=1), encoding="utf-8")
        preview = await post("/settings/salary/preview", {"salary_day": 10})
        (OUT / "salary-preview.json").write_text(json.dumps(preview, indent=1), encoding="utf-8")
        (OUT / "ids.json").write_text(json.dumps({"uber": uber, "bank": bank}), encoding="utf-8")
        o = json.loads((OUT / "overview-last.json").read_text(encoding="utf-8"))
        print("fixtures written:", len(dumps) + 2, "| safe", o["hero"]["safe_to_spend"] / 100, "| health", o["health"]["score"],
              "| alerts", len(o["alerts"]), "| waterfall steps", len(o["waterfall"]["steps"]))


if __name__ == "__main__":
    asyncio.run(main())
