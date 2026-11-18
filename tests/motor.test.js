// Kör: node --test tests/*.test.js
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const M = require("../js/motor.js");

function ladda(fil, namn) {
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", fil), "utf8"), ctx);
  return ctx.window[namn];
}
const VALLOR = ladda("data/vallor.js", "VALLOR");
const KUNSKAP = ladda("data/kunskap.js", "KUNSKAP");
const alla = () => true;
const bara = (marke) => (v) => v.marke === marke;

test("vallor har giltiga fält och unika id", () => {
  const ids = new Set();
  for (const v of VALLOR) {
    assert.ok(!ids.has(v.id), "dubblett " + v.id); ids.add(v.id);
    assert.ok(["glid", "hard", "klister", "grund"].includes(v.typ), v.id);
    assert.ok(v.min <= v.max, v.id);
    for (const s of v.sno) assert.ok(s in M.SNOTYPER, v.id + " " + s);
  }
  for (const k of KUNSKAP.konsensus) assert.ok(ids.has(k.valla), "konsensus pekar på okänd " + k.valla);
});

test("finkornig snö -5: hårdvalla, Swix V40-ish överst", () => {
  const r = M.rekommendera({ temp: -5, fukt: 70, sno: "finkornig" }, VALLOR, bara("Swix"), { kunskap: KUNSKAP });
  assert.strictEqual(r.fastetyp, "hard");
  assert.ok(["swix-v40", "swix-v45", "swix-vp45", "swix-vp55"].includes(r.faste[0].valla.id), r.faste[0].valla.id);
  assert.ok(["swix-ps7", "swix-ts7"].includes(r.glid[0].valla.id), r.glid[0].valla.id);
});

test("isigt -6: klister och topplager", () => {
  const r = M.rekommendera({ temp: -6, fukt: 60, sno: "isig" }, VALLOR, alla, { kunskap: KUNSKAP });
  assert.strictEqual(r.fastetyp, "klister");
  assert.ok(r.faste.every((x) => x.valla.typ === "klister"));
  assert.ok(r.topplager && r.topplager.length === 1);
});

test("blöt +4: varm klister och varm glid", () => {
  const r = M.rekommendera({ temp: 4, fukt: 95, sno: "blot" }, VALLOR, alla, {});
  assert.strictEqual(r.fastetyp, "klister");
  assert.ok(r.faste[0].valla.max >= 4, r.faste[0].valla.id);
  assert.ok(r.glid[0].valla.max >= 4, r.glid[0].valla.id);
});

test("egna dåliga tester sänker en valla", () => {
  const f = { temp: -5, fukt: 70, sno: "finkornig" };
  const fore = M.rekommendera(f, VALLOR, bara("Swix"), {}).faste[0];
  const tester = [1, 2, 3].map(() => ({ valla: fore.valla.id, temp: -5, sno: "finkornig", betyg: 1, datum: "2026-01-01" }));
  const efter = M.rekommendera(f, VALLOR, bara("Swix"), { egnaTester: tester });
  assert.notStrictEqual(efter.faste[0].valla.id, fore.valla.id);
});

test("forumomdömen påverkar", () => {
  const f = { temp: -3, fukt: 70, sno: "ny" };
  const forum = { omnamnanden: Array(5).fill({ valla: "rex-violett", temp: -3, sno: "ny", sentiment: 1, utdrag: "bra", kalla: "x" }) };
  const utan = M.rekommendera(f, VALLOR, bara("Rex"), {}).faste.find((x) => x.valla.id === "rex-violett");
  const med = M.rekommendera(f, VALLOR, bara("Rex"), { forum }).faste.find((x) => x.valla.id === "rex-violett");
  assert.ok(med.poang > utan.poang);
});

test("endast tillgängliga vallor föreslås", () => {
  const mina = new Set(["swix-v30", "swix-ps6"]);
  const r = M.rekommendera({ temp: -3, sno: "ny" }, VALLOR, (v) => mina.has(v.id), {});
  assert.deepStrictEqual([...r.faste.map((x) => x.valla.id)], ["swix-v30"]);
  assert.deepStrictEqual([...r.glid.map((x) => x.valla.id)], ["swix-ps6"]);
  assert.ok(r.basta.faste.valla.id !== "swix-v30");
});

test("snötypsgissning", () => {
  assert.strictEqual(M.gissaSnotyp({ tempNu: -5, tempMax72: -3, nysno48: 6, regn48: 0 }), "ny");
  assert.strictEqual(M.gissaSnotyp({ tempNu: -6, tempMax72: 3, nysno48: 0, regn48: 0 }), "isig");
  assert.strictEqual(M.gissaSnotyp({ tempNu: 3, tempMax72: 5, nysno48: 0, regn48: 4 }), "blot");
  assert.strictEqual(M.gissaSnotyp({ tempNu: -8, tempMax72: -4, nysno48: 0, regn48: 0 }), "finkornig");
});
