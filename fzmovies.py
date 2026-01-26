# fzmovies.py
import sys
import mechanize
from bs4 import BeautifulSoup

search_mode = True
if len(sys.argv) < 2:
    print("❌ No movie name provided")
    sys.exit(1)

query = sys.argv[1]

# If the argument is already a link, we just fetch download links
if query.startswith("https://fzmovies.host/"):
    search_mode = False

br = mechanize.Browser()
br.set_handle_robots(False)
br.addheaders = [('User-agent', 'Mozilla/5.0')]

if search_mode:
    # Search mode
    br.open("https://www.fzmovies.host/")
    br.select_form(nr=0)
    br.form['searchname'] = query
    br.submit()

    soup = BeautifulSoup(br.response().read(), 'html.parser')
    divs = soup.find_all("div", {"class": "mainbox"})

    details = []
    links = []

    for div in divs:
        for a in div.find_all('a', href=True):
            links.append(a['href'])
        details.append(div.find_all(text=True))

    perf_list = []
    links = list(dict.fromkeys(links))
    for link in links:
        if link != '' and 'movietags' not in link:
            perf_list.append(link)

    # Print up to 5 results as: link|title|year|quality
    for link, ident in zip(perf_list[:5], details[:5]):
        title = ident[1].strip() if len(ident) > 1 else "No title"
        year = ident[3].strip() if len(ident) > 3 else "Unknown"
        quality = ident[5].strip() if len(ident) > 5 else "Unknown"
        print(f"https://fzmovies.host/{link}|{title}|{year}|{quality}")

else:
    # Download link mode
    detail = query.replace(" ", "%20")
    r = br.open(detail)
    soup = BeautifulSoup(br.response().read(), 'html.parser')

    down_page = []
    for ul in soup.find_all("ul", {"class": "moviesfiles"}):
        for a in ul.find_all('a', href=True):
            href = a['href']
            if 'mediainfo.php' not in href:
                down_page.append('fzmovies.host/' + href)

    down_conf = down_page[0]
    r = br.open('https://' + down_conf)
    soup = BeautifulSoup(br.response().read(), 'html.parser')

    a_tag = soup.find("a", {"id": "downloadlink"})
    down_page_2 = 'https://fzmovies.host/' + a_tag['href']

    r = br.open(down_page_2)
    soup = BeautifulSoup(br.response().read(), 'html.parser')

    down_link = soup.find_all("input", {"name": "download1"})
    for inp in down_link[:5]:
        print(inp['value'])
