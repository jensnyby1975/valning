import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "scripts"))
import hamta_tester as h  # noqa: E402

M = h.bygg_aliasmonster(h.las_vallor())


class TestParser(unittest.TestCase):
    def test_temp(self):
        self.assertEqual(h.hitta_temp("det var -6C"), -6)
        self.assertEqual(h.hitta_temp("minus 8 grader"), -8)
        self.assertEqual(h.hitta_temp("+2° och sol"), 2)
        self.assertEqual(h.hitta_temp("−3 °C"), -3)
        self.assertAlmostEqual(h.hitta_temp("about 23F"), -5, places=0)
        self.assertIsNone(h.hitta_temp("körde 15 km"))

    def test_langsta_alias_vinner(self):
        self.assertEqual(h.hitta_vallor("Rex blå klister satt", M), ["rex-bla-klister"])
        self.assertEqual(h.hitta_vallor("Rex blå var bra", M), ["rex-bla"])

    def test_koder(self):
        self.assertEqual(set(h.hitta_vallor("V40 under, V45 överst", M)), {"swix-v40", "swix-v45"})

    def test_omdome(self):
        self.assertEqual(h.omdome("great kick all day"), 1)
        self.assertEqual(h.omdome("det slirade hela tiden"), -1)
        self.assertEqual(h.omdome("la på V40"), 0)

    def test_exempelfil(self):
        text = (pathlib.Path(__file__).parent / "exempel_forum.txt").read_text(encoding="utf-8")
        res = {o["valla"]: o for o in h.analysera(text, "t", "", "2026-01-01", M)}
        self.assertEqual(res["swix-v40"]["temp"], -6)
        self.assertEqual(res["swix-v40"]["sno"], "finkornig")
        self.assertEqual(res["swix-v45"]["sentiment"], -1)
        self.assertEqual(res["rex-bla-klister"]["sno"], "isig")


TYPER = {v["id"]: v["typ"] for v in h.las_vallor()}


class TestRecept(unittest.TestCase):
    def test_tillverkarsida(self):
        html = (pathlib.Path(__file__).parent / "exempel_tillverkare.html").read_text(encoding="utf-8")
        self.assertEqual(h.sidans_datum(html), "2026-02-28")
        rec = h.hitta_recept(h.html_till_text(html), "Swix", "tillverkare", "", "2026-02-28", M, TYPER)
        lager = [[(l["valla"], l["roll"]) for l in r["lager"]] for r in rec]
        self.assertIn([("swix-kb20", "grund"), ("swix-kx30", "klister"), ("swix-v40", "topp")], lager)
        self.assertIn([("swix-ps7", "glid"), ("swix-ts7", "glid-topp")], lager)
        self.assertIn([("swix-kx45", "klister"), ("swix-v45", "topp")], lager)
        self.assertTrue(all(r["temp"] == -6 for r in rec))

    def test_roll_efter_namn(self):
        rec = h.hitta_recept("Kick: Swix KX20 binder, Rex blå klister cover. -8C", "x", "butik", "", "", M, TYPER)
        self.assertEqual([(l["valla"], l["roll"]) for l in rec[0]["lager"]],
                         [("swix-kx20", "grund"), ("rex-bla-klister", "topp")])

    def test_en_valla_ar_inget_recept(self):
        self.assertEqual(h.hitta_recept("V40 funkade bra i -5 grader", "x", "forum", "", "", M, TYPER), [])

    def test_atom_flode(self):
        xml = """<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Weekend wax</title>
        <link href="https://ex.com/a"/><published>2026-01-10T08:00:00Z</published>
        <content type="html">&lt;p&gt;Swix KX30 covered with V40&lt;/p&gt;</content></entry></feed>"""
        (titel, lank, datum, innehall), = h.flodesposter(xml)
        self.assertEqual((titel, lank, datum), ("Weekend wax", "https://ex.com/a", "2026-01-10"))
        self.assertIn("KX30", innehall)


if __name__ == "__main__":
    unittest.main()
