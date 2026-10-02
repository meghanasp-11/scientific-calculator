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
    const normalized = input.replace(/[×x]/g, '*').replace(/[÷]/g, '/').replace(/[−]/g, '-');
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
        if (FUNCTIONS.has(word)) raw.push({ type:'function', value:word });
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
