// calculator.js — логика калькулятора (без eval)

/**
 * @typedef {{type: 'percent', value: number, fraction: number}} PercentMarker
 * @typedef {{type: string, value?: any}} Token
 */

// ---------- Элементы UI ----------
const exprEl = document.getElementById('expr');
const resultEl = document.getElementById('result');
const keys = document.querySelector('.keys');
const copyBtn = document.getElementById('copyResult');
const historyPanel = document.getElementById('historyPanel');
const historyListEl = document.getElementById('historyList');
const historyToggleBtn = document.getElementById('historyToggle');
const historyClearBtn = document.getElementById('historyClear');
const themeToggleBtn = document.getElementById('themeToggle');
const themeToggleLabel = themeToggleBtn ? themeToggleBtn.querySelector('.toggle-label') : null;
const copyBtnDefaultText = copyBtn ? ((copyBtn.textContent || '').trim() || 'Копировать') : 'Копировать';

// ---------- Состояние ----------
let expression = ''; // инфиксная строка, которую собирает пользователь
const history = [];
const HISTORY_LIMIT = 30;
const THEME_KEY = 'calculator-theme';
let storedTheme = localStorage.getItem(THEME_KEY);
const prefersDark = typeof window.matchMedia === 'function'
  ? window.matchMedia('(prefers-color-scheme: dark)')
  : null;

// ---------- Конфигурация математических сущностей ----------
const OPERATORS = {
  '+': {precedence: 1, assoc: 'left', fn: (a, b) => a + b},
  '-': {precedence: 1, assoc: 'left', fn: (a, b) => a - b},
  '*': {precedence: 2, assoc: 'left', fn: (a, b) => a * b},
  '/': {
    precedence: 2,
    assoc: 'left',
    fn: (a, b) => {
      if (b === 0) throw new Error('Деление на ноль запрещено');
      return a / b;
    }
  },
  '^': {precedence: 3, assoc: 'right', fn: (a, b) => Math.pow(a, b)}
};

const PREFIX_UNARY = new Set(['√']);
const POSTFIX_UNARY = new Set(['!', '%']);

const FUNCTION_DEFINITIONS = {
  sin: {arity: 1, fn: (x) => Math.sin(x)},
  cos: {arity: 1, fn: (x) => Math.cos(x)},
  tan: {arity: 1, fn: (x) => Math.tan(x)},
  asin: {arity: 1, fn: (x) => {
    if (x < -1 || x > 1) throw new Error('asin(x) определён только для x ∈ [-1; 1]');
    return Math.asin(x);
  }},
  acos: {arity: 1, fn: (x) => {
    if (x < -1 || x > 1) throw new Error('acos(x) определён только для x ∈ [-1; 1]');
    return Math.acos(x);
  }},
  atan: {arity: 1, fn: (x) => Math.atan(x)},
  ln: {arity: 1, fn: (x) => {
    if (x <= 0) throw new Error('Аргумент ln(x) должен быть больше 0');
    return Math.log(x);
  }},
  log: {arity: 2, fn: (base, value) => {
    if (base <= 0 || base === 1) throw new Error('Основание log(base, x) должно быть > 0 и ≠ 1');
    if (value <= 0) throw new Error('Аргумент log(base, x) должен быть > 0');
    return Math.log(value) / Math.log(base);
  }},
  abs: {arity: 1, fn: (x) => Math.abs(x)}
};

const FUNCTION_NAMES = Object.keys(FUNCTION_DEFINITIONS).sort((a, b) => b.length - a.length);
const CONSTANTS = [
  {symbol: 'π', value: Math.PI},
  {symbol: 'pi', value: Math.PI},
  {symbol: 'e', value: Math.E}
].sort((a, b) => b.symbol.length - a.symbol.length);

// ---------- Утилиты ----------
const isDigit = (ch) => /[0-9]/.test(ch);
const isOperatorChar = (ch) => Object.prototype.hasOwnProperty.call(OPERATORS, ch);

// Округление результата для избежания floating point артефактов
/**
 * Форматирует число, убирая лишние нули и артефакты плавающей точки.
 * @param {number} num
 * @returns {string}
 */
function formatNumber(num) {
  if (typeof num !== 'number' || !Number.isFinite(num)) return String(num);
  // Округляем до 12 значащих знаков в мантиссе
  const rounded = Number.parseFloat(num.toPrecision(12));
  // Убираем лишние нули после запятой
  return String(rounded).replace(/\.0+$|(\.\d*[1-9])0+$/,'$1');
}

/**
 * Вычисляет факториал целого числа.
 * @param {number} value
 * @returns {number}
 */
function factorial(value) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error('Факториал определён только для целых чисел ≥ 0');
  }
  if (value > 170) throw new Error('Слишком большое число для факториала');
  let result = 1;
  for (let i = 2; i <= value; i++) {
    result *= i;
  }
  return result;
}

/**
 * Преобразует постфиксный оператор % в объект-маркер.
 * @param {number} value
 * @returns {PercentMarker}
 */
function toPercentMarker(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error('Некорректное значение для процента');
  }
  return {type: 'percent', value, fraction: value / 100};
}

/**
 * Преобразует стековое значение к числу.
 * @param {number|PercentMarker} raw
 * @param {{operator?: string, left?: number}} [context]
 * @returns {number}
 */
function resolveValue(raw, context = {}) {
  if (typeof raw === 'number') return raw;
  if (raw && raw.type === 'percent') {
    if (context.operator === '+' || context.operator === '-') {
      if (typeof context.left !== 'number') {
        throw new Error('Процент требует базовое значение слева');
      }
      return context.left * raw.value / 100;
    }
    return raw.fraction;
  }
  throw new Error('Не удалось преобразовать значение');
}

/**
 * Определяет, является ли символ вертикальной черты открывающим модуль.
 * @param {string} built
 * @returns {boolean}
 */
function shouldOpenAbs(built) {
  if (!built) return true;
  for (let i = built.length - 1; i >= 0; i--) {
    const ch = built[i];
    if (ch === ' ') continue;
    if ('+-*/^,(√'.includes(ch)) return true;
    return false;
  }
  return true;
}

/**
 * Заменяет |x| на abs(x) с учётом вложенных модулей.
 * @param {string} expr
 * @returns {string}
 */
function normalizeAbsolute(expr) {
  let result = '';
  let openCount = 0;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (ch === '|') {
      if (shouldOpenAbs(result)) {
        result += 'abs(';
        openCount++;
      } else {
        if (openCount === 0) throw new Error('Лишний символ |');
        result += ')';
        openCount--;
      }
      continue;
    }
    result += ch;
  }
  if (openCount !== 0) throw new Error('Не закрыт модуль |x|');
  return result;
}

/**
 * Пытается сопоставить функцию, начиная с позиции i.
 * @param {string} expr
 * @param {number} index
 * @returns {string|null}
 */
function matchFunction(expr, index) {
  for (const name of FUNCTION_NAMES) {
    if (expr.slice(index, index + name.length) === name) {
      const rest = expr.slice(index + name.length);
      const match = rest.match(/^\s*(.)/);
      if (!match || match[1] !== '(') {
        throw new Error(`После ${name} требуется открывающая скобка`);
      }
      return name;
    }
  }
  return null;
}

/**
 * Пытается сопоставить константу, начиная с позиции i.
 * @param {string} expr
 * @param {number} index
 * @returns {{symbol: string, value: number}|null}
 */
function matchConstant(expr, index) {
  for (const constant of CONSTANTS) {
    if (expr.slice(index, index + constant.symbol.length) === constant.symbol) {
      return constant;
    }
  }
  return null;
}

/**
 * Разбивает строку на токены.
 * @param {string} expr
 * @returns {Token[]}
 */
function tokenize(expr) {
  // Лексер: разбиваем строку на токены (числа, скобки, операторы)
  const tokens = [];
  let i = 0;
  const pushOperator = (value) => {
    const prev = tokens[tokens.length - 1];
    const isUnaryMinus = (
      value === '-' &&
      (!prev || prev.type === 'operator' ||
        (prev.type === 'paren' && prev.value === '(') ||
        prev.type === 'unary' || prev.type === 'function' ||
        prev.type === 'comma')
    );
    if (isUnaryMinus) {
      tokens.push({type: 'unary', value: 'neg'});
      return;
    }
    tokens.push({type: 'operator', value});
  };

  while (i < expr.length) {
    const ch = expr[i];
    if (ch === ' ') {
      i++;
      continue;
    }

    if (ch === '*' && expr[i + 1] === '*') {
      tokens.push({type: 'operator', value: '^'});
      i += 2;
      continue;
    }

    if (ch === ',' ) {
      tokens.push({type: 'comma'});
      i++;
      continue;
    }

    const func = matchFunction(expr, i);
    if (func) {
      tokens.push({type: 'function', value: func});
      i += func.length;
      continue;
    }

    const constant = matchConstant(expr, i);
    if (constant) {
      tokens.push({type: 'number', value: constant.value});
      i += constant.symbol.length;
      continue;
    }

    if (isDigit(ch) || ch === '.') {
      // читаем число (включая десятичную часть)
      let num = ch;
      let dotCount = ch === '.' ? 1 : 0;
      while (i + 1 < expr.length) {
        const next = expr[i + 1];
        if (isDigit(next)) {
          num += next;
          i++;
        } else if (next === '.') {
          dotCount++;
          if (dotCount > 1) throw new Error('Слишком много точек в числе');
          num += next;
          i++;
        } else break;
      }
      // валидируем формат (например, не две точки, не одиночная точка)
      const parsed = parseFloat(num);
      if (Number.isNaN(parsed)) {
        throw new Error('Некорректное число');
      }
      tokens.push({type: 'number', value: parsed});
      i++;
      continue;
    }

    if (PREFIX_UNARY.has(ch)) {
      tokens.push({type: 'unary', value: ch});
      i++;
      continue;
    }

    if (POSTFIX_UNARY.has(ch)) {
      tokens.push({type: 'postfix', value: ch});
      i++;
      continue;
    }

    if (ch === '(' || ch === ')') {
      tokens.push({type: 'paren', value: ch});
      i++;
      continue;
    }

    if (isOperatorChar(ch)) {
      pushOperator(ch);
      i++;
      continue;
    }
    // если дошли сюда — встретили неизвестный символ
    throw new Error(`Неизвестный символ: ${ch}`);
  }
  return tokens;
}

/**
 * Переносит накопившиеся префиксные операторы в выходную очередь.
 * @param {Token[]} ops
 * @param {Token[]} output
 */
function flushPendingUnary(ops, output) {
  while (ops.length > 0 && ops[ops.length - 1].type === 'unary') {
    output.push(ops.pop());
  }
}

// ---------- Парсер: Shunting Yard (инфикс -> постфикс) ----------
/**
 * Алгоритм сортировочной станции (Shunting Yard).
 * @param {string} infix
 * @returns {Token[]}
 */
function infixToRPN(infix) {
  // Возвращает массив токенов в постфиксной нотации, или выбрасывает Error
  const prepared = normalizeAbsolute(infix);
  const tokens = tokenize(prepared);
  const output = [];
  const ops = []; // стек операторов

  // Шунтинг-ярд
  for (const token of tokens) {
    if (token.type === 'number') {
      output.push(token);
      flushPendingUnary(ops, output);
    } else if (token.type === 'function' || token.type === 'unary') {
      ops.push(token);
    } else if (token.type === 'postfix') {
      output.push(token);
    } else if (token.type === 'operator') {
      while (ops.length > 0) {
        const top = ops[ops.length - 1];
        if (top.type === 'function' || top.type === 'unary') {
          output.push(ops.pop());
          continue;
        }
        if (top.type === 'operator') {
          const topInfo = OPERATORS[top.value];
          const nextInfo = OPERATORS[token.value];
          const shouldPop = (
            (nextInfo.assoc === 'left' && nextInfo.precedence <= topInfo.precedence) ||
            (nextInfo.assoc === 'right' && nextInfo.precedence < topInfo.precedence)
          );
          if (shouldPop) {
            output.push(ops.pop());
            continue;
          }
        }
        break;
      }
      ops.push(token);
    } else if (token.type === 'paren') {
      if (token.value === '(') {
        ops.push(token);
      } else {
        // token is ')'
        let matched = false;
        while (ops.length > 0) {
          const top = ops.pop();
          if (top.type === 'paren' && top.value === '(') {
            matched = true;
            break;
          }
          output.push(top);
        }
        if (!matched) throw new Error('Скобки расставлены неверно');
        while (ops.length > 0 && (ops[ops.length - 1].type === 'function' || ops[ops.length - 1].type === 'unary')) {
          output.push(ops.pop());
        }
      }
    } else if (token.type === 'comma') {
      let foundLeftParen = false;
      while (ops.length > 0) {
        const top = ops[ops.length - 1];
        if (top.type === 'paren' && top.value === '(') {
          foundLeftParen = true;
          break;
        }
        output.push(ops.pop());
      }
      if (!foundLeftParen) throw new Error('Запятая допустима только внутри аргументов функции');
    } else {
      throw new Error('Неизвестный токен при разборе');
    }
  }

  // Перенести остаток стека
  while (ops.length > 0) {
    const top = ops.pop();
    if (top.type === 'paren') throw new Error('Пропущена закрывающая скобка');
    output.push(top);
  }

  return output; // массив токенов
}

// ---------- Вычисление RPN ----------
/**
 * Вычисляет выражение в постфиксной нотации.
 * @param {Token[]} tokens
 * @returns {number}
 */
function evaluateRPN(tokens) {
  const stack = [];
  for (const token of tokens) {
    if (token.type === 'number') {
      stack.push(token.value);
    } else if (token.type === 'unary') {
      if (stack.length < 1) throw new Error('Унарный оператор без аргумента');
      const value = resolveValue(stack.pop());
      switch (token.value) {
        case '√':
          if (value < 0) throw new Error('Подкоренное выражение должно быть ≥ 0');
          stack.push(Math.sqrt(value));
          break;
        case 'neg':
          stack.push(-value);
          break;
        default:
          throw new Error('Неизвестный унарный оператор');
      }
    } else if (token.type === 'function') {
      const def = FUNCTION_DEFINITIONS[token.value];
      if (!def) throw new Error(`Неизвестная функция ${token.value}`);
      if (stack.length < def.arity) throw new Error(`Недостаточно аргументов для ${token.value}`);
      const args = [];
      for (let i = 0; i < def.arity; i++) {
        args.unshift(resolveValue(stack.pop()));
      }
      stack.push(def.fn(...args));
    } else if (token.type === 'operator') {
      if (stack.length < 2) throw new Error('Недостаточно аргументов для операции');
      const rightRaw = stack.pop();
      const leftRaw = stack.pop();
      const left = resolveValue(leftRaw);
      const right = resolveValue(rightRaw, {operator: token.value, left});
      stack.push(OPERATORS[token.value].fn(left, right));
    } else if (token.type === 'postfix') {
      if (stack.length < 1) throw new Error('Постфиксный оператор без аргумента');
      const operand = resolveValue(stack.pop());
      if (token.value === '!') {
        stack.push(factorial(operand));
      } else if (token.value === '%') {
        stack.push(toPercentMarker(operand));
      } else {
        throw new Error('Неизвестный постфиксный оператор');
      }
    } else {
      throw new Error('Некорректный токен в выражении');
    }
  }

  if (stack.length !== 1) throw new Error('Не удалось вычислить выражение');
  return resolveValue(stack[0]);
}

// ---------- Основная функция вычисления выражения ----------
/**
 * Вычисляет пользовательское выражение.
 * @param {string} infix
 * @returns {number}
 */
function computeExpression(infix) {
  if (!infix || infix.trim() === '') throw new Error('Введите выражение');
  const rpn = infixToRPN(infix);
  return evaluateRPN(rpn);
}

// ---------- UI: обновление дисплея ----------
function updateDisplay() {
  if (exprEl) exprEl.textContent = expression;
  if (expression === '' && resultEl) resultEl.value = '0';
  // Примечание: результат не пересчитывается при каждом вводе — вычисляем по "="
}

function hasOperandForPostfix(last) {
  return Boolean(last) && (isDigit(last) || last === ')' || last === 'π' || last === 'e' || last === '!');
}

/**
 * Вставляет значение из кнопки в выражение.
 * @param {string} val
 */
// ---------- Обработчики действий ----------
function insertValue(val) {
  // простая валидация: не разрешаем две точки подряд в числе и два оператора подряд
  const last = expression[expression.length - 1];

  if (val === '.') {
    // если последнее — цифра и уже нет точки в текущем числе
    // находим начало текущего числа
    let i = expression.length - 1;
    while (i >= 0 && (isDigit(expression[i]) || expression[i] === '.')) i--;
    const current = expression.slice(i + 1);
    if (current.includes('.')) return; // уже есть точка
    // если пусто или последний не цифра -> добавить "0." вместо "."
    if (!current || isOperatorChar(last) || last === '(' || !last) {
      expression += '0.';
    } else {
      expression += '.';
    }
    updateDisplay();
    return;
  }

  if (val === ',') {
    if (!expression || isOperatorChar(last) || last === '(') return;
    expression += ',';
    updateDisplay();
    return;
  }

  if (FUNCTION_DEFINITIONS[val]) {
    expression += `${val}(`;
    updateDisplay();
    return;
  }

  if (val === '|') {
    expression += '|';
    updateDisplay();
    return;
  }

  if (val === 'π' || val === 'pi') {
    expression += 'π';
    updateDisplay();
    return;
  }

  if (val === 'e') {
    expression += 'e';
    updateDisplay();
    return;
  }

  if (val === '√') {
    expression += '√';
    updateDisplay();
    return;
  }

  if (val === '!') {
    if (!hasOperandForPostfix(last)) return;
    expression += '!';
    updateDisplay();
    return;
  }

  if (val === '%') {
    if (!hasOperandForPostfix(last)) return;
    expression += '%';
    updateDisplay();
    return;
  }

  if (val === '(' || val === ')') {
    expression += val;
    updateDisplay();
    return;
  }

  if (isOperatorChar(val)) {
    // запрещаем оператор в начале (кроме "-" для отрицательных чисел — можно расширить)
    if (!expression) {
      if (val === '-') {
        expression = '-'; // разрешаем отрицание
        updateDisplay();
      }
      return;
    }
    // если выражение состоит только из унарного минуса и нажали другой оператор — игнорируем
    if (expression === '-' && val !== '-') {
      return;
    }
    // если последний — оператор, заменим его (чтобы не было ++ или +-)
    if (isOperatorChar(last)) {
      // допускаем вставку унарного минуса после оператора (5*-3)
      if (val === '-' && last !== '-') {
        expression += val;
        updateDisplay();
        return;
      }
      expression = expression.slice(0, -1) + val;
    } else {
      expression += val;
    }
    updateDisplay();
    return;
  }
  // если вставляем цифру/точку/скобку/оператор — добавляем
  expression += val;
  updateDisplay();
}

/**
 * Добавляет запись в историю.
 * @param {string} expr
 * @param {string} result
 */
function addToHistory(expr, result) {
  history.unshift({expr, result});
  if (history.length > HISTORY_LIMIT) history.pop();
  renderHistory();
}

function renderHistory() {
  if (!historyListEl) return;
  historyListEl.innerHTML = '';
  if (history.length === 0) {
    const li = document.createElement('li');
    li.className = 'history-empty';
    li.textContent = 'История пуста';
    historyListEl.appendChild(li);
    return;
  }
  const frag = document.createDocumentFragment();
  history.forEach((entry, index) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'history-item';
    btn.dataset.index = String(index);
    const exprSpan = document.createElement('span');
    exprSpan.className = 'history-expr';
    exprSpan.textContent = entry.expr;
    const resultSpan = document.createElement('span');
    resultSpan.className = 'history-result';
    resultSpan.textContent = entry.result;
    btn.append(exprSpan, resultSpan);
    li.appendChild(btn);
    frag.appendChild(li);
  });
  historyListEl.appendChild(frag);
}

function toggleHistoryPanel() {
  if (!historyPanel || !historyToggleBtn) return;
  historyPanel.classList.toggle('history-open');
  const expanded = historyPanel.classList.contains('history-open');
  historyToggleBtn.setAttribute('aria-expanded', String(expanded));
  historyPanel.setAttribute('aria-hidden', String(!expanded));
}

async function copyResult() {
  if (!copyBtn || !resultEl) return;
  const text = resultEl.value;
  try {
    if (!navigator.clipboard) throw new Error('Clipboard API недоступен');
    await navigator.clipboard.writeText(text);
    copyBtn.dataset.state = 'copied';
    copyBtn.textContent = 'Скопировано';
  } catch (err) {
    copyBtn.dataset.state = 'error';
    copyBtn.textContent = 'Ошибка копирования';
    console.error(err);
  } finally {
    setTimeout(() => {
      copyBtn.dataset.state = 'idle';
      copyBtn.textContent = copyBtnDefaultText;
    }, 1500);
  }
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  if (themeToggleBtn) {
    themeToggleBtn.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
    if (themeToggleLabel) {
      themeToggleLabel.textContent = theme === 'dark' ? 'Тёмная' : 'Светлая';
    }
  }
}

function resolveTheme() {
  if (storedTheme) return storedTheme;
  return (prefersDark && prefersDark.matches) ? 'dark' : 'light';
}

function initTheme() {
  applyTheme(resolveTheme());
  if (prefersDark) {
    const handleChange = (event) => {
      if (storedTheme) return;
      const matches = typeof event.matches === 'boolean' ? event.matches : prefersDark.matches;
      applyTheme(matches ? 'dark' : 'light');
    };
    if (typeof prefersDark.addEventListener === 'function') {
      prefersDark.addEventListener('change', handleChange);
    } else if (typeof prefersDark.addListener === 'function') {
      prefersDark.addListener(handleChange);
    }
  }
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
      const next = resolveTheme() === 'dark' ? 'light' : 'dark';
      storedTheme = next;
      localStorage.setItem(THEME_KEY, next);
      applyTheme(next);
    });
  }
}

function handleAction(action) {
  if (action === 'clear') {
    expression = '';
    updateDisplay();
    if (resultEl) resultEl.value = '0';
    return;
  }
  if (action === 'backspace') {
    expression = expression.slice(0, -1);
    updateDisplay();
    return;
  }
  if (action === 'equals') {
    try {
      const value = computeExpression(expression);
      const formatted = formatNumber(value);
      if (resultEl) resultEl.value = formatted;
      addToHistory(expression, formatted);
      // Можно также сохранить в history
      // expression = String(result); // либо оставить выражение, по желанию
      // updateDisplay();
    } catch (err) {
      if (resultEl) resultEl.value = err.message;
      console.error(err);
    }
    return;
  }
  if (action === 'paren-open') {
    // легко вставить '('
    insertValue('(');
    return;
  }
  if (action === 'paren-close') {
    insertValue(')');
    return;
  }
  if (action === 'copy') {
    copyResult();
  }
}

// ---------- Делегирование кликов на контейнер .keys ----------
if (keys) {
  keys.addEventListener('click', (e) => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    const btn = target.closest('button');
    if (!btn) return;
    const val = btn.dataset.value;
    const action = btn.dataset.action;
    if (val !== undefined) {
      insertValue(val);
    } else if (action) {
      handleAction(action);
    }
  });
}

// ---------- Поддержка клавиатуры ----------
if (document) {
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey) return;
    const key = e.key;
    if ((key >= '0' && key <= '9')) {
      insertValue(key);
      e.preventDefault();
      return;
    }
    if (key === '.' || key === ',') {
      insertValue(key);
      e.preventDefault();
      return;
    }
    if (isOperatorChar(key) || key === '^') {
      insertValue(key === '^' ? '^' : key);
      e.preventDefault();
      return;
    }
    if (key === '%' || key === '!') {
      insertValue(key);
      e.preventDefault();
      return;
    }
    if (key === '(' || key === ')') {
      insertValue(key);
      e.preventDefault();
      return;
    }
    if (key === 'Enter' || key === '=') {
      handleAction('equals');
      e.preventDefault();
      return;
    }
    if (key === 'Backspace') {
      handleAction('backspace');
      e.preventDefault();
      return;
    }
    if (key === 'Escape') {
      handleAction('clear');
      e.preventDefault();
    }
  });
}

if (copyBtn) {
  copyBtn.addEventListener('click', () => handleAction('copy'));
}

if (historyToggleBtn) {
  historyToggleBtn.addEventListener('click', toggleHistoryPanel);
}

if (historyClearBtn) {
  historyClearBtn.addEventListener('click', () => {
    history.length = 0;
    renderHistory();
  });
}

if (historyListEl) {
  historyListEl.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const btn = target.closest('.history-item');
    if (!btn) return;
    const index = Number(btn.dataset.index);
    const entry = history[index];
    if (!entry) return;
    expression = entry.expr;
    if (resultEl) resultEl.value = entry.result;
    updateDisplay();
    if (historyPanel && historyPanel.classList.contains('history-open')) {
      toggleHistoryPanel();
    }
  });
}

initTheme();
renderHistory();
updateDisplay();
