(function () {
  "use strict";
  var M = window.Motor;
  var $ = function (id) { return document.getElementById(id); };
  var NYCKEL = "vallaguiden.v1";

  // ---------- Lagring ----------
  var state = las() || { lage: "marken", marken: ["Swix"], mina: [], egna: [], tester: [] };
  function las() { try { return JSON.parse(localStorage.getItem(NYCKEL)); } catch (e) { return null; } }
  function spara() { try { localStorage.setItem(NYCKEL, JSON.stringify(state)); } catch (e) { /* privat läge */ } }

  function allaVallor() { return window.VALLOR.concat(state.egna || []); }
  // Andras egna vallor från gemensamma tester – bara för att kunna visa namn och räkna recept.
  var gemensamma = { tester: [], egna: [], uppdaterad: null };
  function medDeladeVallor() {
    var finns = {}; allaVallor().forEach(function (v) { finns[v.id] = 1; });
    return allaVallor().concat(gemensamma.egna.filter(function (v) { return !finns[v.id]; }));
  }
  function hittaValla(id) { return medDeladeVallor().filter(function (v) { return v.id === id; })[0]; }
  function nyttId() { return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8); }
  state.delade = state.delade || {};
  (state.tester || []).forEach(function (t) { if (!t.id) t.id = nyttId(); });
  function marken() {
    var s = {}; allaVallor().forEach(function (v) { s[v.marke] = 1; });
    return Object.keys(s).sort();
  }
  var TYPNAMN = { glid: "Glid", hard: "Hårdvalla", klister: "Klister", grund: "Grund" };

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function el(tag, attrs, html) {
    var e = document.createElement(tag);
    for (var k in attrs || {}) e.setAttribute(k, attrs[k]);
    if (html != null) e.innerHTML = html;
    return e;
  }

  // ---------- Snötyper ----------
  function fyllSno(sel) {
    Object.keys(M.SNOTYPER).forEach(function (k) { sel.appendChild(el("option", { value: k }, esc(M.SNOTYPER[k]))); });
  }
  fyllSno($("sno")); fyllSno($("testSno"));
  $("sno").value = "finkornig";
  Object.keys(M.SNOTYPER).forEach(function (k) {
    $("egenSno").appendChild(el("label", { "class": "chip" }, '<input type="checkbox" name="sno" value="' + k + '"> ' + esc(M.SNOTYPER[k])));
  });

  // ---------- Läge: märken / vallor ----------
  function satLage(l) {
    state.lage = l; spara();
    document.querySelectorAll(".flik").forEach(function (b) { b.setAttribute("aria-selected", b.dataset.lage === l); });
    $("lageMarken").hidden = l !== "marken";
    $("lageVallor").hidden = l !== "vallor";
    rakna();
  }
  document.querySelectorAll(".flik").forEach(function (b) { b.onclick = function () { satLage(b.dataset.lage); }; });

  function ritaMarken() {
    var c = $("markeChips"); c.innerHTML = "";
    marken().forEach(function (m) {
      var lab = el("label", { "class": "chip" }, '<input type="checkbox" value="' + esc(m) + '"' + (state.marken.indexOf(m) >= 0 ? " checked" : "") + "> " + esc(m));
      lab.querySelector("input").onchange = function (e) {
        if (e.target.checked) state.marken.push(m); else state.marken = state.marken.filter(function (x) { return x !== m; });
        spara(); rakna();
      };
      c.appendChild(lab);
    });
  }

  function ritaVallalista() {
    var q = $("vallaSok").value.trim().toLowerCase();
    var c = $("vallaLista"); c.innerHTML = "";
    marken().forEach(function (m) {
      var lista = allaVallor().filter(function (v) {
        return v.marke === m && (!q || (v.marke + " " + v.namn + " " + TYPNAMN[v.typ]).toLowerCase().indexOf(q) >= 0);
      });
      if (!lista.length) return;
      c.appendChild(el("h4", {}, esc(m)));
      lista.forEach(function (v) {
        var lab = el("label", {},
          '<input type="checkbox"' + (state.mina.indexOf(v.id) >= 0 ? " checked" : "") + '> <span class="typ ' + v.typ + '">' + TYPNAMN[v.typ] + "</span> " +
          esc(v.namn) + (v.egen ? " <em>(egen)</em>" : "") + '<span class="omr">' + esc(M.fmtOmr(v)) + "</span>");
        lab.querySelector("input").onchange = function (e) {
          if (e.target.checked) state.mina.push(v.id); else state.mina = state.mina.filter(function (x) { return x !== v.id; });
          spara(); rakna();
        };
        c.appendChild(lab);
      });
    });
  }
  $("vallaSok").oninput = ritaVallalista;

  $("egenForm").onsubmit = function (e) {
    e.preventDefault();
    var f = e.target, sno = [].slice.call(f.querySelectorAll("input[name=sno]:checked")).map(function (i) { return i.value; });
    var min = parseFloat(f.min.value), max = parseFloat(f.max.value);
    if (min > max) { var t = min; min = max; max = t; }
    var v = { id: "egen-" + Date.now(), marke: f.marke.value.trim(), namn: f.namn.value.trim(), typ: f.typ.value,
      min: min, max: max, sno: sno.length ? sno : Object.keys(M.SNOTYPER), niva: "trän", alias: [], egen: true };
    state.egna.push(v); state.mina.push(v.id);
    if (state.marken.indexOf(v.marke) < 0) state.marken.push(v.marke);
    spara(); f.reset(); ritaMarken(); ritaVallalista(); fyllTestValla(); rakna();
  };

  function tillgangligt(v) {
    return state.lage === "vallor" ? state.mina.indexOf(v.id) >= 0 : state.marken.indexOf(v.marke) >= 0;
  }

  // ---------- Rekommendation ----------
  function forhallanden() {
    var fukt = parseFloat($("fukt").value);
    return { temp: parseFloat($("temp").value) || 0, fukt: isNaN(fukt) ? null : fukt, sno: $("sno").value };
  }

  function ritaRes(ol, lista, tomText) {
    ol.innerHTML = "";
    // Visa inte riktigt dåliga träffar (utom om det är det enda alternativet).
    lista = lista.filter(function (r, i) { return i === 0 || r.poang >= 0.35; });
    if (!lista.length) { ol.appendChild(el("li", { "class": "tom" }, tomText)); return; }
    lista.forEach(function (r) {
      var v = r.valla, ev = "";
      if (r.evidens.length) {
        ev = '<details class="evidens"><summary>Vad tester och forum säger (' + r.evidens.length + ")</summary><ul>" +
          r.evidens.map(function (p) {
            var kl = p.vikt > 0.05 ? "pos" : p.vikt < -0.05 ? "neg" : "";
            var kalla = p.url ? '<a href="' + esc(p.url) + '" target="_blank" rel="noopener">' + esc(p.kalla) + "</a>" : esc(p.kalla);
            return '<li class="' + kl + '">“' + esc(p.text) + '” <span class="marke">– ' + (p.typ === "tillverkare" ? "Tillverkare: " : p.typ === "butik" ? "Butik: " : "") + kalla + (p.temp != null ? ", " + esc(M.fmtT(p.temp)) : "") + (p.datum ? ", " + esc(p.datum) : "") + "</span></li>";
          }).join("") + "</ul></details>";
      }
      ol.appendChild(el("li", {},
        '<div class="resrubrik"><strong>' + esc(v.namn) + '</strong><span class="marke">' + esc(v.marke) + '</span><span class="typ ' + v.typ + '">' + TYPNAMN[v.typ] + "</span>" +
        (v.niva === "tävling" ? '<span class="marke">tävling</span>' : "") + '<span class="marke" style="margin-left:auto">' + Math.round(r.poang * 100) + " %</span></div>" +
        '<div class="matare" title="Passning ' + Math.round(r.poang * 100) + '%"><span style="width:' + Math.round(r.poang * 100) + '%"></span></div>' +
        '<ul class="skal">' + r.skal.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ul>" + ev));
    });
  }

  function ritaRecept(lista) {
    var ol = $("resRecept"); ol.innerHTML = "";
    if (!lista.length) { ol.appendChild(el("li", { "class": "tom" }, "Inga kända kombinationer för de här förhållandena ännu. Hämta mer data eller logga dina egna.")); return; }
    lista.forEach(function (x) {
      var r = x.recept;
      var kalla = r.url ? '<a href="' + esc(r.url) + '" target="_blank" rel="noopener">' + esc(r.kalla) + "</a>" : esc(r.kalla);
      var villkor = [r.tMin != null ? M.fmtT(r.tMax) + " till " + M.fmtT(r.tMin) : r.temp != null ? M.fmtT(r.temp) : null,
        Array.isArray(r.sno) ? r.sno.map(function (k) { return (M.SNOTYPER[k] || k).toLowerCase(); }).join(" / ") : r.sno ? (M.SNOTYPER[r.sno] || r.sno).toLowerCase() : null,
        r.datum].filter(Boolean).join(" · ");
      var lager = x.rader.map(function (l) {
        var status = l.har ? '<span class="har" title="Du har den">✓</span>'
          : l.ersatt ? '<span class="ersatt" title="Ersätt med en av dina">↻</span>' : '<span class="saknas" title="Saknas">✗</span>';
        return "<li>" + status + '<div><span class="roll">' + esc(l.rollnamn) + "</span><strong>" + esc(l.valla.marke + " " + l.valla.namn) + "</strong>" +
          (l.alt.length ? ' <span class="marke">eller ' + l.alt.map(function (a) { return esc(a.marke + " " + a.namn); }).join(", ") + "</span>" : "") +
          (l.viaAlt ? ' <span class="marke">→ du har ' + esc(l.viaAlt.marke + " " + l.viaAlt.namn) + "</span>" : "") +
          (!l.har && l.ersatt ? ' <span class="marke">→ ' + (l.hoppaOver ? "hoppa över (du lägger redan " + esc(l.ersatt.marke + " " + l.ersatt.namn) + ")" : "använd din " + esc(l.ersatt.marke + " " + l.ersatt.namn)) + "</span>" : "") + "</div></li>";
      }).join("");
      ol.appendChild(el("li", {},
        '<div class="resrubrik"><span class="kalltyp ' + esc(r.kalltyp || "forum") + '">' + esc(x.kalltypNamn) + "</span>" +
        '<span class="marke">' + kalla + (x.antalKallor > 1 ? " +" + (x.antalKallor - 1) + " källa" + (x.antalKallor > 2 ? "or" : "") : "") + "</span>" + (x.harAlla ? '<span class="marke" style="margin-left:auto">du har allt</span>' : "") + "</div>" +
        (villkor ? '<p class="villkor">' + esc(villkor) + "</p>" : "") + '<ul class="lager">' + lager + "</ul>" +
        (r.text ? '<details class="evidens"><summary>Originaltext</summary><p>' + esc(r.text) + "</p></details>" : "")));
    });
  }

  function rakna() {
    var f = forhallanden();
    var mina = {}; state.tester.forEach(function (t) { mina[t.id] = 1; });
    var delade = gemensamma.tester.filter(function (t) { return !mina[t.id]; })
      .map(function (t) { return Object.assign({}, t, { gemensam: true }); });
    var kallor = { forum: window.FORUM, kunskap: window.KUNSKAP, egnaTester: state.tester.concat(delade) };
    var r = M.rekommendera(f, allaVallor(), tillgangligt, kallor, 3);
    var fasteNamn = r.fastetyp === "klister" ? "klister" : "hårdvalla";

    $("sammanfattning").innerHTML = "<strong>" + esc(M.fmtT(f.temp)) + "</strong>, " + esc(M.SNOTYPER[f.sno].toLowerCase()) +
      (f.fukt != null ? ", " + f.fukt + " % luftfuktighet" : "") + " → glidvalla för " + esc(M.fmtT(f.temp)) + " och fäste med <strong>" + fasteNamn + "</strong>." +
      (state.lage === "vallor" ? " Urval: dina " + state.mina.length + " vallor." : " Urval: " + (state.marken.join(", ") || "inga märken valda") + ".");
    $("rubrikFaste").textContent = "Fäste – " + fasteNamn;

    var ingenText = state.lage === "vallor" ? "Du har ingen passande valla av den här typen – bocka i fler under ”Mina vallor”." : "Inget valt märke har en sådan valla.";
    ritaRes($("resGlid"), r.glid, ingenText);
    ritaRes($("resFaste"), r.faste, ingenText);

    var extra = $("resExtra"); extra.innerHTML = "";
    if (r.grund.length) extra.appendChild(el("p", { "class": "notis" }, "Grund: lägg först <strong>" + esc(r.grund[0].valla.marke + " " + r.grund[0].valla.namn) + "</strong> för bättre hållbarhet."));
    if (r.topplager && r.topplager.length) extra.appendChild(el("p", { "class": "notis" }, "Tips: ett tunt lager <strong>" + esc(r.topplager[0].valla.marke + " " + r.topplager[0].valla.namn) + "</strong> över klistret minskar smuts och klabb i kall, gammal snö."));
    [["glid", r.glid[0]], ["faste", r.faste[0]]].forEach(function (p) {
      var b = r.basta[p[0]];
      if (b && (!p[1] || b.poang - p[1].poang > 0.12) && (!p[1] || b.valla.id !== p[1].valla.id)) {
        extra.appendChild(el("p", { "class": "notis" }, (p[0] === "glid" ? "Glid" : "Fäste") + ": bästa träffen oavsett märke/låda är <strong>" + esc(b.valla.marke + " " + b.valla.namn) + "</strong> (" + Math.round(b.poang * 100) + " % passning)."));
      }
    });

    ritaRecept(M.rekommenderaRecept(f, medDeladeVallor(), tillgangligt, kallor, 4));
    ritaGemensamma(f);

    $("resTips").innerHTML = r.tips.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("");
  }
  ["temp", "fukt", "sno"].forEach(function (id) { $(id).addEventListener("input", rakna); });
  // Testformuläret följer aktuella förhållanden.
  $("temp").addEventListener("input", function () { $("testForm").temp.value = $("temp").value; });
  $("sno").addEventListener("input", function () { $("testSno").value = $("sno").value; });

  // ---------- Väder (Open-Meteo) ----------
  var nuISO = function () { var d = new Date(); d.setMinutes(0, 0, 0); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
  $("tid").value = nuISO();
  var valdPlats = null;

  function status(t) { $("vaderstatus").textContent = t; }

  $("hamtaVader").onclick = function () {
    var q = $("ort").value.trim();
    if (!q) { if (valdPlats) hamtaVader(valdPlats); else status("Skriv en ort eller använd 📍."); return; }
    status("Söker ort…");
    fetch("https://geocoding-api.open-meteo.com/v1/search?count=6&language=sv&name=" + encodeURIComponent(q))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var res = d.results || [];
        if (!res.length) { status("Hittade ingen ort som heter så."); return; }
        if (res.length === 1) { valjOrt(res[0]); return; }
        var lista = $("ortlista"); lista.innerHTML = ""; lista.hidden = false; status("Välj ort:");
        res.forEach(function (o) {
          var b = el("button", { type: "button" }, esc(o.name) + ' <span class="marke">' + esc([o.admin1, o.country].filter(Boolean).join(", ")) + "</span>");
          b.onclick = function () { lista.hidden = true; valjOrt(o); };
          lista.appendChild(b);
        });
      })
      .catch(function () { status("Kunde inte nå vädertjänsten – fyll i manuellt."); });
  };
  function valjOrt(o) {
    valdPlats = { lat: o.latitude, lon: o.longitude, namn: o.name };
    $("ort").value = o.name;
    hamtaVader(valdPlats);
  }
  $("minPlats").onclick = function () {
    if (!navigator.geolocation) { status("Webbläsaren saknar positionering."); return; }
    status("Hämtar position…");
    navigator.geolocation.getCurrentPosition(function (p) {
      valdPlats = { lat: p.coords.latitude, lon: p.coords.longitude, namn: "din position" };
      $("ort").value = "";
      hamtaVader(valdPlats);
    }, function () { status("Fick inte tillgång till position."); });
  };

  function hamtaVader(p) {
    status("Hämtar väder för " + p.namn + "…");
    var url = "https://api.open-meteo.com/v1/forecast?latitude=" + p.lat + "&longitude=" + p.lon +
      "&hourly=temperature_2m,relative_humidity_2m,snowfall,rain&past_days=3&forecast_days=7&timezone=auto";
    fetch(url).then(function (r) { return r.json(); }).then(function (d) {
      var h = d.hourly, mal = $("tid").value || nuISO();
      var i = h.time.indexOf(mal.slice(0, 13) + ":00");
      if (i < 0) { i = 0; while (i < h.time.length - 1 && h.time[i] < mal) i++; }
      function summa(arr, fran, till) { var s = 0; for (var k = Math.max(0, fran); k <= till; k++) s += arr[k] || 0; return s; }
      var t72 = h.temperature_2m.slice(Math.max(0, i - 72), i + 1);
      var vader = {
        tempNu: h.temperature_2m[i], fukt: h.relative_humidity_2m[i],
        tempMax72: Math.max.apply(null, t72), tempMin72: Math.min.apply(null, t72),
        nysno48: summa(h.snowfall, i - 48, i), regn48: summa(h.rain, i - 48, i)
      };
      $("temp").value = Math.round(vader.tempNu * 2) / 2;
      $("fukt").value = Math.round(vader.fukt);
      var gissning = M.gissaSnotyp(vader);
      $("sno").value = gissning;
      $("testForm").temp.value = $("temp").value; $("testSno").value = gissning;
      status(p.namn + " " + h.time[i].replace("T", " ") + ": " + M.fmtT(vader.tempNu) + ", " + Math.round(vader.fukt) + " % fukt.");
      $("snogissning").textContent = "Snötyp gissad från väder: senaste 48 h " + vader.nysno48.toFixed(1) + " cm snö, " + vader.regn48.toFixed(1) +
        " mm regn, 72 h max " + M.fmtT(vader.tempMax72) + ". Ändra om du ser något annat i spåret.";
      rakna();
    }).catch(function () { status("Kunde inte hämta väder – fyll i manuellt."); });
  }

  // ---------- Egna tester ----------
  function fyllTestValla() {
    ["testValla", "testLager2", "testLager3"].forEach(function (id, i) {
      var s = $(id); s.innerHTML = "";
      if (i > 0) s.appendChild(el("option", { value: "" }, "–"));
      allaVallor().forEach(function (v) {
        s.appendChild(el("option", { value: v.id }, esc(v.marke + " " + v.namn + " (" + TYPNAMN[v.typ] + ")")));
      });
    });
  }
  function ritaTester() {
    var ul = $("testLista"); ul.innerHTML = "";
    var odelade = state.tester.filter(function (t) { return !arDelad(t); });
    $("delaAlla").hidden = odelade.length < 2;
    $("delaAlla").textContent = "Dela alla odelade (" + odelade.length + ")";
    if (!state.tester.length) { ul.appendChild(el("li", { "class": "tom" }, "Inga tester ännu.")); return; }
    state.tester.slice().reverse().forEach(function (t) {
      var namn = [t.valla].concat(t.lager || []).map(function (id) { var v = hittaValla(id); return v ? v.marke + " " + v.namn : id; }).join(" + ");
      var li = el("li", {}, "<span>" + esc(t.datum) + "</span><strong>" + esc(namn) + "</strong><span>" +
        esc(M.fmtT(t.temp)) + ", " + esc((M.SNOTYPER[t.sno] || "").toLowerCase()) + "</span><span>" + "★".repeat(t.betyg) + "☆".repeat(5 - t.betyg) +
        "</span>" + (t.kommentar ? '<span class="marke">' + esc(t.kommentar) + "</span>" : "") +
        '<span class="knappar">' + (arDelad(t) ? '<span class="delad">Delad ✓</span>' : '<button type="button" class="dela">Dela</button>') +
        '<button type="button" class="sekundar tabort">Ta bort</button></span>');
      li.querySelector(".tabort").onclick = function () { state.tester = state.tester.filter(function (x) { return x !== t; }); spara(); ritaTester(); rakna(); };
      var d = li.querySelector(".dela"); if (d) d.onclick = function () { dela([t]); };
      ul.appendChild(li);
    });
  }
  $("testForm").datum.value = new Date().toISOString().slice(0, 10);
  $("testForm").temp.value = $("temp").value;
  $("testForm").onsubmit = function (e) {
    e.preventDefault();
    var f = e.target;
    var lager = [f.lager2.value, f.lager3.value].filter(function (x) { return x && x !== f.valla.value; });
    state.tester.push({ id: nyttId(), ort: valdPlats && valdPlats.namn !== "din position" ? valdPlats.namn : "",
      fukt: parseFloat($("fukt").value) || null, datum: f.datum.value, temp: parseFloat(f.temp.value), sno: f.sno.value, valla: f.valla.value, lager: lager, betyg: parseInt(f.betyg.value, 10), kommentar: f.kommentar.value.trim() });
    spara(); f.kommentar.value = ""; f.lager2.value = ""; f.lager3.value = ""; ritaTester(); rakna();
  };
  // ---------- Dela till den gemensamma filen (via GitHub-ärende) ----------
  var REPO = (function () {
    var m = location.hostname.match(/^([\w-]+)\.github\.io$/);
    var r = location.pathname.split("/")[1];
    return m && r ? m[1] + "/" + r : "jensnyby1975/valning";
  })();
  function arDelad(t) {
    return !!state.delade[t.id] || gemensamma.tester.some(function (g) { return g.id === t.id; });
  }
  $("signatur").value = state.signatur || "";
  $("signatur").oninput = function () { state.signatur = $("signatur").value.trim().slice(0, 40); spara(); };

  function dela(tester) {
    tester = tester.slice(0, 15); // håll länken kort nog för webbläsare
    var egnaIds = {};
    tester.forEach(function (t) { [t.valla].concat(t.lager || []).forEach(function (id) { if (/^egen-/.test(id)) egnaIds[id] = 1; }); });
    var data = {
      tester: tester.map(function (t) {
        return { id: t.id, datum: t.datum, temp: t.temp, fukt: t.fukt == null ? undefined : t.fukt, sno: t.sno, valla: t.valla,
          lager: t.lager || [], betyg: t.betyg, kommentar: t.kommentar || "", ort: t.ort || "", signatur: state.signatur || "" };
      }),
      egna: state.egna.filter(function (v) { return egnaIds[v.id]; })
    };
    var rader = tester.map(function (t) {
      var namn = [t.valla].concat(t.lager || []).map(function (id) { var v = hittaValla(id); return v ? v.marke + " " + v.namn : id; }).join(" + ");
      return "| " + t.datum + " | " + M.fmtT(t.temp) + " | " + (M.SNOTYPER[t.sno] || t.sno) + " | " + namn.replace(/\|/g, "/") + " | " + t.betyg + "/5 |";
    });
    var body = "<!-- vallatest -->\nVallatest delat från Vallaguiden. Skicka ärendet så sparas testerna automatiskt i den gemensamma filen.\n\n" +
      "| Datum | Temp | Snö | Valla | Betyg |\n|---|---|---|---|---|\n" + rader.join("\n") +
      "\n\n```json\n" + JSON.stringify(data) + "\n```\n";
    var titel = "Vallatest: " + (tester.length === 1 ? rader[0].split("|")[4].trim() : tester.length + " tester");
    var url = "https://github.com/" + REPO + "/issues/new?title=" + encodeURIComponent(titel) + "&body=" + encodeURIComponent(body);
    var a = el("a", { href: url, target: "_blank", rel: "noopener" });
    document.body.appendChild(a); a.click(); a.remove();
    tester.forEach(function (t) { state.delade[t.id] = 1; });
    spara(); ritaTester();
    $("delaStatus").innerHTML = 'GitHub öppnades i en ny flik – tryck <strong>Submit new issue</strong> där. Öppnades inget? <a href="' + esc(url) + '" target="_blank" rel="noopener">Öppna här</a>.';
  }
  $("delaAlla").onclick = function () { dela(state.tester.filter(function (t) { return !arDelad(t); })); };

  function ritaGemensamma(f) {
    var ul = $("gemensamLista"); if (!ul) return;
    var personer = {}; gemensamma.tester.forEach(function (t) { personer[t.github || t.signatur] = 1; });
    $("gemensamInfo").textContent = gemensamma.tester.length
      ? gemensamma.tester.length + " tester från " + Object.keys(personer).length + " person(er). Närmast dagens förhållanden:"
      : "Inga delade tester än. Bli först – logga ett test och tryck Dela.";
    var lista = gemensamma.tester.slice().sort(function (a, b) {
      var da = Math.abs(a.temp - f.temp) + (a.sno === f.sno ? 0 : 3), db = Math.abs(b.temp - f.temp) + (b.sno === f.sno ? 0 : 3);
      return da - db || (b.datum > a.datum ? 1 : -1);
    }).slice(0, 8);
    ul.innerHTML = "";
    lista.forEach(function (t) {
      var namn = [t.valla].concat(t.lager || []).map(function (id) { var v = hittaValla(id); return v ? v.marke + " " + v.namn : id; }).join(" + ");
      ul.appendChild(el("li", {}, "<span>" + esc(t.datum) + "</span><strong>" + esc(namn) + "</strong><span>" + esc(M.fmtT(t.temp)) + ", " +
        esc((M.SNOTYPER[t.sno] || "").toLowerCase()) + (t.ort ? ", " + esc(t.ort) : "") + "</span><span>" + "★".repeat(t.betyg) + "☆".repeat(5 - t.betyg) + "</span>" +
        (t.kommentar ? '<span class="marke">' + esc(t.kommentar) + "</span>" : "") + '<span class="marke">– ' + esc(t.signatur || t.github || "") + "</span>"));
    });
  }

  function laddaGemensamma(d) {
    if (!d || !Array.isArray(d.tester)) return;
    gemensamma.tester = d.tester;
    gemensamma.uppdaterad = d.uppdaterad;
    var e = [];
    d.tester.forEach(function (t) { (t.egnaVallor || []).forEach(function (v) { e.push(v); }); });
    gemensamma.egna = e;
    ritaTester(); rakna();
  }
  if (window.GEMENSAMMA_TESTER) laddaGemensamma(window.GEMENSAMMA_TESTER);
  else if (location.protocol !== "file:") {
    fetch("data/tester.json", { cache: "no-cache" }).then(function (r) { return r.ok ? r.json() : null; }).then(laddaGemensamma).catch(function () {});
  }

  $("exportera").onclick = function () {
    var json = JSON.stringify({ tester: state.tester, egna: state.egna }, null, 1);
    var ta = $("exportText"); ta.hidden = false; ta.value = json; ta.select();
    try { navigator.clipboard.writeText(json).then(function () { status("Testerna är kopierade – klistra in dem i en fil eller ett mejl."); }, function () {}); } catch (e) { /* markerad text räcker */ }
    try {
      var a = el("a", { href: URL.createObjectURL(new Blob([json], { type: "application/json" })), download: "vallatester.json" });
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e) { /* nedladdning blockerad – texten visas ovan */ }
  };
  $("importera").onchange = function (e) {
    var fil = e.target.files[0]; if (!fil) return;
    fil.text().then(function (txt) {
      var d = JSON.parse(txt);
      var finns = {}; state.egna.forEach(function (v) { finns[v.id] = 1; });
      (d.egna || []).forEach(function (v) { if (!finns[v.id]) state.egna.push(v); });
      var harId = {}; state.tester.forEach(function (t) { harId[t.id] = 1; });
      (d.tester || []).forEach(function (t) { if (!t.id) t.id = nyttId(); if (!harId[t.id]) state.tester.push(t); });
      spara(); ritaMarken(); ritaVallalista(); fyllTestValla(); ritaTester(); rakna();
    }).catch(function () { $("exportText").hidden = false; $("exportText").value = "Kunde inte läsa filen – är det en JSON-export från Vallaguiden?"; });
  };

  // ---------- Om datan ----------
  var F = window.FORUM || {};
  $("forumInfo").innerHTML = F.uppdaterad
    ? "Forumdata: <strong>" + (F.omnamnanden || []).length + "</strong> vallaomnämnanden från " + esc((F.kallor || []).join(", ")) + ", uppdaterad " + esc(F.uppdaterad.slice(0, 10)) + "."
    : "Forumdata har inte hämtats ännu – kör <code>python3 scripts/hamta_tester.py</code> eller aktivera GitHub Actions-flödet.";

  // ---------- Utan väderanslutning (t.ex. inbäddad version) ----------
  if (window.UTAN_VADER) {
    document.querySelectorAll(".vaderrad").forEach(function (e) { e.hidden = true; });
    $("vaderstatus").innerHTML = 'Fyll i temperatur och snö själv – se t.ex. <a href="https://www.yr.no" target="_blank" rel="noopener">yr.no</a> eller <a href="https://www.smhi.se" target="_blank" rel="noopener">smhi.se</a>.';
  }

  // ---------- Installera som app (offline) ----------
  if ("serviceWorker" in navigator && location.protocol === "https:" && !window.UTAN_VADER) {
    try { navigator.serviceWorker.register("sw.js").catch(function () {}); } catch (e) { /* ej tillgängligt */ }
  }

  // ---------- Start ----------
  ritaMarken(); ritaVallalista(); fyllTestValla(); ritaTester(); satLage(state.lage);
})();
