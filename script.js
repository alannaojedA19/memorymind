/**
 * script.js
 * MemoryMind — lógica del juego de memoria (matching).
 */

const STORAGE_KEY = 'memorymind_scores';

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
  locked: false
};

// ---------- localStorage ----------

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

// ---------- Utilidades ----------

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

// ---------- Menú: selección de dificultad ----------

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

// ---------- Tablero: construcción ----------

function buildBoard(difficulty) {
  const config = DIFFICULTIES[difficulty];
  const symbols = SYMBOL_POOL.slice(0, config.pairs);
  const deck = shuffle([...symbols, ...symbols]).map((symbol, index) => ({
    id: index,
    symbol,
    isFlipped: false,
    isMatched: false
  }));
  return deck;
}

function renderBoard() {
  const grid = document.getElementById('boardGrid');
  grid.dataset.difficulty = state.difficulty;
  grid.innerHTML = state.cards.map(card => `
    <button type="button" class="board-card ${card.isFlipped ? 'flipped' : ''} ${card.isMatched ? 'matched' : ''}"
      data-id="${card.id}" aria-label="Carta boca abajo">
      <div class="board-card-inner">
        <div class="card-face card-back"><i class="bi bi-question-lg"></i></div>
        <div class="card-face card-front">${card.symbol}</div>
      </div>
    </button>
  `).join('');
}

function updateStatsBar() {
  document.getElementById('scoreValue').textContent = state.score;
  document.getElementById('timeValue').textContent = formatTime(state.timeLeft);
  document.getElementById('movesValue').textContent = state.moves;
}

// ---------- Lógica del juego ----------

function startGame(difficulty) {
  clearInterval(state.timerId);
  const config = DIFFICULTIES[difficulty];

  state = {
    difficulty,
    cards: buildBoard(difficulty),
    flipped: [],
    matchedCount: 0,
    moves: 0,
    score: 0,
    timeLeft: config.time,
    timerId: null,
    locked: false
  };

  document.getElementById('currentDifficultyLabel').textContent = config.label;
  document.getElementById('currentDifficultyLabelMobile').textContent = config.label;

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

function checkMatch() {
  const [first, second] = state.flipped;

  if (first.symbol === second.symbol) {
    first.isMatched = true;
    second.isMatched = true;
    state.matchedCount++;
    state.score += 100;
    state.flipped = [];
    updateStatsBar();
    renderBoard();

    if (state.matchedCount === DIFFICULTIES[state.difficulty].pairs) {
      clearInterval(state.timerId);
      setTimeout(() => endGame(true), 400);
    }
    return;
  }

  state.locked = true;
  setTimeout(() => {
    first.isFlipped = false;
    second.isFlipped = false;
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

// ---------- Scoreboard (menú) ----------

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

// ---------- Navegación ----------

function goToMenu() {
  clearInterval(state.timerId);
  document.querySelectorAll('.difficulty-card').forEach(b => b.classList.remove('selected'));
  document.getElementById('playBtn').disabled = true;
  renderScoreboard();
  showScreen('menuScreen');
}

// ---------- Event listeners globales ----------

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

// ---------- Inicialización ----------

function init() {
  setupDifficultySelection();
  setupEventListeners();
  renderScoreboard();
  showScreen('menuScreen');
}

document.addEventListener('DOMContentLoaded', init);
