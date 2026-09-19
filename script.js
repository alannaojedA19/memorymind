/**
 * script.js
 * MemoryMind — lógica del juego de memoria (matching).
 */

// ============================================================
// 1. CONFIGURACIÓN Y CONSTANTES
// ============================================================

const STORAGE_KEY = 'memorymind_scores';
const DOG_API_URL = 'https://dog.ceo/api/breeds/image/random';
const API_TIMEOUT_MS = 8000;

const DIFFICULTIES = {
  easy: { label: 'Fácil', pairs: 6, time: 60 },
  medium: { label: 'Medio', pairs: 8, time: 90 },
  hard: { label: 'Difícil', pairs: 10, time: 120 }
};

const SYMBOL_POOL = ['👑', '⚔️', '💎', '🍎', '🎩', '🎸', '🍕', '🚀', '🎯', '🌙'];

let state = {
  difficulty: null,
  cards: [],
  flipped: [],
  matchedCount: 0,
  moves: 0,
  score: 0,
  timeLeft: 0,
  timerId: null,
  locked: false,
  usingImages: false
};

// Se incrementa cada vez que arranca una partida nueva o se vuelve al menú.
// Cualquier callback async/timeout de una partida anterior compara contra este
// valor antes de tocar el estado, para no "resucitar" una partida vieja.
let activeGameToken = 0;

// ============================================================
// 2. PERSISTENCIA — localStorage
// ============================================================

function getScores() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveScore(entry) {
  const scores = getScores();
  scores.push(entry);
  scores.sort((a, b) => b.score - a.score);
  saveWithLimit(scores.slice(0, 10));
}

function saveWithLimit(scores) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(scores));
}

function bestScoreFor(difficulty) {
  const scores = getScores().filter(s => s.difficulty === difficulty);
  return scores.length ? Math.max(...scores.map(s => s.score)) : 0;
}

// ============================================================
// 3. UTILIDADES GENERALES
// ============================================================

function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function showScreen(id) {
  document.querySelectorAll('.app-screen').forEach(el => el.classList.add('d-none'));
  document.getElementById(id).classList.remove('d-none');
  document.getElementById('statsBar').classList.toggle('d-none', id !== 'gameScreen');
}

function showToast(message) {
  const toastEl = document.getElementById('apiToast');
  document.getElementById('apiToastBody').textContent = message;
  new bootstrap.Toast(toastEl, { delay: 3500 }).show();
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Tiempo de espera agotado')), ms))
  ]);
}

// ============================================================
// 4. INTEGRACIÓN CON DOG CEO API
// ============================================================

// Pide a la API de Dog CEO tantas imágenes únicas como pares necesite el
// nivel (6/8/10), en rondas de peticiones en paralelo. Usa Promise.allSettled
// en vez de Promise.all: si UNA petición del lote falla (timeout puntual,
// hiccup de red), las demás del mismo lote se siguen aprovechando en vez de
// tirar todo el lote a la basura y caer al modo emojis sin necesidad.
async function fetchUniqueDogImages(count) {
  const urls = new Set();
  let rounds = 0;
  const maxRounds = 5;

  while (urls.size < count && rounds < maxRounds) {
    rounds++;
    const needed = count - urls.size;
    const batchSize = needed + 2; // margen por si la API repite alguna URL

    // allSettled en vez de all: si UNA petición del lote falla (timeout puntual,
    // hiccup de red), las demás del mismo lote se siguen aprovechando en vez de
    // tirar todo el lote a la basura.
    const results = await Promise.allSettled(
      Array.from({ length: batchSize }, () =>
        fetch(DOG_API_URL).then(res => {
          if (!res.ok) throw new Error(`Dog CEO API respondió con estado ${res.status}`);
          return res.json();
        })
      )
    );

    results.forEach(result => {
      if (result.status === 'fulfilled' && result.value.status === 'success' && result.value.message) {
        urls.add(result.value.message);
      }
    });
  }

  if (urls.size < count) {
    throw new Error('No se consiguieron suficientes imágenes únicas desde la API.');
  }

  return [...urls].slice(0, count);
}

// ============================================================
// 5. MENÚ Y SELECCIÓN DE DIFICULTAD
// ============================================================

function setupDifficultySelection() {
  const buttons = document.querySelectorAll('.difficulty-card');
  const playBtn = document.getElementById('playBtn');

  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      state.difficulty = btn.dataset.difficulty;
      playBtn.disabled = false;
    });
  });

  playBtn.addEventListener('click', () => startGame(state.difficulty));
}

// ============================================================
// 6. TABLERO — construcción y renderizado
// ============================================================

function buildBoard(cardValues) {
  const deck = shuffle([...cardValues, ...cardValues]).map((card, index) => ({
    id: index,
    type: card.type,
    value: card.value,
    isFlipped: false,
    isMatched: false,
    isMismatch: false
  }));
  return deck;
}

function cardFrontMarkup(card) {
  if (card.type === 'image') {
    return `<img src="${card.value}" alt="Carta de memoria" class="card-image" loading="lazy">`;
  }
  return card.value;
}

function cardAriaLabel(card) {
  if (card.isMatched) {
    return card.type === 'image' ? 'Carta emparejada, imagen de perro' : `Carta emparejada, símbolo ${card.value}`;
  }
  if (card.isFlipped) {
    return card.type === 'image' ? 'Carta volteada, imagen de perro' : `Carta volteada, símbolo ${card.value}`;
  }
  return 'Carta boca abajo';
}

function renderBoard() {
  const grid = document.getElementById('boardGrid');
  grid.dataset.difficulty = state.difficulty;
  grid.innerHTML = state.cards.map(card => `
    <button type="button" class="board-card ${card.isFlipped ? 'flipped' : ''} ${card.isMatched ? 'matched' : ''} ${card.isMismatch ? 'mismatch' : ''}"
      data-id="${card.id}" aria-label="${cardAriaLabel(card)}">
      <div class="board-card-inner">
        <div class="card-face card-back"><i class="bi bi-question-lg"></i></div>
        <div class="card-face card-front">${cardFrontMarkup(card)}</div>
      </div>
    </button>
  `).join('');
}

function updateStatsBar() {
  document.getElementById('scoreValue').textContent = state.score;
  document.getElementById('timeValue').textContent = formatTime(state.timeLeft);
  document.getElementById('movesValue').textContent = state.moves;
}

// ============================================================
// 7. LÓGICA DEL JUEGO
// ============================================================

// Arranca una partida: muestra la pantalla de carga, pide imágenes a la API
// (o cae a emojis si falla), arma el tablero y prende el cronómetro. Toma un
// activeGameToken propio para poder abortar sin efectos si el usuario navega
// fuera (menú) o arranca otra partida antes de que la API responda.
async function startGame(difficulty) {
  const token = ++activeGameToken;
  clearInterval(state.timerId);
  const config = DIFFICULTIES[difficulty];

  showScreen('loadingScreen');
  document.getElementById('loadingText').textContent = 'Buscando imágenes de perritos en Dog CEO API...';

  let cardValues;
  let usingImages = true;

  try {
    const imageUrls = await withTimeout(fetchUniqueDogImages(config.pairs), API_TIMEOUT_MS);
    cardValues = imageUrls.map(url => ({ type: 'image', value: url }));
  } catch (err) {
    console.error('Fallback a emojis: no se pudieron obtener imágenes de Dog CEO API.', err);
    usingImages = false;
    cardValues = SYMBOL_POOL.slice(0, config.pairs).map(symbol => ({ type: 'emoji', value: symbol }));
  }

  // Si mientras esperábamos la API el usuario ya volvió al menú o arrancó otra
  // partida (doble clic en "Jugar", navegación durante la carga), esta llamada
  // quedó obsoleta: no debe pisar el estado de la partida vigente.
  if (token !== activeGameToken) return;

  if (!usingImages) {
    showToast('No se pudo conectar con la API de imágenes. Jugando con símbolos.');
  }

  state = {
    difficulty,
    cards: buildBoard(cardValues),
    flipped: [],
    matchedCount: 0,
    moves: 0,
    score: 0,
    timeLeft: config.time,
    timerId: null,
    locked: false,
    usingImages
  };

  document.getElementById('currentDifficultyLabel').textContent = config.label;
  document.getElementById('currentDifficultyLabelMobile').textContent = config.label;
  document.getElementById('offlineModePill').classList.toggle('d-none', usingImages);

  showScreen('gameScreen');
  renderBoard();
  updateStatsBar();
  renderSidebarScores();

  state.timerId = setInterval(() => {
    state.timeLeft--;
    updateStatsBar();
    if (state.timeLeft <= 0) {
      clearInterval(state.timerId);
      endGame(false);
    }
  }, 1000);
}

function handleCardClick(cardId) {
  if (state.locked) return;
  const card = state.cards.find(c => c.id === cardId);
  if (!card || card.isFlipped || card.isMatched) return;
  if (state.flipped.length === 2) return;

  card.isFlipped = true;
  state.flipped.push(card);
  renderBoard();

  if (state.flipped.length === 2) {
    state.moves++;
    updateStatsBar();
    checkMatch();
  }
}

// Compara las 2 cartas volteadas: si coinciden quedan "matched" para siempre
// y suman puntos; si no, se marcan "mismatch" (dispara el shake en CSS) y se
// voltean de regreso tras 1s. Ambos setTimeout comparan su token contra
// activeGameToken para no tocar el estado si ya se salió al menú o empezó
// otra partida mientras esperaban.
function checkMatch() {
  const [first, second] = state.flipped;
  const token = activeGameToken;

  if (first.value === second.value) {
    first.isMatched = true;
    second.isMatched = true;
    state.matchedCount++;
    state.score += 100;
    state.flipped = [];
    updateStatsBar();
    renderBoard();

    if (state.matchedCount === DIFFICULTIES[state.difficulty].pairs) {
      clearInterval(state.timerId);
      setTimeout(() => {
        if (token !== activeGameToken) return; // se salió al menú/otra partida antes de que cerrara
        endGame(true);
      }, 400);
    }
    return;
  }

  first.isMismatch = true;
  second.isMismatch = true;
  state.locked = true;
  renderBoard();

  setTimeout(() => {
    if (token !== activeGameToken) return; // partida vieja: no tocar el estado de la partida actual
    first.isFlipped = false;
    second.isFlipped = false;
    first.isMismatch = false;
    second.isMismatch = false;
    state.flipped = [];
    state.locked = false;
    renderBoard();
  }, 1000);
}

function endGame(won) {
  const config = DIFFICULTIES[state.difficulty];

  if (won) {
    // Bono de tiempo restante para premiar terminar rápido.
    state.score += state.timeLeft * 2;
  }

  const previousBest = bestScoreFor(state.difficulty);

  saveScore({
    difficulty: state.difficulty,
    score: state.score,
    moves: state.moves,
    date: new Date().toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' })
  });

  document.getElementById('resultIcon').className = won
    ? 'bi bi-trophy-fill result-icon'
    : 'bi bi-hourglass-bottom result-icon';
  document.getElementById('resultTitle').textContent = won ? '¡Tablero completado!' : '¡Se acabó el tiempo!';
  document.getElementById('resultSubtitle').textContent = won
    ? 'Encontraste todos los pares. Buen trabajo.'
    : `Alcanzaste ${state.matchedCount} de ${config.pairs} pares.`;
  document.getElementById('finalScore').textContent = state.score;
  document.getElementById('finalMoves').textContent = state.moves;
  document.getElementById('finalTime').textContent = formatTime(config.time - state.timeLeft);

  const newBest = Math.max(previousBest, state.score);
  document.getElementById('bestRecordText').textContent =
    `Mejor récord de nivel ${config.label}: ${newBest} pts`;

  showScreen('resultScreen');
}

// ============================================================
// 8. SCOREBOARD (menú y sidebar)
// ============================================================

function renderScoreboard() {
  const scores = getScores();
  const tbody = document.getElementById('scoreboardBody');
  const emptyState = document.getElementById('emptyScores');

  if (scores.length === 0) {
    tbody.innerHTML = '';
    emptyState.classList.remove('d-none');
    return;
  }

  emptyState.classList.add('d-none');
  tbody.innerHTML = scores.map((entry, index) => `
    <tr>
      <td>${index + 1}</td>
      <td><span class="badge-level ${entry.difficulty}">${DIFFICULTIES[entry.difficulty].label}</span></td>
      <td>${entry.score}</td>
      <td>${entry.moves}</td>
      <td>${entry.date}</td>
    </tr>
  `).join('');
}

function renderSidebarScores() {
  const list = document.getElementById('sidebarScoreList');
  const scores = getScores().slice(0, 5);

  if (scores.length === 0) {
    list.innerHTML = '<li>Sin registros aún</li>';
    return;
  }

  list.innerHTML = scores.map(entry => `
    <li><span>${DIFFICULTIES[entry.difficulty].label}</span><span>${entry.score} pts</span></li>
  `).join('');
}

// ============================================================
// 9. NAVEGACIÓN
// ============================================================

function goToMenu() {
  activeGameToken++; // invalida cualquier startGame/checkMatch pendiente de la partida anterior
  clearInterval(state.timerId);
  document.querySelectorAll('.difficulty-card').forEach(b => b.classList.remove('selected'));
  document.getElementById('playBtn').disabled = true;
  renderScoreboard();
  showScreen('menuScreen');
}

// ============================================================
// 10. EVENT LISTENERS E INICIALIZACIÓN
// ============================================================

function setupEventListeners() {
  document.getElementById('boardGrid').addEventListener('click', (e) => {
    const cardBtn = e.target.closest('.board-card');
    if (cardBtn) handleCardClick(Number(cardBtn.dataset.id));
  });

  document.getElementById('restartBtn').addEventListener('click', () => startGame(state.difficulty));
  document.getElementById('menuBtn').addEventListener('click', goToMenu);
  document.getElementById('changeLevelBtn').addEventListener('click', goToMenu);
  document.getElementById('changeLevelBtnMobile').addEventListener('click', goToMenu);
  document.getElementById('brandHome').addEventListener('click', (e) => {
    e.preventDefault();
    goToMenu();
  });
}

function init() {
  setupDifficultySelection();
  setupEventListeners();
  renderScoreboard();
  showScreen('menuScreen');
}

document.addEventListener('DOMContentLoaded', init);
