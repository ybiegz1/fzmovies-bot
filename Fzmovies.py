# fzmovies.py
import sys
import ssl
import mechanize
from bs4 import BeautifulSoup
from urllib.parse import urljoin

# ================= SSL FIX =================
ssl._create_default_https_context = ssl._create_unverified_context

BASE_URL = "https://www.fzmovies.host/"

# ================= CHECK INPUT =================
if len(sys.argv) < 2:
    print("❌ No movie name or link provided")
    sys.exit(1)

query = sys.argv[1].strip()
search_mode = not query.startswith("http")

# ================= BROWSER SETUP =================
br = mechanize.Browser()
br.set_handle_robots(False)
br.set_handle_redirect(True)
br.set_handle_refresh(True)
br.addheaders = [
    ('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
]

# ================= SEARCH MODE =================
if search_mode:
    br.open(BASE_URL)
    br.select_form(nr=0)
    br.form['searchname'] = query
    br.submit()

    soup = BeautifulSoup(br.response().read(), "html.parser")
    boxes = soup.find_all("div", class_="mainbox")

    if not boxes:
        print("❌ No results found")
        sys.exit(0)

    results = []
    for box in boxes:
        a = box.find("a", href=True)
        text = box.get_text(" ", strip=True)

        if not a:
            continue

        link = urljoin(BASE_URL, a["href"])
        results.append((link, text))

    for i, (link, text) in enumerate(results[:5], 1):
        print(f"{i}. {text}")
        print(f"   {link}")

# ================= DOWNLOAD MODE =================
else:
    br.open(query)
    soup = BeautifulSoup(br.response().read(), "html.parser")

    # Step 1: get movie file page
    files = soup.select("ul.moviesfiles a[href]")
    if not files:
        print("❌ No download pages found")
        sys.exit(0)

    movie_page = None
    for a in files:
        if "mediainfo.php" not in a["href"]:
            movie_page = urljoin(BASE_URL, a["href"])
            break

    if not movie_page:
        print("❌ No valid movie page")
        sys.exit(0)

    br.open(movie_page)
    soup = BeautifulSoup(br.response().read(), "html.parser")

    # Step 2: get final download page
    a = soup.find("a", id="downloadlink")
    if not a:
        print("❌ Download link not found")
        sys.exit(0)

    final_page = urljoin(BASE_URL, a["href"])
    br.open(final_page)
    soup = BeautifulSoup(br.response().read(), "html.parser")

    # Step 3: extract direct links
    inputs = soup.find_all("input", {"name": "download1"})
    if not inputs:
        print("❌ No direct links found")
        sys.exit(0)

    for i, inp in enumerate(inputs[:5], 1):
        print(f"{i}. {inp.get('value')}")
