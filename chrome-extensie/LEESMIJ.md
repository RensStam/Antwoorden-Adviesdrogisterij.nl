# Chrome-extensie: bestellingen opzoeken

Deze kleine extensie laat de app *Antwoorden Adviesdrogisterij.nl* bij een klantmail de bestelling opzoeken in je webshopbeheer (`adviesdrogisterij.nl/App`).

- Werkt **alleen** als het beheer open staat in Chrome en je daar bent ingelogd. Welke pagina van het beheer open staat maakt niet uit.
- Staat de bestelling niet in een geopende lijst, dan vraagt de extensie hem gericht op via het ingelogde beheer: altijd met een filter op dat ene ordernummer of mailadres en hooguit 5 resultaten, nooit een hele lijst. Ook de orderregels (artikelen) van die bestelling worden zo opgehaald.
- Onthoudt alleen namen (kolomnamen, filtervelden, het adres van het beheer) en welk zoekfilter werkt, nooit klantgegevens. Open je één keer *Beheer orders*, dan leert de extensie de juiste zoekvelden; daarna hoeft die lijst niet meer open te staan.
- Per zoekactie hooguit 14 gerichte verzoeken (binnen 9 seconden). Bij het automatisch zoeken na het openen van een mail alleen met zoekvelden die al bekend zijn.
- Meldt "mogelijk uitgelogd" alleen als het beheer echt om inloggen vraagt. Bij "Geen bestelling gevonden" staan onder de melding technische details (alleen namen en aantallen) die je naar Claude kunt sturen.
- Zoekt alleen op het mailadres en de ordernummers uit de klantmail die je in de app opent.
- Slaat niets op en stuurt niets naar andere servers; het resultaat gaat alleen naar het notitieveld in de app.
- Geen wachtwoorden of sleutels nodig.

## Installeren (eenmalig)

1. Download deze map (`chrome-extensie`) naar je computer, bijvoorbeeld via GitHub: groene knop *Code* → *Download ZIP*, en pak het uit.
2. Open in Chrome de pagina `chrome://extensions`.
3. Zet rechtsboven **Ontwikkelaarsmodus** aan.
4. Klik op **Uitgepakte extensie laden** en kies de map `chrome-extensie`.
5. Ververs de app. Bij *Antwoord maken* staat nu de knop **Bestelling opzoeken**.

