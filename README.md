# Antwoorden Adviesdrogisterij.nl

Eigen "GPT" voor het beantwoorden van klantmails, met open AI-modellen (Mistral, Ollama, OpenRouter, Groq of elk OpenAI-compatibel adres). Vervangt de Custom GPT in ChatGPT.

Eén bestand: `index.html`. Geen server, geen installatie.

## Gebruik

1. Open `index.html` in Chrome of Edge (dubbelklikken, of via de beveiligde website, zie hieronder).
2. Kies een wachtwoord (minimaal 10 tekens). **Dit wachtwoord is niet te herstellen.**
3. **Instellingen**: kies een aanbieder en plak je API-sleutel. Aanbevolen: Mistral (EU), sleutel via console.mistral.ai.
4. **Instructies**: klik op *Instructiebestand laden* en kies je instructiebestand (bijv. `Adviesdrogisterij_AI_V22_master.json`).
5. **Kennisbank**: upload je Word-bestanden (Klachten, Retourneren, Standaard antwoorden, Verzendinformatie, Betaalmogelijkheden). Meerdere tegelijk kan.
6. **Antwoord maken**: plak de mail van de klant, eventueel een notitie, en klik op *Antwoord maken*.

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

## Beveiliging

- **End-to-end versleuteld**: instructies, kennisbank, geschiedenis en de API-sleutel worden in de browser versleuteld met je wachtwoord (PBKDF2 met 600.000 rondes + AES-256-GCM). De server (Supabase) krijgt alleen onleesbare data en nooit het wachtwoord.
- **Toegang tot de server** alleen met een toegangsbewijs dat uit het wachtwoord wordt afgeleid; de tabel zelf is niet leesbaar. Een fout wachtwoord geeft een vertraging tegen raden.
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
