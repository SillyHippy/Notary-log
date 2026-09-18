import asyncio
import os
from playwright.async_api import async_playwright

SCREENSHOT_DIR = "/home/workspace/Projects/Notary-log/artifacts/notary-journal/public/screenshots"
os.makedirs(SCREENSHOT_DIR, exist_ok=True)

async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)

        # Tablet Viewport (iPad Pro style: 834 x 1194 or 1024 x 768 landscape)
        t_context = await browser.new_context(
            viewport={"width": 1024, "height": 768},
            device_scale_factor=2,
            has_touch=True,
        )
        page = await t_context.new_page()

        # 1. Tablet Setup PIN / Unlock
        await page.goto("http://127.0.0.1:4173/")
        await page.wait_for_timeout(1000)

        pin_inputs = page.locator('input[type="password"]')
        if await pin_inputs.count() >= 2:
            await pin_inputs.nth(0).fill("1234")
            await pin_inputs.nth(1).fill("1234")
            await page.click('button:has-text("Create PIN"), button:has-text("Encrypt journal")')
            await page.wait_for_timeout(1500)

        # 2. Tablet Dashboard
        await page.screenshot(path=f"{SCREENSHOT_DIR}/tablet-dashboard.png", full_page=False)

        # 3. Tablet New Entry Form
        await page.goto("http://127.0.0.1:4173/entry/new")
        await page.wait_for_timeout(1500)

        inputs = page.locator('input')
        for i in range(await inputs.count()):
            name = await inputs.nth(i).get_attribute("name") or await inputs.nth(i).get_attribute("id") or ""
            placeholder = await inputs.nth(i).get_attribute("placeholder") or ""
            if "name" in name.lower() or "signer" in name.lower() or "name" in placeholder.lower():
                await inputs.nth(i).fill("Marcus Aurelius Sterling")
            elif "address" in name.lower() or "address" in placeholder.lower():
                await inputs.nth(i).fill("4500 S Harvard Ave, Tulsa, OK 74135")
            elif "city" in name.lower():
                await inputs.nth(i).fill("Tulsa")
            elif "state" in name.lower():
                await inputs.nth(i).fill("OK")
            elif "doc" in name.lower() or "title" in placeholder.lower():
                await inputs.nth(i).fill("Commercial Lease Guarantee & Acknowledgment")

        await page.screenshot(path=f"{SCREENSHOT_DIR}/tablet-entry.png", full_page=False)

        # 4. Tablet Journal Ledger
        await page.goto("http://127.0.0.1:4173/journal")
        await page.wait_for_timeout(1500)
        await page.screenshot(path=f"{SCREENSHOT_DIR}/tablet-journal.png", full_page=False)

        # 5. Tablet Reports / Ledger
        await page.goto("http://127.0.0.1:4173/reports")
        await page.wait_for_timeout(1500)
        await page.screenshot(path=f"{SCREENSHOT_DIR}/tablet-reports.png", full_page=False)

        await browser.close()
        print("Tablet screenshots generated in:", SCREENSHOT_DIR)

if __name__ == "__main__":
    asyncio.run(run())
