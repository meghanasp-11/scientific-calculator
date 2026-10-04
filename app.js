(() => {
  'use strict';

  const STORAGE_KEY = 'calcula-history-v1';
  const MEMORY_KEY = 'calcula-memory-v1';
  const MAX_HISTORY = 60;

  const state = {
    expression: '',
    answer: null,
    angleMode: 'DEG',
    memory: Number(localStorage.getItem(MEMORY_KEY) || 0),
    history: loadHistory(),
    justEvaluated: false,
  };

  const display = document.getElementById('display');
  const expressionPreview = document.getElementById('expressionPreview');
  const historyList = document.getElementById('historyList');
  const historyCount = document.getElementById('historyCount');
  const angleToggle = document.getElementById('angleToggle');
  const angleIndicator = document.getElementById('angleIndicator');
  const memoryIndicator = document.getElementById('memoryIndicator');
  const statusIndicator = document.getElementById('statusIndicator');
  const toast = document.getElementById('toast');

  function loadHistory() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(raw) ? raw.slice(0, MAX_HISTORY) : [];
    } catch {
      return [];
    }
  }

  function saveHistory() {
    const payload = state.history.slice(0, MAX_HISTORY);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    // When the app is served by server.js, mirror history to the local backend.
    fetch('/api/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ history: payload }),
    }).catch(() => {});
  }

  async function hydrateFromServer() {
    try {
      const response = await fetch('/api/history', { cache: 'no-store' });
      if (!response.ok) return;
      const data = await response.json();
      if (Array.isArray(data.history)) {
        state.history = data.history.slice(0, MAX_HISTORY);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state.history));
        renderHistory();
      }
    } catch {
      // Opening index.html directly still works through localStorage.
    }
  }

  function setMemory(value) {
    state.memory = Number(value) || 0;
    localStorage.setItem(MEMORY_KEY, String(state.memory));
    memoryIndicator.classList.toggle('hidden', Math.abs(state.memory) < Number.EPSILON);
  }

  function formatNumber(value) {
    if (!Number.isFinite(value)) throw new Error('Result is not a finite number.');
    const rounded = Math.abs(value) < 1e-14 ? 0 : value;
    if (Number.isInteger(rounded) && Math.abs(rounded) < 1e15) return String(rounded);
    return rounded.toLocaleString('en-US', {
      maximumFractionDigits: 12,
      useGrouping: false,
    });
  }

  function prettyExpression(value) {
    return value
      .replaceAll('sqrt(', '√(')
      .replaceAll('cbrt(', '∛(')
      .replaceAll('asin(', 'sin⁻¹(')
      .replaceAll('acos(', 'cos⁻¹(')
      .replaceAll('atan(', 'tan⁻¹(')
      .replaceAll('exp(', 'eˣ(')
      .replaceAll('*', '×')
      .replaceAll('/', '÷')
      .replaceAll('-', '−');
  }

  function render() {
    expressionPreview.textContent = state.expression ? prettyExpression(state.expression) : 'Ready when you are';
    display.classList.remove('error');
    display.textContent = state.expression ? state.expression : (state.answer !== null ? formatNumber(state.answer) : '0');
    angleToggle.textContent = state.angleMode;
    angleIndicator.textContent = state.angleMode;
    statusIndicator.textContent = state.justEvaluated ? 'Result locked · tap a key to continue' : 'Scientific mode';
    memoryIndicator.classList.toggle('hidden', Math.abs(state.memory) < Number.EPSILON);
    renderHistory();
  }

  function renderError(message) {
    display.classList.add('error');
    display.textContent = message;
    statusIndicator.textContent = 'Check expression';
  }

  function renderHistory() {
    historyCount.textContent = String(state.history.length);
    if (!state.history.length) {
      historyList.innerHTML = `
        <div class="empty-history">
          <div>
            <div class="empty-orbit" aria-hidden="true">↺</div>
            <p>Every calculation you make will live here.</p>
          </div>
        </div>`;
      return;
    }
    historyList.innerHTML = state.history.map((item, index) => `
      <button class="history-item" type="button" data-history-index="${index}">
        <div class="history-expression">${escapeHtml(prettyExpression(item.expression))}</div>
        <div class="history-result">= ${escapeHtml(item.result)}</div>
        <div class="history-time">${escapeHtml(item.time)}</div>
      </button>`).join('');
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[char]);
  }

  function addHistory(expression, result) {
    state.history.unshift({
      expression,
      result: formatNumber(result),
      time: new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }),
    });
    state.history = state.history.slice(0, MAX_HISTORY);
    saveHistory();
  }

  function insert(value) {
    if (state.justEvaluated) {
      const canContinue = /^[+−×÷^%!)].*/.test(value) || ['^', '%', '!', ')'].includes(value);
      if (canContinue && state.answer !== null) state.expression = String(state.answer);
      else state.expression = '';
      state.justEvaluated = false;
    }
    state.expression += value;
    render();
  }

  function clearAll() {
    state.expression = '';
    state.answer = null;
    state.justEvaluated = false;
    render();
  }

  function backspace() {
    if (state.justEvaluated) {
      state.expression = '';
      state.justEvaluated = false;
      render();
      return;
    }
    if (!state.expression) return;
    const fnTokens = ['asin(', 'acos(', 'atan(', 'sqrt(', 'cbrt(', 'sin(', 'cos(', 'tan(', 'log(', 'ln(', 'exp(', 'abs('];
    const token = fnTokens.find((t) => state.expression.endsWith(t));
    state.expression = token ? state.expression.slice(0, -token.length) : state.expression.slice(0, -1);
    render();
  }

  function toggleSign() {
    if (!state.expression) {
      insert('−');
      return;
    }
    const value = state.expression;
    if (/^−/.test(value)) state.expression = value.slice(1);
    else state.expression = '−(' + value + ')';
    state.justEvaluated = false;
    render();
  }

  function calculate() {
    const raw = state.expression.trim();
    if (!raw) return;
    try {
      const value = evaluateExpression(raw, state.angleMode);
      state.answer = value;
      addHistory(raw, value);
      state.expression = '';
      state.justEvaluated = true;
      display.classList.remove('error');
      render();
      showToast('Calculated and saved to history');
    } catch (error) {
      renderError(error instanceof Error ? error.message : 'Invalid expression');
    }
  }

  function useAnswer() {
    if (state.answer === null) return;
    state.expression = String(state.answer);
    state.justEvaluated = false;
    render();
  }

  function handleMemory(action) {
    let current = state.answer;
    if (current === null && state.expression) {
      try { current = evaluateExpression(state.expression, state.angleMode); } catch { current = null; }
    }
    if (action === 'clear') { setMemory(0); showToast('Memory cleared'); return; }
    if (action === 'recall') { insert(formatNumber(state.memory)); showToast('Memory recalled'); return; }
    if (current === null) { showToast('Nothing to store in memory'); return; }
    if (action === 'add') setMemory(state.memory + current);
    if (action === 'subtract') setMemory(state.memory - current);
    showToast(action === 'add' ? 'Added to memory' : 'Subtracted from memory');
    render();
  }

  async function copyResult() {
    let value = state.answer;
    if (value === null && state.expression) {
      try { value = evaluateExpression(state.expression, state.angleMode); } catch { value = null; }
    }
    if (value === null) return showToast('There is no result to copy');

    const text = formatNumber(value);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const helper = document.createElement('textarea');
        helper.value = text;
        helper.setAttribute('readonly', '');
        helper.style.position = 'fixed';
        helper.style.opacity = '0';
        document.body.appendChild(helper);
        helper.select();
        const copied = document.execCommand('copy');
        helper.remove();
        if (!copied) throw new Error('Clipboard copy failed');
      }
      showToast('Result copied');
    } catch {
      showToast('Clipboard permission was blocked');
    }
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => toast.classList.remove('show'), 1600);
  }

  // ---------- Expression parser ----------

  function evaluateExpression(input, angleMode) {
    const tokens = tokenize(input);
    const rpn = toRpn(tokens);
    return evaluateRpn(rpn, angleMode);
  }

  const FUNCTIONS = new Set(['sin','cos','tan','asin','acos','atan','log','ln','sqrt','cbrt','exp','abs']);
  const CONSTANTS = { 'π': Math.PI, 'pi': Math.PI, 'e': Math.E };
  const OP_INFO = {
    '+': { p: 1, assoc: 'L', arity: 2 },
    '-': { p: 1, assoc: 'L', arity: 2 },
    '*': { p: 2, assoc: 'L', arity: 2 },
    '/': { p: 2, assoc: 'L', arity: 2 },
    'mod': { p: 2, assoc: 'L', arity: 2 },
    '^': { p: 4, assoc: 'R', arity: 2 },
    'u-': { p: 3, assoc: 'R', arity: 1 },
    '%': { p: 5, assoc: 'L', arity: 1 },
    '!': { p: 5, assoc: 'L', arity: 1 },
  };

  function tokenize(input) {
    const normalized = input.replace(/[×]/g, '*').replace(/[÷]/g, '/').replace(/[−]/g, '-');
    const raw = [];
    let i = 0;

    while (i < normalized.length) {
      const ch = normalized[i];
      if (/\s/.test(ch)) { i++; continue; }
      if (/\d|\./.test(ch)) {
        const start = i;
        let dotSeen = false;
        if (ch === '.') dotSeen = true;
        i++;
        while (i < normalized.length) {
          const c = normalized[i];
          if (/\d/.test(c)) { i++; continue; }
          if (c === '.' && !dotSeen) { dotSeen = true; i++; continue; }
          break;
        }
        const value = Number(normalized.slice(start, i));
        if (Number.isNaN(value)) throw new Error('Invalid number');
        raw.push({ type: 'number', value });
        continue;
      }
      if (/\p{L}/u.test(ch) || ch === 'π') {
        const start = i;
        if (ch === 'π') { i++; raw.push({ type:'constant', value:'π' }); continue; }
        i++;
        while (i < normalized.length && /[A-Za-z]/.test(normalized[i])) i++;
        const word = normalized.slice(start, i).toLowerCase();
        if (word === 'x') raw.push({ type:'operator', value:'*' });
        else if (FUNCTIONS.has(word)) raw.push({ type:'function', value:word });
        else if (word === 'mod') raw.push({ type:'operator', value:'mod' });
        else if (Object.prototype.hasOwnProperty.call(CONSTANTS, word)) raw.push({ type:'constant', value:word });
        else throw new Error(`Unknown token: ${word}`);
        continue;
      }
      if ('()+-*/^%!'.includes(ch)) {
        if (ch === '(' || ch === ')') raw.push({ type: ch === '(' ? 'leftParen' : 'rightParen', value:ch });
        else raw.push({ type:'operator', value:ch });
        i++;
        continue;
      }
      throw new Error(`Unsupported symbol: ${ch}`);
    }

    const out = [];
    for (let j = 0; j < raw.length; j++) {
      const token = raw[j];
      const prev = out[out.length - 1];
      if (needsImplicitMultiply(prev, token)) out.push({ type:'operator', value:'*' });
      out.push(token);
    }

    // Convert leading/binary minus into unary minus.
    for (let j = 0; j < out.length; j++) {
      if (out[j].type === 'operator' && out[j].value === '-') {
        const prev = out[j - 1];
        if (!prev || prev.type === 'operator' || prev.type === 'leftParen') out[j].value = 'u-';
      }
    }
    return out;
  }

  function needsImplicitMultiply(prev, next) {
    if (!prev) return false;
    const prevCanEnd = prev.type === 'number' || prev.type === 'constant' || prev.type === 'rightParen' || (prev.type === 'operator' && (prev.value === '!' || prev.value === '%'));
    const nextCanStart = next.type === 'number' || next.type === 'constant' || next.type === 'function' || next.type === 'leftParen';
    if (!prevCanEnd || !nextCanStart) return false;
    // function calls like sin( should not become sin*(
    if (prev.type === 'function') return false;
    return true;
  }

  function toRpn(tokens) {
    const output = [];
    const stack = [];
    let expectingValue = true;

    for (const token of tokens) {
      if (token.type === 'number' || token.type === 'constant') {
        output.push(token);
        expectingValue = false;
        continue;
      }

      if (token.type === 'function') {
        stack.push(token);
        expectingValue = true;
        continue;
      }

      if (token.type === 'leftParen') {
        stack.push(token);
        expectingValue = true;
        continue;
      }

      if (token.type === 'rightParen') {
        let found = false;
        while (stack.length) {
          const top = stack.pop();
          if (top.type === 'leftParen') { found = true; break; }
          output.push(top);
        }
        if (!found) throw new Error('Mismatched parentheses');
        if (stack[stack.length - 1]?.type === 'function') output.push(stack.pop());
        expectingValue = false;
        continue;
      }

      if (token.type === 'operator') {
        if (['!', '%'].includes(token.value) && expectingValue) throw new Error(`Unexpected ${token.value}`);
        const current = OP_INFO[token.value];
        while (stack.length) {
          const top = stack[stack.length - 1];
          if (top.type !== 'operator') break;
          const topInfo = OP_INFO[top.value];
          const shouldPop = current.assoc === 'L' ? current.p <= topInfo.p : current.p < topInfo.p;
          if (!shouldPop) break;
          output.push(stack.pop());
        }
        stack.push(token);
        expectingValue = !['!', '%'].includes(token.value);
        continue;
      }
    }

    while (stack.length) {
      const top = stack.pop();
      if (top.type === 'leftParen' || top.type === 'rightParen') throw new Error('Mismatched parentheses');
      output.push(top);
    }
    if (expectingValue && output.length) throw new Error('Expression is incomplete');
    return output;
  }

  function evaluateRpn(rpn, angleMode) {
    const stack = [];
    const toRad = (x) => angleMode === 'DEG' ? x * Math.PI / 180 : x;
    const fromRad = (x) => angleMode === 'DEG' ? x * 180 / Math.PI : x;

    for (const token of rpn) {
      if (token.type === 'number') stack.push(token.value);
      else if (token.type === 'constant') stack.push(CONSTANTS[token.value]);
      else if (token.type === 'operator') {
        const op = token.value;
        if (op === 'u-') {
          const a = pop(stack, op); stack.push(-a); continue;
        }
        if (op === '%') {
          const a = pop(stack, op); stack.push(a / 100); continue;
        }
        if (op === '!') {
          const a = pop(stack, op); stack.push(factorial(a)); continue;
        }
        const b = pop(stack, op), a = pop(stack, op);
        if (op === '+') stack.push(a + b);
        else if (op === '-') stack.push(a - b);
        else if (op === '*') stack.push(a * b);
        else if (op === '/') { if (b === 0) throw new Error('Cannot divide by zero'); stack.push(a / b); }
        else if (op === 'mod') { if (b === 0) throw new Error('Cannot mod by zero'); stack.push(a % b); }
        else if (op === '^') stack.push(Math.pow(a, b));
      } else if (token.type === 'function') {
        const a = pop(stack, token.value);
        let result;
        switch (token.value) {
          case 'sin': result = Math.sin(toRad(a)); break;
          case 'cos': result = Math.cos(toRad(a)); break;
          case 'tan': result = Math.tan(toRad(a)); break;
          case 'asin': if (a < -1 || a > 1) throw new Error('asin input must be between −1 and 1'); result = fromRad(Math.asin(a)); break;
          case 'acos': if (a < -1 || a > 1) throw new Error('acos input must be between −1 and 1'); result = fromRad(Math.acos(a)); break;
          case 'atan': result = fromRad(Math.atan(a)); break;
          case 'log': if (a <= 0) throw new Error('log input must be positive'); result = Math.log10(a); break;
          case 'ln': if (a <= 0) throw new Error('ln input must be positive'); result = Math.log(a); break;
          case 'sqrt': if (a < 0) throw new Error('sqrt input must be non-negative'); result = Math.sqrt(a); break;
          case 'cbrt': result = Math.cbrt(a); break;
          case 'exp': result = Math.exp(a); break;
          case 'abs': result = Math.abs(a); break;
          default: throw new Error(`Unknown function: ${token.value}`);
        }
        stack.push(result);
      }
      if (stack.length && !Number.isFinite(stack[stack.length - 1])) throw new Error('Result is not finite');
    }
    if (stack.length !== 1) throw new Error('Expression is invalid');
    return stack[0];
  }

  function pop(stack, label) {
    if (!stack.length) throw new Error(`Missing value for ${label}`);
    return stack.pop();
  }

  function factorial(n) {
    if (n < 0 || !Number.isInteger(n)) throw new Error('Factorial needs a non-negative integer');
    if (n > 170) throw new Error('Factorial is too large');
    let result = 1;
    for (let i = 2; i <= n; i++) result *= i;
    return result;
  }

  function runAction(action) {
    switch (action) {
      case 'equals':
      case 'evaluate': calculate(); break;
      case 'clear': clearAll(); break;
      case 'backspace': backspace(); break;
      case 'sign': toggleSign(); break;
      case 'ans': useAnswer(); break;
      case 'copy': copyResult(); break;
      case 'memory-clear': handleMemory('clear'); break;
      case 'memory-recall': handleMemory('recall'); break;
      case 'memory-add': handleMemory('add'); break;
      case 'memory-subtract': handleMemory('subtract'); break;
    }
  }

  function handleButtonClick(event) {
    const button = event.target.closest('button');
    if (!button) return;
    const value = button.dataset.value;
    const action = button.dataset.action;
    if (value !== undefined) insert(value);
    if (action) runAction(action);
  }

  document.getElementById('keypad').addEventListener('click', handleButtonClick);
  document.getElementById('utilityRow').addEventListener('click', handleButtonClick);

  document.getElementById('clearHistory').addEventListener('click', () => {
    state.history = [];
    saveHistory();
    fetch('/api/history', { method: 'DELETE' }).catch(() => {});
    render();
    showToast('History cleared');
  });

  historyList.addEventListener('click', (event) => {
    const target = event.target.closest('[data-history-index]');
    if (!target) return;
    const item = state.history[Number(target.dataset.historyIndex)];
    if (!item) return;
    state.expression = item.expression;
    state.answer = Number(item.result);
    state.justEvaluated = false;
    render();
    showToast('Loaded from history');
  });

  angleToggle.addEventListener('click', () => {
    state.angleMode = state.angleMode === 'DEG' ? 'RAD' : 'DEG';
    render();
    showToast(`Angle mode: ${state.angleMode}`);
  });

  document.addEventListener('keydown', (event) => {
    const target = event.target;
    // Isolation: never feed Calculator when typing in a text field (Graph f(x) input).
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    // Isolation: in Graph mode physical keys belong to Graph; Calculator keeps its state untouched.
    if (typeof window.__calculaMode !== 'undefined' && window.__calculaMode === 'graph') return;
    const key = event.key;
    if (/\d/.test(key) || key === '.') insert(key);
    else if (key === '+') insert('+');
    else if (key === '-') insert('−');
    else if (key === '*') insert('×');
    else if (key === '/') { event.preventDefault(); insert('÷'); }
    else if (key === '^') insert('^');
    else if (key === '(' || key === ')') insert(key);
    else if (key === '%') insert('%');
    else if (key === '!') insert('!');
    else if (key === 'Enter' || key === '=') { event.preventDefault(); calculate(); }
    else if (key === 'Backspace') backspace();
    else if (key === 'Escape') clearAll();
  });

  render();
  hydrateFromServer();
})();

// ---------- Graph Mode (isolated from Calculator Mode) ----------
// Uses its own expression parser/evaluator and view state. It never touches
// the Calculator's evaluateExpression(), tokenizer, memory, history, display
// or DEG/RAD state. Calculator DOM is only hidden/shown, never destroyed.
(() => {
  'use strict';

  const WINE = '#AA1945';
  const BUTTER = '#F5E8AA';
  const DEFAULT_VIEW = { xmin: -10, xmax: 10, ymin: -10, ymax: 10 };
  const SAMPLES = 800;

  const view = { xmin: DEFAULT_VIEW.xmin, xmax: DEFAULT_VIEW.xmax, ymin: DEFAULT_VIEW.ymin, ymax: DEFAULT_VIEW.ymax };
  const MAX_FUNCTIONS = 8;
  const GRAPH_COLORS = ['#AA1945', '#1F6F5B', '#2B4C9B', '#8A5A00', '#6B2D91', '#0E6E8C', '#4A6B0F', '#333333'];
  const SUBSCRIPTS = ['₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈'];
  let graphRows = [];
  let graphCompiled = [];
  let graphUid = 0;
  let totalPlotted = 0;
  let lastError = '';

  const $ = (id) => document.getElementById(id);
  const modeCalculatorBtn = $('modeCalculator');
  const modeGraphBtn = $('modeGraph');
  const calculatorPanel = $('calculatorPanel');
  const graphPanel = $('graphPanel');
  const graphFunctionList = $('graphFunctionList');
  const graphAddBtn = $('graphAdd');
  const graphLegend = $('graphLegend');
  const graphPlotBtn = $('graphPlot');
  const graphClearBtn = $('graphClear');
  const graphResetBtn = $('graphReset');
  const graphZoomInBtn = $('graphZoomIn');
  const graphZoomOutBtn = $('graphZoomOut');
  const graphPanLeftBtn = $('graphPanLeft');
  const graphPanRightBtn = $('graphPanRight');
  const graphPanUpBtn = $('graphPanUp');
  const graphPanDownBtn = $('graphPanDown');
  const graphError = $('graphError');
  const graphInfo = $('graphInfo');
  const graphCoords = $('graphCoords');
  const graphCanvas = $('graphCanvas');

  // If Graph DOM is absent (older cached page), do nothing and keep Calculator working.
  if (!modeCalculatorBtn || !modeGraphBtn || !calculatorPanel || !graphPanel || !graphFunctionList || !graphCanvas) {
    window.__calculaMode = window.__calculaMode || 'calculator';
    return;
  }

  window.__calculaMode = window.__calculaMode || 'calculator';

  function setMode(mode) {
    const isGraph = mode === 'graph';
    window.__calculaMode = isGraph ? 'graph' : 'calculator';
    calculatorPanel.hidden = isGraph;
    graphPanel.hidden = !isGraph;
    modeCalculatorBtn.classList.toggle('is-active', !isGraph);
    modeGraphBtn.classList.toggle('is-active', isGraph);
    modeCalculatorBtn.setAttribute('aria-selected', String(!isGraph));
    modeGraphBtn.setAttribute('aria-selected', String(isGraph));
    if (isGraph) {
      requestAnimationFrame(() => { resizeCanvas(); draw(); });
    }
  }

  // ----- Function rows (Phase 2B: multiple functions) -----
  function fnLabel(index) {
    return 'f' + (SUBSCRIPTS[index] || ('_' + (index + 1))) + '(x)';
  }

  function rowColor(index) {
    return GRAPH_COLORS[index % GRAPH_COLORS.length];
  }

  function renumberRows() {
    graphRows.forEach((row, index) => {
      const label = fnLabel(index);
      row.label = label;
      row.color = rowColor(index);
      row.labelEl.textContent = label + ' =';
      row.labelEl.setAttribute('for', 'graphInput' + index);
      row.inputEl.id = 'graphInput' + index;
      row.inputEl.setAttribute('aria-label', label);
      row.toggleBtn.textContent = row.visible ? 'Hide' : 'Show';
      row.toggleBtn.setAttribute('aria-pressed', String(row.visible));
      row.toggleBtn.setAttribute('aria-label', (row.visible ? 'Hide ' : 'Show ') + label);
      row.removeBtn.setAttribute('aria-label', 'Remove ' + label);
      row.colorEl.style.background = row.color;
      const compiled = graphCompiled.find((c) => c.uid === row.uid);
      if (compiled) { compiled.label = label; compiled.color = row.color; }
    });
  }

  function setRowError(row, message) {
    row.error = message || '';
    row.errorEl.textContent = row.error ? row.label + ': ' + row.error : '';
    row.rowEl.classList.toggle('invalid', Boolean(row.error));
  }

  function findRow(uid) {
    return graphRows.find((r) => r.uid === uid);
  }

  function addFunctionRow(expr, visible, focusInput) {
    if (graphRows.length >= MAX_FUNCTIONS) {
      setError('Maximum ' + MAX_FUNCTIONS + ' functions');
      draw();
      return null;
    }
    const uid = ++graphUid;
    const rowEl = document.createElement('div');
    rowEl.className = 'graph-fn-row';
    const colorEl = document.createElement('span');
    colorEl.className = 'graph-fn-color';
    colorEl.setAttribute('aria-hidden', 'true');
    const labelEl = document.createElement('label');
    labelEl.className = 'graph-fx';
    const inputEl = document.createElement('input');
    inputEl.className = 'graph-input';
    inputEl.type = 'text';
    inputEl.setAttribute('autocomplete', 'off');
    inputEl.setAttribute('spellcheck', 'false');
    inputEl.value = expr || '';
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'graph-btn small';
    toggleBtn.type = 'button';
    const removeBtn = document.createElement('button');
    removeBtn.className = 'graph-btn small';
    removeBtn.type = 'button';
    removeBtn.textContent = 'Remove';
    const errorEl = document.createElement('div');
    errorEl.className = 'graph-fn-error';
    errorEl.setAttribute('role', 'status');
    rowEl.appendChild(colorEl);
    rowEl.appendChild(labelEl);
    rowEl.appendChild(inputEl);
    rowEl.appendChild(toggleBtn);
    rowEl.appendChild(removeBtn);
    graphFunctionList.appendChild(rowEl);
    graphFunctionList.appendChild(errorEl);
    const row = {
      uid: uid, rowEl: rowEl, labelEl: labelEl, colorEl: colorEl,
      inputEl: inputEl, toggleBtn: toggleBtn, removeBtn: removeBtn,
      errorEl: errorEl, label: '', color: '', visible: visible !== false, error: '',
    };
    toggleBtn.addEventListener('click', () => toggleRow(uid));
    removeBtn.addEventListener('click', () => removeRow(uid));
    graphRows.push(row);
    renumberRows();
    setError('');
    draw();
    if (focusInput) inputEl.focus();
    return row;
  }

  function toggleRow(uid) {
    const row = findRow(uid);
    if (!row) return;
    row.visible = !row.visible;
    row.toggleBtn.textContent = row.visible ? 'Hide' : 'Show';
    row.toggleBtn.setAttribute('aria-pressed', String(row.visible));
    row.toggleBtn.setAttribute('aria-label', (row.visible ? 'Hide ' : 'Show ') + row.label);
    const compiled = graphCompiled.find((c) => c.uid === uid);
    if (compiled) compiled.visible = row.visible;
    draw();
  }

  function removeRow(uid) {
    const index = graphRows.findIndex((r) => r.uid === uid);
    if (index < 0) return;
    // Never remove the final row: leave a valid empty state instead.
    if (graphRows.length === 1) {
      const only = graphRows[0];
      only.inputEl.value = '';
      only.visible = true;
      setRowError(only, '');
      graphCompiled = [];
      totalPlotted = 0;
      setError('');
      renumberRows();
      draw();
      only.inputEl.focus();
      return;
    }
    const row = graphRows[index];
    row.rowEl.remove();
    row.errorEl.remove();
    graphRows.splice(index, 1);
    graphCompiled = graphCompiled.filter((c) => c.uid !== uid);
    renumberRows();
    draw();
    const focusTarget = graphRows[Math.min(index, graphRows.length - 1)];
    if (focusTarget) focusTarget.inputEl.focus();
  }

  // ----- Isolated graph expression parser (radians for trig) -----
  const GRAPH_FUNCTIONS = new Set(['sin', 'cos', 'tan', 'sqrt', 'log', 'ln', 'abs', 'cbrt', 'exp']);
  const GRAPH_CONSTANTS = { pi: Math.PI, e: Math.E, 'π': Math.PI };
  const GRAPH_OP_INFO = {
    '+': { p: 1, assoc: 'L' },
    '-': { p: 1, assoc: 'L' },
    '*': { p: 2, assoc: 'L' },
    '/': { p: 2, assoc: 'L' },
    '^': { p: 4, assoc: 'R' },
    'u-': { p: 3, assoc: 'R' },
  };

  function graphTokenize(input) {
    const normalized = String(input)
      .replace(/[×]/g, '*')
      .replace(/[÷]/g, '/')
      .replace(/[−]/g, '-');
    const raw = [];
    let i = 0;
    while (i < normalized.length) {
      const ch = normalized[i];
      if (/\s/.test(ch)) { i++; continue; }
      if (/\d|\./.test(ch)) {
        const start = i;
        let dotSeen = ch === '.';
        i++;
        while (i < normalized.length) {
          const c = normalized[i];
          if (/\d/.test(c)) { i++; continue; }
          if (c === '.' && !dotSeen) { dotSeen = true; i++; continue; }
          break;
        }
        const value = Number(normalized.slice(start, i));
        if (Number.isNaN(value)) throw new Error('Invalid number');
        raw.push({ type: 'number', value });
        continue;
      }
      if (ch === '*' && normalized[i + 1] === '*') {
        raw.push({ type: 'operator', value: '^' });
        i += 2;
        continue;
      }
      if (/[A-Za-zπ]/.test(ch)) {
        if (ch === 'π') { i++; raw.push({ type: 'constant', value: 'π' }); continue; }
        const start = i;
        i++;
        while (i < normalized.length && /[A-Za-z]/.test(normalized[i])) i++;
        const word = normalized.slice(start, i).toLowerCase();
        if (word === 'x') { raw.push({ type: 'variable', value: 'x' }); continue; }
        if (GRAPH_FUNCTIONS.has(word)) { raw.push({ type: 'function', value: word }); continue; }
        if (Object.prototype.hasOwnProperty.call(GRAPH_CONSTANTS, word)) { raw.push({ type: 'constant', value: word }); continue; }
        throw new Error('Unknown token: ' + word);
      }
      if (ch === '(') { raw.push({ type: 'leftParen', value: ch }); i++; continue; }
      if (ch === ')') { raw.push({ type: 'rightParen', value: ch }); i++; continue; }
      if ('+-*/^'.includes(ch)) { raw.push({ type: 'operator', value: ch }); i++; continue; }
      throw new Error('Unsupported symbol: ' + ch);
    }

    // Implicit multiplication: 2x, 2(x+1), (x)(x), x sin(x) etc. Never between fn and its '('.
    const out = [];
    for (let j = 0; j < raw.length; j++) {
      const token = raw[j];
      const prev = out[out.length - 1];
      if (prev && graphNeedsImplicitMultiply(prev, token)) out.push({ type: 'operator', value: '*' });
      out.push(token);
    }
    for (let j = 0; j < out.length; j++) {
      if (out[j].type === 'operator' && out[j].value === '-') {
        const prev = out[j - 1];
        if (!prev || prev.type === 'operator' || prev.type === 'leftParen') out[j].value = 'u-';
      }
    }
    return out;
  }

  function graphNeedsImplicitMultiply(prev, next) {
    const prevCanEnd = prev.type === 'number' || prev.type === 'variable' || prev.type === 'constant' || prev.type === 'rightParen';
    const nextCanStart = next.type === 'number' || next.type === 'variable' || next.type === 'constant' || next.type === 'function' || next.type === 'leftParen';
    if (!prevCanEnd || !nextCanStart) return false;
    if (prev.type === 'function') return false;
    return true;
  }

  function graphToRpn(tokens) {
    const output = [];
    const stack = [];
    let expectingValue = true;
    for (const token of tokens) {
      if (token.type === 'number' || token.type === 'constant' || token.type === 'variable') {
        output.push(token);
        expectingValue = false;
        continue;
      }
      if (token.type === 'function') { stack.push(token); expectingValue = true; continue; }
      if (token.type === 'leftParen') { stack.push(token); expectingValue = true; continue; }
      if (token.type === 'rightParen') {
        let found = false;
        while (stack.length) {
          const top = stack.pop();
          if (top.type === 'leftParen') { found = true; break; }
          output.push(top);
        }
        if (!found) throw new Error('Mismatched parentheses');
        if (stack.length && stack[stack.length - 1].type === 'function') output.push(stack.pop());
        expectingValue = false;
        continue;
      }
      if (token.type === 'operator') {
        const current = GRAPH_OP_INFO[token.value];
        if (!current) throw new Error('Unknown operator');
        if (token.value !== 'u-' && expectingValue) throw new Error('Expression is incomplete');
        while (stack.length) {
          const top = stack[stack.length - 1];
          if (top.type !== 'operator') break;
          const topInfo = GRAPH_OP_INFO[top.value];
          const shouldPop = current.assoc === 'L' ? current.p <= topInfo.p : current.p < topInfo.p;
          if (!shouldPop) break;
          output.push(stack.pop());
        }
        stack.push(token);
        expectingValue = token.value !== 'u-' ? true : true;
        continue;
      }
    }
    while (stack.length) {
      const top = stack.pop();
      if (top.type === 'leftParen' || top.type === 'rightParen') throw new Error('Mismatched parentheses');
      output.push(top);
    }
    if (expectingValue && output.length) throw new Error('Expression is incomplete');
    if (!output.length) throw new Error('Empty expression');
    return output;
  }

  function graphEvalRpn(rpn, x) {
    const stack = [];
    for (const token of rpn) {
      if (token.type === 'number') stack.push(token.value);
      else if (token.type === 'variable') stack.push(x);
      else if (token.type === 'constant') stack.push(GRAPH_CONSTANTS[token.value]);
      else if (token.type === 'operator') {
        const op = token.value;
        if (op === 'u-') {
          if (!stack.length) throw new Error('Missing value');
          stack.push(-stack.pop());
          continue;
        }
        if (stack.length < 2) throw new Error('Expression is incomplete');
        const b = stack.pop();
        const a = stack.pop();
        if (op === '+') stack.push(a + b);
        else if (op === '-') stack.push(a - b);
        else if (op === '*') stack.push(a * b);
        else if (op === '/') stack.push(b === 0 ? NaN : a / b);
        else if (op === '^') stack.push(Math.pow(a, b));
      } else if (token.type === 'function') {
        if (!stack.length) throw new Error('Missing value');
        const a = stack.pop();
        switch (token.value) {
          case 'sin': stack.push(Math.sin(a)); break;
          case 'cos': stack.push(Math.cos(a)); break;
          case 'tan': stack.push(Math.tan(a)); break;
          case 'sqrt': stack.push(a < 0 ? NaN : Math.sqrt(a)); break;
          case 'cbrt': stack.push(Math.cbrt(a)); break;
          case 'exp': stack.push(Math.exp(a)); break;
          case 'abs': stack.push(Math.abs(a)); break;
          case 'log': stack.push(a <= 0 ? NaN : Math.log10(a)); break;
          case 'ln': stack.push(a <= 0 ? NaN : Math.log(a)); break;
          default: throw new Error('Unknown function');
        }
      }
    }
    if (stack.length !== 1) throw new Error('Expression is invalid');
    return stack[0];
  }

  function graphCompile(expr) {
    const trimmed = String(expr || '').trim();
    if (!trimmed) throw new Error('Empty expression');
    return graphToRpn(graphTokenize(trimmed));
  }

  // ----- Rendering -----
  function resizeCanvas() {
    const rect = graphCanvas.getBoundingClientRect();
    const cssW = Math.max(50, Math.floor(rect.width));
    const cssH = Math.max(200, Math.floor(rect.height || 340));
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = Math.floor(cssW * dpr);
    const h = Math.floor(cssH * dpr);
    if (graphCanvas.width !== w || graphCanvas.height !== h) {
      graphCanvas.width = w;
      graphCanvas.height = h;
    }
  }

  function niceStep(range, targetCount) {
    const raw = range / Math.max(1, targetCount);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    let step;
    if (norm < 1.5) step = 1;
    else if (norm < 3.5) step = 2;
    else if (norm < 7.5) step = 5;
    else step = 10;
    return step * mag;
  }

  function draw() {
    resizeCanvas();
    const ctx = graphCanvas.getContext('2d');
    const W = graphCanvas.width;
    const H = graphCanvas.height;
    const xRange = view.xmax - view.xmin;
    const yRange = view.ymax - view.ymin;
    const toPx = (x) => ((x - view.xmin) / xRange) * W;
    const toPy = (y) => H - ((y - view.ymin) / yRange) * H;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = BUTTER;
    ctx.fillRect(0, 0, W, H);

    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const xStep = niceStep(xRange, 12);
    const yStep = niceStep(yRange, 10);

    ctx.lineWidth = 1 * dpr;
    ctx.strokeStyle = 'rgba(170, 25, 69, 0.16)';
    ctx.beginPath();
    for (let gx = Math.ceil(view.xmin / xStep) * xStep; gx <= view.xmax; gx += xStep) {
      if (Math.abs(gx) < xStep * 1e-9) continue;
      ctx.moveTo(toPx(gx), 0);
      ctx.lineTo(toPx(gx), H);
    }
    for (let gy = Math.ceil(view.ymin / yStep) * yStep; gy <= view.ymax; gy += yStep) {
      if (Math.abs(gy) < yStep * 1e-9) continue;
      ctx.moveTo(0, toPy(gy));
      ctx.lineTo(W, toPy(gy));
    }
    ctx.stroke();

    // Axes
    ctx.lineWidth = 2 * dpr;
    ctx.strokeStyle = WINE;
    ctx.beginPath();
    if (view.xmin <= 0 && view.xmax >= 0) { ctx.moveTo(toPx(0), 0); ctx.lineTo(toPx(0), H); }
    if (view.ymin <= 0 && view.ymax >= 0) { ctx.moveTo(0, toPy(0)); ctx.lineTo(W, toPy(0)); }
    ctx.stroke();

    // Ticks + labels
    ctx.fillStyle = WINE;
    ctx.font = `${11 * dpr}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const fmt = (v) => {
      const a = Math.abs(v);
      if (a !== 0 && (a >= 1000 || a < 0.01)) return v.toExponential(0);
      return String(Math.round(v * 100) / 100);
    };
    for (let gx = Math.ceil(view.xmin / xStep) * xStep; gx <= view.xmax; gx += xStep) {
      if (Math.abs(gx) < xStep * 1e-9) continue;
      ctx.fillText(fmt(gx), toPx(gx) + 3 * dpr, toPy(0) + 4 * dpr);
    }
    for (let gy = Math.ceil(view.ymin / yStep) * yStep; gy <= view.ymax; gy += yStep) {
      if (Math.abs(gy) < yStep * 1e-9) continue;
      ctx.fillText(fmt(gy), toPx(0) + 4 * dpr, toPy(gy) + 3 * dpr);
    }
    if (view.xmin <= 0 && view.xmax >= 0 && view.ymin <= 0 && view.ymax >= 0) {
      ctx.fillText('O', toPx(0) + 4 * dpr, toPy(0) + 4 * dpr);
    }

    // Curves (one per visible compiled function, each in its own color)
    totalPlotted = 0;
    for (const entry of graphCompiled) {
      entry.points = 0;
      if (!entry.visible) continue;
      ctx.lineWidth = 3 * dpr;
      ctx.strokeStyle = entry.color;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      let penDown = false;
      let prevPy = 0;
      for (let s = 0; s < SAMPLES; s++) {
        const x = view.xmin + (xRange * s) / (SAMPLES - 1);
        let y;
        try {
          y = graphEvalRpn(entry.rpn, x);
        } catch {
          penDown = false;
          continue;
        }
        if (typeof y !== 'number' || !Number.isFinite(y)) { penDown = false; continue; }
        const py = toPy(y);
        const px = toPx(x);
        if (py < -H * 2 || py > H * 3) { penDown = false; continue; }
        if (penDown && Math.abs(py - prevPy) > H * 1.2) { penDown = false; }
        if (!penDown) { ctx.moveTo(px, py); penDown = true; }
        else { ctx.lineTo(px, py); }
        prevPy = py;
        entry.points++;
      }
      ctx.stroke();
      totalPlotted += entry.points;
    }

    if (graphLegend) {
      graphLegend.textContent = '';
      for (const entry of graphCompiled) {
        if (!entry.visible) continue;
        const item = document.createElement('span');
        item.className = 'graph-legend-item';
        const dot = document.createElement('span');
        dot.className = 'graph-legend-dot';
        dot.style.background = entry.color;
        dot.setAttribute('aria-hidden', 'true');
        item.appendChild(dot);
        item.appendChild(document.createTextNode(entry.label + ' = ' + entry.expr));
        graphLegend.appendChild(item);
      }
    }

    if (graphInfo) {
      const r2 = (v) => Math.round(v * 100) / 100;
      const count = graphCompiled.filter((c) => c.visible).length;
      graphInfo.textContent = `x ∈ [${r2(view.xmin)}, ${r2(view.xmax)}] · y ∈ [${r2(view.ymin)}, ${r2(view.ymax)}] · ${count} plotted`;
    }
    window.__graphTest = window.__graphTest || {};
    window.__graphTest.plottedPoints = totalPlotted;
    window.__graphTest.view = { xmin: view.xmin, xmax: view.xmax, ymin: view.ymin, ymax: view.ymax };
    const firstCompiled = graphCompiled.find((c) => c.visible) || null;
    window.__graphTest.expr = firstCompiled ? firstCompiled.expr : '';
    const firstRowError = graphRows.find((r) => r.error);
    window.__graphTest.error = lastError || (firstRowError ? firstRowError.label + ': ' + firstRowError.error : '');
    window.__graphTest.mode = window.__calculaMode;
    window.__graphTest.functions = graphRows.map((r) => {
      const compiled = graphCompiled.find((c) => c.uid === r.uid) || null;
      return {
        label: r.label,
        expr: r.inputEl.value,
        visible: r.visible,
        points: compiled && r.visible ? compiled.points : 0,
        error: r.error,
        color: r.color,
      };
    });
  }

  function setError(message) {
    lastError = message || '';
    if (graphError) graphError.textContent = lastError;
  }

  function plot() {
    setError('');
    graphCompiled = [];
    let anyExpression = false;
    for (const row of graphRows) {
      setRowError(row, '');
      const expr = row.inputEl.value.trim();
      if (!expr) continue;
      anyExpression = true;
      if (!row.visible) continue;
      try {
        const rpn = graphCompile(expr);
        graphCompiled.push({
          uid: row.uid, label: row.label, expr: expr,
          rpn: rpn, color: row.color, visible: true, points: 0,
        });
      } catch {
        setRowError(row, 'Unable to plot function');
      }
    }
    if (!anyExpression) {
      draw();
      setError('Enter a function, e.g. x²');
      return;
    }
    draw();
    // Drop entries with nothing drawable and mark their rows, without
    // disturbing valid curves.
    let changed = false;
    for (const entry of graphCompiled) {
      if (entry.points === 0) {
        const row = findRow(entry.uid);
        if (row) setRowError(row, 'Unable to plot function');
        changed = true;
      }
    }
    if (changed) {
      graphCompiled = graphCompiled.filter((c) => c.points > 0);
      draw();
    }
  }

  function clearGraph() {
    for (const row of graphRows) {
      row.inputEl.value = '';
      setRowError(row, '');
    }
    graphCompiled = [];
    totalPlotted = 0;
    setError('');
    draw();
    if (graphRows[0]) graphRows[0].inputEl.focus();
  }

  function resetView() {
    view.xmin = DEFAULT_VIEW.xmin;
    view.xmax = DEFAULT_VIEW.xmax;
    view.ymin = DEFAULT_VIEW.ymin;
    view.ymax = DEFAULT_VIEW.ymax;
    setError('');
    draw();
  }

  function zoom(factor) {
    const cx = (view.xmin + view.xmax) / 2;
    const cy = (view.ymin + view.ymax) / 2;
    const hw = ((view.xmax - view.xmin) / 2) * factor;
    const hh = ((view.ymax - view.ymin) / 2) * factor;
    if (!Number.isFinite(hw) || !Number.isFinite(hh) || hw <= 1e-9 || hh <= 1e-9) return;
    if (hw > 1e9 || hh > 1e9) return;
    view.xmin = cx - hw;
    view.xmax = cx + hw;
    view.ymin = cy - hh;
    view.ymax = cy + hh;
    draw();
  }

  function pan(fracX, fracY) {
    const w = view.xmax - view.xmin;
    const h = view.ymax - view.ymin;
    view.xmin += w * fracX;
    view.xmax += w * fracX;
    view.ymin += h * fracY;
    view.ymax += h * fracY;
    draw();
  }

  // ----- Coordinate inspection (read-only: never redraws, never recompiles) -----
  let lastCoords = null;

  function fmtCoord(value, range) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
    const abs = Math.abs(value);
    if (abs !== 0 && (abs >= 10000 || abs < 0.0001)) return String(Number(value.toPrecision(4)));
    let decimals = 2;
    if (range < 0.1) decimals = 4;
    else if (range < 1) decimals = 3;
    const text = value.toFixed(decimals);
    return text.startsWith('-') && Number(text) === 0 ? text.slice(1) : text;
  }

  function renderCoords() {
    if (graphCoords) {
      graphCoords.textContent = lastCoords
        ? 'x = ' + fmtCoord(lastCoords.x, view.xmax - view.xmin) + ' · y = ' + fmtCoord(lastCoords.y, view.ymax - view.ymin)
        : 'x = — · y = —';
    }
    if (window.__graphTest) window.__graphTest.coords = lastCoords ? { x: lastCoords.x, y: lastCoords.y } : null;
  }

  function updateCoordsFromEvent(event) {
    const rect = graphCanvas.getBoundingClientRect();
    if (!rect.width || !rect.height) { lastCoords = null; renderCoords(); return; }
    const fx = (event.clientX - rect.left) / rect.width;
    const fy = (event.clientY - rect.top) / rect.height;
    lastCoords = {
      x: view.xmin + fx * (view.xmax - view.xmin),
      y: view.ymin + (1 - fy) * (view.ymax - view.ymin),
    };
    renderCoords();
  }

  function clearCoords() {
    lastCoords = null;
    renderCoords();
  }

  modeCalculatorBtn.addEventListener('click', () => setMode('calculator'));
  modeGraphBtn.addEventListener('click', () => setMode('graph'));
  graphAddBtn.addEventListener('click', () => { addFunctionRow('', true, true); });
  graphPlotBtn.addEventListener('click', plot);
  graphClearBtn.addEventListener('click', clearGraph);
  graphResetBtn.addEventListener('click', resetView);
  graphZoomInBtn.addEventListener('click', () => zoom(0.7));
  graphZoomOutBtn.addEventListener('click', () => zoom(1.4));
  graphPanLeftBtn.addEventListener('click', () => pan(-0.2, 0));
  graphPanRightBtn.addEventListener('click', () => pan(0.2, 0));
  graphPanUpBtn.addEventListener('click', () => pan(0, 0.2));
  graphPanDownBtn.addEventListener('click', () => pan(0, -0.2));

  graphFunctionList.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'Enter' && event.target && event.target.classList.contains('graph-input')) {
      event.preventDefault();
      plot();
    }
  });

  graphCanvas.addEventListener('keydown', (event) => {
    if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(0.7); }
    else if (event.key === '-' || event.key === '_') { event.preventDefault(); zoom(1.4); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); pan(-0.2, 0); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); pan(0.2, 0); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); pan(0, 0.2); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); pan(0, -0.2); }
  });

  let dragState = null;
  graphCanvas.addEventListener('pointerdown', (event) => {
    graphCanvas.setPointerCapture(event.pointerId);
    dragState = { x: event.clientX, y: event.clientY, view: { ...view } };
  });
  graphCanvas.addEventListener('pointermove', (event) => {
    updateCoordsFromEvent(event);
    if (!dragState) return;
    const rect = graphCanvas.getBoundingClientRect();
    const dx = (event.clientX - dragState.x) / Math.max(1, rect.width);
    const dy = (event.clientY - dragState.y) / Math.max(1, rect.height);
    const w = dragState.view.xmax - dragState.view.xmin;
    const h = dragState.view.ymax - dragState.view.ymin;
    view.xmin = dragState.view.xmin - dx * w;
    view.xmax = dragState.view.xmax - dx * w;
    view.ymin = dragState.view.ymin + dy * h;
    view.ymax = dragState.view.ymax + dy * h;
    draw();
  });
  const endDrag = () => { dragState = null; };
  graphCanvas.addEventListener('pointerup', endDrag);
  graphCanvas.addEventListener('pointercancel', endDrag);
  graphCanvas.addEventListener('pointerleave', () => { clearCoords(); });

  graphCanvas.addEventListener('wheel', (event) => {
    // Require Ctrl/Cmd: an ordinary wheel scroll over the canvas must scroll
    // the page, not silently zoom the view (deep accidental zooms can push
    // the plotted curve almost entirely out of frame).
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    zoom(event.deltaY > 0 ? 1.15 : 0.87);
  }, { passive: false });

  window.addEventListener('resize', () => {
    if (window.__calculaMode === 'graph') { resizeCanvas(); draw(); }
  });

  window.__graphTest = {
    mode: window.__calculaMode,
    plottedPoints: totalPlotted,
    error: lastError,
    view: { xmin: view.xmin, xmax: view.xmax, ymin: view.ymin, ymax: view.ymax },
    expr: '',
    functions: [],
  };

  addFunctionRow('x^2', true, false);
  setMode('calculator');
})();
