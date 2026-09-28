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

## Koppeling met Outlook (Microsoft 365)

Mails worden direct uit je mailbox geladen en het antwoord komt als concept in de mailconversatie te staan (map Concepten); je klikt in Outlook alleen nog op Verzenden. Inloggen gaat via Microsoft zelf (OAuth); je mailwachtwoord komt nooit in de app en de toegang staat alleen in de huidige browsersessie.

Eenmalig een app-registratie maken (±5 minuten, als beheerder van je Microsoft 365-omgeving):

1. Ga naar https://entra.microsoft.com → **Applications → App registrations → New registration**.
2. Naam: `Antwoorden Adviesdrogisterij`. Supported account types: **Accounts in this organizational directory only**.
3. Redirect URI: platform **Single-page application (SPA)**, adres: `https://rensstam.github.io/Antwoorden-Adviesdrogisterij.nl/` (precies zoals het in de app bij Instellingen staat). Klik **Register**.
4. Kopieer op de overzichtspagina de **Application (client) ID** en **Directory (tenant) ID**.
5. **API permissions → Add a permission → Microsoft Graph → Delegated**: `Mail.ReadWrite`, `Mail.ReadWrite.Shared`, `User.Read`, `offline_access`. Klik daarna op **Grant admin consent**.
6. Vul in de app bij **Instellingen → Koppeling met Outlook** de twee ID's in, en bij *Mailbox* eventueel de gedeelde mailbox (bijv. `info@adviesdrogisterij.nl`). Klik **Verbinden met Outlook**.

Voor een gedeelde mailbox moet je eigen Microsoft-account in Exchange *Volledige toegang* tot die mailbox hebben.

## Beveiliging

- **End-to-end versleuteld**: instructies, kennisbank, geschiedenis en de API-sleutel worden in de browser versleuteld met je wachtwoord (PBKDF2 met 600.000 rondes + AES-256-GCM). De server (Supabase) krijgt alleen onleesbare data en nooit het wachtwoord.
- **Toegang tot de server** alleen met een toegangsbewijs dat uit het wachtwoord wordt afgeleid; de tabel zelf is niet leesbaar. Een fout wachtwoord geeft een vertraging tegen raden.
- **Beheerderswachtwoord**: alleen de beheerder kan het gewone wachtwoord wijzigen (de server controleert dat). Instellen via *Instellingen → Wachtwoord en beheer*. Kwijt? In Supabase: `update public.vault set admin_hash = null, admin_salt = null;` en daarna opnieuw instellen.
- **Wachtwoord kwijt?** Dan is de data niet te herstellen. Wis de kluis in Supabase (SQL: `delete from public.vault;`), kies in de app een nieuw wachtwoord en zet je back-up terug.
- **Automatisch vergrendelen** na 30 minuten zonder gebruik, of direct via de knop *Vergrendelen*.
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
