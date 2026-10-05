# Chrome-extensie: bestellingen opzoeken

Deze kleine extensie laat de app *Antwoorden Adviesdrogisterij.nl* bij een klantmail de bestelling opzoeken in je webshopbeheer (`adviesdrogisterij.nl/App`).

- Werkt **alleen** als het beheer open staat in Chrome en je daar bent ingelogd. Welke pagina van het beheer open staat maakt niet uit.
- Staat de bestelling niet in een geopende lijst, dan vraagt de extensie hem gericht op via het ingelogde beheer: altijd met een filter op dat ene ordernummer of mailadres en hooguit 5 resultaten, nooit een hele lijst. Ook de orderregels (artikelen) van die bestelling worden zo opgehaald.
- Onthoudt alleen kolomnamen en welk zoekfilter werkt, nooit klantgegevens. Open je één keer *Beheer orders* en de orderregels van een bestelling, dan leert de extensie de juiste kolomnamen.
- Zoekt alleen op het mailadres en de ordernummers uit de klantmail die je in de app opent.
- Slaat niets op en stuurt niets naar andere servers; het resultaat gaat alleen naar het notitieveld in de app.
- Geen wachtwoorden of sleutels nodig.

## Installeren (eenmalig)

1. Download deze map (`chrome-extensie`) naar je computer, bijvoorbeeld via GitHub: groene knop *Code* → *Download ZIP*, en pak het uit.
2. Open in Chrome de pagina `chrome://extensions`.
3. Zet rechtsboven **Ontwikkelaarsmodus** aan.
4. Klik op **Uitgepakte extensie laden** en kies de map `chrome-extensie`.
5. Ververs de app. Bij *Antwoord maken* staat nu de knop **Bestelling opzoeken**.

