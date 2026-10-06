# Antwoorden Adviesdrogisterij.nl

Eigen "GPT" voor het beantwoorden van klantmails, met open AI-modellen (Mistral, Ollama, OpenRouter, Groq of elk OpenAI-compatibel adres). Vervangt de Custom GPT in ChatGPT.

Eén bestand: `index.html`. Het versienummer staat rechts naast de titel (constante `APP_VERSION` in `index.html`) en wordt bij elke wijziging opgehoogd.

## Gebruik

1. Open `index.html` in Chrome of Edge (dubbelklikken, of via de beveiligde website, zie hieronder).
2. Kies een wachtwoord (minimaal 10 tekens). **Dit wachtwoord is niet te herstellen.**
3. **Instellingen**: kies een aanbieder en plak je API-sleutel. Aanbevolen: Mistral (EU), sleutel via console.mistral.ai.
4. **Instructies**: klik op *Instructiebestand laden* en kies je instructiebestand (bijv. `Adviesdrogisterij_AI_V22_master.json`).
5. **Kennisbank**: upload je Word-bestanden (Klachten, Retourneren, Standaard antwoorden, Verzendinformatie, Betaalmogelijkheden). Meerdere tegelijk kan.
6. **Antwoord maken**: plak de mail van de klant, eventueel een notitie, en klik op *Antwoord maken*.

### Leren van eerdere antwoorden

Klik je op *Kopiëren*, dan onthoudt de app de mail met jouw definitieve antwoord (inclusief eigen aanpassingen; namen, mailadressen, telefoonnummers, IBANs, postcodes en bestelnummers worden verborgen). Bij een nieuwe mail krijgt de AI de drie meest vergelijkbare goedgekeurde antwoorden mee als voorbeeld. Vaste regels voeg je toe via *Onthoud dit als vaste regel* bij *Laat het aanpassen* of in het tabblad *Geleerd*. Daar kun je ook voorbeelden en regels verwijderen of het leren uitzetten.

### Controle op huisregels

Na elk antwoord controleert de app automatisch op de regels uit het instructiebestand: verboden woorden, gedachtestreepjes, niet ingevulde [invulplekken], en escalatie- of spoedwoorden in de klantmail. Met *Laten verbeteren* herschrijft de AI het antwoord volgens die regels.

### Wat wordt meegestuurd?

Documenten met het vinkje *Altijd volledig meesturen* gaan bij elke mail helemaal mee. Vink grote, zelden nodige documenten (bijv. Algemene voorwaarden) uit: daarvan gaan dan alleen de stukken mee die bij de vraag passen. Dat scheelt kosten.

### Bestanden bijwerken

Upload een nieuwe versie met dezelfde bestandsnaam: de oude versie wordt automatisch vervangen. Of klik bij een document op *Nieuwe versie*.

## Centrale opslag (Supabase)

Zonder server bewaart de app alles alleen in de browser van één computer. Met een (gratis) Supabase-project staat alles centraal: op elke computer log je in met hetzelfde wachtwoord en zie je dezelfde instructies, kennisbank, geschiedenis en API-sleutel.

Eenmalig instellen:

1. Maak op supabase.com een **nieuw project** aan (los van PhytoForsan), regio bijv. *Central EU (Frankfurt)*.
2. **SQL Editor → New query**: plak de inhoud van `supabase/setup.sql` en klik **Run**.
3. **Project Settings → API**: kopieer de *Project URL* en de *publishable* (of *anon public*) sleutel. Deze sleutel mag openbaar zijn; de *secret / service_role* sleutel nooit delen.
4. Vul beide in bovenaan het script in `index.html` (`SERVER_URL` en `SERVER_KEY`).
5. Open de app op de computer waar je gegevens nu staan en voer je wachtwoord in: alles wordt versleuteld naar de server gezet. Daarna kun je op elke computer inloggen.

Werken twee mensen tegelijk, dan voegt de app de wijzigingen samen. Wijzigingen van een andere computer verschijnen zodra je terugkomt in het venster.

De workflow `.github/workflows/keep-supabase-awake.yml` houdt het gratis project wakker (Supabase pauzeert anders na een week zonder gebruik).

## Koppeling met je mailbox (IMAP)

Mails worden direct uit je eigen mailbox geladen en het antwoord komt als concept in je map Concepten (als antwoord op de oorspronkelijke mail, met de oorspronkelijke tekst eronder). Verzenden doe je zelf in je mailprogramma. Mails worden alleen gelezen: niet als gelezen gemarkeerd, niet verplaatst of verwijderd.

Een browser kan niet zelf met een mailserver praten. Daarom loopt dit via een kleine functie in Supabase (`supabase/functions/mail/index.ts`). Die controleert eerst of je in de app bent ingelogd en logt pas daarna in op je mailbox. De gegevens van je mailbox staan alleen als *Secrets* in Supabase, nooit in de app of in deze repository. Dit werkt alleen met centrale opslag.

Eenmalig instellen (±10 minuten):

1. **Database bijwerken**: voer `supabase/setup.sql` opnieuw uit (SQL Editor → Run). Dit voegt de controle `vault_verify` toe; bestaande gegevens blijven staan.
2. **Functie plaatsen**: Supabase → **Edge Functions → Deploy a new function → Via Editor**. Naam: `mail`. Vervang de voorbeeldcode door de inhoud van `supabase/functions/mail/index.ts` en klik **Deploy**.
3. **JWT-controle uit**: open de functie `mail` → **Settings** (of Details) en zet **Verify JWT** (*Enforce JWT verification*) **uit**, en sla op. De functie doet zelf de toegangscontrole.
4. **Secrets**: Supabase → **Edge Functions → Secrets** (Manage secrets). Voeg toe:
   - `IMAP_HOST`: je inkomende mailserver, bijv. `mail.adviesdrogisterij.nl`
   - `IMAP_PORT`: `993` (SSL/TLS; bij `143` wordt STARTTLS gebruikt)
   - `IMAP_USER`: de gebruikersnaam, meestal het volledige mailadres
   - `IMAP_PASSWORD`: het wachtwoord van de mailbox
   - optioneel `MAIL_FROM_NAME` (standaard *Adviesdrogisterij.nl*), `MAIL_FROM` (afzenderadres, standaard `IMAP_USER`), `IMAP_DRAFTS` (naam van de conceptenmap als die niet vanzelf wordt gevonden) en `IMAP_ALLOW_SELF_SIGNED` = `true` als je server een eigen (niet-officieel) certificaat gebruikt.
5. **In de app**: Instellingen → **Koppeling met je mailbox** → **Verbinding testen**. Daarna staat de inbox bij *Antwoord maken*.

De gegevens voor stap 4 vind je in je mailprogramma bij de accountinstellingen (inkomende server, IMAP).

**Tegoed en kosten (live)**: maak bij OpenAI een beheerderssleutel aan (platform.openai.com → Settings → Organization → **Admin keys** → Create, kies indien mogelijk alleen-lezen) en zet die in Supabase als Secret `OPENAI_ADMIN_KEY`. Vul in de app bij *Instellingen → Tegoed en kosten* het opgewaardeerde bedrag en de datum in. De app toont dan bovenaan het geschatte tegoed (opgewaardeerd min de live kosten sinds die datum). Het resterende tegoed zelf laat OpenAI niet opvragen; de kosten lopen een paar uur achter.

**Behandeld**: in de inbox zie je per mail of er een concept is gemaakt of het antwoord is gekopieerd; met ✓ markeer je een mail zelf als behandeld. Mails met een ster of vlag in je mailprogramma krijgen een ★. Dit alles is op alle computers zichtbaar.

**Handtekening**: Outlook zet zijn handtekening niet onder concepten die van de server komen. Plak je handtekening daarom één keer in de app (tabblad *Instructies* → *Handtekening onder concepten*); die komt dan onder elk concept. Staat de groet al in je handtekening, maak het veld *Ondertekening* dan leeg, dan zet de AI zelf geen groet meer onder het antwoord.

Na een update van `supabase/functions/mail/index.ts`: plak de nieuwe code in Supabase bij de functie `mail` (Code → Deploy).

## Beveiliging

- **End-to-end versleuteld**: instructies, kennisbank, geschiedenis en de API-sleutel worden in de browser versleuteld met je wachtwoord (PBKDF2 met 600.000 rondes + AES-256-GCM). De server (Supabase) krijgt alleen onleesbare data en nooit het wachtwoord.
- **Toegang tot de server** alleen met een toegangsbewijs dat uit het wachtwoord wordt afgeleid; de tabel zelf is niet leesbaar. Een fout wachtwoord geeft een vertraging tegen raden.
- **Beheerderswachtwoord**: alleen de beheerder kan het gewone wachtwoord wijzigen (de server controleert dat). Instellen via *Instellingen → Wachtwoord en beheer*. Kwijt? In Supabase: `update public.vault set admin_hash = null, admin_salt = null;` en daarna opnieuw instellen.
- **Beveiligde instructies**: bij *Instructies* kun je de instructies achter het beheerderswachtwoord zetten. Iedereen met het gewone wachtwoord kan ze lezen (de AI gebruikt ze), maar opslaan kan alleen met het beheerderswachtwoord; dat controleert de server (`vault_save_locked`). Vereist de bijgewerkte `supabase/setup.sql`. Opheffen in Supabase: `update public.vault set locked = null;`.
- **Wachtwoord kwijt?** Dan is de data niet te herstellen. Wis de kluis in Supabase (SQL: `delete from public.vault;`), kies in de app een nieuw wachtwoord en zet je back-up terug.
- **Automatisch vergrendelen** na 30 minuten zonder gebruik, of direct via de knop *Vergrendelen*.
- **Onthoud mij op deze computer (30 dagen)**: vink je dit aan bij het inloggen, dan opent de app op die computer direct. Niet het wachtwoord maar een afgeleide sleutel wordt bewaard, versleuteld met een niet-uitleesbare apparaatsleutel van de browser. *Vergrendelen* of een wachtwoordwijziging wist het weer. Gebruik het niet op een computer die anderen ook gebruiken.
- **Geen bedrijfsgegevens in deze repository**: instructies en kennisbank staan niet in de code.
- **Content Security Policy**: de pagina mag alleen verbinding maken met de AI-aanbieder, de server en de PDF-lezer van cdnjs.
- **Privacy (AVG)**: klantmails gaan naar de gekozen AI-aanbieder. Mistral verwerkt in de EU; met Ollama blijft alles op je eigen computer. Optioneel worden e-mailadressen, telefoonnummers en IBANs gemaskeerd.
- **Back-up**: *Instellingen → Back-up downloaden* (zonder API-sleutel). Bewaar dat bestand veilig; het is niet versleuteld.

## Online zetten met inlogbeveiliging (aanbevolen: Cloudflare, gratis)

GitHub Pages kan geen wachtwoord op een website zetten. Cloudflare wel, en het werkt met deze privé repository:

1. Maak een gratis account op cloudflare.com.
2. **Workers & Pages → Create → Pages → Connect to Git** en kies deze repository. Build-instellingen leeg laten (geen framework, output-map `/`).
3. **Zero Trust → Access → Applications → Add → Self-hosted**: kies het adres van je site (bijv. `antwoorden-adviesdrogisterij.pages.dev` of een eigen subdomein zoals `antwoorden.adviesdrogisterij.nl`).
4. Voeg een policy toe: *Allow*, *Emails* = de e-mailadressen die erin mogen.

Daarna moet iedereen eerst inloggen met een code die naar zijn of haar e-mail wordt gestuurd, en daarna het wachtwoord van de app invoeren: twee sloten.

Het bestand `_headers` zorgt op Cloudflare voor extra beveiligingsheaders.
