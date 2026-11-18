#!/usr/bin/env python3
"""Packar ihop appen till EN html-fil (allt inbäddat) utan väderhämtning.

Används för att publicera en version som går att öppna direkt i mobilen,
t.ex. som delbar sida där externa anrop inte är tillåtna.
Kör: python3 scripts/bygg_enfil.py ut.html
"""
import pathlib
import re
import sys

ROT = pathlib.Path(__file__).resolve().parent.parent


def las(rel):
    return (ROT / rel).read_text(encoding="utf-8").replace("</script", "<\\/script")


def main():
    ut = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ROT / "vallaguiden-enfil.html")
    html = (ROT / "index.html").read_text(encoding="utf-8")
    kropp = re.search(r"<body>(.*?)<script", html, re.S).group(1)
    css = (ROT / "css" / "stil.css").read_text(encoding="utf-8")
    # Sidans ram lägger redan till säkerhetsmarginal upptill.
    css += "\nheader { padding-top: 24px; }\n"
    skript = "\n".join(
        "<script>\n" + las(f) + "\n</script>"
        for f in ["data/vallor.js", "data/kunskap.js", "data/forum.js", "js/motor.js"]
    )
    gemensamma = (ROT / "data" / "tester.json").read_text(encoding="utf-8").strip().replace("</", "<\\/")
    sida = (
        "<title>Vallaguiden</title>\n"
        '<meta name="claude:viewport-fit-sides" content="cover">\n'
        f"<style>\n{css}</style>\n{kropp}"
        f"<script>window.UTAN_VADER = true;\nwindow.GEMENSAMMA_TESTER = {gemensamma};</script>\n{skript}\n<script>\n{las('js/app.js')}\n</script>\n"
    )
    ut.write_text(sida, encoding="utf-8")
    print(f"Skrev {ut} ({len(sida) // 1024} kB)")


if __name__ == "__main__":
    main()
