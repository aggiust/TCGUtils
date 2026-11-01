<script setup>
import { computed, ref } from 'vue';

const service = ref('mtg');
const input = ref('');
const output = ref('');
const preview = ref('');
const outputFilename = ref('');
const errorMessage = ref('');
const statusMessage = ref('');
const isProcessing = ref(false);
const progress = ref({ completed: 0, total: 0 });

const serviceInfo = computed(() => service.value === 'mtg'
  ? {
      label: 'Magic: The Gathering',
      placeholder: 'Una carta per riga, ad esempio:\nCultivate\nSeek the Horizon',
      hint: 'Inserisci un nome di carta per riga. Il report scaricabile include il dettaglio per carta e la classifica; sono esclusi The List (plst) e le stampe solo digitali/MTGO.'
    }
  : {
      label: 'Yu-Gi-Oh!',
      placeholder: 'Un ID carta per riga, ad esempio:\n88240808\n88240808',
      hint: 'Inserisci gli ID numerici delle carte, uno per riga (non una stringa codificata ydke://). Gli ID duplicati saranno raggruppati, ad esempio: 2x Kycoo the Ghost Destroyer.'
    });

const canGenerate = computed(() => input.value.trim().length > 0 && !isProcessing.value);

function parseLines(value) {
  return value
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

let lastScryfallRequestAt = 0;

async function fetchScryfall(url) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const waitTime = lastScryfallRequestAt + 100 - Date.now();
    if (waitTime > 0) await wait(waitTime);
    lastScryfallRequestAt = Date.now();

    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (response.status !== 429 || attempt === 3) {
      if (!response.ok) {
        const body = (await response.text()).trim().slice(0, 500);
        const details = `${response.status} ${response.statusText}${body ? `: ${body}` : ''}`;
        throw new Error(details);
      }
      return response.json();
    }

    const retryAfter = response.headers.get('Retry-After');
    const retrySeconds = Number(retryAfter);
    const retryDate = Date.parse(retryAfter);
    await wait(Number.isFinite(retrySeconds) && retrySeconds > 0
      ? retrySeconds * 1000
      : Number.isFinite(retryDate)
        ? Math.max(0, retryDate - Date.now())
        : 1000 * (attempt + 1));
  }
}

async function getPrintings(cardName) {
  const card = await fetchScryfall(
    `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(cardName)}`
  );
  if (!card.prints_search_uri) {
    throw new Error('La risposta API non contiene il collegamento alle ristampe.');
  }

  const sets = new Map();
  let pageUrl = card.prints_search_uri;

  while (pageUrl) {
    const page = await fetchScryfall(pageUrl);
    for (const printing of page.data ?? []) {
      const isMtgoOnly = printing.games?.includes('mtgo') && !printing.games.includes('paper');
      if (printing.set === 'plst' || printing.digital || isMtgoOnly) continue;
      if (!sets.has(printing.set)) {
        sets.set(printing.set, {
          name: printing.set_name,
          code: printing.set,
          releasedAt: printing.released_at
        });
      }
    }
    if (page.has_more && !page.next_page) {
      throw new Error('La risposta API indica altre pagine ma non fornisce il collegamento successivo.');
    }
    pageUrl = page.has_more ? page.next_page : null;
  }

  return Array.from(sets.values()).sort((a, b) =>
    a.releasedAt.localeCompare(b.releasedAt) || a.name.localeCompare(b.name)
  );
}

async function createMtgReport(cards) {
  const results = [];
  const setMap = new Map();
  const errors = [];

  for (const [index, card] of cards.entries()) {
    statusMessage.value = `Cerco le ristampe di ${card}…`;
    progress.value = { completed: index, total: cards.length };
    try {
      const sets = await getPrintings(card);
      results.push({ card, sets });
      for (const set of sets) {
        if (!setMap.has(set.code)) {
          setMap.set(set.code, { ...set, cards: new Set() });
        }
        setMap.get(set.code).cards.add(card);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ card, message });
      results.push({ card, sets: [], error: message });
    }
    progress.value = { completed: index + 1, total: cards.length };
  }

  const ranking = Array.from(setMap.values())
    .map(set => ({ ...set, cards: Array.from(set.cards) }))
    .sort((a, b) => b.cards.length - a.cards.length || a.name.localeCompare(b.name));

  const rankingLines = [
    'CLASSIFICA PER ESPANSIONE',
    '',
    ...(ranking.length === 0
      ? ['Nessuna espansione trovata.']
      : ranking.map((set, index) =>
          `${index + 1}. ${set.name} (${set.code}) — ${set.cards.length} carte: ${set.cards.join(', ')}`
        ))
  ];

  const errorLines = errors.length > 0
    ? [`RICERCHE NON RIUSCITE (${errors.length})`, ...errors.map(({ card, message }) => `- ${card}: ${message}`)]
    : [];
  const detailLines = [
    'REPORT ESPANSIONI MAGIC: THE GATHERING',
    `Carte richieste: ${cards.length}`,
    'Esclusi The List (plst) e le stampe solo digitali/MTGO.',
    '',
    'ESPANSIONI PER CARTA',
    ''
  ];

  for (const result of results) {
    detailLines.push(result.card);
    if (result.error) {
      detailLines.push(`  ERRORE: ${result.error}`);
    } else if (result.sets.length === 0) {
      detailLines.push('  Nessuna espansione trovata.');
    } else {
      for (const set of result.sets) {
        detailLines.push(`  - ${set.name} (${set.code}, ${set.releasedAt})`);
      }
    }
    detailLines.push('');
  }

  const text = [
    ...detailLines,
    '',
    ...rankingLines,
    ...(errorLines.length > 0 ? ['', ...errorLines] : [])
  ].join('\n');
  const previewText = [
    'REPORT ESPANSIONI MAGIC: THE GATHERING',
    'Esclusi The List (plst) e le stampe solo digitali/MTGO.',
    '',
    ...rankingLines,
    ...(errorLines.length > 0 ? ['', ...errorLines] : [])
  ].join('\n');

  return { text, previewText, errors };
}

async function fetchYgoName(id) {
  const response = await fetch(
    `https://db.ygoprodeck.com/api/v7/cardinfo.php?id=${encodeURIComponent(id)}`
  );
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

  const data = await response.json();
  const name = data.data?.[0]?.name;
  if (!name) throw new Error('La risposta API non contiene il nome della carta.');
  return name;
}

async function createYgoReport(ids) {
  const namesById = new Map();
  const errors = [];
  const uniqueIds = Array.from(new Set(ids));

  for (const [index, id] of uniqueIds.entries()) {
    statusMessage.value = `Cerco la carta con ID ${id}…`;
    progress.value = { completed: index, total: uniqueIds.length };
    if (!/^\d+$/.test(id)) {
      errors.push({ id, message: 'L’ID deve contenere solo cifre.' });
      continue;
    }
    try {
      namesById.set(id, await fetchYgoName(id));
    } catch (error) {
      errors.push({ id, message: error instanceof Error ? error.message : String(error) });
    }
    progress.value = { completed: index + 1, total: uniqueIds.length };
  }

  const countsByName = new Map();
  for (const id of ids) {
    const name = namesById.get(id);
    if (name) countsByName.set(name, (countsByName.get(name) ?? 0) + 1);
  }

  const lines = [
    'LISTA CARTE YU-GI-OH!',
    `Codici richiesti: ${ids.length}`,
    '',
    ...Array.from(countsByName, ([name, count]) => `${count > 1 ? `${count}x ` : ''}${name}`)
  ];

  if (errors.length > 0) {
    lines.push('', `CODICI NON CONVERTITI (${errors.length})`);
    for (const { id, message } of errors) lines.push(`- ${id}: ${message}`);
  }

  return { text: lines.join('\n'), errors };
}

async function loadFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    input.value = await file.text();
    clearGeneratedReport();
  } catch (error) {
    errorMessage.value = `Impossibile leggere il file: ${error instanceof Error ? error.message : String(error)}`;
  }
  event.target.value = '';
}

function changeService(value) {
  if (service.value === value) return;
  service.value = value;
  input.value = '';
  output.value = '';
  preview.value = '';
  outputFilename.value = '';
  errorMessage.value = '';
  statusMessage.value = '';
  progress.value = { completed: 0, total: 0 };
}

function clearGeneratedReport() {
  output.value = '';
  preview.value = '';
  outputFilename.value = '';
  errorMessage.value = '';
  statusMessage.value = '';
}

function clearList() {
  input.value = '';
  clearGeneratedReport();
  progress.value = { completed: 0, total: 0 };
}

async function generateReport() {
  const entries = Array.from(new Set(parseLines(input.value)));
  if (entries.length === 0) {
    errorMessage.value = 'Inserisci almeno una carta o un ID.';
    return;
  }

  isProcessing.value = true;
  output.value = '';
  preview.value = '';
  outputFilename.value = '';
  errorMessage.value = '';
  progress.value = { completed: 0, total: entries.length };

  try {
    const result = service.value === 'mtg'
      ? await createMtgReport(entries)
      : await createYgoReport(parseLines(input.value));
    output.value = result.text;
    preview.value = result.previewText ?? result.text;
    outputFilename.value = service.value === 'mtg' ? 'report-espansioni-mtg.txt' : 'lista-carte-yugioh.txt';
    if (result.errors.length > 0) {
      errorMessage.value = `Operazione completata con ${result.errors.length} errori. Il report li elenca e potrebbe essere incompleto.`;
      statusMessage.value = 'Report parziale pronto.';
    } else {
      statusMessage.value = 'Report completato.';
    }
  } catch (error) {
    errorMessage.value = `Non è stato possibile generare il report: ${error instanceof Error ? error.message : String(error)}`;
    statusMessage.value = '';
  } finally {
    isProcessing.value = false;
  }
}

function downloadReport() {
  const blob = new Blob([output.value], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = outputFilename.value;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
</script>

<template>
  <main class="page-shell">
    <header class="site-header">
      <a class="brand" href="#" aria-label="Card List Tools, home">
        <span class="brand-mark" aria-hidden="true">C</span>
        <span>Card List Tools</span>
      </a>
      <span class="header-note">Strumenti per le tue liste di carte</span>
    </header>

    <section class="intro">
      <p class="eyebrow">ANALISI E CONVERSIONE</p>
      <h1>La tua lista, pronta da usare.</h1>
      <p class="intro-copy">
        Incolla i dati o carica un file. Elaboriamo la lista e prepariamo un report da scaricare.
      </p>
    </section>

    <section class="workspace" aria-labelledby="form-title">
      <div class="service-picker" role="group" aria-label="Seleziona il servizio">
        <button
          type="button"
          class="service-option"
          :class="{ selected: service === 'mtg' }"
          :aria-pressed="service === 'mtg'"
          @click="changeService('mtg')"
        >
          <span class="game-symbol mtg-symbol" aria-hidden="true">M</span>
          <span><strong>Magic: The Gathering</strong><small>Espansioni e ristampe</small></span>
        </button>
        <button
          type="button"
          class="service-option"
          :class="{ selected: service === 'ygo' }"
          :aria-pressed="service === 'ygo'"
          @click="changeService('ygo')"
        >
          <span class="game-symbol ygo-symbol" aria-hidden="true">Y</span>
          <span><strong>Yu-Gi-Oh!</strong><small>Da ID a lista carte</small></span>
        </button>
      </div>

      <div class="form-content">
        <div class="section-heading">
          <div>
            <p class="eyebrow">NUOVA ELABORAZIONE</p>
            <h2 id="form-title">{{ serviceInfo.label }}</h2>
          </div>
          <span class="step-badge">01 <span>/ INPUT</span></span>
        </div>

        <p class="input-hint">{{ serviceInfo.hint }}</p>

        <label class="input-label" for="card-input">Lista</label>
        <textarea
          id="card-input"
          v-model="input"
          :placeholder="serviceInfo.placeholder"
          :disabled="isProcessing"
          @input="clearGeneratedReport"
          spellcheck="false"
        />
        <div class="input-meta">
          <span>{{ parseLines(input).length }} righe inserite</span>
          <div class="input-actions">
            <button
              type="button"
              class="clear-button"
              :disabled="isProcessing || (!input && !output)"
              @click="clearList"
            >
              Svuota lista
            </button>
            <label class="file-picker" :class="{ disabled: isProcessing }">
              <input type="file" accept=".txt,text/plain" :disabled="isProcessing" @change="loadFile">
              <span aria-hidden="true">↑</span> Carica file .txt
            </label>
          </div>
        </div>

        <div v-if="isProcessing" class="progress-area" aria-live="polite">
          <div class="progress-copy">
            <span>{{ statusMessage }}</span>
            <span>{{ progress.completed }}/{{ progress.total }}</span>
          </div>
          <progress :value="progress.completed" :max="progress.total || 1" />
        </div>
        <p v-else-if="statusMessage" class="success-message" role="status">{{ statusMessage }}</p>
        <p v-if="errorMessage" class="error-message" role="alert">{{ errorMessage }}</p>

        <button type="button" class="primary-button" :disabled="!canGenerate" @click="generateReport">
          <span>{{ isProcessing ? 'Elaborazione in corso…' : 'Genera report' }}</span>
          <span v-if="!isProcessing" aria-hidden="true">→</span>
        </button>

        <section v-if="output" class="result-panel" aria-labelledby="result-title">
          <div class="result-heading">
            <div>
              <p class="eyebrow">RISULTATO</p>
              <h3 id="result-title">Report pronto</h3>
            </div>
            <button type="button" class="download-button" @click="downloadReport">
              <span aria-hidden="true">↓</span> Scarica .txt
            </button>
          </div>
          <pre>{{ preview }}</pre>
        </section>
      </div>
    </section>

    <footer class="site-footer">
      <span>I dati vengono elaborati nel browser e non vengono salvati su un server.</span>
      <span>Fonti: Scryfall · YGOPRODeck</span>
    </footer>
  </main>
</template>
