// Allmän, välkänd vallakunskap (konsensus från vallaguider och forumdiskussioner).
// Detta är INTE specifika tester – riktiga test- och forumdata kommer från data/forum.js
// (hämtas med scripts/hamta_tester.py) och från dina egna tester i appen.
window.KUNSKAP = {
  konsensus: [
    {"valla":"swix-v40","tMin":-8,"tMax":-2,"sno":["ny","finkornig","konst"],"text":"Swix V40 Blue Extra är den mest använda fästvallan runt -2 till -8 – en säker förstaval på finkornig snö."},
    {"valla":"swix-v30","tMin":-12,"tMax":-5,"sno":["ny","finkornig"],"text":"V30 är standardvalet när det är för kallt för V40."},
    {"valla":"swix-v45","tMin":-3,"tMax":0,"sno":["ny","finkornig"],"text":"V45 ger mer fäste än V40 strax under noll men kan isa i nysnö nära 0°."},
    {"valla":"rex-bla-klister","tMin":-12,"tMax":-2,"sno":["isig","grovkornig"],"text":"Rex Blå Klister är en klassiker på kall skare och isiga spår, ofta som grund under hårdvalla."},
    {"valla":"swix-kx30","tMin":-10,"tMax":-1,"sno":["isig","grovkornig","konst"],"text":"KX30 Blue Ice är ett säkert val på hårda, isiga och nedkörda spår."},
    {"valla":"swix-kx45","tMin":-3,"tMax":2,"sno":["grovkornig","blot","isig"],"text":"KX45 Violett räknas som en bred allroundklister på omvandlad snö runt nollan."},
    {"valla":"swix-kx65","tMin":1,"tMax":5,"sno":["grovkornig","blot"],"text":"Röd klister för blöt, grovkornig vårsnö."},
    {"valla":"start-gron","tMin":-25,"tMax":-10,"sno":["ny","finkornig"],"text":"Grön hårdvalla (Start, Swix V20, Rex Grön) är givet i riktig kyla."},
    {"valla":"rode-blu-extra","tMin":-8,"tMax":-2,"sno":["ny","finkornig"],"text":"Rode Blu Extra nämns ofta som alternativ till V40 med lite mer fäste."},
    {"valla":"rex-bla","tMin":-10,"tMax":-3,"sno":["ny","finkornig"],"text":"Rex Blå är en populär, lättvallad fästvalla i normal vinterkyla."}
  ],
  tips: [
    {"villkor":{"tMin":-1.5,"tMax":1.5,"sno":["ny","blot"]},"text":"Nollföre med nysnö: stor risk för isbildning/klabb. Testa tunn klister täckt med hårdvalla, korta fästzonen, eller använd skinskidor/skrapa (\"zero\")."},
    {"villkor":{"sno":["isig"]},"text":"Isigt: lägg grundklister eller blå klister, låt kallna och lägg ev. ett tunt lager hårdvalla överst för att minska smuts och klabb."},
    {"villkor":{"sno":["konst"]},"text":"Konstsnö sliter hårt – använd grundvalla (binder) under hårdvallan och lägg fler tunna lager."},
    {"villkor":{"tMax":-12},"text":"Mycket kallt: glid kan bli trögt – borsta noga, välj hård glid och korka fästvallan länge."},
    {"villkor":{"tMin":0,"sno":["blot","grovkornig"]},"text":"Blött: grövre struktur i glidzonen hjälper mot sug. Klister ska läggas tunt och värmas ut."},
    {"villkor":{"fuktMin":85,"tMin":-4,"tMax":1},"text":"Hög luftfuktighet nära nollan: välj hellre en kallare/hårdare fästvalla – mjuk valla isar lättare."},
    {"villkor":{"sno":["ny"],"tMax":-5},"text":"Kall nysnö är aggressiv mot fästvallan – lägg den längre och tjockare, men kallare valla."},
    {"villkor":{},"text":"Testa alltid två–tre alternativ på plats. Väderdata ger lufttemperatur – snötemperaturen kan vara flera grader kallare i klart väder."}
  ]
};
