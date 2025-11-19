// calculator.js — логика калькулятора (без eval)

// ---------- Элементы UI ----------
const exprEl = document.getElementById('expr');
const resultEl = document.getElementById('result');
const keys = document.querySelector('.keys');

// ---------- Состояние ----------
let expression = ''; // инфиксная строка, которую собирает пользователь
// Можно добавить history = [] для хранения прошлых вычислений

// ---------- Утилиты ----------
const isDigit = ch => /[0-9]/.test(ch);
const isOperator = ch => ['+', '-', '*', '/'].includes(ch);

// Округление результата для избежания floating point артефактов
function formatNumber(num) {
  if (typeof num !== 'number' || !isFinite(num)) return String(num);
  // Округляем до 12 значащих знаков в мантиссе
  const rounded = Number.parseFloat(num.toPrecision(12));
  // Убираем лишние нули после запятой
  return String(rounded).replace(/\.0+$|(\.\d*[1-9])0+$/,'$1');
}

// ---------- Парсер: Shunting Yard (инфикс -> постфикс) ----------
function infixToRPN(infix) {
  // Возвращает массив токенов в постфиксной нотации, или выбрасывает Error
  const output = [];
  const ops = []; // стек операторов

  // Лексер: разбиваем строку на токены (числа, скобки, операторы)
  const tokens = [];
  for (let i = 0; i < infix.length; i++) {
    const ch = infix[i];
    if (ch === ' ') continue;
    if (isDigit(ch) || ch === '.') {
      // читаем число (включая десятичную часть)
      let num = ch;
      while (i + 1 < infix.length && (isDigit(infix[i+1]) || infix[i+1] === '.')) {
        num += infix[++i];
      }
      // валидируем формат (например, не две точки)
      if ((num.match(/\./g) || []).length > 1) {
        throw new Error('Неверный формат числа');
      }
      tokens.push({type: 'number', value: parseFloat(num)});
      continue;
    }
    if (isOperator(ch)) {
      tokens.push({type: 'operator', value: ch});
      continue;
    }
    if (ch === '(' || ch === ')') {
      tokens.push({type: 'paren', value: ch});
      continue;
    }
    // если дошли сюда — встретили неизвестный символ
    throw new Error(`Неподдерживаемый символ: ${ch}`);
  }

  // Приоритеты операторов
  const precedence = {'+': 1, '-': 1, '*': 2, '/': 2};
  const isLeftAssoc = op => true; // +,-,*,/ — левоассоциативные

  // Шунтинг-ярд
  for (const token of tokens) {
    if (token.type === 'number') {
      output.push(token);
    } else if (token.type === 'operator') {
      while (ops.length > 0) {
        const top = ops[ops.length - 1];
        if (top.type === 'operator' &&
            ((isLeftAssoc(token.value) && precedence[token.value] <= precedence[top.value]) ||
             (!isLeftAssoc(token.value) && precedence[token.value] < precedence[top.value]))) {
          output.push(ops.pop());
        } else break;
      }
      ops.push(token);
    } else if (token.type === 'paren') {
      if (token.value === '(') {
        ops.push(token);
      } else {
        // token is ')'
        let foundLeft = false;
        while (ops.length > 0) {
          const top = ops.pop();
          if (top.type === 'paren' && top.value === '(') {
            foundLeft = true;
            break;
          } else {
            output.push(top);
          }
        }
        if (!foundLeft) throw new Error('Несбалансированные скобки');
      }
    }
  }

  // Перенести остаток стека
  while (ops.length > 0) {
    const top = ops.pop();
    if (top.type === 'paren') throw new Error('Несбалансированные скобки');
    output.push(top);
  }

  return output; // массив токенов
}

// ---------- Вычисление RPN ----------
function evaluateRPN(tokens) {
  const stack = [];
  for (const token of tokens) {
    if (token.type === 'number') {
      stack.push(token.value);
    } else if (token.type === 'operator') {
      if (stack.length < 2) throw new Error('Недостаточно операндов');
      const b = stack.pop();
      const a = stack.pop();
      let res;
      switch (token.value) {
        case '+': res = a + b; break;
        case '-': res = a - b; break;
        case '*': res = a * b; break;
        case '/':
          if (b === 0) throw new Error('Деление на ноль');
          res = a / b; break;
        default: throw new Error('Неизвестная операция');
      }
      stack.push(res);
    } else {
      throw new Error('Неверный токен в RPN');
    }
  }
  if (stack.length !== 1) throw new Error('Неверное выражение');
  return stack[0];
}

// ---------- Основная функция вычисления выражения ----------
function computeExpression(infix) {
  if (!infix || infix.trim() === '') throw new Error('Пустое выражение');
  const rpn = infixToRPN(infix);
  const result = evaluateRPN(rpn);
  return result;
}

// ---------- UI: обновление дисплея ----------
function updateDisplay() {
  exprEl.textContent = expression;
  if (expression === '') resultEl.value = '0';
  // Примечание: результат не пересчитывается при каждом вводе — вычисляем по "="
}

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
    if (current === '') {
      expression += '0.';
      updateDisplay();
      return;
    }
  }
  if (isOperator(val)) {
    // запрещаем оператор в начале (кроме "-" для отрицательных чисел — можно расширить)
    if (!expression) {
      if (val === '-') {
        expression += '-'; // разрешаем отрицание
      }
      return;
    }
    // если последний — оператор, заменим его (чтобы не было ++ или +-)
    if (isOperator(last)) {
      expression = expression.slice(0, -1) + val;
      updateDisplay();
      return;
    }
  }
  // если вставляем цифру/точку/скобку/оператор — добавляем
  expression += val;
  updateDisplay();
}

function handleAction(action) {
  if (action === 'clear') {
    expression = '';
    updateDisplay();
    return;
  }
  if (action === 'backspace') {
    expression = expression.slice(0, -1);
    updateDisplay();
    return;
  }
  if (action === 'equals') {
    try {
      const result = computeExpression(expression);
      resultEl.value = formatNumber(result);
      // Можно также сохранить в history
      // expression = String(result); // либо оставить выражение, по желанию
      // updateDisplay();
    } catch (err) {
      resultEl.value = 'Ошибка';
      console.error(err);
    }
    return;
  }
  if (action === 'paren-open') {
    // легко вставить '('
    expression += '(';
    updateDisplay();
    return;
  }
  if (action === 'paren-close') {
    expression += ')';
    updateDisplay();
    return;
  }
}

// ---------- Делегирование кликов на контейнер .keys ----------
keys.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const val = btn.dataset.value;
  const action = btn.dataset.action;
  if (val !== undefined) {
    insertValue(val);
  } else if (action !== undefined) {
    handleAction(action);
  }
});

// ---------- Поддержка клавиатуры ----------
document.addEventListener('keydown', (e) => {
  const key = e.key;
  if ((key >= '0' && key <= '9') || key === '.') {
    insertValue(key);
    e.preventDefault();
    return;
  }
  if (key === '+' || key === '-' || key === '*' || key === '/') {
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
    return;
  }
  if (key === '(') {
    insertValue('(');
    e.preventDefault();
    return;
  }
  if (key === ')') {
    insertValue(')');
    e.preventDefault();
    return;
  }
});

