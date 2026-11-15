"""Headless UI smoke test for the home page and the explorer (Playwright, Chromium).

    py -3.14 -E -P web/scripts/smoke_ui.py http://localhost:3001 out_dir [--expect live|archive]

Walks: home (sensor-illusion toggle, briefing), explorer (all 3 story chapters, province click in the
folded province comparison, Area Tools popover, the 3 tabs, the 3 dock views, calendar cell click). Collects console errors/warnings and page errors,
saves screenshots, and exits 1 if any page error or unexpected console error occurs.
"""
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

base = sys.argv[1].rstrip("/")
out = Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
expect = sys.argv[sys.argv.index("--expect") + 1] if "--expect" in sys.argv else None
# A refused connection to a configured-but-stopped API is logged by the browser itself; it is expected in that case.
allow = ["ERR_CONNECTION_REFUSED", "Download the React DevTools", "[HMR]", "[Fast Refresh]"]
problems: list[str] = []
log: list[str] = []


def watch(page, tag):
    def on_console(m):
        if m.type in ("error", "warning"):
            line = f"[{tag}] console.{m.type}: {m.text[:300]}"
            log.append(line)
            if m.type == "error" and not any(a in m.text for a in allow):
                problems.append(line)
    page.on("console", on_console)
    page.on("pageerror", lambda e: problems.append(f"[{tag}] pageerror: {e}"))


def shot(page, name):
    page.screenshot(path=str(out / f"{name}.png"))


with sync_playwright() as p:
    import glob, os
    # use any installed Playwright Chromium build if the pinned one is missing
    exe = next(iter(sorted(glob.glob(os.path.expandvars(r"%LOCALAPPDATA%\ms-playwright\chromium-*\chrome-win*\chrome.exe")), reverse=True)), None)
    b = p.chromium.launch(executable_path=exe) if exe else p.chromium.launch()
    page = b.new_page(viewport={"width": 1440, "height": 900})
    watch(page, "home")
    page.goto(base + "/", wait_until="load", timeout=180000)
    shot(page, "01_home_hero")
    page.locator("#illusion").scroll_into_view_if_needed()
    time.sleep(0.6)
    shot(page, "02_illusion_raw")
    page.get_by_role("button", name="Harmonized series true trend").click()
    time.sleep(1.0)
    shot(page, "03_illusion_harmonized")
    page.locator("#briefing-title").scroll_into_view_if_needed()
    time.sleep(1.5)
    shot(page, "04_briefing")
    pill = page.locator("#briefing-title").locator("xpath=ancestor::section").get_by_text("Archive Mode").or_(page.get_by_text("Live API ·")).first
    log.append(f"home status pill: {pill.inner_text() if pill.count() else 'not found'}")
    page.get_by_role("button", name="Explain MODIS-equivalent simply").click()
    time.sleep(4 if expect == "live" else 1.5)
    shot(page, "05_ask_widget")

    page = b.new_page(viewport={"width": 1440, "height": 900})
    watch(page, "explore")
    page.goto(base + "/explore", wait_until="load", timeout=180000)
    time.sleep(3)
    shot(page, "10_explore_load")
    status = page.locator("aside").get_by_text("Archive Mode").or_(page.locator("aside").get_by_text("Live API")).first.inner_text()
    log.append(f"explore status pill: {status}")
    if expect == "archive" and "archive" not in status.lower():
        problems.append(f"expected Archive Mode, got {status!r}")
    if expect == "live" and "live" not in status.lower():
        problems.append(f"expected Live API, got {status!r}")
    nav = page.get_by_role("navigation", name="Guided story")
    for i in range(3):
        nav.locator("button").filter(has_text=f"0{i + 1}").first.click()
        time.sleep(3.2)
        shot(page, f"1{i + 1}_story_ch{i + 1}")
    page.get_by_role("button", name="Free explore →").click()
    time.sleep(0.5)
    # province comparison (folded) click on Sindh, then the dock views
    page.get_by_role("tab", name="Insight").click()
    page.locator("aside summary").filter(has_text="Province comparison").first.click()
    time.sleep(0.4)
    page.locator("aside button").filter(has_text="Sindh").first.click()
    time.sleep(3)
    shot(page, "20_sindh")
    for t in ["Outlook", "Controls", "Insight"]:
        page.get_by_role("tab", name=t).click()
        time.sleep(1.2)
        shot(page, f"3{['Outlook', 'Controls', 'Insight'].index(t)}_tab_{t.split()[0].lower()}")
    page.get_by_role("button", name="Area Tools").click()
    time.sleep(0.5)
    shot(page, "35_area_tools")
    page.get_by_role("button", name="Area Tools").click()
    for i, d in enumerate(["Yearly trend", "Timeline"]):
        page.get_by_role("button", name=d, exact=True).click()
        time.sleep(1.2)
        shot(page, f"4{i}_dock_{d.split()[0].lower()}")
    page.get_by_role("button", name="Full Calendar Grid").click()
    time.sleep(1.2)
    # click near the right end of the calendar (recent year, mid-year month)
    box = page.locator("canvas").last.bounding_box()
    if box:
        page.mouse.move(box["x"] + box["width"] - 40, box["y"] + box["height"] * 0.35)
        time.sleep(0.6)
        shot(page, "50_calendar_hover")
        page.mouse.click(box["x"] + box["width"] - 40, box["y"] + box["height"] * 0.35)
        time.sleep(3)
        shot(page, "51_calendar_click")
    # hotspot popup: click the map centre of Punjab while a month with dots is shown
    page.get_by_role("navigation", name="Guided story").locator("button").filter(has_text="02").first.click()
    time.sleep(4)
    page.mouse.click(1000, 330)
    time.sleep(1)
    shot(page, "60_map_click")

    m = b.new_page(viewport={"width": 390, "height": 844})
    watch(m, "mobile")
    m.goto(base + "/explore", wait_until="load", timeout=180000)
    time.sleep(3)
    m.screenshot(path=str(out / "70_mobile.png"), full_page=True)
    b.close()

print("\n".join(log) or "(no console warnings/errors)")
print("PROBLEMS:" if problems else "OK: no page errors or unexpected console errors")
print("\n".join(problems))
sys.exit(1 if problems else 0)
