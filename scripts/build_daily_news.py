"""Build site/daily/news.json: the day's headlines from about 90 public news feeds, for the Daily News page.

Each story keeps only its headline, a short summary, a thumbnail and a link to the publisher; full articles are never
copied. Outlets without a public feed (or whose feed fails) are filled from Google News results limited to that site.
Stories are tagged with genres (from the feed and from words in the headline), with the Canadian province or US state
they are about, and stories that many outlets are covering are grouped as the day's big stories.
    python scripts/build_daily_news.py
"""
from __future__ import annotations

import json
import re
import sys
import time
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import quote_plus

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from safe_io import write_text  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "site" / "daily" / "news.json"
# Google News results from earlier runs: the page refreshes every 15 minutes, but searches only every hour or two
CACHE = ROOT / "site" / "daily" / "search-cache.json"
SEARCH_EVERY = {"outlets": timedelta(minutes=55), "local": timedelta(minutes=115)}
MAX_AGE = timedelta(hours=48)
PER_FEED = 25
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36 topticker-news"}
MEDIA = "{http://search.yahoo.com/mrss/}"
ATOM = "{http://www.w3.org/2005/Atom}"
CONTENT = "{http://purl.org/rss/1.0/modules/content/}"
DC = "{http://purl.org/dc/elements/1.1/}"

GENRES = [
    ("world", "World", "🌍"), ("us", "U.S.", "🇺🇸"), ("canada", "Canada", "🇨🇦"), ("politics", "Politics", "🏛️"),
    ("business", "Business", "💼"), ("markets", "Markets", "📈"), ("tech", "Tech", "💻"), ("science", "Science & space", "🔭"),
    ("health", "Health", "🩺"), ("weather", "Weather", "🌦️"), ("sports", "Sports", "🏟️"), ("sportsbiz", "Sports business", "💰"),
    ("betting", "Betting & odds", "🎲"), ("entertainment", "Entertainment", "🎬"), ("gaming", "Gaming", "🎮"),
    ("crypto", "Crypto", "🪙"), ("autos", "Cars & EVs", "🚗"), ("lifestyle", "Food & travel", "🍽️"), ("good", "Good news", "🌞"),
]

# outlet id, name, site, country, genres, feeds; a feed is a URL or (URL, province or state code)
# The first ten are the ones asked for by name.
OUTLETS = [
    ("yahoo", "Yahoo News & Finance", "yahoo.com", "US", ["us", "world"], ["https://news.yahoo.com/rss/", ("https://sports.yahoo.com/rss/", None, ["sports"])]),
    ("cnbc", "CNBC", "cnbc.com", "US", ["business"], [
        "https://www.cnbc.com/id/100003114/device/rss/rss.html", ("https://www.cnbc.com/id/15837362/device/rss/rss.html", None, ["us"]),
        ("https://www.cnbc.com/id/100727362/device/rss/rss.html", None, ["world"]), ("https://www.cnbc.com/id/19854910/device/rss/rss.html", None, ["tech"]),
        ("https://www.cnbc.com/id/100370673/device/rss/rss.html", None, ["markets"])]),
    ("bloomberg", "Bloomberg", "bloomberg.com", "US", ["business"], [
        ("https://feeds.bloomberg.com/markets/news.rss", None, ["markets"]), ("https://feeds.bloomberg.com/politics/news.rss", None, ["politics"]),
        ("https://feeds.bloomberg.com/technology/news.rss", None, ["tech"]), "https://feeds.bloomberg.com/economics/news.rss",
        "https://feeds.bloomberg.com/business/news.rss"]),
    ("forbes", "Forbes", "forbes.com", "US", ["business"], [
        "https://www.forbes.com/business/feed/", ("https://www.forbes.com/innovation/feed/", None, ["tech"]),
        ("https://www.forbes.com/sportsmoney/feed/", None, ["sportsbiz"])]),
    ("cnn", "CNN", "cnn.com", "US", ["us", "world"], []),  # CNN's RSS feeds stopped updating in 2023
    ("fos", "Front Office Sports", "frontofficesports.com", "US", ["sportsbiz"], ["https://frontofficesports.com/feed/"]),
    ("benzinga", "Benzinga", "benzinga.com", "US", ["markets"], ["https://www.benzinga.com/feed"]),
    ("sbj", "Sports Business Journal", "sportsbusinessjournal.com", "US", ["sportsbiz"], ["https://www.sportsbusinessjournal.com/rss"]),
    ("espn", "ESPN", "espn.com", "US", ["sports"], ["https://www.espn.com/espn/rss/news"]),
    ("action", "The Action Network", "actionnetwork.com", "US", ["betting"], []),
    # ---- world and U.S.
    ("ap", "Associated Press", "apnews.com", "US", ["us", "world"], []),
    ("reuters", "Reuters", "reuters.com", "", ["world", "business"], []),
    ("bbc", "BBC News", "bbc.com", "", ["world"], ["https://feeds.bbci.co.uk/news/world/rss.xml", "https://feeds.bbci.co.uk/news/rss.xml"]),
    ("nyt", "New York Times", "nytimes.com", "US", ["us"], ["https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml", ("https://rss.nytimes.com/services/xml/rss/nyt/World.xml", None, ["world"])]),
    ("npr", "NPR", "npr.org", "US", ["us"], ["https://feeds.npr.org/1001/rss.xml", ("https://feeds.npr.org/1007/rss.xml", None, ["science"])]),
    ("abc", "ABC News", "abcnews.go.com", "US", ["us"], ["https://feeds.abcnews.com/abcnews/topstories"]),
    ("cbs", "CBS News", "cbsnews.com", "US", ["us"], ["https://www.cbsnews.com/latest/rss/main"]),
    ("nbc", "NBC News", "nbcnews.com", "US", ["us"], ["https://feeds.nbcnews.com/nbcnews/public/news"]),
    ("pbs", "PBS NewsHour", "pbs.org", "US", ["us"], ["https://www.pbs.org/newshour/feeds/rss/headlines"]),
    ("wapo", "Washington Post", "washingtonpost.com", "US", ["world"], ["https://feeds.washingtonpost.com/rss/world"]),
    ("latimes", "Los Angeles Times", "latimes.com", "US", ["us"], [("https://www.latimes.com/world-nation/rss2.0.xml", None, ["us", "world"])]),
    ("axios", "Axios", "axios.com", "US", ["us"], ["https://www.axios.com/feeds/feed.rss"]),
    ("hill", "The Hill", "thehill.com", "US", ["politics"], ["https://thehill.com/news/feed/"]),
    ("politico", "Politico", "politico.com", "US", ["politics"], []),
    ("guardian", "The Guardian", "theguardian.com", "", ["world"], ["https://www.theguardian.com/world/rss"]),
    ("aljazeera", "Al Jazeera", "aljazeera.com", "", ["world"], ["https://www.aljazeera.com/xml/rss/all.xml"]),
    ("france24", "France 24", "france24.com", "", ["world"], ["https://www.france24.com/en/rss"]),
    ("euronews", "Euronews", "euronews.com", "", ["world"], ["https://www.euronews.com/rss"]),
    ("scmp", "South China Morning Post", "scmp.com", "", ["world"], ["https://www.scmp.com/rss/91/feed"]),
    ("japantimes", "Japan Times", "japantimes.co.jp", "", ["world"], ["https://www.japantimes.co.jp/feed/"]),
    ("abcau", "ABC Australia", "abc.net.au", "", ["world"], ["https://www.abc.net.au/news/feed/51120/rss.xml"]),
    ("atlantic", "The Atlantic", "theatlantic.com", "US", ["us"], ["https://www.theatlantic.com/feed/all/"]),
    # ---- Canada (regional feeds carry their province)
    ("cbc", "CBC News", "cbc.ca", "CA", ["canada"], [
        "https://www.cbc.ca/webfeed/rss/rss-topstories", "https://www.cbc.ca/webfeed/rss/rss-canada",
        ("https://www.cbc.ca/webfeed/rss/rss-politics", None, ["politics"]), ("https://www.cbc.ca/webfeed/rss/rss-business", None, ["business"]),
        ("https://www.cbc.ca/webfeed/rss/rss-health", None, ["health"]), ("https://www.cbc.ca/webfeed/rss/rss-technology", None, ["tech", "science"]),
        ("https://www.cbc.ca/webfeed/rss/rss-arts", None, ["entertainment"]), ("https://www.cbc.ca/webfeed/rss/rss-sports", None, ["sports"]),
        ("https://www.cbc.ca/webfeed/rss/rss-canada-britishcolumbia", "CA-BC"), ("https://www.cbc.ca/webfeed/rss/rss-canada-calgary", "CA-AB"),
        ("https://www.cbc.ca/webfeed/rss/rss-canada-edmonton", "CA-AB"), ("https://www.cbc.ca/webfeed/rss/rss-canada-saskatchewan", "CA-SK"),
        ("https://www.cbc.ca/webfeed/rss/rss-canada-manitoba", "CA-MB"), ("https://www.cbc.ca/webfeed/rss/rss-canada-toronto", "CA-ON"),
        ("https://www.cbc.ca/webfeed/rss/rss-canada-ottawa", "CA-ON"), ("https://www.cbc.ca/webfeed/rss/rss-canada-montreal", "CA-QC"),
        ("https://www.cbc.ca/webfeed/rss/rss-canada-newbrunswick", "CA-NB"), ("https://www.cbc.ca/webfeed/rss/rss-canada-novascotia", "CA-NS"),
        ("https://www.cbc.ca/webfeed/rss/rss-canada-pei", "CA-PE"), ("https://www.cbc.ca/webfeed/rss/rss-canada-newfoundland", "CA-NL"),
        ("https://www.cbc.ca/webfeed/rss/rss-canada-north", "CA-NORTH")]),
    ("global", "Global News", "globalnews.ca", "CA", ["canada"], [
        "https://globalnews.ca/canada/feed/", ("https://globalnews.ca/bc/feed/", "CA-BC"), ("https://globalnews.ca/calgary/feed/", "CA-AB"),
        ("https://globalnews.ca/edmonton/feed/", "CA-AB"), ("https://globalnews.ca/regina/feed/", "CA-SK"), ("https://globalnews.ca/saskatoon/feed/", "CA-SK"),
        ("https://globalnews.ca/winnipeg/feed/", "CA-MB"), ("https://globalnews.ca/toronto/feed/", "CA-ON"), ("https://globalnews.ca/ottawa/feed/", "CA-ON"),
        ("https://globalnews.ca/montreal/feed/", "CA-QC"), ("https://globalnews.ca/new-brunswick/feed/", "CA-NB"), ("https://globalnews.ca/halifax/feed/", "CA-NS")]),
    ("ctv", "CTV News", "ctvnews.ca", "CA", ["canada"], []),
    ("globe", "The Globe and Mail", "theglobeandmail.com", "CA", ["canada"], [
        "https://www.theglobeandmail.com/arc/outboundfeeds/rss/category/canada/",
        ("https://www.theglobeandmail.com/arc/outboundfeeds/rss/category/business/", None, ["business"])]),
    ("natpost", "National Post", "nationalpost.com", "CA", ["canada"], []),
    ("star", "Toronto Star", "thestar.com", "CA", ["canada"], []),
    ("sun", "Toronto Sun", "torontosun.com", "CA", ["canada"], [("https://torontosun.com/feed/", "CA-ON")]),
    ("bnn", "BNN Bloomberg", "bnnbloomberg.ca", "CA", ["business", "markets"], ["https://www.bnnbloomberg.ca/arc/outboundfeeds/rss/"]),
    ("macleans", "Maclean's", "macleans.ca", "CA", ["canada"], ["https://www.macleans.ca/feed/"]),
    ("dailyhive", "Daily Hive", "dailyhive.com", "CA", ["canada"], ["https://dailyhive.com/feed"]),
    ("tyee", "The Tyee", "thetyee.ca", "CA", ["canada"], [("https://thetyee.ca/rss2.xml", "CA-BC")]),
    ("tsn", "TSN", "tsn.ca", "CA", ["sports"], []),
    # ---- business and markets
    ("marketwatch", "MarketWatch", "marketwatch.com", "US", ["markets"], ["https://feeds.content.dowjones.io/public/rss/mw_topstories"]),
    ("economist", "The Economist", "economist.com", "", ["world", "business"], ["https://www.economist.com/the-world-this-week/rss.xml"]),
    # ---- tech, science, health
    ("verge", "The Verge", "theverge.com", "US", ["tech"], ["https://www.theverge.com/rss/index.xml"]),
    ("techcrunch", "TechCrunch", "techcrunch.com", "US", ["tech"], ["https://techcrunch.com/feed/"]),
    ("ars", "Ars Technica", "arstechnica.com", "US", ["tech"], ["https://feeds.arstechnica.com/arstechnica/index"]),
    ("wired", "Wired", "wired.com", "US", ["tech"], ["https://www.wired.com/feed/rss"]),
    ("engadget", "Engadget", "engadget.com", "US", ["tech"], ["https://www.engadget.com/rss.xml"]),
    ("sciencedaily", "ScienceDaily", "sciencedaily.com", "", ["science"], ["https://www.sciencedaily.com/rss/top/science.xml"]),
    ("space", "Space.com", "space.com", "", ["science"], ["https://www.space.com/feeds/all"]),
    ("nasa", "NASA", "nasa.gov", "", ["science"], ["https://www.nasa.gov/news-release/feed/"]),
    ("livescience", "Live Science", "livescience.com", "", ["science"], ["https://www.livescience.com/feeds/all"]),
    ("sciencenews", "Science News", "sciencenews.org", "", ["science"], ["https://www.sciencenews.org/feed"]),
    ("stat", "STAT", "statnews.com", "US", ["health"], ["https://www.statnews.com/feed/"]),
    # ---- sports and betting
    ("athletic", "The Athletic", "nytimes.com/athletic", "", ["sports"], ["https://www.nytimes.com/athletic/rss/news/"]),
    ("cbssports", "CBS Sports", "cbssports.com", "US", ["sports"], ["https://www.cbssports.com/rss/headlines/"]),
    ("sportico", "Sportico", "sportico.com", "US", ["sportsbiz"], ["https://www.sportico.com/feed/"]),
    ("covers", "Covers", "covers.com", "", ["betting"], ["https://www.covers.com/rss"]),
    # ---- entertainment and games
    ("variety", "Variety", "variety.com", "", ["entertainment"], ["https://variety.com/feed/"]),
    ("thr", "The Hollywood Reporter", "hollywoodreporter.com", "", ["entertainment"], ["https://www.hollywoodreporter.com/feed/"]),
    ("billboard", "Billboard", "billboard.com", "", ["entertainment"], ["https://www.billboard.com/feed/"]),
    ("rollingstone", "Rolling Stone", "rollingstone.com", "", ["entertainment"], ["https://www.rollingstone.com/feed/"]),
    ("eonline", "E! News", "eonline.com", "", ["entertainment"], ["https://www.eonline.com/syndication/feeds/rssfeeds/topstories.xml"]),
    ("ign", "IGN", "ign.com", "", ["gaming"], ["https://feeds.feedburner.com/ign/news"]),
    ("polygon", "Polygon", "polygon.com", "", ["gaming"], ["https://www.polygon.com/rss/index.xml"]),
    ("gamespot", "GameSpot", "gamespot.com", "", ["gaming"], ["https://www.gamespot.com/feeds/news/"]),
    # ---- crypto, cars, food and travel, good news
    ("coindesk", "CoinDesk", "coindesk.com", "", ["crypto"], ["https://www.coindesk.com/arc/outboundfeeds/rss/"]),
    ("decrypt", "Decrypt", "decrypt.co", "", ["crypto"], ["https://decrypt.co/feed"]),
    ("electrek", "Electrek", "electrek.co", "", ["autos"], ["https://electrek.co/feed/"]),
    ("motor1", "Motor1", "motor1.com", "", ["autos"], ["https://www.motor1.com/rss/news/all/"]),
    ("caranddriver", "Car and Driver", "caranddriver.com", "", ["autos"], ["https://www.caranddriver.com/rss/all.xml/"]),
    ("bonappetit", "Bon Appétit", "bonappetit.com", "", ["lifestyle"], ["https://www.bonappetit.com/feed/rss"]),
    ("cntraveler", "Condé Nast Traveler", "cntraveler.com", "", ["lifestyle"], ["https://www.cntraveler.com/feed/rss"]),
    ("eater", "Eater", "eater.com", "", ["lifestyle"], ["https://www.eater.com/rss/index.xml"]),
    ("gnn", "Good News Network", "goodnewsnetwork.org", "", ["good"], ["https://www.goodnewsnetwork.org/feed/"]),
    ("upworthy", "Upworthy", "upworthy.com", "", ["good"], ["https://www.upworthy.com/feeds/feed.rss"]),
]
# Outlets filled from Google News when their own feed is missing or thin: the search words keep it to news
SEARCH = {"yahoo": "site:finance.yahoo.com", "benzinga": "site:benzinga.com", "cnn": "site:cnn.com", "sbj": "site:sportsbusinessjournal.com", "espn": "site:espn.com",
          "action": "site:actionnetwork.com", "ap": "site:apnews.com", "reuters": "site:reuters.com", "politico": "site:politico.com",
          "ctv": "site:ctvnews.ca", "natpost": "site:nationalpost.com", "star": "site:thestar.com", "tsn": "site:tsn.ca"}

# ---------------------------------------------------------------- places
PROVINCES = {  # code: (name, words a headline may use)
    "CA-BC": ("British Columbia", r"British Columbia|B\.C\.|Vancouver|Victoria, B|Surrey|Burnaby|Kelowna|Okanagan|Nanaimo|Squamish|Whistler|Abbotsford|Coquitlam|Richmond, B|Kamloops|Prince George"),
    "CA-AB": ("Alberta", r"Alberta|Alta\.|Calgary|Edmonton|Red Deer|Lethbridge|Banff|Fort McMurray|Medicine Hat|Danielle Smith"),
    "CA-SK": ("Saskatchewan", r"Saskatchewan|Sask\.|Regina|Saskatoon|Moose Jaw|Prince Albert|Roughriders"),
    "CA-MB": ("Manitoba", r"Manitoba|Man\.|Winnipeg|Brandon|Churchill, Man|Kinew"),
    "CA-ON": ("Ontario", r"Ontario|Ont\.|Toronto|Ottawa|Mississauga|Brampton|Hamilton, Ont|London, Ont|Kitchener|Waterloo, Ont|Windsor, Ont|Sudbury|Thunder Bay|Kingston, Ont|Barrie|Guelph|Niagara|Oshawa|Markham|Vaughan|Doug Ford|Leafs|Senators"),
    "CA-QC": ("Quebec", r"Quebec|Québec|Que\.|Montreal|Montréal|Laval|Gatineau|Sherbrooke|Trois-Rivi|Saguenay|Granby|Legault|Plamondon|Canadiens"),
    "CA-NB": ("New Brunswick", r"New Brunswick|N\.B\.|Fredericton|Moncton|Saint John"),
    "CA-NS": ("Nova Scotia", r"Nova Scotia|N\.S\.|Halifax|Dartmouth|Cape Breton|Sydney, N\.S"),
    "CA-PE": ("Prince Edward Island", r"Prince Edward Island|P\.E\.I\.|PEI\b|Charlottetown|Summerside"),
    "CA-NL": ("Newfoundland and Labrador", r"Newfoundland|Labrador|N\.L\.|St\. John's"),
    "CA-YT": ("Yukon", r"Yukon|Whitehorse"),
    "CA-NT": ("Northwest Territories", r"Northwest Territories|N\.W\.T\.|Yellowknife"),
    "CA-NU": ("Nunavut", r"Nunavut|Iqaluit"),
}
STATES = {
    "AL": ("Alabama", "Birmingham, Ala|Montgomery, Ala|Huntsville|Mobile, Ala|Crimson Tide"), "AK": ("Alaska", "Anchorage|Juneau|Fairbanks"),
    "AZ": ("Arizona", "Phoenix|Tucson|Scottsdale|Mesa, Ariz"), "AR": ("Arkansas", "Little Rock|Fayetteville, Ark"),
    "CA": ("California", "Los Angeles|San Francisco|San Diego|San Jose|Sacramento|Oakland|Silicon Valley|Hollywood|Newsom|Bay Area|Fresno|Long Beach"),
    "CO": ("Colorado", "Denver|Boulder|Colorado Springs|Aurora, Colo"), "CT": ("Connecticut", "Hartford|New Haven|Stamford"),
    "DE": ("Delaware", "Wilmington, Del|Dover, Del"), "DC": ("District of Columbia", "Washington, D\\.C|D\\.C\\.|Washington DC"),
    "FL": ("Florida", "Miami|Orlando|Tampa|Jacksonville|Tallahassee|Fort Lauderdale|DeSantis|St\\. Petersburg, Fla"),
    "GA": ("Georgia", "Atlanta|Savannah|Augusta, Ga"), "HI": ("Hawaii", "Honolulu|Maui|Oahu"), "ID": ("Idaho", "Boise"),
    "IL": ("Illinois", "Chicago|Springfield, Ill|Pritzker"), "IN": ("Indiana", "Indianapolis|Fort Wayne|Notre Dame"),
    "IA": ("Iowa", "Des Moines|Cedar Rapids"), "KS": ("Kansas", "Wichita|Topeka"), "KY": ("Kentucky", "Louisville|Lexington, Ky"),
    "LA": ("Louisiana", "New Orleans|Baton Rouge|Shreveport"), "ME": ("Maine", "Portland, Maine|Bangor"),
    "MD": ("Maryland", "Baltimore|Annapolis"), "MA": ("Massachusetts", "Boston|Cambridge, Mass|Worcester"),
    "MI": ("Michigan", "Detroit|Grand Rapids|Ann Arbor|Lansing|Whitmer"), "MN": ("Minnesota", "Minneapolis|St\\. Paul|Duluth"),
    "MS": ("Mississippi", "Jackson, Miss|Biloxi"), "MO": ("Missouri", "St\\. Louis|Kansas City|Springfield, Mo"),
    "MT": ("Montana", "Billings|Missoula|Bozeman"), "NE": ("Nebraska", "Omaha|Lincoln, Neb"), "NV": ("Nevada", "Las Vegas|Reno"),
    "NH": ("New Hampshire", "Manchester, N\\.H|Concord, N\\.H"), "NJ": ("New Jersey", "Newark|Jersey City|Atlantic City|Trenton"),
    "NM": ("New Mexico", "Albuquerque|Santa Fe"), "NY": ("New York", "Manhattan|Brooklyn|Queens|Bronx|Buffalo|Albany|NYC|Hochul|Mamdani"),
    "NC": ("North Carolina", "Charlotte|Raleigh|Durham|Asheville"), "ND": ("North Dakota", "Fargo|Bismarck"),
    "OH": ("Ohio", "Columbus, Ohio|Cleveland|Cincinnati|Toledo|Akron"), "OK": ("Oklahoma", "Oklahoma City|Tulsa"),
    "OR": ("Oregon", "Portland, Ore|Salem, Ore|Eugene"), "PA": ("Pennsylvania", "Philadelphia|Pittsburgh|Harrisburg|Shapiro"),
    "RI": ("Rhode Island", "Providence"), "SC": ("South Carolina", "Charleston, S\\.C|Columbia, S\\.C|Myrtle Beach"),
    "SD": ("South Dakota", "Sioux Falls|Rapid City"), "TN": ("Tennessee", "Nashville|Memphis|Knoxville|Chattanooga"),
    "TX": ("Texas", "Houston|Dallas|Austin|San Antonio|Fort Worth|El Paso|Abbott"), "UT": ("Utah", "Salt Lake City|Provo"),
    "VT": ("Vermont", "Burlington, Vt|Montpelier"), "VA": ("Virginia", "Richmond, Va|Virginia Beach|Norfolk|Arlington, Va"),
    "WA": ("Washington State", "Washington state|Seattle|Spokane|Tacoma|Olympia, Wash"), "WV": ("West Virginia", "Charleston, W\\.Va|Morgantown"),
    "WI": ("Wisconsin", "Milwaukee|Madison, Wis|Green Bay"), "WY": ("Wyoming", "Cheyenne|Jackson Hole|Casper"),
}
_PLACE = {}
for code, (name, words) in PROVINCES.items():
    _PLACE[code] = re.compile(r"(?<![\w.])(" + words + r")(?!\w)")
for code, (name, words) in STATES.items():
    base = re.escape(name) if code not in ("WA", "GA", "DC") else ("Georgia(?! (?:the country|Tbilisi))" if code == "GA" else "")
    pat = "|".join(x for x in (base, words) if x)
    if code == "VA":
        pat = r"(?<!West )Virginia|" + words
    if code == "KS":
        pat = r"Kansas(?! City)|" + words
    if code == "AR":
        pat = r"Arkansas|" + words
    _PLACE["US-" + code] = re.compile(r"(?<![\w.])(" + pat + r")(?!\w)")


def places(text: str) -> list[str]:
    return [c for c, rx in _PLACE.items() if rx.search(text)][:4]


# ---------------------------------------------------------------- genres from words
WORDS = {
    "politics": r"election|senat|congress|parliament|premier|prime minister|\bminister|(?-i:\bMPs?\b)|governor|\bTrump|Carney|Poilievre|democrat|republican|\bGOP\b|liberals?\b|conservatives?\b|\bNDP\b|\bvot(e|er|ers|ing)\b|ballot|White House|Supreme Court|legislat|lawmakers|\bmayor|campaign|impeach|Pentagon|Kremlin|sanction",
    "business": r"earnings|\bCEO\b|profit|revenue|merger|acquisi|layoffs?|start-?up|econom|inflation|jobs report|retail|\bbanks?\b|tariff|\bGDP\b|unemployment|company|deal\b|bankrupt|union|strike\b",
    "markets": r"\bstocks?\b|S&P|Nasdaq|(?-i:\bDow\b)|\bTSX\b|shares|investors?|bonds?\b|yields?|(?-i:\bFed\b)|interest rates?|oil prices?|gold prices?|Wall Street|\bIPO\b|rate cut|Bank of Canada|dividend",
    "tech": r"(?-i:\bAI\b)|artificial intelligence|(?-i:\bApple\b)|Google|Microsoft|Nvidia|OpenAI|Anthropic|software|\bchips?\b|semiconductor|smartphone|iPhone|Tesla|robot|cyber|hack(er|ed|ing)?\b|\bapps?\b|(?-i:\bMeta\b)|Amazon|SpaceX|Starlink|data cent",
    "science": r"NASA|\bspace (station|agency|flight|telescope)|astronom|planet|scientists?|study finds|researchers|fossil|species|physics|telescope|asteroid|comet|eclipse|dinosaur|Starship|(?-i:Moon|Mars)\b|archaeolog",
    "health": r"health|hospital|doctors?|cancer|vaccin|virus|COVID|\bflu\b|disease|\bFDA\b|medical|\bdrugs?\b|patients?|outbreak|measles|nurses?|surgery|Alzheimer|diabetes|obesity|Ozempic|RFK",
    "weather": r"storm|hurricane|snow|weather|tornado|flood|wildfire|heat ?wave|forecast|blizzard|typhoon|cyclone|El Ni[nñ]o|freez|rainfall|drought|earthquake|avalanche",
    "sports": r"\bNFL\b|\bNBA\b|\bNHL\b|\bMLB\b|\bMLS\b|\bUFC\b|\bCFL\b|\bWNBA\b|soccer|football|hockey|baseball|basketball|\bgolf|tennis|Olympic|World Cup|playoffs?|quarterback|touchdown|Grey Cup|Super Bowl|Stanley Cup|World Series|\bcoach|Premier League|Formula 1|\bF1\b|NASCAR|boxing|sacks?\b|rookie|\bpuck|homer|Raptors|Maple Leafs|Blue Jays|Oilers|Canucks|Flames|(?-i:Jets)\b|Chiefs|Lakers|Yankees|Dodgers|Cowboys|Eagles\b|Packers|Celtics|Warriors|Steelers|Bills\b",
    "entertainment": r"\bmovies?\b|\bfilms?\b|box office|Netflix|Disney|\bHBO\b|streaming|\bactor|actress|singer|album|concert|celebrit|Oscars?|Grammys?|Emmys?|Hollywood|\bmusic|\btour\b|trailer|\bSNL\b|Taylor Swift|Broadway|sitcom|rapper|Rock & Roll Hall",
    "crypto": r"bitcoin|crypto|ethereum|blockchain|stablecoin|\bBTC\b|Solana|\bXRP\b|Coinbase",
    "autos": r"(?-i:\bEVs?\b)|electric vehicle|\bcars?\b(?! crash)|automaker|\bFord\b(?! Nation)|(?-i:\bGM\b)|Toyota|Honda|Hyundai|Rivian|Lucid|Waymo|robotaxi|Cybercab",
    "betting": r"\bodds\b|betting|best bets?|\b(best|expert|top) picks?\b|sportsbook|parlay|prediction markets?|DraftKings|FanDuel|Kalshi|Polymarket",
    "sportsbiz": r"naming rights|media rights|franchise valu|\bsalary cap|team sale|stadium deal|sponsorship|(?-i:\bNIL\b)|broadcast deal|ownership group",
}
WORD_RE = {k: re.compile(v, re.I) for k, v in WORDS.items()}
GENERAL = {"world", "us", "canada", "business", "politics"}  # feeds whose stories get extra genres from their words


def genres_for(feed_genres: list[str], text: str) -> list[str]:
    out = list(feed_genres)
    if set(feed_genres) & GENERAL:
        for k, rx in WORD_RE.items():
            if k not in out and rx.search(text):
                out.append(k)
    elif "sports" in feed_genres or "sportsbiz" in feed_genres:
        for k in ("betting", "sportsbiz"):
            if k not in out and WORD_RE[k].search(text):
                out.append(k)
    return out[:5]


# ---------------------------------------------------------------- fetching
TAGS = re.compile(r"<[^>]+>")
NOT_NEWS = re.compile(r"\b(stock price|price & quote|quote & history|historical prices|horoscope|crossword|wordle|connections hints|strands hints|sudoku|promo code|coupon)\b", re.I)


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def clean(text: str) -> str:
    text = TAGS.sub(" ", text or "")
    for a, b in (("&amp;", "&"), ("&quot;", '"'), ("&#39;", "'"), ("&#039;", "'"), ("&#8217;", "’"), ("&#8216;", "‘"), ("&#8220;", "“"),
                 ("&#8221;", "”"), ("&#8211;", "–"), ("&#8212;", "—"), ("&#038;", "&"), ("&nbsp;", " "), ("&lt;", "<"), ("&gt;", ">"), ("&hellip;", "…"), ("&#8230;", "…")):
        text = text.replace(a, b)
    return re.sub(r"\s+", " ", text).strip()


def when(text):
    if not text:
        return None
    text = text.strip()
    try:
        d = parsedate_to_datetime(text)
    except Exception:
        try:
            d = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except Exception:
            return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def parse(content: bytes):
    try:
        return ET.fromstring(content)
    except ET.ParseError:
        # Many feeds break XML with a bare "&" or stray control characters; repair those and try once more
        txt = content.decode("utf-8", "replace")
        txt = re.sub(r"&(?!#?\w+;)", "&amp;", txt)
        txt = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", txt)
        return ET.fromstring(txt.encode("utf-8"))


def image_of(it) -> str | None:
    for tag in (MEDIA + "thumbnail", MEDIA + "content", "enclosure"):
        for m in it.iter(tag):
            u = m.get("url") or ""
            if u.startswith("http") and "video" not in (m.get("type") or "") and not u.endswith((".mp3", ".mp4")):
                return u
    for tag in (CONTENT + "encoded", "description"):
        m = re.search(r'<img[^>]+src="(https?://[^"]+)"', it.findtext(tag) or "")
        if m:
            return m.group(1)
    return None


def fetch(url: str) -> list[dict]:
    try:
        r = requests.get(url, headers=UA, timeout=25)
        r.raise_for_status()
        root = parse(r.content)
    except Exception as e:
        log(f"  feed {url} failed ({str(e)[:90]})")
        return []
    out = []
    for it in list(root.iter("item")) + list(root.iter(ATOM + "entry")):
        title = clean(it.findtext("title") or it.findtext(ATOM + "title"))
        link = (it.findtext("link") or "").strip()
        if not link:
            a = it.find(ATOM + "link")
            link = a.get("href") if a is not None else ""
        at = when(it.findtext("pubDate") or it.findtext(ATOM + "published") or it.findtext(ATOM + "updated") or it.findtext(DC + "date"))
        summary = clean(it.findtext("description") or it.findtext(ATOM + "summary") or "")
        if summary.lower().startswith(title.lower()[:40]):
            summary = ""
        src = it.find("source")
        pub = src.text.strip() if src is not None and src.text else ""
        if pub and title.endswith(" - " + pub):
            title = title[: -len(pub) - 3]
        if title and link.startswith("http") and at:
            out.append({"t": title, "u": link, "at": at, "sum": summary[:220], "img": image_of(it), "pub": pub})
    return out


def google(q: str, hl="en-US", gl="US", ceid="US:en", window="when:1d") -> list[dict]:
    url = f"https://news.google.com/rss/search?q={quote_plus(q + ' ' + window)}&hl={hl}&gl={gl}&ceid={ceid}"
    for attempt in range(2):
        got = fetch(url)
        if got:
            return got
        time.sleep(2)
    return []


# ---------------------------------------------------------------- big stories
STOP = set("""a an the and or but of to in on at for with from by as is are was were be been has have had it its this that these those
after before over under into about amid says said say new more most first last top how why what who when where will would could should
can may not no than then them they their his her he she you your our we us up down out off just now year years week day days time
amid against during while still also live updates update latest report reports video watch photos two three one""".split())


def tokens(title: str) -> set[str]:
    words = re.findall(r"[a-z0-9][a-z0-9'’\-]+", title.lower())
    return {w.strip("'’-").removesuffix("'s").removesuffix("’s") for w in words if len(w) > 2 and w not in STOP}


def big_stories(stories: list[dict], max_n=12) -> list[list[int]]:
    """Groups of stories from different outlets about the same thing (many shared headline words)."""
    toks = [tokens(s["t"]) for s in stories]
    index: dict[str, list[int]] = {}
    for i, ts in enumerate(toks):
        for w in ts:
            index.setdefault(w, []).append(i)
    # Words in too many headlines (like "Trump") can't tell stories apart on their own
    common = {w for w, ids in index.items() if len(ids) > len(stories) * 0.04}
    used, groups = set(), []
    order = sorted(range(len(stories)), key=lambda i: stories[i]["at"], reverse=True)
    for i in order:
        if i in used or len(toks[i]) < 3:
            continue
        cand = {}
        for w in toks[i]:
            for j in index[w]:
                if j != i and j not in used:
                    cand[j] = cand.get(j, 0) + (0.5 if w in common else 1)
        members = [i] + [j for j, n in cand.items() if n >= 2.5 or (n >= 2 and len(toks[j] & toks[i]) / max(1, len(toks[j] | toks[i])) >= 0.3)]
        outlets = {stories[j]["o"] for j in members}
        if len(outlets) >= 3:
            used.update(members)
            groups.append(members)
    groups.sort(key=lambda g: (len({stories[j]["o"] for j in g}), max(stories[j]["at"] for j in g)), reverse=True)
    return groups[:max_n]


# ---------------------------------------------------------------- searches, reused between quick runs
def _load_cache() -> dict:
    try:
        return json.loads(CACHE.read_text())
    except Exception:
        return {}


_cache = None


def searched(kind: str, keys: list[str], run, now: datetime) -> list[list[dict]]:
    """Google News results for each key, searching again only when the saved ones are old (or missing)."""
    global _cache
    if _cache is None:
        _cache = _load_cache()
    part = _cache.get(kind) or {}
    at = when(part.get("at"))
    saved = part.get("items") or {}
    if at and now - at < SEARCH_EVERY[kind] and all(k in saved for k in keys):
        log(f"  reusing {kind} searches from {at:%H:%M} UTC")
        return [[{**s, "at": when(s["at"])} for s in saved[k]] for k in keys]
    with ThreadPoolExecutor(4) as ex:
        got = list(ex.map(run, keys))
    # If Google refused every search, keep using the last results rather than losing them
    if not any(got) and saved:
        log(f"  {kind} searches all came back empty, reusing the saved ones")
        return [[{**s, "at": when(s["at"])} for s in saved.get(k, [])] for k in keys]
    _cache[kind] = {"at": now.isoformat(timespec="minutes"),
                    "items": {k: [{**s, "at": s["at"].isoformat(timespec="minutes")} for s in v] for k, v in zip(keys, got)}}
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    write_text(CACHE, json.dumps(_cache, ensure_ascii=False, separators=(",", ":")))
    return got


# ---------------------------------------------------------------- build
def build():
    now = datetime.now(timezone.utc)
    jobs = []  # (outlet id, url, place, genres)
    meta = {}
    for oid, name, site, country, genres, feeds in OUTLETS:
        meta[oid] = {"id": oid, "name": name, "site": site, "country": country, "g": genres}
        for f in feeds:
            if isinstance(f, str):
                f = (f, None, None)
            url, place, g = (list(f) + [None, None])[:3]
            jobs.append((oid, url, place, g or genres))
    with ThreadPoolExecutor(16) as ex:
        results = list(ex.map(lambda j: fetch(j[1]), jobs))

    raw: list[dict] = []
    per_outlet: dict[str, int] = {}
    for (oid, url, place, g), items in zip(jobs, results):
        fresh = [s for s in items if now - s["at"] <= MAX_AGE and s["at"] <= now + timedelta(hours=1)][:PER_FEED]
        for s in fresh:
            raw.append({**s, "o": oid, "s": meta[oid]["name"], "g0": g, "place": place, "c": meta[oid]["country"]})
        per_outlet[oid] = per_outlet.get(oid, 0) + len(fresh)

    # Outlets with no feed, or a thin one: Google News results limited to that site
    how = {oid: "feed" for oid in meta}
    thin = [oid for oid in SEARCH if per_outlet.get(oid, 0) < 6]
    def site_search(oid):
        ca = meta[oid]["country"] == "CA"
        return google(SEARCH[oid], "en-CA" if ca else "en-US", "CA" if ca else "US", "CA:en" if ca else "US:en")
    every = searched("outlets", list(SEARCH), site_search, now)
    found = [every[list(SEARCH).index(oid)] for oid in thin]
    for oid, items in zip(thin, found):
        fresh = [s for s in items if now - s["at"] <= MAX_AGE][:PER_FEED]
        for s in fresh:
            raw.append({**s, "o": oid, "s": meta[oid]["name"], "g0": meta[oid]["g"], "place": None, "c": meta[oid]["country"]})
        if fresh:
            how[oid] = "search" if per_outlet.get(oid, 0) == 0 else "feed+search"
        per_outlet[oid] = per_outlet.get(oid, 0) + len(fresh)

    # Local news for every province and state, from Google News (kept only when the headline names the place)
    local_jobs = [(c, n, "CA") for c, (n, _) in PROVINCES.items()] + [("US-" + c, n, "US") for c, (n, _) in STATES.items()]
    def local(job):
        code, name, country = job
        q = f'"{name}"' if code != "US-WA" else '"Washington state" OR Seattle'
        if code == "US-DC":
            q = '"Washington, D.C." OR "D.C. police" OR "D.C. Council"'
        hl, gl, ceid = ("en-CA", "CA", "CA:en") if country == "CA" else ("en-US", "US", "US:en")
        time.sleep(0.3)
        return google(q, hl, gl, ceid)
    local_found = searched("local", [j[0] for j in local_jobs], lambda code: local(next(j for j in local_jobs if j[0] == code)), now)
    n_local = 0
    for (code, name, country), items in zip(local_jobs, local_found):
        kept = 0
        for s in items:
            if now - s["at"] > MAX_AGE or code not in places(s["t"]) or kept >= 12:
                continue
            raw.append({**s, "o": "local", "s": s["pub"] or "Local news", "g0": ["canada" if country == "CA" else "us"], "place": code, "c": country})
            kept += 1
        n_local += kept
    meta["local"] = {"id": "local", "name": "Local papers & TV (via Google News)", "site": "news.google.com", "country": "", "g": []}
    per_outlet["local"] = n_local
    how["local"] = "search"

    # Tidy, tag and drop repeats (same headline from two feeds of one outlet, or a wire story run twice)
    stories, seen_url, seen_title = [], set(), {}
    for s in sorted(raw, key=lambda s: s["at"], reverse=True):
        key = re.sub(r"\W+", "", s["t"].lower())[:70]
        if s["u"] in seen_url or NOT_NEWS.search(s["t"]):
            continue
        if key in seen_title:
            # Keep the province or state a regional feed knew about
            prev = stories[seen_title[key]]
            if s["place"] and s["place"] not in prev["geo"]:
                prev["geo"].append(s["place"])
            continue
        seen_url.add(s["u"])
        text = s["t"] + " " + s["sum"]
        geo = places(s["t"]) or places(s["sum"])[:2]
        if s["place"] == "CA-NORTH":  # CBC North covers all three territories: keep whichever the story names
            pass
        elif s["place"] and s["place"] not in geo:
            geo = [s["place"]] + geo
        geo = [p for p in geo if p != "CA-NORTH"]
        g = genres_for(s["g0"], text)
        # A story about a province or state belongs to that country too
        if any(p.startswith("CA-") for p in geo) and "canada" not in g:
            g.append("canada")
        if any(p.startswith("US-") for p in geo) and "us" not in g and s["c"] != "CA":
            g.append("us")
        seen_title[key] = len(stories)
        stories.append({"t": s["t"], "u": s["u"], "s": s["s"], "o": s["o"], "at": s["at"], "sum": s["sum"], "img": s["img"],
                        "g": g, "geo": geo[:4]})

    if len(stories) < 200 and OUT.exists():
        log(f"only {len(stories)} stories came back, keeping the saved news")
        return
    groups = big_stories(stories)
    for s in stories:
        s["at"] = s["at"].isoformat(timespec="minutes")
    outlets = []
    for oid, m in meta.items():
        outlets.append({**{k: v for k, v in m.items() if k != "g"}, "n": per_outlet.get(oid, 0), "how": how[oid] if per_outlet.get(oid, 0) else "none"})
    missing = [o["name"] for o in outlets if o["n"] == 0]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    write_text(OUT, json.dumps({
        "generated": now.isoformat(timespec="minutes"),
        "genres": [{"id": a, "label": b, "icon": c} for a, b, c in GENRES],
        "provinces": {k: v[0] for k, v in PROVINCES.items()},
        "states": {"US-" + k: v[0] for k, v in STATES.items()},
        "outlets": outlets, "missing": missing, "big": groups, "stories": stories,
    }, ensure_ascii=False, separators=(",", ":")))
    log(f"wrote {OUT}: {len(stories)} stories from {sum(1 for o in outlets if o['n'])} outlets, {len(groups)} big stories, "
        f"{n_local} local; nothing from: {', '.join(missing) or 'none'}")
    for o in outlets:
        log(f"  {o['name']}: {o['n']} ({o['how']})")
    by_geo = {}
    for s in stories:
        for p in s["geo"]:
            by_geo[p] = by_geo.get(p, 0) + 1
    log("  places: " + ", ".join(f"{k} {v}" for k, v in sorted(by_geo.items())))


if __name__ == "__main__":
    build()
