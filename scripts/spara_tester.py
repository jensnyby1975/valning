#!/usr/bin/env python3
"""Lägger in vallatester från ett GitHub-ärende i den gemensamma filen data/tester.json.

Körs av .github/workflows/spara-tester.yml när någon delar tester från appen.
Ärendets text är otrustad indata: den läses som JSON ur ett ```json-block,
varje test valideras fält för fält och bara kända fält sparas.

Lokalt test:  ISSUE_BODY="$(cat arende.md)" ISSUE_USER=namn ISSUE_NUMBER=1 python3 scripts/spara_tester.py
"""
import datetime as dt
import json
import os
import pathlib
import re
import sys

ROT = pathlib.Path(__file__).resolve().parent.parent
FIL = ROT / "data" / "tester.json"
VALLOR_JS = ROT / "data" / "vallor.js"
SNOTYPER = {"ny", "finkornig", "grovkornig", "isig", "konst", "blot"}
MAX_PER_ARENDE = 50
MARKOR = "<!-- vallatest -->"


def kanda_vallor():
    txt = VALLOR_JS.read_text(encoding="utf-8")
    return {v["id"] for v in json.loads(txt[txt.index("[") : txt.rindex("]") + 1])}


def text(v, maxlen):
    if not isinstance(v, str):
        return ""
    v = re.sub(r"[\x00-\x1f\x7f<>]", " ", v).strip()
    return v[:maxlen]


def tal(v, lo, hi):
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        raise ValueError("inte ett tal")
    if not lo <= v <= hi:
        raise ValueError(f"{v} utanför {lo}..{hi}")
    return round(float(v), 1)


def valla(v, kanda, egna):
    """Känd valla-id, eller en egen valla som sparas med namn (så andra kan läsa den)."""
    if isinstance(v, str) and v in kanda:
        return v, None
    if isinstance(v, str) and re.fullmatch(r"egen-\d{1,16}", v) and v in egna:
        return v, egna[v]
    raise ValueError(f"okänd valla {v!r}")


def validera_egen(e):
    typ = e.get("typ")
    if typ not in ("glid", "hard", "klister", "grund"):
        raise ValueError("egen valla: fel typ")
    mn, mx = tal(e.get("min"), -40, 20), tal(e.get("max"), -40, 20)
    return {"id": e["id"], "marke": text(e.get("marke"), 40) or "Okänt", "namn": text(e.get("namn"), 60) or "Okänd",
            "typ": typ, "min": min(mn, mx), "max": max(mn, mx),
            "sno": [s for s in e.get("sno", []) if s in SNOTYPER] or sorted(SNOTYPER), "niva": "trän", "alias": [], "egen": True}


def validera(t, kanda, egna, anvandare, arende):
    v_id, egen = valla(t.get("valla"), kanda, egna)
    lager_ids, lager_egna = [], [egen] if egen else []
    for x in (t.get("lager") or [])[:4]:
        lid, le = valla(x, kanda, egna)
        if lid != v_id and lid not in lager_ids:
            lager_ids.append(lid)
            if le:
                lager_egna.append(le)
    datum = text(t.get("datum"), 10)
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", datum):
        raise ValueError("fel datum")
    sno = t.get("sno")
    if sno not in SNOTYPER:
        raise ValueError("fel snötyp")
    betyg = t.get("betyg")
    if betyg not in (1, 2, 3, 4, 5):
        raise ValueError("betyg ska vara 1–5")
    tid = text(t.get("id"), 40)
    if not re.fullmatch(r"[a-z0-9-]{6,40}", tid):
        raise ValueError("saknar id")
    ut = {
        "id": tid, "datum": datum, "temp": tal(t.get("temp"), -40, 20), "sno": sno,
        "valla": v_id, "lager": lager_ids, "betyg": betyg,
        "kommentar": text(t.get("kommentar"), 300), "ort": text(t.get("ort"), 60),
        "signatur": text(t.get("signatur"), 40) or anvandare,
        "github": anvandare, "arende": arende,
        "sparad": dt.datetime.now(dt.timezone.utc).date().isoformat(),
    }
    if t.get("fukt") is not None:
        ut["fukt"] = tal(t.get("fukt"), 0, 100)
    if lager_egna:
        ut["egnaVallor"] = lager_egna
    return ut


def las_arende(body):
    if MARKOR not in body:
        raise ValueError("ärendet kommer inte från appen")
    m = re.search(r"```json\s*(.*?)```", body, re.S)
    if not m:
        raise ValueError("hittar inget json-block")
    data = json.loads(m.group(1))
    if not isinstance(data, dict) or not isinstance(data.get("tester"), list):
        raise ValueError("fel format")
    return data


def main():
    body = os.environ.get("ISSUE_BODY", "")
    anvandare = text(os.environ.get("ISSUE_USER", ""), 40)
    arende = int(os.environ.get("ISSUE_NUMBER", "0") or 0)
    data = las_arende(body)
    kanda = kanda_vallor()
    egna = {}
    for e in (data.get("egna") or [])[:20]:
        if isinstance(e, dict) and isinstance(e.get("id"), str) and re.fullmatch(r"egen-\d{1,16}", e["id"]):
            try:
                egna[e["id"]] = validera_egen(e)
            except (ValueError, TypeError):
                pass
    befintliga = json.loads(FIL.read_text(encoding="utf-8")) if FIL.exists() else {"tester": []}
    finns = {t["id"] for t in befintliga["tester"]}
    nya, fel = [], []
    for i, t in enumerate(data["tester"][:MAX_PER_ARENDE]):
        try:
            if not isinstance(t, dict):
                raise ValueError("fel format")
            v = validera(t, kanda, egna, anvandare, arende)
            if v["id"] in finns:
                fel.append(f"test {i + 1}: redan sparat")
                continue
            finns.add(v["id"])
            nya.append(v)
        except (ValueError, TypeError) as e:
            fel.append(f"test {i + 1}: {e}")
    befintliga["tester"] += nya
    befintliga["tester"].sort(key=lambda t: (t["datum"], t["id"]))
    befintliga["uppdaterad"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="minutes")
    FIL.write_text(json.dumps(befintliga, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    rapport = f"Sparade {len(nya)} test(er) i data/tester.json."
    if fel:
        rapport += "\n\nHoppade över:\n" + "\n".join(f"- {f}" for f in fel)
    print(rapport)
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as f:
            f.write(f"antal={len(nya)}\n")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, json.JSONDecodeError) as e:
        print(f"Kunde inte läsa testerna: {e}")
        sys.exit(1)
