# Vallaguiden – längdskidvalla

Ett verktyg som ger rekommendationer på **glid- och fästvalla** utifrån väder och snö, och som bara föreslår det du faktiskt kan använda: antingen **märkena du använder** eller **vallorna du har i lådan**. Rekommendationerna viktas mot omdömen från forum, allmän vallakunskap och dina egna tester.

## Kom igång

Öppna `index.html` i webbläsaren (dubbelklicka). Ingen installation behövs.

### I mobilen

Appen kan installeras på hemskärmen och fungerar offline (väder kräver nät):

1. Slå på GitHub Pages: *Settings → Pages → Source: **GitHub Actions***.
2. Slå ihop koden till `main` – flödet `.github/workflows/pages.yml` publicerar då till `https://<användare>.github.io/valning/`.
3. Öppna länken i mobilen → *Dela → Lägg till på hemskärmen* (iPhone) eller *⋮ → Installera app* (Android).

`python3 scripts/bygg_enfil.py ut.html` bygger en fristående enfilsversion utan väderhämtning.

### Användning

1. **Förhållanden** – skriv en ort (eller 📍) och tidpunkt och tryck *Hämta väder*. Temperatur och luftfuktighet hämtas från Open-Meteo och snötypen gissas från de senaste 72 timmarnas väder (nysnö, regn, plusgrader). Justera om du ser något annat i spåret.
2. **Dina vallor** – välj *Mina märken* (t.ex. Swix + Rex) eller *Mina vallor* och bocka i det du har. Saknas en valla kan du lägga till den själv.
3. **Rekommendation** – topp 3 glid och topp 3 fäste (hårdvalla eller klister beroende på snön), grundvalla, topplager över klister, samt tips för förhållandena. Finns det en klart bättre valla som du inte har visas den också.
4. **Mina tester** – logga hur vallan fungerade (1–5). Dina tester väger tyngst nästa gång det är liknande förhållanden. Kan exporteras/importeras som JSON.

## Hur rekommendationen räknas

Per valla (`js/motor.js`):

- **Temperatur (60 %)** – hur väl lufttemperaturen ligger i vallans område. För hårdvalla justeras temperaturen: gammal/finkornig snö och konstsnö → varmare valla, hög luftfuktighet nära nollan → kallare valla (mindre isbildning).
- **Snötyp (25 %)** – om vallan är gjord för snötypen. Isig/grovkornig snö, och blött runt nollan, ger klister.
- **Evidens (15 % + justering)** – forumomnämnanden nära samma temperatur (positiva/negativa), allmän konsensus och dina egna tester.

## Tillverkare, butiker, forum – och kombinationer

`scripts/hamta_tester.py` hämtar vallarekommendationer och tester från **tillverkare** (t.ex. Swix vallatips inför lopp), **butiker/vallateam** (t.ex. Gear Wests helgrekommendationer) och **forum**, och letar upp:

- vilka vallor som nämns (via namn och alias i `data/vallor.js`, t.ex. `V40`, `KX45`, `Rex blå klister`),
- temperatur (`-6C`, `minus 8 grader`, `23F` …) och snötyp,
- omdöme (”bra fäste”, ”slirade”, ”iced”, ”great kick” …) på svenska, norska och engelska.

- **kombinationer i flera lager** – när flera vallor nämns i samma stycke eller lista blir det ett recept, och varje lager får en roll: grund/binder, klister, fäste, topplager (”covered with”, ”täckt med”, ”cover”) eller glid/glidtopp. Temperatur och snö ärvs från inledningen om de inte står i själva stycket.

I appen visas recepten under *Kombinationer*. För varje lager syns om du har vallan (✓), vilken av dina vallor som kan ersätta den (↻) eller att den saknas (✗). Tillverkare väger tyngre än butiker, som väger tyngre än forum. Du kan också logga egna tester med upp till tre lager.

Resultatet skrivs till `data/forum.js` och visas i appen under ”Vad tester och forum säger”, med länk till källan.

```bash
python3 scripts/hamta_tester.py                         # hämta från källorna i scripts/kallor.json
python3 scripts/hamta_tester.py --fil tests/exempel_forum.txt   # testa analysen på en textfil
```

Källor ställs in i `scripts/kallor.json`. Reddit (r/xcountryskiing, r/langrenn, r/Skidor) är förinställt, liksom Swix lopptips, Gear West och Nordic Ski Racer under `sidor`. En sida kan vara ett flöde eller en indexsida vars artiklar följs:

```json
"sidor": [
  {"namn": "Mitt forum", "typ": "forum", "rss": "https://exempel.se/forum/valla.rss", "filter": "valla"},
  {"namn": "Tillverkarens vallatips", "typ": "tillverkare",
   "url": "https://exempel.com/wax-tips", "lankmonster": "/wax-tips/[a-z0-9-]+$", "max": 15}
]
```

`typ` är `tillverkare`, `butik` eller `forum` och styr vikten. Adresserna under `sidor` kunde inte provas från utvecklingsmiljön – kör skriptet och se utskriften; byter en sajt struktur skrivs ett fel ut och övriga källor körs ändå. Läsaren är generell (ren text ur HTML), så de flesta sidor med vallatips fungerar utan specialkod.

GitHub Actions-flödet `.github/workflows/hamta-tester.yml` kör skriptet varje natt och committar ny data. Det kan också startas manuellt under *Actions*.

## Data

- `data/vallor.js` – ~90 vallor från Swix, Rex, Start, Toko, Holmenkol, Vauhti, Rode och Ski-Go. **Temperaturområdena är riktvärden** sammanställda per märke och färg; tillverkarna byter sortiment och namn ofta, så kontrollera förpackningen. Rätta gärna direkt i filen.
- `data/kunskap.js` – allmän vallakunskap/konsensus och tips. Inte specifika tester.
- `data/forum.js` – genereras av skriptet.

## Tester

```bash
node --test tests/*.test.js
python3 -m unittest discover -s tests -p "test_*.py"
```
