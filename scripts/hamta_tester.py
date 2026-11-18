#!/usr/bin/env python3
"""Hämtar vallarapporter från forum/test-sidor och sammanställer dem till data/forum.js.

Källor konfigureras i scripts/kallor.json:
  - reddit: subreddits + sökord (publikt JSON-API, ingen inloggning)
  - rss:    valfria RSS/Atom-flöden, t.ex. ett forums "senaste inlägg" eller en vallablogg
            [{"namn": "Mitt forum", "url": "https://..."}]

För varje text letas vallanamn (från data/vallor.js), temperaturer, snötyp och
omdöme (bra/dåligt fäste/glid) upp. Resultatet används av appen som "forumevidens".

Kör:  python3 scripts/hamta_tester.py           (hämtar från nätet)
      python3 scripts/hamta_tester.py --fil x.txt (analyserar en lokal textfil, bra för test)
Endast standardbiblioteket används.
"""
import argparse
import datetime as dt
import email.utils
import json
import pathlib
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

ROT = pathlib.Path(__file__).resolve().parent.parent
VALLOR_JS = ROT / "data" / "vallor.js"
UT_JS = ROT / "data" / "forum.js"
KALLOR = ROT / "scripts" / "kallor.json"
UA = "vallaguiden/1.0 (open source ski wax helper)"

POSITIVA = [
    "bra fäste", "bra grepp", "satt bra", "satt perfekt", "fäste satt", "perfekt", "toppen", "klockrent",
    "snabba skidor", "snabb", "gick bra", "funkade bra", "fungerade bra", "rekommenderar", "bäst",
    "great kick", "good kick", "great grip", "good grip", "worked well", "worked great", "worked perfectly",
    "perfect", "excellent", "fast skis", "spot on", "nailed it", "recommend", "best",
    "godt feste", "bra feste", "fungerte bra", "gikk bra", "raske ski", "anbefaler", "perfekt feste",
]
NEGATIVA = [
    "slirade", "slirar", "inget fäste", "dåligt fäste", "isade", "isar", "klabbade", "klabbar", "trög", "tröga",
    "sög", "suger", "funkade inte", "fungerade inte", "värdelös",
    "slipped", "slipping", "no kick", "no grip", "poor grip", "iced", "icing", "clumped", "clumping",
    "slow", "sticky", "didn't work", "did not work", "terrible", "useless",
    "glapp", "ingen feste", "dårlig feste", "ising", "klabbet", "trege ski", "funket ikke",
]
SNOORD = {
    "ny": ["nysnö", "ny snö", "fallande snö", "new snow", "fresh snow", "falling snow", "nysnø", "snöfall", "snowing"],
    "finkornig": ["finkornig", "fine grained", "fine-grained", "old snow", "gammal snö", "gammel snø"],
    "grovkornig": ["grovkornig", "omvandlad", "transformed", "coarse", "corn snow", "vårsnö", "spring snow", "grovkornet"],
    "isig": ["isig", "skare", "isigt", "icy", "ice", "hardpack", "glazed", "skare", "isete"],
    "konst": ["konstsnö", "kanonsnö", "man-made", "manmade", "artificial snow", "kunstsnø"],
    "blot": ["blöt", "blött", "våt", "wet snow", "slush", "slask", "våt snø", "blaut"],
}

TEMP_RE = re.compile(
    r"(?P<tecken>[-−–+]|minus\s*|plus\s*)?\s*(?P<tal>\d{1,2}(?:[.,]\d)?)\s*(?:°\s*[cf]?|grader|degrees|deg\b|c\b|celsius)",
    re.IGNORECASE,
)
F_RE = re.compile(r"(\d{1,2})\s*°?\s*f\b", re.IGNORECASE)


def las_vallor():
    txt = VALLOR_JS.read_text(encoding="utf-8")
    start, slut = txt.index("["), txt.rindex("]")
    return json.loads(txt[start : slut + 1])


def bygg_aliasmonster(vallor):
    par = []
    for v in vallor:
        namn = {a.lower() for a in v.get("alias", [])}
        namn.add(f"{v['marke']} {v['namn']}".lower())
        for a in namn:
            par.append((a, v["id"]))
    par.sort(key=lambda p: -len(p[0]))  # längsta först så "rex blå klister" vinner över "rex blå"
    return [(re.compile(r"(?<![\w])" + re.escape(a).replace(r"\ ", r"[\s\-]*") + r"(?![\w])"), vid) for a, vid in par]


def hitta_vallor_pos(mening, monster):
    """[(start, slut, valla_id), …] i textordning; längsta alias vinner vid överlapp."""
    text = mening.lower()
    hittade = []
    for rx, vid in monster:
        for m in rx.finditer(text):
            hittade.append((m.start(), m.end(), vid))
            text = text[: m.start()] + " " * (m.end() - m.start()) + text[m.end() :]
    return sorted(hittade)


def hitta_vallor(mening, monster):
    return list(dict.fromkeys(vid for _, _, vid in hitta_vallor_pos(mening, monster)))


def hitta_temp(mening):
    varden = []
    for m in TEMP_RE.finditer(mening):
        tal = float(m.group("tal").replace(",", "."))
        tecken = (m.group("tecken") or "").strip().lower()
        if tecken in ("-", "−", "–", "minus"):
            tal = -tal
        if -40 <= tal <= 20:
            varden.append(tal)
    if not varden:
        for m in F_RE.finditer(mening):
            c = (float(m.group(1)) - 32) * 5 / 9
            if -40 <= c <= 20:
                varden.append(round(c, 1))
    if not varden:
        return None
    return round(sum(varden) / len(varden), 1)


def hitta_sno(text):
    t = text.lower()
    for typ, ord_ in SNOORD.items():
        if any(re.search(r"(?<![\w])" + re.escape(o) + r"(?![\w])", t) for o in ord_):
            return typ
    return None


def omdome(mening):
    t = mening.lower()
    def traff(lista):
        return sum(1 for o in lista if re.search(r"(?<![\w])" + re.escape(o) + r"(?![\w])", t))
    p, n = traff(POSITIVA), traff(NEGATIVA)
    return 1 if p > n else -1 if n > p else 0


def dela_meningar(text):
    return [m.strip() for m in re.split(r"(?<=[.!?\n])\s+", text) if m.strip()]


ROLLORD = {
    "grund": ["binder", "base", "base layer", "grund", "grundvalla", "grundklister", "bas", "underlag", "underst", "first layer", "festeunderlag"],
    "topp": ["cover", "covered", "covered with", "top", "topcoat", "top coat", "topping", "topped", "overlay", "finish",
             "över", "täck", "täckt", "toppa", "toppat", "ovanpå", "överst", "dekk", "over"],
}


def _roll(fore, efter, typ):
    """Bestämmer lagrets roll utifrån ord nära vallanamnet och vallans typ."""
    def har(t, lista):
        return any(re.search(r"(?<![\w])" + re.escape(o) + r"(?![\w])", t) for o in lista)
    narfore = fore[-30:]
    # Ord direkt efter namnet räknas ("KX20 binder", "V40 cover") – men inte "KX30 covered with V40".
    m = re.match(r"[\s,:–-]*(\w+)(?:\s+(\w+))?", efter)
    ord1, ord2 = (m.group(1), m.group(2) or "") if m else ("", "")
    efterroll = ord1 if ord2 not in ("with", "med", "by", "av", "in") else ""
    if har(narfore, ROLLORD["topp"]) or efterroll in ("cover", "top", "topcoat", "topp", "överst") \
            or har(efter[:20], ["on top", "som topp", "as cover", "as a cover"]):
        return "glid-topp" if typ == "glid" else "topp"
    if har(narfore, ROLLORD["grund"]) or efterroll in ("binder", "base", "grund", "underst") \
            or har(efter[:20], ["as binder", "som grund", "as base"]):
        return "glid" if typ == "glid" else "grund"
    return {"grund": "grund", "klister": "klister", "hard": "fäste", "glid": "glid"}[typ]


def hitta_recept(text, kalla, kalltyp, url, datum, monster, typer):
    """Hittar kombinationer (flera vallor i samma stycke/lista) och returnerar recept.

    Ett recept = ett stycke (avgränsat av tomrad) där minst två olika vallor nämns,
    t.ex. "Binder: Swix KB20. Klister: KX30 covered with V40" eller en lista med glidlager.
    """
    ut = []
    ctx_temp = ctx_sno = None  # förhållanden som nämnts tidigare i texten (t.ex. i inledningen)
    for block in re.split(r"\n\s*\n", text):
        if not block.strip():
            continue
        b_temp, b_sno = hitta_temp(block), hitta_sno(block)
        lager, sedda = [], set()
        for rad in block.split("\n"):
            pos = hitta_vallor_pos(rad, monster)
            forra = 0
            for start, slut, vid in pos:
                if vid in sedda:
                    continue
                sedda.add(vid)
                lager.append({"valla": vid, "roll": _roll(rad[:start].lower()[forra:] if forra < start else rad[:start].lower(),
                                                          rad[slut:].lower(), typer[vid])})
                forra = slut
        if len(lager) < 2:
            ctx_temp = b_temp if b_temp is not None else ctx_temp
            ctx_sno = b_sno or ctx_sno
            continue
        kort = re.sub(r"\s+", " ", block).strip()
        ut.append({
            "lager": lager, "temp": b_temp if b_temp is not None else ctx_temp, "sno": b_sno or ctx_sno,
            "sentiment": omdome(block),
            "kalla": kalla, "kalltyp": kalltyp, "url": url, "datum": datum,
            "text": (kort[:400] + "…") if len(kort) > 400 else kort,
        })
    return ut


def analysera(text, kalla, url, datum, monster):
    """Returnerar en lista med omnämnanden från en text (inlägg/kommentar)."""
    ut = []
    # Temperatur/snötyp tas i första hand från meningen, annars från samma stycke.
    for stycke in (s for s in re.split(r"\n+", text) if s.strip()):
        st_temp, st_sno = hitta_temp(stycke), hitta_sno(stycke)
        ut += _analysera_stycke(stycke, st_temp, st_sno, kalla, url, datum, monster)
    return ut


def _analysera_stycke(stycke, st_temp, st_sno, kalla, url, datum, monster):
    ut = []
    for mening in dela_meningar(stycke):
        vallor = hitta_vallor(mening, monster)
        if not vallor:
            continue
        temp = hitta_temp(mening)
        if temp is None:
            temp = st_temp
        sno = hitta_sno(mening) or st_sno
        s = omdome(mening)
        for vid in vallor:
            ut.append({
                "valla": vid, "temp": temp, "sno": sno, "sentiment": s,
                "kalla": kalla, "url": url, "datum": datum,
                "utdrag": (mening[:220] + "…") if len(mening) > 220 else mening,
            })
    return ut


def hamta_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode("utf-8"))


def hamta_text(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read().decode("utf-8", errors="replace")


def fran_reddit(cfg, monster):
    ut, sedda = [], set()
    paus = cfg.get("paus_sekunder", 1.5)
    kommentarer_kvar = cfg.get("max_kommentartradar", 40)
    for k in cfg.get("reddit", []):
        for q in k["sok"]:
            url = (f"https://www.reddit.com/r/{k['sub']}/search.json?"
                   + urllib.parse.urlencode({"q": q, "restrict_sr": 1, "sort": "new", "t": "year",
                                             "limit": cfg.get("max_tradar_per_sokning", 25)}))
            try:
                data = hamta_json(url)
            except Exception as e:  # noqa: BLE001
                print(f"  ! reddit r/{k['sub']} '{q}': {e}", file=sys.stderr)
                continue
            time.sleep(paus)
            for barn in data.get("data", {}).get("children", []):
                p = barn["data"]
                if p["id"] in sedda:
                    continue
                sedda.add(p["id"])
                datum = dt.datetime.fromtimestamp(p["created_utc"], dt.timezone.utc).date().isoformat()
                lank = "https://www.reddit.com" + p["permalink"]
                kalla = f"reddit r/{k['sub']}"
                text = p.get("title", "") + ".\n\n" + p.get("selftext", "")
                ut += analysera(text, kalla, lank, datum, monster)
                RECEPT_REDDIT.extend(hitta_recept(text, kalla, "forum", lank, datum, monster, TYPER))
                if p.get("num_comments", 0) and kommentarer_kvar > 0:
                    kommentarer_kvar -= 1
                    try:
                        trad = hamta_json(f"https://www.reddit.com/comments/{p['id']}.json?limit=200")
                        time.sleep(paus)
                    except Exception as e:  # noqa: BLE001
                        print(f"  ! kommentarer {p['id']}: {e}", file=sys.stderr)
                        continue
                    for c in plocka_kommentarer(trad[1] if len(trad) > 1 else {}):
                        cdatum = dt.datetime.fromtimestamp(c.get("created_utc", p["created_utc"]), dt.timezone.utc).date().isoformat()
                        ut += analysera(c.get("body", ""), kalla, lank, cdatum, monster)
                        RECEPT_REDDIT.extend(hitta_recept(c.get("body", ""), kalla, "forum", lank, cdatum, monster, TYPER))
    return ut


def plocka_kommentarer(listning):
    for barn in listning.get("data", {}).get("children", []):
        d = barn.get("data", {})
        if barn.get("kind") == "t1":
            yield d
            svar = d.get("replies")
            if isinstance(svar, dict):
                yield from plocka_kommentarer(svar)


def html_till_text(html):
    import html as htmlmod
    html = re.sub(r"(?is)<(script|style|noscript|nav|footer|header|form)[^>]*>.*?</\1>", " ", html)
    html = re.sub(r"(?i)<h[1-6][^>]*>", "\n\n", html)
    html = re.sub(r"(?i)</h[1-6]>", "\n\n", html)
    html = re.sub(r"(?i)</(p|div|section|article|table|ul|ol)>", "\n\n", html)
    html = re.sub(r"(?i)<br\s*/?>|</(li|tr|dd|dt)>", "\n", html)
    html = re.sub(r"(?i)</t[dh]>", " ", html)
    text = htmlmod.unescape(re.sub(r"<[^>]+>", " ", html))
    text = re.sub(r"[ \t\u00a0]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def sidans_datum(html):
    m = re.search(r'(?:article:published_time"\s+content="|<time[^>]+datetime=")(\d{4}-\d{2}-\d{2})', html)
    return m.group(1) if m else None


def flodesposter(xml):
    """(titel, länk, datum, innehåll-html) från RSS eller Atom."""
    rot = ET.fromstring(xml)
    A = "{http://www.w3.org/2005/Atom}"
    ut = []
    for it in rot.findall(".//item") + rot.findall(f".//{A}entry"):
        def txt(*taggar):
            for t in taggar:
                el = it.find(t)
                if el is not None and (el.text or "").strip():
                    return el.text
            return ""
        lank = txt("link")
        if not lank:
            el = it.find(f"{A}link")
            lank = el.get("href", "") if el is not None else ""
        datum = txt("pubDate", f"{A}published", f"{A}updated")
        try:
            datum = email.utils.parsedate_to_datetime(datum).date().isoformat()
        except Exception:  # noqa: BLE001
            datum = datum[:10]
        innehall = txt("{http://purl.org/rss/1.0/modules/content/}encoded", f"{A}content", "description", f"{A}summary")
        ut.append((txt("title", f"{A}title"), lank, datum, innehall))
    return ut


def fran_sidor(cfg, monster, typer):
    """Tillverkare, butiker och bloggar: RSS/Atom-flöden eller indexsidor med länkar till artiklar."""
    omn, recept = [], []
    paus = cfg.get("paus_sekunder", 1.5)
    for s in cfg.get("sidor", []) + [dict(r, typ=r.get("typ", "forum")) for r in cfg.get("rss", [])]:
        namn, typ = s.get("namn", s.get("url") or s.get("rss")), s.get("typ", "forum")
        filt = re.compile(s["filter"], re.I) if s.get("filter") else None
        dokument = []  # (url, datum, html)
        try:
            if s.get("rss"):
                for titel, lank, datum, innehall in flodesposter(hamta_text(s["rss"]))[: s.get("max", 20)]:
                    if filt and not filt.search(titel or ""):
                        continue
                    if len(re.sub(r"<[^>]+>", "", innehall or "")) < 300 and lank:
                        try:
                            innehall = hamta_text(lank)
                            time.sleep(paus)
                        except Exception as e:  # noqa: BLE001
                            print(f"  ! {lank}: {e}", file=sys.stderr)
                    dokument.append((lank or s["rss"], datum, (titel or "") + "\n\n" + (innehall or "")))
            if s.get("url"):
                index = hamta_text(s["url"])
                time.sleep(paus)
                if s.get("lankmonster"):
                    rx = re.compile(s["lankmonster"])
                    lankar = []
                    for href in re.findall(r'href="([^"#]+)"', index):
                        full = urllib.parse.urljoin(s["url"], href)
                        if rx.search(full) and full not in lankar and full != s["url"]:
                            lankar.append(full)
                    for lank in lankar[: s.get("max", 15)]:
                        try:
                            html = hamta_text(lank)
                            time.sleep(paus)
                        except Exception as e:  # noqa: BLE001
                            print(f"  ! {lank}: {e}", file=sys.stderr)
                            continue
                        dokument.append((lank, sidans_datum(html), html))
                else:
                    dokument.append((s["url"], sidans_datum(index), index))
        except Exception as e:  # noqa: BLE001
            print(f"  ! {namn}: {e}", file=sys.stderr)
            continue
        idag = dt.date.today().isoformat()
        for url, datum, html in dokument:
            text = html_till_text(html)
            for o in analysera(text, namn, url, datum or idag, monster):
                o["kalltyp"] = typ
                omn.append(o)
            recept += hitta_recept(text, namn, typ, url, datum or idag, monster, typer)
        print(f"  {namn}: {len(dokument)} sidor")
    return omn, recept


RECEPT_REDDIT = []
TYPER = {}


def skriv(omnamnanden, kallnamn, recept=()):
    # Ta bort dubbletter (samma valla + utdrag / samma lager + källa)
    unika = {(o["valla"], o["utdrag"]): o for o in omnamnanden}
    for o in unika.values():
        o.setdefault("kalltyp", "forum")
    unika_r = {(tuple(l["valla"] for l in r["lager"]), r["url"], r["text"][:80]): r for r in recept}
    data = {
        "uppdaterad": dt.datetime.now(dt.timezone.utc).isoformat(timespec="minutes"),
        "kallor": kallnamn,
        "omnamnanden": sorted(unika.values(), key=lambda o: o["datum"] or "", reverse=True),
        "recept": sorted(unika_r.values(), key=lambda r: r["datum"] or "", reverse=True),
    }
    UT_JS.write_text(
        "// Genererad av scripts/hamta_tester.py – redigera inte för hand.\nwindow.FORUM = "
        + json.dumps(data, ensure_ascii=False, indent=1) + ";\n",
        encoding="utf-8",
    )
    return data


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--fil", help="Analysera en lokal textfil i stället för att hämta från nätet")
    ap.add_argument("--torrkorning", action="store_true", help="Skriv inte data/forum.js")
    a = ap.parse_args()

    vallor = las_vallor()
    TYPER.update({v["id"]: v["typ"] for v in vallor})
    monster = bygg_aliasmonster(vallor)
    if a.fil:
        text = pathlib.Path(a.fil).read_text(encoding="utf-8")
        if a.fil.endswith((".html", ".htm")):
            text = html_till_text(text)
        idag = dt.date.today().isoformat()
        res = {"omnamnanden": analysera(text, "lokal fil", "", idag, monster),
               "recept": hitta_recept(text, "lokal fil", "tillverkare", "", idag, monster, TYPER)}
        print(json.dumps(res, ensure_ascii=False, indent=1))
        return

    cfg = json.loads(KALLOR.read_text(encoding="utf-8"))
    print("Hämtar från Reddit …")
    alla = fran_reddit(cfg, monster)
    print("Hämtar tillverkare, butiker och bloggar …")
    omn, recept = fran_sidor(cfg, monster, TYPER)
    alla += omn
    recept += RECEPT_REDDIT
    kallnamn = ([f"reddit r/{k['sub']}" for k in cfg.get("reddit", [])]
                + [s.get("namn", s.get("url") or s.get("rss")) for s in cfg.get("sidor", []) + cfg.get("rss", [])])
    print(f"Hittade {len(alla)} vallaomnämnanden och {len(recept)} kombinationer.")
    if not alla and not recept:
        print("Inga träffar (nätverk blockerat?) – behåller befintlig data/forum.js.", file=sys.stderr)
        return
    if not a.torrkorning:
        d = skriv(alla, kallnamn, recept)
        print(f"Skrev {len(d['omnamnanden'])} omnämnanden och {len(d['recept'])} recept till {UT_JS.relative_to(ROT)}")


if __name__ == "__main__":
    main()
