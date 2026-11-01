import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const codesFile = path.join(projectDirectory, 'files', 'ydke-code.txt');
const outputFile = path.join(projectDirectory, 'results', 'ydke-cards.txt');

async function fetchCardName(id) {
  const url = `https://db.ygoprodeck.com/api/v7/cardinfo.php?id=${encodeURIComponent(id)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Errore HTTP ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const cardName = data.data?.[0]?.name;
  if (!cardName) {
    throw new Error('La risposta API non contiene il nome della carta');
  }
  return cardName;
}

export async function main() {
  const fileContent = fs.readFileSync(codesFile, 'utf-8');
  const cardIds = fileContent
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  if (cardIds.length === 0) {
    throw new Error(`${codesFile} non contiene codici carta`);
  }

  const namesById = new Map();
  const failures = [];

  for (const id of cardIds) {
    if (namesById.has(id)) continue;

    try {
      namesById.set(id, await fetchCardName(id));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ id, message });
    }
  }

  if (failures.length > 0) {
    for (const { id, message } of failures) {
      console.error(`Errore con ID ${id}: ${message}`);
    }
    throw new Error(`${failures.length} codici non sono stati convertiti; il file di output non è stato aggiornato`);
  }

  const countsByName = new Map();
  for (const id of cardIds) {
    const name = namesById.get(id);
    countsByName.set(name, (countsByName.get(name) ?? 0) + 1);
  }

  const output = Array.from(countsByName, ([name, count]) =>
    `${count > 1 ? `${count}x ` : ''}${name}`
  ).join('\n') + '\n';

  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, output, 'utf-8');

  console.log(`Convertite ${cardIds.length} carte (${countsByName.size} nomi univoci).`);
  console.log(`Lista salvata in: ${outputFile}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error('Errore durante la conversione:', error.message);
    process.exitCode = 1;
  });
}
