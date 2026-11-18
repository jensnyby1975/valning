// Rekommendationsmotor – fungerar både i webbläsaren (window.Motor) och i Node (require).
(function (root) {
  "use strict";

  var SNOTYPER = {
    ny: "Nysnö / fallande snö",
    finkornig: "Finkornig (lätt omvandlad)",
    grovkornig: "Grovkornig / omvandlad (vårsnö)",
    isig: "Isig / skare / hårt nedkört",
    konst: "Konstsnö",
    blot: "Blöt / våt snö"
  };

  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

  // Hur bra passar temperaturen in i vallans område? 0..1
  function tempPassning(v, t) {
    var mitt = (v.min + v.max) / 2;
    var halv = Math.max(1, (v.max - v.min) / 2);
    if (t >= v.min && t <= v.max) {
      return 1 - 0.25 * Math.abs(t - mitt) / halv;
    }
    var d = t < v.min ? v.min - t : t - v.max;
    return 0.7 * Math.exp(-d / 1.5);
  }

  // Vilken typ av fäste kräver förhållandena?
  function vilkenFastetyp(f) {
    var t = f.temp, s = f.sno;
    if (s === "isig" || s === "grovkornig") return "klister";
    if (s === "blot") return t > -1 ? "klister" : "hard";
    if (s === "konst" && t > -1) return "klister";
    return "hard";
  }

  // Effektiv temperatur för val av fästvalla: gammal/finkornig snö -> varmare valla,
  // hög luftfuktighet nära nollan -> kallare valla (minska isbildning).
  function effektivTemp(f, typ) {
    var t = f.temp;
    if (typ === "hard") {
      if (f.sno === "finkornig" || f.sno === "konst") t += 2;
      if (f.fukt != null && f.fukt >= 85 && f.temp > -5) t -= 1;
    }
    return t;
  }

  function gauss(d, s) { return Math.exp(-(d * d) / (2 * s * s)); }

  // Samlar evidens (forum, konsensus, egna tester) för en valla vid givna förhållanden.
  function evidens(v, f, kallor) {
    var poang = 0, poster = [];
    var forum = (kallor.forum && kallor.forum.omnamnanden) || [];
    forum.forEach(function (o) {
      if (o.valla !== v.id) return;
      var w = o.temp == null ? 0.25 : gauss(o.temp - f.temp, 3);
      if (o.sno && o.sno !== f.sno) w *= 0.6;
      if (w < 0.1) return;
      var s = o.sentiment > 0 ? 1 : o.sentiment < 0 ? -1.2 : 0.3;
      poang += w * s * 0.6;
      poster.push({ typ: "forum", vikt: w * s, text: o.utdrag, kalla: o.kalla, url: o.url, datum: o.datum, temp: o.temp });
    });
    var kons = (kallor.kunskap && kallor.kunskap.konsensus) || [];
    kons.forEach(function (k) {
      if (k.valla !== v.id) return;
      if (f.temp < k.tMin - 1 || f.temp > k.tMax + 1) return;
      var w = k.sno && k.sno.indexOf(f.sno) < 0 ? 0.4 : 1;
      poang += 0.8 * w;
      poster.push({ typ: "konsensus", vikt: w, text: k.text, kalla: "Allmän erfarenhet" });
    });
    (kallor.egnaTester || []).forEach(function (e) {
      if (e.valla !== v.id) return;
      var w = gauss(e.temp - f.temp, 2.5) * (e.sno === f.sno ? 1 : 0.6);
      if (w < 0.1) return;
      var s = (e.betyg - 3) / 2; // betyg 1..5 -> -1..1
      poang += 2.0 * w * s;
      poster.push({ typ: "eget", vikt: w * s, text: "Ditt test " + e.datum + ": betyg " + e.betyg + "/5" + (e.kommentar ? " – " + e.kommentar : ""), kalla: "Mina tester", temp: e.temp });
    });
    poster.sort(function (a, b) { return Math.abs(b.vikt) - Math.abs(a.vikt); });
    return { poang: poang, poster: poster };
  }

  function bedom(v, f, typ, kallor) {
    var tEff = effektivTemp(f, typ);
    var tp = tempPassning(v, tEff);
    var sp = v.sno.indexOf(f.sno) >= 0 ? 1 : 0.35;
    var ev = evidens(v, f, kallor);
    var ep = 1 / (1 + Math.exp(-ev.poang)); // 0..1, 0.5 = neutral
    // Temperatur väger tyngst, sedan snötyp; evidens från tester/forum kan lyfta eller sänka.
    var total = clamp(0.6 * tp + 0.25 * sp + 0.15 * ep + (ep - 0.5) * 0.2, 0, 1);
    var skal = [];
    if (tEff >= v.min && tEff <= v.max) skal.push("Inom vallans område (" + fmtOmr(v) + ")");
    else skal.push("Utanför angivet område (" + fmtOmr(v) + ")");
    if (tEff !== f.temp) skal.push("Räknat på " + fmtT(tEff) + " pga snötyp/fukt");
    if (sp < 1) skal.push("Inte primärt gjord för " + (SNOTYPER[f.sno] || f.sno).toLowerCase());
    if (ev.poster.length) skal.push(ev.poster.length + " omdöme(n) från tester/forum");
    return { valla: v, poang: total, skal: skal, evidens: ev.poster.slice(0, 4) };
  }

  function fmtT(t) { return (t > 0 ? "+" : "") + Math.round(t * 10) / 10 + "°"; }
  function fmtOmr(v) { return fmtT(v.max) + " till " + fmtT(v.min); }

  // tillgangligt(v) -> bool: filtrerar på användarens märken eller vallor.
  function rekommendera(f, vallor, tillgangligt, kallor, antal) {
    antal = antal || 3;
    kallor = kallor || {};
    var fastetyp = vilkenFastetyp(f);

    function topp(typer, typForBedomning, bara) {
      return vallor
        .filter(function (v) { return typer.indexOf(v.typ) >= 0 && (!bara || tillgangligt(v)); })
        .map(function (v) { return bedom(v, f, typForBedomning, kallor); })
        .sort(function (a, b) { return b.poang - a.poang; })
        .slice(0, antal);
    }

    var res = {
      fastetyp: fastetyp,
      glid: topp(["glid"], "glid", true),
      faste: topp([fastetyp], fastetyp, true),
      grund: topp(["grund"], fastetyp, true).filter(function (r) { return r.valla.sno.indexOf(f.sno) >= 0; }).slice(0, 1),
      // Bästa alternativet oavsett vad användaren har – visas som "saknas i din låda".
      basta: {
        glid: topp(["glid"], "glid", false)[0],
        faste: topp([fastetyp], fastetyp, false)[0]
      },
      tips: tipsFor(f, kallor)
    };
    // Om nollföre: föreslå även hårdvalla som topplager över klister.
    if (fastetyp === "klister" && f.temp <= 0 && f.sno !== "blot") {
      res.topplager = topp(["hard"], "hard", true).slice(0, 1);
    }
    return res;
  }

  function tipsFor(f, kallor) {
    var tips = (kallor.kunskap && kallor.kunskap.tips) || [];
    return tips.filter(function (t) {
      var c = t.villkor || {};
      if (c.tMin != null && f.temp < c.tMin) return false;
      if (c.tMax != null && f.temp > c.tMax) return false;
      if (c.sno && c.sno.indexOf(f.sno) < 0) return false;
      if (c.fuktMin != null && (f.fukt == null || f.fukt < c.fuktMin)) return false;
      return true;
    }).map(function (t) { return t.text; });
  }

  // Gissar snötyp utifrån väderhistorik (senaste ~72 h).
  // h: { tempNu, tempMax72, tempMin72, nysno48 (cm), regn48 (mm), fukt }
  function gissaSnotyp(h) {
    if (h.regn48 > 1 && h.tempNu > -2) return "blot";
    if (h.tempNu > 0.5) return h.nysno48 >= 2 ? "blot" : "grovkornig";
    if (h.nysno48 >= 2) return "ny";
    if (h.tempMax72 > 1) return h.tempNu < -3 ? "isig" : "grovkornig";
    if (h.nysno48 > 0.3) return "ny";
    return "finkornig";
  }

  var api = {
    SNOTYPER: SNOTYPER,
    tempPassning: tempPassning,
    vilkenFastetyp: vilkenFastetyp,
    effektivTemp: effektivTemp,
    rekommendera: rekommendera,
    gissaSnotyp: gissaSnotyp,
    fmtT: fmtT,
    fmtOmr: fmtOmr
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Motor = api;
})(this);
