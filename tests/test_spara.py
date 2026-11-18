import json
import os
import pathlib
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "scripts"))
import spara_tester as st  # noqa: E402


def arende(tester, egna=()):
    return "<!-- vallatest -->\nhej\n\n```json\n" + json.dumps({"tester": tester, "egna": list(egna)}) + "\n```\n"


BRA = {"id": "abc123-x1", "datum": "2026-01-10", "temp": -5, "sno": "finkornig", "valla": "swix-v40",
       "lager": ["swix-vg35"], "betyg": 4, "kommentar": "bra <script>", "signatur": "Jens"}


class TestSpara(unittest.TestCase):
    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp())
        self.fil = self.tmp / "tester.json"
        st.FIL = self.fil

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def kor(self, body, user="kalle", nr="7"):
        os.environ.update(ISSUE_BODY=body, ISSUE_USER=user, ISSUE_NUMBER=nr)
        os.environ.pop("GITHUB_OUTPUT", None)
        st.main()
        return json.loads(self.fil.read_text())["tester"]

    def test_sparar_och_rensar(self):
        t = self.kor(arende([BRA]))
        self.assertEqual(len(t), 1)
        self.assertEqual(t[0]["kommentar"], "bra  script")
        self.assertEqual(t[0]["github"], "kalle")
        self.assertEqual(t[0]["arende"], 7)
        self.assertEqual(t[0]["lager"], ["swix-vg35"])

    def test_dubbletter_och_felaktiga_hoppas_over(self):
        dalig = [dict(BRA, id="zzz999-1", valla="påhittad"), dict(BRA, id="zzz999-2", temp=99),
                 dict(BRA, id="zzz999-3", betyg=9), dict(BRA, id="x"), "inte ett objekt"]
        t = self.kor(arende([BRA, BRA] + dalig))
        self.assertEqual([x["id"] for x in t], ["abc123-x1"])
        self.assertEqual(len(self.kor(arende([BRA]))), 1)  # samma id igen

    def test_egen_valla_foljer_med(self):
        egen = {"id": "egen-123", "marke": "Guru", "namn": "Blå", "typ": "hard", "min": -10, "max": -2, "sno": ["ny"]}
        t = self.kor(arende([dict(BRA, id="egen-test1", valla="egen-123", lager=[])], [egen]))
        self.assertEqual(t[0]["egnaVallor"][0]["marke"], "Guru")

    def test_kraver_markor(self):
        with self.assertRaises(ValueError):
            st.las_arende("```json\n{\"tester\": []}\n```")


if __name__ == "__main__":
    unittest.main()
