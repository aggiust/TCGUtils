TODO:
1) pubblicare su dockerhub
2) Test su pc windows
3) Test su android


# MTG Commander Analyzer tools

Il progetto include due servizi, selezionabili dal menu:

1. **MTG Expansions**: legge i nomi delle carte da `files/cards.txt`, elenca per ciascuna tutti i set in cui è stata stampata e produce una classifica dei set con più carte della lista. Salva il report in `results/mtg-expansions-report.md`.
2. **YGO Code Converter**: legge gli ID delle carte Yu-Gi-Oh! da `files/ydke-code.txt`, uno per riga, e salva `results/ydke-cards.txt`. Le carte duplicate vengono raggruppate, ad esempio `2x Kycoo the Ghost Destroyer`.

## Avvio locale

Richiede Node.js 20 o successivo. Dalla cartella del progetto, esegui:

```sh
npm start
```

Quando compare il menu, inserisci `1` o `2` e premi Invio. In alternativa, avvia direttamente un servizio con `npm start -- mtg` oppure `npm start -- ygo`. Per il servizio MTG, modifica prima `files/cards.txt`, inserendo una carta per riga; per Yu-Gi-Oh!, modifica `files/ydke-code.txt`, inserendo un ID per riga.

## Avvio con Docker

```sh
docker compose build
docker compose run --rm app
```

Il servizio MTG consulta l'API pubblica di Scryfall; il convertitore Yu-Gi-Oh! consulta l'API pubblica di YGOPRODeck. Entrambi richiedono una connessione Internet.