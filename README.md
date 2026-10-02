# LiraSnapWeb

En minimalistisk skärmklippsapp i samma visuella familj som LiraCADWeb och LiraPDFWeb. Flytande vänstermeny, flera bildkort och ritning med en kalibrerad skala. All bildhantering sker lokalt i webbläsaren.

## Starta

Dubbelklicka på **Starta LiraSnap.command** på macOS, eller kör `npm start` med Node.js 22 eller senare. Öppna <http://localhost:5188>.

Appen behöver inga installerade paket för att köras eller byggas. `npm run build` skapar en fristående `dist/` som kan serveras statiskt. Kör via localhost eller HTTPS för skärmklipp och urklipp, inte genom att dubbelklicka på HTML-filen.

## Installera som app

I Chrome eller Edge visas **Installera** när webbläsaren erbjuder installation. Du kan också använda webbläsarens installationsmeny. LiraSnap öppnas därefter i ett eget fönster. Installation och offlinefunktion kräver HTTPS eller localhost.

Appens manifest innehåller genvägarna **Nytt skärmklipp**, **Nytt projekt** och **Öppna LiraSnap** för ikonens meny i aktivitetsfältet eller Dock. Vilka menyer som visas beror på operativsystem och webbläsare. Skärmklippsgenvägen öppnar en knapp för att starta skärmvalet; webbläsaren kräver ett klick i appen innan skärmen får fångas. Projektgenvägen frågar efter namn innan arbetsytan byts. Avbryt behåller arbetsytan, och ett skapat nytt projekt kan ångras under samma session.

Efter första besöket cachas appen för offlinebruk. Bilder och projekt autosparas fortfarande lokalt. Appen söker efter nya versioner när den får fokus, när anslutningen återkommer och var femtonde minut medan den är synlig. När en ny version är hämtad visas den gröna knappen **Uppdatera appen**; arbetsytan sparas innan appen laddas om. Bygget genererar ett versionsbundet offlinepaket och fungerar även under en undermapp på webbservern.

## Arbeta med klipp

- **Nytt skärmklipp:** välj en skärm i webbläsarens dialog. Dra sedan en rektangel i den fångade bilden. När du släpper läggs klippet direkt på arbetsytan, utan en extra bekräftelse. Fångstvyn fyller webbläsarfönstret och visar bara bilden och en avbrytknapp. Skärmdelningen stoppas när bilden har fångats, även vid fel.
- **Bild, klistra in eller släpp:** PNG, JPG, WebP och GIF. GIF läses som en stillbild. Flera bilder kan importeras samtidigt.
- **Skala:** klicka två kända punkter och ange den verkliga längden i mm, cm eller m. Varje klipp har sin egen skala. En befintlig skala kan kalibreras om.
- **Rita:** linje, rektangel, cirkel, frihand, mått, leader, text, färgmarkering och täckande maskering. Geometriska verktyg använder klick–klick med förhandsvisning mellan punkterna. För mått: klicka två referenspunkter och klicka därefter för att placera måttlinjen. Frihand använder håll ned och dra.
- **Exakt längd:** ange längden i det aktiva klippets enhet innan du klickar startpunkt och riktning. För cirklar gäller längden radien. Kräver kalibrerad skala.
- **Redigera:** markera ett objekt, flytta det, dra handtagen eller ändra text, färg, linjebredd och längd i egenskapspanelen. Mått har ett särskilt handtag för måttlinjens placering.
- **Flera klipp:** dra ett korts rubrik för att flytta det, dra dess nedre högra handtag för att ändra visningsstorlek. Skalans förhållande till bildens pixlar ändras inte. Klippets egenskaper innehåller namn, enhet, duplicering och återställning av beskärning.
- **POLAR:** snäpp nära multiplar av 45°. Shift ger 90°-riktningar. **OSNAP:** ändpunkter, mittpunkter, cirkelcentrum/kardinalpunkter och skärningar mellan linjer. **OTRACK:** hovra 400 ms över en snäpppunkt för att fånga den som referens. Högst två referenser hålls aktiva. Horisontella och vertikala hjälplinjer utgår bara från fångade referenser. Referensen släpps efter 1 200 ms utan kontakt; kontakt med dess hjälplinje håller den kvar. Kräver OSNAP.
- **Navigera:** rullhjul panorerar, ⌘/Ctrl + rullhjul zoomar vid pekaren. Mellanslag + dra eller mittenknapp + dra panorerar. Visa alla passar in samlingen.

Vänstermenyn visar Markera och kategorierna Rita, Ändra, Mått och Bild. Hovra över en kategori för att visa verktygen; klick och tangentbordsfokus fungerar också. Menyn kan flyttas med greppet högst upp och fällas ihop med pilen.

### Markera och ändra

Markera med klick på ett objekt eller klick–klick på två hörn i en tom del av bilden. Vänster till höger (blå ruta) väljer objekt helt innanför; höger till vänster (grön streckad ruta) tar också objekt som korsar rutan. Shift lägger till objekt och fönster i markeringen; Shift-klick på ett markerat objekt tar bort det.

**Flytta (G)** och **Kopiera (K)**: markera objekt, välj verktyget och klicka baspunkt och destination. Om verktyget väljs först markerar du objekten och trycker Enter innan baspunkten. Förhandsvisning, Polar, OSNAP och tidsstyrd OTRACK hjälper vid placeringen. Copy kan placera flera kopior från samma baspunkt; Esc avslutar. En markering med flera objekt kan också dras, dupliceras och tas bort tillsammans.

**Trimma (X)** och **Förläng (E)** arbetar på linjer. Välj en linje, rektangel eller cirkel som gräns och klicka sedan linjedelen som ska tas bort, respektive nära änden som ska förlängas. Redan markerade gränsobjekt används när verktyget startar. Shift-klick lägger till fler gränser. Trim mellan två gränser kan dela linjen i två kvarvarande delar. Ändringarna kan ångras.

## Spara och dela

Arbetsytan autosparas i IndexedDB i den aktuella webbläsaren. Spara projekt ger en `.lirasnap`-fil med originalbilder, skala och redigerbara ritobjekt. Ångra/gör om omfattar import, ritning, egenskaper, beskärning, förflyttning och borttagning.

Kopiera/exportera erbjuder aktivt klipp eller hela samlingen i klippens placering på arbetsytan. PNG och kopiering innehåller bilden med ritobjekten inbakade. Skalstreck kan läggas till per kalibrerat klipp. PDF-exporten är en bildbaserad A4-sida som kan öppnas i LiraPDFWeb; bilderna passas in på sidan och garanterar inte en fysisk utskriftsskala. Någon direkt API-koppling till LiraPDFWeb finns ännu inte.

Skalan förutsätter en bild med enhetlig skala. Perspektivfoton kan inte kalibreras över hela bilden med en enda referens. Beskärning och maskering är redigerbara i projektfilen, som behåller originalbilden; delade PNG/PDF-filer visar den beskurna och maskerade versionen.

[Skärmfångst](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia) och [bildkopiering](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/write) styrs av webbläsarens stöd och tillstånd. Vid saknat stöd kan en skärmbild klistras in/importeras och resultatet exporteras som PNG.

## Kortkommandon

V markera · L linje · R rektangel · C cirkel · F frihand · D mått · A leader · T text · S skala · B beskär · H färgmarkering · M maskering. Esc avbryter och återgår alltid till Markera. Delete tar bort markerat objekt; hela klippet kan tas bort i dess egenskaper. ⌘/Ctrl Z ångrar, Shift Z gör om, S sparar projekt, O öppnar, C kopierar aktivt klipp och D duplicerar markeringen eller aktivt klipp. F3/F10/F11 växlar OSNAP/POLAR/OTRACK.

## GitHub Pages

Webbapp: https://andreassvensson87-dev.github.io/LiraSnapWeb/

Källkod: https://github.com/andreassvensson87-dev/LiraSnapWeb

Push till `main` kör syntaxkontroll, tester och bygge i GitHub Actions. Ett godkänt bygge publiceras automatiskt på GitHub Pages. Pull requests kontrolleras utan publicering. Projekt och skärmklipp lagras i besökarens webbläsare. För att flytta ett projekt från localhost till den publicerade appen, spara en `.lirasnap`-fil och öppna den där.

## Kontroller

`npm run check` kontrollerar syntax, kör geometritester och bygger appen. Testerna täcker kalibrering, snäppning, exakta längder, beskärning, projektschema, SVG-export och PDF-struktur.

För webbläsartester: installera utvecklingsberoendena med `npm install`, installera Chromium med `npx playwright install chromium`, starta appen och kör `npm run test:browser`. Alternativt kan `LIRASNAP_TEST_MODULES` peka på en befintlig `node_modules` med Playwright och pdf-lib. `LIRASNAP_TEST_URL` kan ange en annan appadress. Resultatbilder och exportfiler hamnar i `test-results/`.

Webbläsartesterna provar alla ritverktyg, skala, exakta längder, objektredigering och förflyttning, ångra/gör om, beskärning, PNG/PDF-export, projektsparande/öppnande, återställning efter omladdning, import, inklistring, mobil layout och flyttbar meny. PWA-testet kontrollerar manifest, genvägar, undermappar, offlinebruk och uppdatering med bevarat projekt. Skärmfångstkällan, urklippsskrivningen och installationsdialogen simuleras i testerna; riktiga OS-tillstånd och ikonens meny behöver provas i den vanliga webbläsaren.
