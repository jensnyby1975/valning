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

  var KALLVIKT = { tillverkare: 1.0, butik: 0.9, forum: 0.6, erfarenhet: 0.8, eget: 1.5 };
  var KALLNAMN = { tillverkare: "Tillverkare", butik: "Butik/vallateam", forum: "Forum", erfarenhet: "Allmän erfarenhet", eget: "Ditt test" };
  var ROLLNAMN = { grund: "Grund", klister: "Klister", "fäste": "Fäste", topp: "Topplager", glid: "Glid", "glid-topp": "Glid, topplager" };

  // Hittar en ersättare bland användarens vallor: samma typ, vars område täcker originalets mitt bäst.
  function ersattare(v, vallor, tillgangligt) {
    var mitt = (v.min + v.max) / 2, bast = null, bp = -1;
    vallor.forEach(function (x) {
      if (x.typ !== v.typ || x.id === v.id || !tillgangligt(x)) return;
      var p = tempPassning(x, mitt) + (x.marke === v.marke ? 0.05 : 0);
      if (p > bp) { bp = p; bast = x; }
    });
    return bp >= 0.6 ? bast : null;
  }

  // Kombinationer (recept med flera lager) från tillverkare, butiker, forum, allmän erfarenhet och egna tester.
  function rekommenderaRecept(f, vallor, tillgangligt, kallor, antal) {
    var perId = {};
    vallor.forEach(function (v) { perId[v.id] = v; });
    var alla = [];
    ((kallor.forum && kallor.forum.recept) || []).forEach(function (r) { alla.push(r); });
    ((kallor.kunskap && kallor.kunskap.recept) || []).forEach(function (r) {
      alla.push({ lager: r.lager, temp: (r.tMin + r.tMax) / 2, tMin: r.tMin, tMax: r.tMax, sno: r.sno, kalla: "Allmän erfarenhet", kalltyp: "erfarenhet", text: r.text });
    });
    (kallor.egnaTester || []).forEach(function (e) {
      if (!e.lager || !e.lager.length || e.betyg < 4) return;
      alla.push({ lager: [{ valla: e.valla, roll: "" }].concat(e.lager.map(function (id) { return { valla: id, roll: "" }; })),
        temp: e.temp, sno: e.sno, kalla: "Mina tester", kalltyp: "eget", datum: e.datum,
        text: "Ditt test: betyg " + e.betyg + "/5" + (e.kommentar ? " – " + e.kommentar : "") });
    });
    var ut = [];
    alla.forEach(function (r) {
      var lager = r.lager.filter(function (l) { return perId[l.valla]; });
      if (lager.length < 2) return;
      var tp;
      if (r.tMin != null) tp = f.temp >= r.tMin - 0.5 && f.temp <= r.tMax + 0.5 ? 1 : gauss(Math.min(Math.abs(f.temp - r.tMin), Math.abs(f.temp - r.tMax)), 2);
      else if (r.temp == null) tp = 0.35;
      else tp = gauss(r.temp - f.temp, 2.5);
      var snoLista = Array.isArray(r.sno) ? r.sno : r.sno ? [r.sno] : null;
      var sp = !snoLista ? 0.85 : snoLista.indexOf(f.sno) >= 0 ? 1 : 0.7;
      var harAntal = 0, anvanda = {};
      lager.forEach(function (l) { if (tillgangligt(perId[l.valla])) anvanda[l.valla] = 1; });
      var rader = lager.map(function (l) {
        var v = perId[l.valla], har = tillgangligt(v);
        if (har) harAntal++;
        var roll = l.roll || ({ grund: "grund", klister: "klister", hard: "fäste", glid: "glid" })[v.typ];
        var ers = har ? null : ersattare(v, vallor, tillgangligt);
        // Samma ersättare för två lager = lägg bara ett lager av den.
        var hoppa = !!(ers && anvanda[ers.id]);
        if (ers) anvanda[ers.id] = 1;
        return { valla: v, roll: roll, rollnamn: ROLLNAMN[roll] || roll, har: har, ersatt: ers, hoppaOver: hoppa };
      });
      var tackt = rader.filter(function (x) { return x.har || x.ersatt; }).length / rader.length;
      var neg = r.sentiment < 0 ? 0.6 : 1;
      var poang = tp * sp * neg * (KALLVIKT[r.kalltyp] || 0.6) / 1.5 * (0.55 + 0.45 * tackt);
      if (tp < 0.25) return;
      ut.push({ recept: r, rader: rader, poang: poang, harAlla: harAntal === rader.length, tackt: tackt,
        kalltypNamn: KALLNAMN[r.kalltyp] || "Forum" });
    });
    // Slå ihop dubbletter (samma lager): behåll den mest auktoritativa källan och bästa poängen.
    var RANG = { eget: 5, tillverkare: 4, butik: 3, erfarenhet: 2, forum: 1 };
    var grupper = {};
    ut.forEach(function (x) {
      var k = x.rader.map(function (r) { return r.valla.id; }).join("+");
      var g = grupper[k];
      if (!g) { grupper[k] = x; return; }
      var poang = Math.max(g.poang, x.poang);
      var vinnare = (RANG[x.recept.kalltyp] || 0) > (RANG[g.recept.kalltyp] || 0) ? x : g;
      vinnare.poang = poang;
      vinnare.antalKallor = (g.antalKallor || 1) + 1;
      grupper[k] = vinnare;
    });
    return Object.keys(grupper).map(function (k) { return grupper[k]; })
      .sort(function (a, b) { return b.poang - a.poang; })
      .slice(0, antal || 4);
  }

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
      // Tillverkare och butiker rekommenderar (neutralt omnämnande = rekommendation) och väger tyngre.
      var kv = KALLVIKT[o.kalltyp] || KALLVIKT.forum;
      if ((o.kalltyp === "tillverkare" || o.kalltyp === "butik") && o.sentiment === 0) s = 1;
      poang += w * s * kv;
      poster.push({ typ: o.kalltyp || "forum", vikt: w * s, text: o.utdrag, kalla: o.kalla, url: o.url, datum: o.datum, temp: o.temp });
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
      if (e.valla !== v.id && (e.lager || []).indexOf(v.id) < 0) return;
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
    rekommenderaRecept: rekommenderaRecept,
    gissaSnotyp: gissaSnotyp,
    fmtT: fmtT,
    fmtOmr: fmtOmr
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Motor = api;
})(this);
