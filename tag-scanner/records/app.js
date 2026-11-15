// Standalone Records page - the inventory table used to sit below the
// scanner on the main page (js/app.js). Tapping a row opens that item back
// on the scanner page (/?record=<id>), where Sell/Print/Edit live.

import { getRecords, getCachedRecords, saveRecord, updateRecord, deleteRecord, exportCSV } from '../js/storage.js';

const recordsList = document.getElementById('records-list');
const recordsSearchInput = document.getElementById('records-search');
const recordsCount = document.getElementById('records-count');
const btnExport = document.getElementById('btn-export');
const btnSeedTest = document.getElementById('btn-seed-test');

const ITEM_STATUSES = ['holding', 'returned', 'sold'];
const recordsSort = { field: 'date', dir: 'desc' };
let recordsSearchQuery = '';

function esc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

let toastTimer;
function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'show' + (type ? ' ' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 3000);
}

function compareForSort(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

function sortRows(rows, state, accessors) {
  const getter = accessors[state.field];
  if (!getter) return rows;
  const sorted = [...rows].sort((r1, r2) => compareForSort(getter(r1), getter(r2)));
  return state.dir === 'desc' ? sorted.reverse() : sorted;
}

function toggleSort(state, field) {
  if (state.field === field) {
    state.dir = state.dir === 'asc' ? 'desc' : 'asc';
  } else {
    state.field = field;
    state.dir = 'desc';
  }
}

function sortTh(label, field, state, table) {
  const arrow = state.field === field ? `<span class="sort-arrow">${state.dir === 'asc' ? '▲' : '▼'}</span>` : '';
  return `<th class="sortable" data-table="${table}" data-field="${field}">${esc(label)}${arrow}</th>`;
}

function recordMatchesSearch(r, query) {
  if (!query) return true;
  const haystack = [r.uniqueId, r.name, r.item, r.brand, r.size, r.color, r.subVendor, r.tagColor, r.location]
    .join(' ').toLowerCase();
  return haystack.includes(query);
}

function statusLabel(status) {
  const s = status || 'holding';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function renderRecordsList(records) {
  const query = recordsSearchQuery.trim().toLowerCase();
  const filtered = records.filter(r => recordMatchesSearch(r, query));
  recordsCount.textContent = records.length ? `Records (${query ? `${filtered.length} of ` : ''}${records.length})` : 'Records';

  if (!records.length) {
    recordsList.innerHTML = '<div class="empty-state">No records yet — scan a tag to get started.</div>';
    return;
  }
  if (!filtered.length) {
    recordsList.innerHTML = '<div class="empty-state">No records match your search.</div>';
    return;
  }

  const rows = sortRows(filtered, recordsSort, {
    id: r => r.uniqueId || '',
    item: r => r.item || r.name || '',
    subVendor: r => r.subVendor || '',
    price: r => parseFloat(r.price) || 0,
    quantity: r => parseInt(r.quantity, 10) || 0,
    location: r => r.location || '',
    date: r => new Date(r.createdAt).getTime() || 0,
    status: r => r.status || 'holding'
  });

  recordsList.innerHTML = `
    <div class="sales-report-table-wrap">
      <table class="sales-report-table">
        <thead><tr>
          ${sortTh('ID', 'id', recordsSort, 'records')}
          ${sortTh('Item', 'item', recordsSort, 'records')}
          ${sortTh('Sub-vendor', 'subVendor', recordsSort, 'records')}
          ${sortTh('Price', 'price', recordsSort, 'records')}
          ${sortTh('Qty', 'quantity', recordsSort, 'records')}
          ${sortTh('Location', 'location', recordsSort, 'records')}
          ${sortTh('Date', 'date', recordsSort, 'records')}
          ${sortTh('Status', 'status', recordsSort, 'records')}
          <th></th>
        </tr></thead>
        <tbody>${rows.map(r => { const status = r.status || 'holding'; return `
          <tr class="record-row" data-id="${esc(r.id)}">
            <td>${esc(r.uniqueId || '—')}</td>
            <td>${esc(r.item || r.name || '(no name)')}</td>
            <td>${esc(r.subVendor || '—')}</td>
            <td>${r.price ? `$${esc(r.price)}` : '—'}</td>
            <td>${esc(r.quantity || '—')}</td>
            <td>${esc(r.location || '—')}</td>
            <td>${new Date(r.createdAt).toLocaleDateString()}</td>
            <td>
              <select class="status-select status-${status}" data-id="${esc(r.id)}">
                ${ITEM_STATUSES.map(s => `<option value="${s}" ${s === status ? 'selected' : ''}>${statusLabel(s)}</option>`).join('')}
              </select>
            </td>
            <td><button class="record-btn delete" data-id="${esc(r.id)}" title="Delete">✕</button></td>
          </tr>
        `; }).join('')}</tbody>
      </table>
    </div>
  `;
}

async function loadRecords() {
  try {
    renderRecordsList(await getRecords());
  } catch (err) {
    recordsList.innerHTML = `<div class="empty-state">Couldn't load records: ${esc(err.message)}. <a href="/">Back to the scanner</a> to log in with a location code.</div>`;
  }
}

recordsList.addEventListener('click', async e => {
  const th = e.target.closest('th.sortable');
  if (th && th.dataset.table === 'records') {
    toggleSort(recordsSort, th.dataset.field);
    renderRecordsList(getCachedRecords());
    return;
  }

  if (e.target.closest('.status-select')) return;

  const btn = e.target.closest('.record-btn');
  const row = e.target.closest('.record-row');
  if (!row) return;
  const id = row.dataset.id;

  if (btn?.classList.contains('delete')) {
    try {
      await deleteRecord(id);
    } catch (err) {
      toast('Failed to delete: ' + err.message, 'error');
    }
    renderRecordsList(getCachedRecords());
    return;
  }

  if (!btn) location.href = `/?record=${encodeURIComponent(id)}`;
});

recordsList.addEventListener('change', async e => {
  const select = e.target.closest('.status-select');
  if (!select) return;
  const id = select.dataset.id;
  const newStatus = select.value;
  const record = getCachedRecords().find(r => r.id === id);
  const oldStatus = (record && record.status) || 'holding';

  // Sold/Returned are "settled" states - changing away from either is
  // more likely to be a misclick, so confirm first.
  if ((oldStatus === 'sold' || oldStatus === 'returned') && newStatus !== oldStatus) {
    if (!window.confirm(`This item is marked "${statusLabel(oldStatus)}". Change it to "${statusLabel(newStatus)}"?`)) {
      select.value = oldStatus;
      return;
    }
  }

  try {
    await updateRecord(id, { status: newStatus });
  } catch (err) {
    toast('Failed to update status: ' + err.message, 'error');
  }
  renderRecordsList(getCachedRecords());
});

recordsSearchInput.addEventListener('input', () => {
  recordsSearchQuery = recordsSearchInput.value;
  renderRecordsList(getCachedRecords());
});

btnExport.addEventListener('click', async () => {
  exportCSV(await getRecords());
  toast('CSV downloaded', 'success');
});

if (['localhost', '127.0.0.1'].includes(window.location.hostname)) {
  btnSeedTest.style.display = '';
}

btnSeedTest.addEventListener('click', async () => {
  const sampleRecords = [
    { uniqueId: '', name: 'Kitty Button', price: '8.00', quantity: '5', location: 'Bin A' },
    { uniqueId: '', name: 'Star Button', price: '6.50', quantity: '3', location: 'Bin A' },
    { uniqueId: '', name: 'Floral Button', price: '10.00', quantity: '2', location: 'Bin B' }
  ];
  for (const record of sampleRecords) await saveRecord(record);
  renderRecordsList(getCachedRecords());
  toast('Seeded 3 test records', 'success');
});

loadRecords();
