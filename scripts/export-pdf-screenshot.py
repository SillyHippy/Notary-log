import asyncio
import os
from playwright.async_api import async_playwright
import pypdfium2 as pdfium

SCREENSHOT_DIR = "/home/workspace/Projects/Notary-log/artifacts/notary-journal/public/screenshots"
os.makedirs(SCREENSHOT_DIR, exist_ok=True)

async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={"width": 1280, "height": 850},
            device_scale_factor=2,
            accept_downloads=True,
        )
        page = await context.new_page()

        # 1. Setup PIN
        await page.goto("http://127.0.0.1:4173/")
        await page.wait_for_timeout(1000)

        pin_inputs = page.locator('input[type="password"]')
        if await pin_inputs.count() >= 2:
            await pin_inputs.nth(0).fill("1234")
            await pin_inputs.nth(1).fill("1234")
            await page.click('button:has-text("Create PIN"), button:has-text("Encrypt journal")')
            await page.wait_for_timeout(1500)

        # 2. Add 2 entries
        for name, doc in [("Sarah M. Jenkins", "Warranty Deed & Affidavit of Title"), ("David K. Reynolds", "Power of Attorney")]:
            await page.goto("http://127.0.0.1:4173/entry/new")
            await page.wait_for_timeout(1000)
            
            inputs = page.locator('input')
            for i in range(await inputs.count()):
                n = await inputs.nth(i).get_attribute("name") or await inputs.nth(i).get_attribute("id") or ""
                ph = await inputs.nth(i).get_attribute("placeholder") or ""
                if "name" in n.lower() or "signer" in n.lower() or "name" in ph.lower():
                    await inputs.nth(i).fill(name)
                elif "address" in n.lower() or "address" in ph.lower():
                    await inputs.nth(i).fill("1042 Elmwood Ave, Tulsa, OK")
                elif "city" in n.lower():
                    await inputs.nth(i).fill("Tulsa")
                elif "state" in n.lower():
                    await inputs.nth(i).fill("OK")
                elif "doc" in n.lower() or "title" in ph.lower():
                    await inputs.nth(i).fill(doc)

            # Click complete / save entry
            save_btn = page.locator('button:has-text("Complete"), button:has-text("Save Entry"), button:has-text("Save")')
            if await save_btn.count() > 0:
                await save_btn.first.click()
                await page.wait_for_timeout(1000)

        # 3. Go to Reports & Trigger Print Journal download
        await page.goto("http://127.0.0.1:4173/reports")
        await page.wait_for_timeout(1500)

        # Look for Print Journal or Export PDF button
        print_btn = page.locator('button:has-text("Print Journal"), button:has-text("Official Journal PDF"), button:has-text("Export PDF")')
        if await print_btn.count() > 0:
            async with page.expect_download() as download_info:
                await print_btn.first.click()
            download = await download_info.value
            pdf_path = f"{SCREENSHOT_DIR}/sample-official-journal.pdf"
            await download.save_as(pdf_path)
            print(f"Downloaded PDF to {pdf_path}")

            # Convert PDF Page 1 to high-res PNG image
            pdf = pdfium.PdfDocument(pdf_path)
            page_0 = pdf[0]
            bitmap = page_0.render(scale=2)
            pil_image = bitmap.to_pil()
            pil_image.save(f"{SCREENSHOT_DIR}/print-journal-sample.png")
            print("Saved print-journal-sample.png!")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(run())
