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

## Beveiliging

- **Versleuteld opslaan**: instructies, kennisbank, geschiedenis en de API-sleutel worden alleen in je eigen browser bewaard, versleuteld met je wachtwoord (PBKDF2 met 600.000 rondes + AES-256-GCM). Zonder wachtwoord zijn ze onleesbaar.
- **Automatisch vergrendelen** na 30 minuten zonder gebruik, of direct via de knop *Vergrendelen*.
- **Geen bedrijfsgegevens in deze repository**: instructies en kennisbank staan niet in de code, alleen versleuteld in je browser.
- **Content Security Policy**: de pagina mag alleen verbinding maken met de AI-aanbieder en de PDF-lezer van cdnjs.
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
