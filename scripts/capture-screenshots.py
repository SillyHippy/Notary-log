import asyncio
import os
from playwright.async_api import async_playwright

SCREENSHOT_DIR = "/home/workspace/Projects/Notary-log/artifacts/notary-journal/public/screenshots"
os.makedirs(SCREENSHOT_DIR, exist_ok=True)

async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={"width": 1280, "height": 850},
            device_scale_factor=2,
        )
        page = await context.new_page()

        # 1. First visit - PIN Setup screen
        await page.goto("http://127.0.0.1:4173/")
        await page.wait_for_timeout(1000)
        await page.screenshot(path=f"{SCREENSHOT_DIR}/pin-setup.png", full_page=False)

        # Set PIN
        pin_inputs = page.locator('input[type="password"]')
        if await pin_inputs.count() >= 2:
            await pin_inputs.nth(0).fill("1234")
            await pin_inputs.nth(1).fill("1234")
            await page.click('button:has-text("Create PIN"), button:has-text("Encrypt journal")')
            await page.wait_for_timeout(2000)

        # 2. Populate a rich sample journal entry via UI
        await page.goto("http://127.0.0.1:4173/entry/new")
        await page.wait_for_timeout(1500)

        # Select Acknowledgment and type details if fields exist
        inputs = page.locator('input')
        for i in range(await inputs.count()):
            name = await inputs.nth(i).get_attribute("name") or await inputs.nth(i).get_attribute("id") or ""
            placeholder = await inputs.nth(i).get_attribute("placeholder") or ""
            if "name" in name.lower() or "signer" in name.lower() or "name" in placeholder.lower():
                await inputs.nth(i).fill("Eleanor R. Vance")
            elif "address" in name.lower() or "address" in placeholder.lower():
                await inputs.nth(i).fill("742 Evergreen Terrace, Springfield, IL")
            elif "city" in name.lower():
                await inputs.nth(i).fill("Springfield")
            elif "state" in name.lower():
                await inputs.nth(i).fill("IL")
            elif "doc" in name.lower() or "title" in placeholder.lower():
                await inputs.nth(i).fill("Warranty Deed & Affidavit of Title")

        # Capture New Entry form view
        await page.screenshot(path=f"{SCREENSHOT_DIR}/new-entry.png", full_page=False)

        # 3. Reports & Official Print Journal
        await page.goto("http://127.0.0.1:4173/reports")
        await page.wait_for_timeout(1500)
        await page.screenshot(path=f"{SCREENSHOT_DIR}/reports-ledger.png", full_page=False)

        # 4. Settings / Chain Verification & Integrity
        await page.goto("http://127.0.0.1:4173/settings")
        await page.wait_for_timeout(1500)
        await page.screenshot(path=f"{SCREENSHOT_DIR}/settings-integrity.png", full_page=False)

        # 5. Mobile App Frame (414 x 896)
        m_page = await context.new_page()
        await m_page.set_viewport_size({"width": 414, "height": 896})
        await m_page.goto("http://127.0.0.1:4173/")
        await m_page.wait_for_timeout(1500)
        await m_page.screenshot(path=f"{SCREENSHOT_DIR}/mobile-dashboard.png", full_page=False)

        await m_page.goto("http://127.0.0.1:4173/entry/new")
        await m_page.wait_for_timeout(1500)
        await m_page.screenshot(path=f"{SCREENSHOT_DIR}/mobile-entry.png", full_page=False)

        await browser.close()
        print("Optimized high-res screenshots created in:", SCREENSHOT_DIR)

if __name__ == "__main__":
    asyncio.run(run())
