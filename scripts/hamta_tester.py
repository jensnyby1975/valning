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


def hitta_vallor(mening, monster):
    text = mening.lower()
    hittade = []
    for rx, vid in monster:
        for m in rx.finditer(text):
            hittade.append(vid)
            text = text[: m.start()] + " " * (m.end() - m.start()) + text[m.end() :]
    return list(dict.fromkeys(hittade))


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
                ut += analysera(p.get("title", "") + ". " + p.get("selftext", ""), kalla, lank, datum, monster)
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
    return ut


def plocka_kommentarer(listning):
    for barn in listning.get("data", {}).get("children", []):
        d = barn.get("data", {})
        if barn.get("kind") == "t1":
            yield d
            svar = d.get("replies")
            if isinstance(svar, dict):
                yield from plocka_kommentarer(svar)


def fran_rss(cfg, monster):
    ut = []
    for f in cfg.get("rss", []):
        try:
            rot = ET.fromstring(hamta_text(f["url"]))
        except Exception as e:  # noqa: BLE001
            print(f"  ! rss {f.get('namn')}: {e}", file=sys.stderr)
            continue
        poster = rot.findall(".//item") or rot.findall(".//{http://www.w3.org/2005/Atom}entry")
        for it in poster:
            def txt(tag):
                el = it.find(tag)
                if el is None:
                    el = it.find("{http://www.w3.org/2005/Atom}" + tag)
                return (el.text or "") if el is not None else ""
            lank = txt("link")
            if not lank:
                el = it.find("{http://www.w3.org/2005/Atom}link")
                lank = el.get("href", "") if el is not None else f["url"]
            datum = (txt("pubDate") or txt("updated") or "")[:16]
            brodtext = re.sub(r"<[^>]+>", " ", txt("description") or txt("summary") or txt("content"))
            ut += analysera(txt("title") + ". " + brodtext, f.get("namn", "RSS"), lank, datum, monster)
    return ut


def skriv(omnamnanden, kallnamn):
    # Ta bort dubbletter (samma valla + utdrag)
    unika = {(o["valla"], o["utdrag"]): o for o in omnamnanden}
    data = {
        "uppdaterad": dt.datetime.now(dt.timezone.utc).isoformat(timespec="minutes"),
        "kallor": kallnamn,
        "omnamnanden": sorted(unika.values(), key=lambda o: o["datum"] or "", reverse=True),
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

    monster = bygg_aliasmonster(las_vallor())
    if a.fil:
        text = pathlib.Path(a.fil).read_text(encoding="utf-8")
        res = analysera(text, "lokal fil", "", dt.date.today().isoformat(), monster)
        print(json.dumps(res, ensure_ascii=False, indent=1))
        return

    cfg = json.loads(KALLOR.read_text(encoding="utf-8"))
    print("Hämtar från Reddit …")
    alla = fran_reddit(cfg, monster)
    if cfg.get("rss"):
        print("Hämtar RSS-flöden …")
        alla += fran_rss(cfg, monster)
    kallnamn = [f"reddit r/{k['sub']}" for k in cfg.get("reddit", [])] + [f.get("namn", f["url"]) for f in cfg.get("rss", [])]
    print(f"Hittade {len(alla)} vallaomnämnanden.")
    if not alla:
        print("Inga träffar (nätverk blockerat?) – behåller befintlig data/forum.js.", file=sys.stderr)
        return
    if not a.torrkorning:
        d = skriv(alla, kallnamn)
        print(f"Skrev {len(d['omnamnanden'])} unika omnämnanden till {UT_JS.relative_to(ROT)}")


if __name__ == "__main__":
    main()
