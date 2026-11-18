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


if __name__ == "__main__":
    unittest.main()
