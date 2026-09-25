/* =====================================================
   EXPENSE & BUDGET VISUALIZER — app.js
   Features:
   - LocalStorage persistence
   - Add / Delete transactions
   - Category filter pills
   - Sort by date, amount, category
   - Auto-updating pie chart (Chart.js)
   - Auto-updating total balance
   - Budget limit with progress bar + warning
   - Dark / Light mode toggle
   ===================================================== */

'use strict';

/* ── CONSTANTS ─────────────────────────────────────── */
const STORAGE_KEY_TRANSACTIONS = 'bv_transactions';
const STORAGE_KEY_BUDGET       = 'bv_budget';
const STORAGE_KEY_THEME        = 'bv_theme';
const STORAGE_KEY_SORT         = 'bv_sort';

const CATEGORY_META = {
  Food:      { icon: '🍔', badgeClass: 'badge-food'      },
  Transport: { icon: '🚗', badgeClass: 'badge-transport' },
  Fun:       { icon: '🎉', badgeClass: 'badge-fun'       },
};

const CHART_COLORS = {
  Food:      '#f97316',
  Transport: '#3b82f6',
  Fun:       '#a855f7',
};

/* ── STATE ─────────────────────────────────────────── */
let transactions  = [];   // Array of { id, name, amount, category, date }
let budgetLimit   = 0;    // Number; 0 = not set
let activeFilter  = 'All';
let activeSortKey = 'date-desc';
let chartInstance = null;

/* ── DOM REFERENCES ────────────────────────────────── */
const $ = id => document.getElementById(id);

const dom = {
  totalBalance:    $('total-balance'),
  budgetBar:       $('budget-bar'),
  budgetHint:      $('budget-hint'),
  warningBanner:   $('warning-banner'),

  budgetInput:     $('budget-input'),
  setBudgetBtn:    $('set-budget-btn'),

  form:            $('transaction-form'),
  itemName:        $('item-name'),
  amount:          $('amount'),
  category:        $('category'),
  nameError:       $('name-error'),
  amountError:     $('amount-error'),
  categoryError:   $('category-error'),

  transactionList: $('transaction-list'),
  listEmpty:       $('list-empty'),
  chartEmpty:      $('chart-empty'),
  clearAllBtn:     $('clear-all-btn'),

  sortBy:          $('sort-by'),
  filterPills:     $('filter-pills'),
  themeToggle:     $('theme-toggle'),
  themeIcon:       $('theme-icon'),
  chartCanvas:     $('expense-chart'),
};

/* ══════════════════════════════════════════════════════
   INITIALISATION
══════════════════════════════════════════════════════ */
function init() {
  loadFromStorage();
  applyTheme(getStoredTheme(), false);
  dom.sortBy.value = activeSortKey;
  renderAll();
  bindEvents();
}

/* ── STORAGE HELPERS ───────────────────────────────── */
function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_TRANSACTIONS);
    transactions = raw ? JSON.parse(raw) : [];
  } catch { transactions = []; }

  budgetLimit   = parseFloat(localStorage.getItem(STORAGE_KEY_BUDGET)) || 0;
  activeSortKey = localStorage.getItem(STORAGE_KEY_SORT) || 'date-desc';

  if (budgetLimit > 0) dom.budgetInput.value = budgetLimit;
}

function saveTransactions() {
  localStorage.setItem(STORAGE_KEY_TRANSACTIONS, JSON.stringify(transactions));
}

function saveBudget() {
  localStorage.setItem(STORAGE_KEY_BUDGET, budgetLimit);
}

function saveSort() {
  localStorage.setItem(STORAGE_KEY_SORT, activeSortKey);
}

function getStoredTheme() {
  return localStorage.getItem(STORAGE_KEY_THEME) || 'light';
}

/* ══════════════════════════════════════════════════════
   EVENT BINDING
══════════════════════════════════════════════════════ */
function bindEvents() {
  // Form submit
  dom.form.addEventListener('submit', handleAddTransaction);

  // Set budget
  dom.setBudgetBtn.addEventListener('click', handleSetBudget);
  dom.budgetInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') handleSetBudget();
  });

  // Sort change
  dom.sortBy.addEventListener('change', () => {
    activeSortKey = dom.sortBy.value;
    saveSort();
    renderList();
  });

  // Filter pills
  dom.filterPills.addEventListener('click', e => {
    const pill = e.target.closest('.pill');
    if (!pill) return;
    activeFilter = pill.dataset.filter;
    dom.filterPills.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    renderList();
  });

  // Clear all
  dom.clearAllBtn.addEventListener('click', handleClearAll);

  // Theme toggle
  dom.themeToggle.addEventListener('click', toggleTheme);

  // Delete via event delegation on list
  dom.transactionList.addEventListener('click', e => {
    const btn = e.target.closest('.btn-delete');
    if (!btn) return;
    const id = btn.dataset.id;
    deleteTransaction(id);
  });
}

/* ══════════════════════════════════════════════════════
   TRANSACTION CRUD
══════════════════════════════════════════════════════ */
function handleAddTransaction(e) {
  e.preventDefault();
  if (!validateForm()) return;

  const tx = {
    id:       crypto.randomUUID(),
    name:     dom.itemName.value.trim(),
    amount:   parseFloat(dom.amount.value),
    category: dom.category.value,
    date:     new Date().toISOString(),
  };

  transactions.unshift(tx);   // newest first in storage
  saveTransactions();
  dom.form.reset();
  clearErrors();
  renderAll();

  // Brief success flash on the submit button
  const btn = dom.form.querySelector('button[type="submit"]');
  btn.textContent = '✓ Added!';
  btn.style.background = 'var(--clr-success)';
  setTimeout(() => {
    btn.textContent = '+ Add Expense';
    btn.style.background = '';
  }, 1200);
}

function deleteTransaction(id) {
  transactions = transactions.filter(tx => tx.id !== id);
  saveTransactions();
  renderAll();
}

function handleClearAll() {
  if (!confirm('Delete all transactions? This cannot be undone.')) return;
  transactions = [];
  saveTransactions();
  renderAll();
}

/* ── BUDGET ────────────────────────────────────────── */
function handleSetBudget() {
  const val = parseFloat(dom.budgetInput.value);
  if (isNaN(val) || val < 0) {
    dom.budgetInput.classList.add('is-invalid');
    dom.budgetInput.focus();
    setTimeout(() => dom.budgetInput.classList.remove('is-invalid'), 1500);
    return;
  }
  budgetLimit = val;
  saveBudget();
  renderBudget();
}

/* ══════════════════════════════════════════════════════
   VALIDATION
══════════════════════════════════════════════════════ */
function validateForm() {
  clearErrors();
  let valid = true;

  const name = dom.itemName.value.trim();
  const amt  = dom.amount.value;
  const cat  = dom.category.value;

  if (!name) {
    showError(dom.itemName, dom.nameError, 'Item name is required.');
    valid = false;
  } else if (name.length < 2) {
    showError(dom.itemName, dom.nameError, 'Name must be at least 2 characters.');
    valid = false;
  }

  if (!amt) {
    showError(dom.amount, dom.amountError, 'Amount is required.');
    valid = false;
  } else if (isNaN(parseFloat(amt)) || parseFloat(amt) <= 0) {
    showError(dom.amount, dom.amountError, 'Enter a valid positive amount.');
    valid = false;
  }

  if (!cat) {
    showError(dom.category, dom.categoryError, 'Please select a category.');
    valid = false;
  }

  return valid;
}

function showError(input, msgEl, message) {
  input.classList.add('is-invalid');
  msgEl.textContent = message;
}

function clearErrors() {
  [dom.itemName, dom.amount, dom.category].forEach(el => el.classList.remove('is-invalid'));
  [dom.nameError, dom.amountError, dom.categoryError].forEach(el => el.textContent = '');
}

/* ══════════════════════════════════════════════════════
   RENDER PIPELINE
══════════════════════════════════════════════════════ */
function renderAll() {
  renderList();
  renderBalance();
  renderBudget();
  renderChart();
}

/* ── SORT HELPER ───────────────────────────────────── */
function getSortedFiltered() {
  let list = activeFilter === 'All'
    ? [...transactions]
    : transactions.filter(tx => tx.category === activeFilter);

  switch (activeSortKey) {
    case 'date-desc':    list.sort((a, b) => new Date(b.date) - new Date(a.date)); break;
    case 'date-asc':     list.sort((a, b) => new Date(a.date) - new Date(b.date)); break;
    case 'amount-desc':  list.sort((a, b) => b.amount - a.amount); break;
    case 'amount-asc':   list.sort((a, b) => a.amount - b.amount); break;
    case 'category-az':  list.sort((a, b) => a.category.localeCompare(b.category)); break;
  }

  return list;
}

/* ── RENDER LIST ───────────────────────────────────── */
function renderList() {
  const list = getSortedFiltered();
  dom.transactionList.innerHTML = '';

  const isEmpty = transactions.length === 0;
  const isFilteredEmpty = list.length === 0 && !isEmpty;

  dom.listEmpty.classList.toggle('hidden', !isEmpty && !isFilteredEmpty);
  dom.clearAllBtn.classList.toggle('hidden', isEmpty);

  if (isEmpty) {
    dom.listEmpty.textContent = 'No transactions yet. Add one above!';
    return;
  }

  if (isFilteredEmpty) {
    dom.listEmpty.textContent = `No "${activeFilter}" transactions found.`;
    return;
  }

  const fragment = document.createDocumentFragment();

  list.forEach(tx => {
    const meta    = CATEGORY_META[tx.category] || { icon: '💸', badgeClass: '' };
    const dateStr = formatDate(tx.date);
    const amtStr  = formatCurrency(tx.amount);

    const li = document.createElement('li');
    li.className = 'transaction-item';
    li.dataset.category = tx.category;
    li.setAttribute('role', 'listitem');

    li.innerHTML = `
      <span class="item-icon" aria-hidden="true">${meta.icon}</span>
      <div class="item-info">
        <div class="item-name" title="${escapeHtml(tx.name)}">${escapeHtml(tx.name)}</div>
        <div class="item-meta">
          <span class="item-category-badge ${meta.badgeClass}">${tx.category}</span>
          &nbsp;·&nbsp; ${dateStr}
        </div>
      </div>
      <span class="item-amount">${amtStr}</span>
      <button class="btn-delete" data-id="${tx.id}" aria-label="Delete ${escapeHtml(tx.name)}" title="Delete">✕</button>
    `;

    fragment.appendChild(li);
  });

  dom.transactionList.appendChild(fragment);
}

/* ── RENDER BALANCE ────────────────────────────────── */
function renderBalance() {
  const total = transactions.reduce((sum, tx) => sum + tx.amount, 0);
  dom.totalBalance.textContent = formatCurrency(total);
}

/* ── RENDER BUDGET ─────────────────────────────────── */
function renderBudget() {
  const total = transactions.reduce((sum, tx) => sum + tx.amount, 0);

  if (budgetLimit <= 0) {
    dom.budgetBar.style.width = '0%';
    dom.budgetHint.textContent = 'Set a budget limit below to track usage.';
    dom.warningBanner.classList.add('hidden');
    dom.budgetBar.classList.remove('over-budget');
    return;
  }

  const pct     = Math.min((total / budgetLimit) * 100, 100);
  const overBudget = total > budgetLimit;

  dom.budgetBar.style.width = pct + '%';
  dom.budgetBar.classList.toggle('over-budget', overBudget);

  const remaining = budgetLimit - total;
  if (overBudget) {
    dom.budgetHint.textContent = `Over budget by ${formatCurrency(Math.abs(remaining))} (limit: ${formatCurrency(budgetLimit)})`;
  } else {
    dom.budgetHint.textContent = `${formatCurrency(remaining)} remaining of ${formatCurrency(budgetLimit)} budget (${Math.round(pct)}% used)`;
  }

  dom.warningBanner.classList.toggle('hidden', !overBudget);
}

/* ── RENDER CHART ──────────────────────────────────── */
function renderChart() {
  // Aggregate totals per category
  const totals = { Food: 0, Transport: 0, Fun: 0 };
  transactions.forEach(tx => {
    if (totals[tx.category] !== undefined) totals[tx.category] += tx.amount;
  });

  const hasData = Object.values(totals).some(v => v > 0);
  dom.chartEmpty.style.display = hasData ? 'none' : 'flex';

  const labels = Object.keys(totals).filter(k => totals[k] > 0);
  const data   = labels.map(k => totals[k]);
  const colors = labels.map(k => CHART_COLORS[k]);

  if (!hasData) {
    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }
    return;
  }

  const isDark  = document.documentElement.getAttribute('data-theme') === 'dark';
  const textClr = isDark ? '#e8eaf6' : '#1a1d2e';

  if (chartInstance) {
    chartInstance.data.labels          = labels;
    chartInstance.data.datasets[0].data   = data;
    chartInstance.data.datasets[0].backgroundColor = colors;
    chartInstance.options.plugins.legend.labels.color = textClr;
    chartInstance.update('active');
    return;
  }

  chartInstance = new Chart(dom.chartCanvas, {
    type: 'pie',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors,
        borderColor:      isDark ? '#1a1d2e' : '#ffffff',
        borderWidth:      3,
        hoverOffset:      10,
      }],
    },
    options: {
      responsive: true,
      animation:  { duration: 500, easing: 'easeInOutQuart' },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color:     textClr,
            font:      { size: 12, weight: '600' },
            padding:   14,
            usePointStyle: true,
            pointStyleWidth: 10,
          },
        },
        tooltip: {
          callbacks: {
            label: ctx => {
              const val   = ctx.parsed;
              const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
              const pct   = ((val / total) * 100).toFixed(1);
              return ` ${formatCurrency(val)} (${pct}%)`;
            },
          },
        },
      },
    },
  });
}

/* ══════════════════════════════════════════════════════
   DARK / LIGHT THEME
══════════════════════════════════════════════════════ */
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  applyTheme(current === 'dark' ? 'light' : 'dark', true);
}

function applyTheme(theme, save) {
  document.documentElement.setAttribute('data-theme', theme);
  dom.themeIcon.textContent = theme === 'dark' ? '☀️' : '🌙';
  if (save) localStorage.setItem(STORAGE_KEY_THEME, theme);

  // Refresh chart colours when theme changes
  if (chartInstance) {
    const isDark  = theme === 'dark';
    const textClr = isDark ? '#e8eaf6' : '#1a1d2e';
    const borderClr = isDark ? '#1a1d2e' : '#ffffff';

    chartInstance.data.datasets[0].borderColor = borderClr;
    chartInstance.options.plugins.legend.labels.color = textClr;
    chartInstance.update('none');  // no animation on theme switch
  }
}

/* ══════════════════════════════════════════════════════
   UTILITY FUNCTIONS
══════════════════════════════════════════════════════ */
function formatCurrency(amount) {
  return 'Rp ' + amount.toLocaleString('id-ID', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function formatDate(isoString) {
  return new Date(isoString).toLocaleDateString('id-ID', {
    day:   '2-digit',
    month: 'short',
    year:  'numeric',
  });
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ── KICK OFF ──────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', init);
