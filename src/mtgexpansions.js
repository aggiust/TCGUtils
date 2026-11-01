import fs from 'fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const cardsFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../files/cards.txt');
const reportFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../results/mtg-expansions-report.md');
const scryfallRequestOptions = {
  headers: {
    'User-Agent': 'MTGCommanderAnalyzer/1.0',
    Accept: 'application/json'
  }
};
const requestIntervalMs = 100;
let lastRequestAt = 0;

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function fetchFromScryfall(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const waitTime = lastRequestAt + requestIntervalMs - Date.now();
    if (waitTime > 0) await delay(waitTime);
    lastRequestAt = Date.now();

    const response = await fetch(url, scryfallRequestOptions);
    if (response.status !== 429 || attempt === 3) return response;

    const retryAfter = response.headers.get('Retry-After');
    const retryAfterSeconds = Number(retryAfter);
    const retryAfterDate = Date.parse(retryAfter);
    const retryDelay = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? retryAfterSeconds * 1000
      : Number.isFinite(retryAfterDate)
        ? Math.max(0, retryAfterDate - Date.now())
        : 1000 * (attempt + 1);
    await delay(retryDelay);
  }
}

async function getCardPrintings(cardName) {
  const searchUrl = `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(cardName)}`;
  const response = await fetchFromScryfall(searchUrl);
  if (!response.ok){
    console.error(`Errore nella ricerca ${searchUrl}: HTTP ${response.status} ${response.statusText}`);
    throw new Error(`Errore nella ricerca di ${cardName}: HTTP ${response.status} ${response.statusText}`);
  } 

  const cardData = await response.json();

  let printsUrl = cardData.prints_search_uri;
  const sets = new Map();

  while (printsUrl) {
    const printsResponse = await fetchFromScryfall(printsUrl);
    if (!printsResponse.ok) {
      throw new Error(`Errore nel recupero delle ristampe di ${cardName}: HTTP ${printsResponse.status} ${printsResponse.statusText}`);
    }

    const printsData = await printsResponse.json();
    for (const print of printsData.data) {
      if (!sets.has(print.set)) {
        sets.set(print.set, {
          setName: print.set_name,
          setCode: print.set,
          releasedAt: print.released_at
        });
      }
    }

    if (printsData.has_more && !printsData.next_page) {
      throw new Error(`Risposta Scryfall incompleta: manca la pagina successiva per ${cardName}`);
    }
    printsUrl = printsData.has_more ? printsData.next_page : null;
  }

  return Array.from(sets.values()).sort((a, b) =>
    a.releasedAt.localeCompare(b.releasedAt) || a.setName.localeCompare(b.setName)
  );
}

export async function main() {
  // Leggo il file cards.txt dalla cartella files
  const fileContent = fs.readFileSync(cardsFile, "utf-8");

  // Splitto per righe e rimuovo spazi vuoti
  const cardList = fileContent
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0);
  const uniqueCardList = Array.from(new Set(cardList));

  // Mappa dei set
  const setMap = new Map();
  const cardResults = [];
  const errors = [];

  for (const [index, card] of uniqueCardList.entries()) {
    console.log(`Ricerca ${index + 1}/${uniqueCardList.length}: ${card}`);
    try {
      const sets = await getCardPrintings(card);
      cardResults.push({ card, sets });
      console.log(`  Trovate ${sets.length} espansioni`);

      for (const s of sets) {
        if (!setMap.has(s.setCode)) {
          setMap.set(s.setCode, { setName: s.setName, cards: [] });
        }
        setMap.get(s.setCode).cards.push(card);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ card, message });
      cardResults.push({ card, sets: [], error: message });
    }
  }

  // Trasformo in array e ordino per numero di carte trovate
  const ranking = Array.from(setMap.entries())
    .map(([setCode, entry]) => ({
      setCode,
      setName: entry.setName,
      count: entry.cards.length,
      cards: entry.cards
    }))
    .sort((a, b) => b.count - a.count);

  const report = [
    '# Report delle espansioni MTG',
    '',
    // '## Espansioni per carta',
    // '',
    // ...cardResults.flatMap(({ card, sets, error }) => [
    //   `### ${card}`,
    //   ...(error
    //     ? [`- Errore: ${error}`]
    //     : sets.length > 0
    //       ? sets.map(set => `- ${set.setName} (\`${set.setCode}\`, ${set.releasedAt})`)
    //       : ['- Nessuna espansione trovata']),
    //   ''
    // ]),
    '## Classifica per espansione',
    '',
    ...(ranking.length > 0
      ? ranking.map((entry, index) =>
          `${index + 1}. **${entry.setName}** (\`${entry.setCode}\`) — ${entry.count} carte: ${entry.cards.join(', ')}`
        )
      : ['Nessuna espansione trovata.']),
    '',
    ...(errors.length > 0
      ? [`## Ricerche non riuscite (${errors.length})`, '', ...errors.map(({ card, message }) => `- **${card}**: ${message}`), '']
      : [])
  ].join('\n');

  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  fs.writeFileSync(reportFile, report, 'utf-8');
  console.log(report);
  console.log(`Report salvato in: ${reportFile}`);

  if (errors.length > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error('Errore durante la ricerca delle espansioni:', error.message);
    process.exitCode = 1;
  });
}
