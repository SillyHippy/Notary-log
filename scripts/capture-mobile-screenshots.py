import asyncio
import os
from playwright.async_api import async_playwright

SCREENSHOT_DIR = "/home/workspace/Projects/Notary-log/artifacts/notary-journal/public/screenshots"
os.makedirs(SCREENSHOT_DIR, exist_ok=True)

async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)

        # Mobile viewport (390 x 844) iPhone style
        m_context = await browser.new_context(
            viewport={"width": 390, "height": 844},
            device_scale_factor=2,
            is_mobile=True,
            has_touch=True,
        )
        page = await m_context.new_page()

        # 1. PIN Setup screen on mobile
        await page.goto("http://127.0.0.1:4173/")
        await page.wait_for_timeout(1000)
        await page.screenshot(path=f"{SCREENSHOT_DIR}/mobile-pin.png", full_page=False)

        # Setup PIN
        pin_inputs = page.locator('input[type="password"]')
        if await pin_inputs.count() >= 2:
            await pin_inputs.nth(0).fill("1234")
            await pin_inputs.nth(1).fill("1234")
            await page.click('button:has-text("Create PIN"), button:has-text("Encrypt journal")')
            await page.wait_for_timeout(2000)

        # 2. Mobile Dashboard
        await page.screenshot(path=f"{SCREENSHOT_DIR}/mobile-dashboard.png", full_page=False)

        # 3. Mobile New Entry - Step 1
        await page.goto("http://127.0.0.1:4173/entry/new")
        await page.wait_for_timeout(1500)

        inputs = page.locator('input')
        for i in range(await inputs.count()):
            name = await inputs.nth(i).get_attribute("name") or await inputs.nth(i).get_attribute("id") or ""
            placeholder = await inputs.nth(i).get_attribute("placeholder") or ""
            if "name" in name.lower() or "signer" in name.lower() or "name" in placeholder.lower():
                await inputs.nth(i).fill("Sarah M. Jenkins")
            elif "address" in name.lower() or "address" in placeholder.lower():
                await inputs.nth(i).fill("1042 Elmwood Ave, Tulsa, OK")
            elif "city" in name.lower():
                await inputs.nth(i).fill("Tulsa")
            elif "state" in name.lower():
                await inputs.nth(i).fill("OK")
            elif "doc" in name.lower() or "title" in placeholder.lower():
                await inputs.nth(i).fill("Power of Attorney & Health Directive")

        await page.screenshot(path=f"{SCREENSHOT_DIR}/mobile-entry.png", full_page=False)

        # 4. Mobile Journal List
        await page.goto("http://127.0.0.1:4173/journal")
        await page.wait_for_timeout(1500)
        await page.screenshot(path=f"{SCREENSHOT_DIR}/mobile-journal.png", full_page=False)

        # 5. Mobile Bookings / Appointments
        await page.goto("http://127.0.0.1:4173/bookings")
        await page.wait_for_timeout(1500)
        await page.screenshot(path=f"{SCREENSHOT_DIR}/mobile-bookings.png", full_page=False)

        # 6. Mobile Settings & Integrity Check
        await page.goto("http://127.0.0.1:4173/settings")
        await page.wait_for_timeout(1500)
        await page.screenshot(path=f"{SCREENSHOT_DIR}/mobile-settings.png", full_page=False)

        await browser.close()
        print("All mobile screenshots generated in:", SCREENSHOT_DIR)

if __name__ == "__main__":
    asyncio.run(run())
