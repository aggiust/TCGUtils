import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { main as runMtgExpansions } from './mtgexpansions.js';
import { main as runYgoCodeConverter } from './ygo-code-converter.js';

async function main() {
  let prompt;

  try {
    let choice = process.argv[2]?.trim().toLowerCase();
    if (!choice) {
      prompt = createInterface({ input: stdin, output: stdout });
      console.log('Seleziona il servizio (il programma attende una scelta):');
      console.log('1) MTG Expansions');
      console.log('2) YGO Code Converter');
      choice = (await prompt.question('Scelta (1 o 2, poi Invio): ')).trim();
    }

    if (choice === '1' || choice === 'mtg') {
      await runMtgExpansions();
    } else if (choice === '2' || choice === 'ygo') {
      await runYgoCodeConverter();
    } else {
      console.error('Scelta non valida. Usa 1/mtg oppure 2/ygo.');
      process.exitCode = 1;
    }
  } finally {
    prompt?.close();
  }
}

main().catch(error => {
  console.error('Errore durante l\'esecuzione:', error.message);
  process.exitCode = 1;
});