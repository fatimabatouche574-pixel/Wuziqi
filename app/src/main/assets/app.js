(() => {
  'use strict';

  const SIZE = 19;
  const EMPTY = 0;
  const BLACK = 1;
  const WHITE = 2;
  const KOMI = 7.5;
  const MAX_SEARCH_STEPS = 3000;
  const LETTERS = 'ABCDEFGHJKLMNOPQRST';

  const TIME_PRESETS = {
    rapid: { label: '快棋', mainMs: 10 * 60_000, periods: 3, periodMs: 30_000 },
    standard: { label: '标准赛', mainMs: 30 * 60_000, periods: 5, periodMs: 60_000 },
    long: { label: '长考', mainMs: 60 * 60_000, periods: 5, periodMs: 60_000 }
  };

  const LEVELS = {
    normal: { label: '普通', minSteps: 24, maxSteps: 150, minDepth: 18, maxDepth: 42, roots: 12, rolloutWidth: 8, maxThinkMs: 3_500 },
    strong: { label: '强势', minSteps: 120, maxSteps: 1_000, minDepth: 38, maxDepth: 105, roots: 26, rolloutWidth: 13, maxThinkMs: 10_000 },
    crush: { label: '碾压', minSteps: 420, maxSteps: MAX_SEARCH_STEPS, minDepth: 70, maxDepth: 165, roots: 44, rolloutWidth: 18, maxThinkMs: 22_000 }
  };

  const elements = {
    canvas: document.getElementById('board'),
    stateValue: document.getElementById('stateValue'),
    captureValue: document.getElementById('captureValue'),
    nodeValue: document.getElementById('nodeValue'),
    progressBar: document.getElementById('progressBar'),
    thinkingCover: document.getElementById('thinkingCover'),
    thinkingPill: document.getElementById('thinkingPill'),
    playerColor: document.getElementById('playerColor'),
    timeControl: document.getElementById('timeControl'),
    difficulty: document.getElementById('difficulty'),
    passButton: document.getElementById('passButton'),
    undoButton: document.getElementById('undoButton'),
    hintButton: document.getElementById('hintButton'),
    newButton: document.getElementById('newButton'),
    message: document.getElementById('message'),
    detail: document.getElementById('detail'),
    result: document.getElementById('result'),
    matchSummary: document.getElementById('matchSummary'),
    turnBadge: document.getElementById('turnBadge'),
    blackClockCard: document.getElementById('blackClockCard'),
    whiteClockCard: document.getElementById('whiteClockCard'),
    blackRole: document.getElementById('blackRole'),
    whiteRole: document.getElementById('whiteRole'),
    blackClock: document.getElementById('blackClock'),
    whiteClock: document.getElementById('whiteClock'),
    blackPeriod: document.getElementById('blackPeriod'),
    whitePeriod: document.getElementById('whitePeriod')
  };

  const context = elements.canvas.getContext('2d');
  let game = createGame(BLACK, TIME_PRESETS.standard, 'standard');
  let history = [];
  let thinking = false;
  let searchToken = 0;
  let previewPoint = -1;
  let hintPoint = -1;
  let geometry = { size: 0, margin: 0, cell: 0 };
  let lastClockTick = performance.now();

  function createClock(preset) {
    return {
      mainMs: preset.mainMs,
      periodsLeft: preset.periods,
      periodMs: preset.periodMs,
      periodRemainingMs: preset.periodMs
    };
  }

  function cloneClock(clock) {
    return {
      mainMs: clock.mainMs,
      periodsLeft: clock.periodsLeft,
      periodMs: clock.periodMs,
      periodRemainingMs: clock.periodRemainingMs
    };
  }

  function createGame(playerColor, preset, timeControlKey) {
    const aiColor = opponent(playerColor);
    return {
      board: Array(SIZE * SIZE).fill(EMPTY),
      turn: BLACK,
      playerColor,
      aiColor,
      timeControlKey,
      captures: { [BLACK]: 0, [WHITE]: 0 },
      clocks: { [BLACK]: createClock(preset), [WHITE]: createClock(preset) },
      koHash: null,
      passes: 0,
      lastMove: -1,
      over: false,
      clockRunning: true,
      status: playerColor === BLACK ? '轮到你' : '电脑先行',
      message: playerColor === BLACK ? '你执黑棋，点击棋盘交叉点落子。' : '你执白棋，电脑将先下黑棋。',
      detail: '双方独立计时；主时间用尽后进入读秒。',
      result: ''
    };
  }

  function cloneGame(source = game) {
    return {
      board: source.board.slice(),
      turn: source.turn,
      playerColor: source.playerColor,
      aiColor: source.aiColor,
      timeControlKey: source.timeControlKey,
      captures: { [BLACK]: source.captures[BLACK], [WHITE]: source.captures[WHITE] },
      clocks: { [BLACK]: cloneClock(source.clocks[BLACK]), [WHITE]: cloneClock(source.clocks[WHITE]) },
      koHash: source.koHash,
      passes: source.passes,
      lastMove: source.lastMove,
      over: source.over,
      clockRunning: source.clockRunning,
      status: source.status,
      message: source.message,
      detail: source.detail,
      result: source.result
    };
  }

  function opponent(color) { return color === BLACK ? WHITE : BLACK; }
  function colorName(color) { return color === BLACK ? '黑棋' : '白棋'; }
  function ownerName(color) { return color === game.playerColor ? '玩家' : '电脑'; }
  function hashBoard(board) { return board.join(''); }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

  function neighbors(point) {
    const x = point % SIZE;
    const y = Math.floor(point / SIZE);
    const output = [];
    if (x > 0) output.push(point - 1);
    if (x < SIZE - 1) output.push(point + 1);
    if (y > 0) output.push(point - SIZE);
    if (y < SIZE - 1) output.push(point + SIZE);
    return output;
  }

  function collectGroup(board, start) {
    const color = board[start];
    const stack = [start];
    const visited = new Set([start]);
    const stones = [];
    const liberties = new Set();
    while (stack.length) {
      const point = stack.pop();
      stones.push(point);
      for (const next of neighbors(point)) {
        if (board[next] === EMPTY) liberties.add(next);
        else if (board[next] === color && !visited.has(next)) {
          visited.add(next);
          stack.push(next);
        }
      }
    }
    return { stones, liberties };
  }

  function tryMove(board, color, point, koHash) {
    if (point < 0 || point >= board.length || board[point] !== EMPTY) return null;
    const nextBoard = board.slice();
    nextBoard[point] = color;
    const enemy = opponent(color);
    const checked = new Set();
    let captured = 0;

    for (const next of neighbors(point)) {
      if (nextBoard[next] !== enemy || checked.has(next)) continue;
      const group = collectGroup(nextBoard, next);
      group.stones.forEach(stone => checked.add(stone));
      if (group.liberties.size === 0) {
        captured += group.stones.length;
        group.stones.forEach(stone => { nextBoard[stone] = EMPTY; });
      }
    }

    const ownGroup = collectGroup(nextBoard, point);
    if (ownGroup.liberties.size === 0) return null;
    if (koHash && hashBoard(nextBoard) === koHash) return null;
    return { board: nextBoard, captured, liberties: ownGroup.liberties.size, groupSize: ownGroup.stones.length };
  }

  function occupiedCount(board) {
    let count = 0;
    for (const value of board) if (value !== EMPTY) count++;
    return count;
  }

  function countGroupsAndAtari(board) {
    const visited = new Set();
    let groups = 0;
    let atari = 0;
    for (let point = 0; point < board.length; point++) {
      if (board[point] === EMPTY || visited.has(point)) continue;
      const group = collectGroup(board, point);
      group.stones.forEach(stone => visited.add(stone));
      groups++;
      if (group.liberties.size === 1) atari++;
    }
    return { groups, atari };
  }

  function isEye(board, color, point) {
    const close = neighbors(point);
    return close.length >= 3 && close.every(next => board[next] === color);
  }

  function candidatePool(board) {
    const pool = new Set();
    const occupied = occupiedCount(board);
    if (occupied < 8) {
      const opening = [[3,3],[15,3],[3,15],[15,15],[9,9],[3,9],[15,9],[9,3],[9,15],[4,4],[14,4],[4,14],[14,14],[2,3],[16,3],[2,15],[16,15]];
      opening.forEach(([x, y]) => {
        const point = y * SIZE + x;
        if (board[point] === EMPTY) pool.add(point);
      });
    }

    for (let point = 0; point < board.length; point++) {
      if (board[point] === EMPTY) continue;
      const x = point % SIZE;
      const y = Math.floor(point / SIZE);
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (Math.abs(dx) + Math.abs(dy) > 3) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= SIZE || ny < 0 || ny >= SIZE) continue;
          const candidate = ny * SIZE + nx;
          if (board[candidate] === EMPTY) pool.add(candidate);
        }
      }
    }

    if (pool.size < 44) {
      for (let point = 0; point < board.length && pool.size < 62; point++) {
        if (board[point] === EMPTY && Math.random() < .24) pool.add(point);
      }
    }
    return [...pool];
  }

  function moveHeuristic(board, color, point, move) {
    const x = point % SIZE;
    const y = Math.floor(point / SIZE);
    const occupied = occupiedCount(board);
    let value = move.captured * 82;
    value += Math.min(move.liberties, 7) * 2.9;
    value += Math.min(move.groupSize, 10) * .45;

    const seen = new Set();
    for (const next of neighbors(point)) {
      if (board[next] === EMPTY) continue;
      const group = collectGroup(board, next);
      const key = Math.min(...group.stones);
      if (seen.has(key)) continue;
      seen.add(key);
      if (group.liberties.size === 1 && group.liberties.has(point)) {
        value += board[next] === color ? 35 + group.stones.length * 5 : 30 + group.stones.length * 6;
      } else if (group.liberties.size === 2 && group.liberties.has(point)) {
        value += board[next] === color ? 8 : 14;
      }
    }

    if (occupied < 32) {
      const corners = [[3,3],[15,3],[3,15],[15,15]];
      const nearestCorner = Math.min(...corners.map(([cx, cy]) => Math.hypot(x - cx, y - cy)));
      value += Math.max(0, 9 - nearestCorner * 1.45);
    }

    const edgeDistance = Math.min(x, y, SIZE - 1 - x, SIZE - 1 - y);
    if (occupied < 24 && edgeDistance === 0) value -= 9;
    if (move.liberties === 1 && move.captured === 0) value -= 62;
    if (isEye(board, color, point) && move.captured === 0) value -= 52;
    return value;
  }

  function generateCandidates(board, color, koHash, limit) {
    const output = [];
    for (const point of candidatePool(board)) {
      const move = tryMove(board, color, point, koHash);
      if (!move) continue;
      output.push({ point, move, heuristic: moveHeuristic(board, color, point, move) });
    }
    output.sort((a, b) => b.heuristic - a.heuristic);
    return output.slice(0, limit);
  }

  function weightedChoice(candidates) {
    const top = candidates.slice(0, Math.min(9, candidates.length));
    const best = top[0].heuristic;
    const weights = top.map(item => Math.exp((item.heuristic - best) / 13) + .04);
    let random = Math.random() * weights.reduce((sum, weight) => sum + weight, 0);
    for (let index = 0; index < top.length; index++) {
      random -= weights[index];
      if (random <= 0) return top[index];
    }
    return top[top.length - 1];
  }

  function scoreArea(board) {
    let black = 0;
    let white = KOMI;
    const visited = new Set();
    for (let point = 0; point < board.length; point++) {
      if (board[point] === BLACK) { black++; continue; }
      if (board[point] === WHITE) { white++; continue; }
      if (visited.has(point)) continue;
      const stack = [point];
      const region = [];
      const borders = new Set();
      visited.add(point);
      while (stack.length) {
        const current = stack.pop();
        region.push(current);
        for (const next of neighbors(current)) {
          if (board[next] === EMPTY && !visited.has(next)) {
            visited.add(next);
            stack.push(next);
          } else if (board[next] !== EMPTY) {
            borders.add(board[next]);
          }
        }
      }
      if (borders.size === 1 && borders.has(BLACK)) black += region.length;
      if (borders.size === 1 && borders.has(WHITE)) white += region.length;
    }
    return { black, white };
  }

  function evaluateBoard(board, perspectiveColor) {
    const area = scoreArea(board);
    let whiteAdvantage = area.white - area.black;
    const visited = new Set();
    for (let point = 0; point < board.length; point++) {
      if (board[point] === EMPTY || visited.has(point)) continue;
      const group = collectGroup(board, point);
      group.stones.forEach(stone => visited.add(stone));
      const safety = Math.min(group.liberties.size, 7) * .13;
      whiteAdvantage += board[point] === WHITE ? safety : -safety;
    }
    return perspectiveColor === WHITE ? whiteAdvantage : -whiteAdvantage;
  }

  function rollout(startBoard, nextColor, startKoHash, plan, perspectiveColor) {
    let board = startBoard.slice();
    let color = nextColor;
    let koHash = startKoHash;
    let passes = 0;
    for (let depth = 0; depth < plan.depth && passes < 2; depth++) {
      const candidates = generateCandidates(board, color, koHash, plan.rolloutWidth);
      if (!candidates.length || (depth > 34 && candidates[0].heuristic < -22 && Math.random() < .16)) {
        passes++;
        koHash = hashBoard(board);
        color = opponent(color);
        continue;
      }
      passes = 0;
      const selected = weightedChoice(candidates);
      const oldHash = hashBoard(board);
      board = selected.move.board;
      koHash = oldHash;
      color = opponent(color);
    }
    return evaluateBoard(board, perspectiveColor);
  }

  function effectiveClockMs(clock) {
    if (clock.mainMs > 0) return clock.mainMs + clock.periodsLeft * clock.periodMs;
    return Math.max(0, clock.periodRemainingMs) + Math.max(0, clock.periodsLeft - 1) * clock.periodMs;
  }

  function buildSearchPlan(levelKey, roots) {
    const level = LEVELS[levelKey];
    const occupied = occupiedCount(game.board);
    const phase = occupied / (SIZE * SIZE);
    const boardInfo = countGroupsAndAtari(game.board);
    const tacticalRoots = roots.filter(item => item.move.captured > 0 || item.heuristic >= 38).length;
    const rootFactor = clamp(roots.length / level.roots, 0, 1);
    const tacticalFactor = clamp((boardInfo.atari + tacticalRoots) / 8, 0, 1);
    const phaseFactor = phase < .13 ? .48 : phase < .72 ? 1 : .78;
    const groupFactor = clamp(boardInfo.groups / 38, .25, 1);
    const complexity = clamp(.14 + rootFactor * .28 + tacticalFactor * .34 + groupFactor * .14 + phaseFactor * .1, 0, 1);

    const clock = game.clocks[game.aiColor];
    const availableMs = effectiveClockMs(clock);
    let clockFactor = 1;
    if (clock.mainMs <= 0) clockFactor = clamp(clock.periodRemainingMs / clock.periodMs, .12, .82);
    else if (availableMs < 30_000) clockFactor = .16;
    else if (availableMs < 90_000) clockFactor = .34;
    else if (availableMs < 5 * 60_000) clockFactor = .64;

    const sceneFactor = clamp(complexity * phaseFactor, .08, 1);
    let steps = Math.round(level.minSteps + (level.maxSteps - level.minSteps) * sceneFactor * clockFactor);
    steps = clamp(steps, Math.min(level.minSteps, level.maxSteps), Math.min(level.maxSteps, MAX_SEARCH_STEPS));

    let depth = Math.round(level.minDepth + (level.maxDepth - level.minDepth) * clamp(complexity * .72 + phaseFactor * .28, 0, 1));
    if (clockFactor < .4) depth = Math.max(level.minDepth, Math.round(depth * .7));

    let timeBudgetMs;
    if (clock.mainMs > 0) {
      timeBudgetMs = clamp(1_600 + clock.mainMs * .007, 1_500, level.maxThinkMs);
    } else {
      timeBudgetMs = clamp(clock.periodRemainingMs - 1_300, 450, Math.min(level.maxThinkMs, clock.periodMs * .78));
    }

    return {
      steps,
      depth,
      rolloutWidth: level.rolloutWidth,
      deadline: performance.now() + timeBudgetMs,
      complexity,
      label: level.label
    };
  }

  async function chooseComputerMove(token) {
    const levelKey = elements.difficulty.value;
    const level = LEVELS[levelKey];
    const currentHash = hashBoard(game.board);
    const roots = generateCandidates(game.board, game.aiColor, game.koHash, level.roots);
    if (!roots.length) return null;

    const plan = buildSearchPlan(levelKey, roots);
    const stats = roots.map(candidate => {
      const replies = generateCandidates(candidate.move.board, game.playerColor, currentHash, 5);
      const danger = replies.length ? Math.max(0, replies[0].heuristic) : 0;
      return { candidate, visits: 0, total: 0, prior: candidate.heuristic - danger * .52 };
    });

    let completed = 0;
    updateThinking(0, plan);
    for (let step = 0; step < plan.steps; step++) {
      if (token !== searchToken || game.over) return null;
      if (performance.now() >= plan.deadline && completed >= Math.min(24, plan.steps)) break;

      let selected = stats.find(item => item.visits === 0);
      if (!selected) {
        const logVisits = Math.log(step + 1);
        selected = stats.reduce((best, item) => {
          const average = item.total / item.visits;
          const exploration = Math.sqrt(logVisits / item.visits);
          const value = average + item.prior * .024 + exploration;
          return !best || value > best.value ? { value, item } : best;
        }, null).item;
      }

      selected.total += rollout(selected.candidate.move.board, game.playerColor, currentHash, plan, game.aiColor);
      selected.visits++;
      completed++;

      if (completed % 4 === 0 || completed === plan.steps) {
        if (syncClock()) return null;
        updateThinking(completed, plan);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    stats.sort((a, b) => {
      const aValue = a.visits ? a.total / a.visits + a.prior * .035 : -Infinity;
      const bValue = b.visits ? b.total / b.visits + b.prior * .035 : -Infinity;
      return bValue - aValue;
    });
    elements.nodeValue.textContent = `${completed}/${plan.steps}`;
    return stats[0].candidate;
  }

  function saveHistory() { history.push(cloneGame()); }

  function resetPeriodAfterMove(color) {
    const clock = game.clocks[color];
    if (clock.mainMs <= 0 && clock.periodsLeft > 0) clock.periodRemainingMs = clock.periodMs;
  }

  function applyMove(color, point, move) {
    saveHistory();
    const oldHash = hashBoard(game.board);
    game.board = move.board;
    game.captures[color] += move.captured;
    game.koHash = oldHash;
    game.passes = 0;
    game.lastMove = point;
    resetPeriodAfterMove(color);
    game.turn = opponent(color);
    game.status = game.turn === game.playerColor ? '轮到你' : '电脑思考';
    game.message = move.captured ? `${ownerName(color)}的${colorName(color)}提了 ${move.captured} 子。` : `${ownerName(color)}的${colorName(color)}落在 ${coordinate(point)}。`;
    game.detail = game.turn === game.playerColor ? '你的计时已经开始。' : '电脑计时中，搜索预算会随局面变化。';
    hintPoint = -1;
    lastClockTick = performance.now();
  }

  function applyPass(color) {
    saveHistory();
    game.koHash = hashBoard(game.board);
    game.passes++;
    game.lastMove = -1;
    resetPeriodAfterMove(color);
    game.turn = opponent(color);
    game.status = game.turn === game.playerColor ? '轮到你' : '电脑思考';
    game.message = `${ownerName(color)}的${colorName(color)}停一手。`;
    game.detail = game.passes === 1 ? '另一方若也停一手，对局将结束。' : '';
    hintPoint = -1;
    lastClockTick = performance.now();
    if (game.passes >= 2) finishGame();
  }

  function finishGame() {
    const score = scoreArea(game.board);
    const difference = score.black - score.white;
    const winnerColor = difference > 0 ? BLACK : WHITE;
    const winner = colorName(winnerColor);
    game.over = true;
    game.clockRunning = false;
    game.status = '对局结束';
    game.message = `${winner}胜 ${Math.abs(difference).toFixed(1)} 目。`;
    game.detail = `黑棋 ${score.black.toFixed(1)} 目，白棋 ${score.white.toFixed(1)} 目（含贴目）。`;
    game.result = `${winner}胜 ${Math.abs(difference).toFixed(1)} 目\n${winnerColor === game.playerColor ? '玩家获胜' : '电脑获胜'}｜黑棋 ${score.black.toFixed(1)}　白棋 ${score.white.toFixed(1)}`;
    searchToken++;
    thinking = false;
    clearThinking();
  }

  function loseOnTime(color) {
    if (game.over) return;
    const winner = opponent(color);
    game.over = true;
    game.clockRunning = false;
    game.status = '超时负';
    game.message = `${ownerName(color)}的${colorName(color)}用时耗尽。`;
    game.detail = `${ownerName(winner)}的${colorName(winner)}获胜。`;
    game.result = `${colorName(color)}超时负\n${ownerName(winner)}获胜`;
    searchToken++;
    thinking = false;
    clearThinking();
    render();
  }

  function consumeClock(color, elapsedMs) {
    const clock = game.clocks[color];
    let remaining = Math.max(0, elapsedMs);

    if (clock.mainMs > 0) {
      const used = Math.min(clock.mainMs, remaining);
      clock.mainMs -= used;
      remaining -= used;
    }

    while (remaining > 0 && clock.mainMs <= 0) {
      if (clock.periodsLeft <= 0) { loseOnTime(color); return true; }
      if (remaining < clock.periodRemainingMs) {
        clock.periodRemainingMs -= remaining;
        remaining = 0;
      } else {
        remaining -= clock.periodRemainingMs;
        clock.periodsLeft--;
        if (clock.periodsLeft <= 0) { clock.periodRemainingMs = 0; loseOnTime(color); return true; }
        clock.periodRemainingMs = clock.periodMs;
      }
    }
    return false;
  }

  function syncClock() {
    const now = performance.now();
    const elapsed = now - lastClockTick;
    lastClockTick = now;
    if (!game.clockRunning || game.over || elapsed <= 0) return false;
    const timedOut = consumeClock(game.turn, elapsed);
    updateClockDisplay();
    return timedOut;
  }

  async function computerTurn() {
    if (thinking || game.over || game.turn !== game.aiColor) return;
    syncClock();
    if (game.over) return;

    thinking = true;
    const token = ++searchToken;
    game.status = '电脑思考';
    game.message = `${LEVELS[elements.difficulty.value].label}难度正在评估局面。`;
    game.detail = `搜索会根据局面复杂度和电脑剩余时间自动调整，单回合不超过 ${MAX_SEARCH_STEPS} 步。`;
    render();

    const selected = await chooseComputerMove(token);
    if (token !== searchToken || game.over) return;
    syncClock();
    if (game.over) return;

    if (selected) applyMove(game.aiColor, selected.point, selected.move);
    else applyPass(game.aiColor);

    thinking = false;
    clearThinking();
    render();
  }

  function playerMove(point) {
    if (thinking || game.over || game.turn !== game.playerColor) return;
    syncClock();
    if (game.over) return;

    const move = tryMove(game.board, game.playerColor, point, game.koHash);
    if (!move) {
      game.message = '这里不能落子。';
      game.detail = '该点可能已有棋子，或触发禁自杀、简单劫争规则。';
      render();
      return;
    }

    applyMove(game.playerColor, point, move);
    render();
    window.setTimeout(computerTurn, 80);
  }

  function startNewGame() {
    searchToken++;
    thinking = false;
    history = [];
    previewPoint = -1;
    hintPoint = -1;
    const playerColor = elements.playerColor.value === 'white' ? WHITE : BLACK;
    const preset = TIME_PRESETS[elements.timeControl.value];
    game = createGame(playerColor, preset, elements.timeControl.value);
    elements.nodeValue.textContent = '0';
    clearThinking();
    lastClockTick = performance.now();
    render();
    if (game.aiColor === BLACK) window.setTimeout(computerTurn, 180);
  }

  function coordinate(point) {
    const x = point % SIZE;
    const y = Math.floor(point / SIZE);
    return `${LETTERS[x]}${SIZE - y}`;
  }

  function formatClockMs(milliseconds) {
    const safe = Math.max(0, milliseconds);
    const totalSeconds = Math.ceil(safe / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function clockText(clock) {
    if (clock.mainMs > 0) return { value: formatClockMs(clock.mainMs), sub: '主时间' };
    return { value: formatClockMs(clock.periodRemainingMs), sub: `读秒 · 剩余 ${clock.periodsLeft} 次` };
  }

  function updateClockDisplay() {
    const black = clockText(game.clocks[BLACK]);
    const white = clockText(game.clocks[WHITE]);
    elements.blackClock.textContent = black.value;
    elements.whiteClock.textContent = white.value;
    elements.blackPeriod.textContent = black.sub;
    elements.whitePeriod.textContent = white.sub;
    elements.blackClockCard.classList.toggle('active', !game.over && game.turn === BLACK);
    elements.whiteClockCard.classList.toggle('active', !game.over && game.turn === WHITE);
    elements.blackClockCard.classList.toggle('danger', game.clocks[BLACK].mainMs <= 0 || effectiveClockMs(game.clocks[BLACK]) < 30_000);
    elements.whiteClockCard.classList.toggle('danger', game.clocks[WHITE].mainMs <= 0 || effectiveClockMs(game.clocks[WHITE]) < 30_000);
  }

  function updateThinking(done, plan) {
    elements.nodeValue.textContent = `${done}/${plan.steps}`;
    elements.progressBar.style.width = plan.steps ? `${done / plan.steps * 100}%` : '0%';
    elements.thinkingPill.textContent = `${plan.label}搜索 ${done}/${plan.steps} · 深度 ${plan.depth}`;
    elements.thinkingCover.classList.add('show');
  }

  function clearThinking() {
    elements.progressBar.style.width = '0%';
    elements.thinkingCover.classList.remove('show');
  }

  function render() {
    const preset = TIME_PRESETS[game.timeControlKey];
    elements.stateValue.textContent = game.status;
    elements.captureValue.textContent = `${game.captures[BLACK]} : ${game.captures[WHITE]}`;
    elements.message.textContent = game.message;
    elements.detail.textContent = game.detail;
    elements.blackRole.textContent = `黑棋 · ${ownerName(BLACK)}`;
    elements.whiteRole.textContent = `白棋 · ${ownerName(WHITE)}`;
    elements.matchSummary.textContent = `${preset.label} · 玩家执${game.playerColor === BLACK ? '黑' : '白'} · ${LEVELS[elements.difficulty.value].label}难度`;
    elements.turnBadge.innerHTML = game.over ? '<strong>对局结束</strong>' : `轮到 <strong>${colorName(game.turn)}</strong>`;
    elements.passButton.disabled = thinking || game.over || game.turn !== game.playerColor;
    elements.undoButton.disabled = thinking || history.length === 0;
    elements.hintButton.disabled = thinking || game.over || game.turn !== game.playerColor;
    elements.playerColor.disabled = thinking;
    elements.timeControl.disabled = thinking;
    elements.difficulty.disabled = thinking;
    elements.result.textContent = game.result;
    elements.result.classList.toggle('show', Boolean(game.result));
    updateClockDisplay();
    drawBoard();
  }

  function drawBoard() {
    const rect = elements.canvas.getBoundingClientRect();
    const size = rect.width;
    if (!size) return;
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    elements.canvas.width = Math.round(size * dpr);
    elements.canvas.height = Math.round(size * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    geometry = { size, margin: size * .064, cell: size * .872 / 18 };

    context.clearRect(0, 0, size, size);
    context.fillStyle = '#d5a65f';
    context.fillRect(0, 0, size, size);
    const wood = context.createLinearGradient(0, 0, size, size);
    wood.addColorStop(0, 'rgba(255,255,255,.15)');
    wood.addColorStop(.5, 'rgba(255,255,255,.025)');
    wood.addColorStop(1, 'rgba(71,38,9,.11)');
    context.fillStyle = wood;
    context.fillRect(0, 0, size, size);

    drawCoordinates();
    context.strokeStyle = 'rgba(43,27,10,.92)';
    context.lineWidth = Math.max(.65, size / 800);
    for (let line = 0; line < SIZE; line++) {
      const position = geometry.margin + line * geometry.cell;
      context.beginPath();
      context.moveTo(geometry.margin, position);
      context.lineTo(size - geometry.margin, position);
      context.stroke();
      context.beginPath();
      context.moveTo(position, geometry.margin);
      context.lineTo(position, size - geometry.margin);
      context.stroke();
    }

    context.fillStyle = 'rgba(43,27,10,.95)';
    for (const x of [3, 9, 15]) {
      for (const y of [3, 9, 15]) {
        context.beginPath();
        context.arc(geometry.margin + x * geometry.cell, geometry.margin + y * geometry.cell, Math.max(1.35, geometry.cell * .11), 0, Math.PI * 2);
        context.fill();
      }
    }

    for (let point = 0; point < game.board.length; point++) {
      if (game.board[point] !== EMPTY) drawStone(point, game.board[point], point === game.lastMove);
    }
    if (hintPoint >= 0 && game.board[hintPoint] === EMPTY) drawMarker(hintPoint, '#8a301f', geometry.cell * .19, 2);

    if (previewPoint >= 0 && !thinking && !game.over && game.turn === game.playerColor && game.board[previewPoint] === EMPTY && tryMove(game.board, game.playerColor, previewPoint, game.koHash)) {
      const x = geometry.margin + (previewPoint % SIZE) * geometry.cell;
      const y = geometry.margin + Math.floor(previewPoint / SIZE) * geometry.cell;
      context.globalAlpha = .42;
      context.fillStyle = game.playerColor === BLACK ? '#111' : '#f5f3ed';
      context.beginPath();
      context.arc(x, y, geometry.cell * .465, 0, Math.PI * 2);
      context.fill();
      context.globalAlpha = 1;
    }
  }

  function drawCoordinates() {
    if (geometry.size < 320) return;
    context.save();
    context.fillStyle = 'rgba(60,38,14,.72)';
    context.font = `${Math.max(7, geometry.cell * .34)}px sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    for (let index = 0; index < SIZE; index++) {
      const position = geometry.margin + index * geometry.cell;
      context.fillText(LETTERS[index], position, geometry.margin * .45);
      context.fillText(String(SIZE - index), geometry.margin * .45, position);
    }
    context.restore();
  }

  function drawStone(point, color, isLast) {
    const x = geometry.margin + (point % SIZE) * geometry.cell;
    const y = geometry.margin + Math.floor(point / SIZE) * geometry.cell;
    const radius = geometry.cell * .47;
    context.save();
    context.shadowColor = 'rgba(0,0,0,.32)';
    context.shadowBlur = radius * .24;
    context.shadowOffsetY = radius * .12;
    const gradient = context.createRadialGradient(x - radius * .32, y - radius * .35, radius * .08, x, y, radius);
    if (color === BLACK) {
      gradient.addColorStop(0, '#606060');
      gradient.addColorStop(.34, '#202020');
      gradient.addColorStop(1, '#040404');
    } else {
      gradient.addColorStop(0, '#ffffff');
      gradient.addColorStop(.58, '#f2f0e9');
      gradient.addColorStop(1, '#bdb9b0');
    }
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
    context.restore();

    if (isLast) {
      context.strokeStyle = color === BLACK ? '#eee5d7' : '#2b2721';
      context.lineWidth = Math.max(1, radius * .13);
      context.beginPath();
      context.arc(x, y, radius * .27, 0, Math.PI * 2);
      context.stroke();
    }
  }

  function drawMarker(point, color, radius, lineWidth) {
    const x = geometry.margin + (point % SIZE) * geometry.cell;
    const y = geometry.margin + Math.floor(point / SIZE) * geometry.cell;
    context.strokeStyle = color;
    context.lineWidth = lineWidth;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.stroke();
  }

  function locatePoint(event) {
    const rect = elements.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const gridX = Math.round((x - geometry.margin) / geometry.cell);
    const gridY = Math.round((y - geometry.margin) / geometry.cell);
    if (gridX < 0 || gridX >= SIZE || gridY < 0 || gridY >= SIZE) return -1;
    const exactX = geometry.margin + gridX * geometry.cell;
    const exactY = geometry.margin + gridY * geometry.cell;
    return Math.hypot(x - exactX, y - exactY) <= geometry.cell * .72 ? gridY * SIZE + gridX : -1;
  }

  elements.canvas.addEventListener('pointerdown', event => {
    elements.canvas.setPointerCapture(event.pointerId);
    previewPoint = locatePoint(event);
    drawBoard();
  });

  elements.canvas.addEventListener('pointermove', event => {
    if (event.pointerType === 'mouse' || event.buttons) {
      previewPoint = locatePoint(event);
      drawBoard();
    }
  });

  elements.canvas.addEventListener('pointerup', event => {
    const point = locatePoint(event);
    previewPoint = -1;
    drawBoard();
    if (point >= 0) playerMove(point);
  });

  elements.canvas.addEventListener('pointercancel', () => {
    previewPoint = -1;
    drawBoard();
  });

  elements.passButton.addEventListener('click', () => {
    if (thinking || game.over || game.turn !== game.playerColor) return;
    syncClock();
    if (game.over) return;
    applyPass(game.playerColor);
    render();
    if (!game.over) window.setTimeout(computerTurn, 80);
  });

  elements.undoButton.addEventListener('click', () => {
    if (thinking || history.length === 0) return;
    searchToken++;
    const steps = game.turn === game.playerColor ? Math.min(2, history.length) : 1;
    const targetIndex = history.length - steps;
    game = history[targetIndex];
    history.splice(targetIndex, steps);
    game.over = false;
    game.clockRunning = true;
    game.status = game.turn === game.playerColor ? '轮到你' : '电脑思考';
    game.message = '已经退回上一回合。';
    game.detail = '双方计时也恢复到悔棋前的状态。';
    hintPoint = -1;
    thinking = false;
    clearThinking();
    lastClockTick = performance.now();
    render();
    if (game.turn === game.aiColor) window.setTimeout(computerTurn, 80);
  });

  elements.hintButton.addEventListener('click', () => {
    if (thinking || game.over || game.turn !== game.playerColor) return;
    const candidates = generateCandidates(game.board, game.playerColor, game.koHash, 1);
    if (!candidates.length) {
      game.message = '当前没有找到合适的合法落点。';
      game.detail = '你可以选择停一手。';
    } else {
      hintPoint = candidates[0].point;
      game.message = `提示落点：${coordinate(hintPoint)}。`;
      game.detail = '红色圆圈只是提示，不会自动替你落子；你的计时仍在继续。';
    }
    render();
  });

  elements.newButton.addEventListener('click', startNewGame);
  elements.difficulty.addEventListener('change', () => {
    const level = LEVELS[elements.difficulty.value];
    game.message = `已选择${level.label}难度。`;
    game.detail = elements.difficulty.value === 'crush' ? `碾压模式动态分配搜索，单回合最高 ${MAX_SEARCH_STEPS} 步。新难度从电脑下一手起生效。` : '新难度从电脑下一手起生效。';
    render();
  });
  elements.playerColor.addEventListener('change', () => {
    game.message = '执子设置已更改。';
    game.detail = '点击“按当前设置开新局”后生效。';
    render();
  });
  elements.timeControl.addEventListener('change', () => {
    game.message = '计时规则已更改。';
    game.detail = '点击“按当前设置开新局”后生效。';
    render();
  });

  window.addEventListener('resize', drawBoard);
  if ('ResizeObserver' in window) new ResizeObserver(drawBoard).observe(elements.canvas.parentElement);
  window.setInterval(() => {
    if (!game.over && game.clockRunning) {
      const timedOut = syncClock();
      if (!timedOut) updateClockDisplay();
    }
  }, 100);

  render();
})();
