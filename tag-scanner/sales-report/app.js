// Standalone Sales Report page - previously a modal in the main app
// (js/app.js), moved out to its own route so it's reachable/bookmarkable
// on its own and doesn't depend on the scanning page's state. Logic is
// otherwise unchanged from the modal version.

import { getSales, getRecords } from '../js/storage.js';

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

const salesReportSummary = document.getElementById('sales-report-summary');
const salesReportList = document.getElementById('sales-report-list');
const btnSalesReportExport = document.getElementById('btn-sales-report-export');
const salesReportFilterVendor = document.getElementById('sales-report-filter-vendor');
const salesReportFilterMethod = document.getElementById('sales-report-filter-method');
const btnSalesReportViewSale = document.getElementById('btn-sales-report-view-sale');
const btnSalesReportViewItem = document.getElementById('btn-sales-report-view-item');

// allSales: every sale fetched from the server for this location, unfiltered.
// visibleSales: allSales after the vendor/method filters + sort are
// applied - this is what's actually on screen in "By Sale" view, and what
// CSV export sends in that view, so exporting always matches what you're
// looking at rather than silently exporting everything regardless of the
// filters shown.
let allSales = [];
let visibleSales = [];
let allItems = []; // current inventory - used by "By Item" view to know what never sold.
let salesReportView = 'sale'; // 'sale' or 'item'
let soldRowsForExport = [];
let unsoldRowsForExport = [];

const PAYMENT_METHOD_LABELS = { cash: 'Cash', venmo: 'Venmo', card: 'Card (Terminal)', other: 'Other / Quick Sale' };
const NO_SUB_VENDOR = '(no sub-vendor)';

function paymentMethodLabel(method) {
  return PAYMENT_METHOD_LABELS[method] || method;
}

function populateSalesReportVendorFilter(sales) {
  const vendors = new Set();
  for (const sale of sales) {
    for (const item of sale.items) {
      if (item.subVendor) vendors.add(item.subVendor);
    }
  }
  const current = salesReportFilterVendor.value;
  salesReportFilterVendor.innerHTML = '<option value="">All sub-vendors</option>' +
    Array.from(vendors).sort().map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
  if (vendors.has(current)) salesReportFilterVendor.value = current;
}

// Sortable-table headers - one state object per table (each table's
// columns are independent, so clicking "Total" on the sale table doesn't
// touch the Sold/Unsold tables' own sort). Clicking an unsorted column
// sorts it descending first (newest/highest first reads as the more
// useful default for both dates and money); clicking the already-active
// column flips direction instead of resetting it.
let saleTableSort = { field: 'date', dir: 'desc' };
let soldTableSort = { field: 'revenue', dir: 'desc' };
let unsoldTableSort = { field: 'name', dir: 'asc' };

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

// One delegated listener handles every sortable header across all three
// tables (sale/sold/unsold) - innerHTML gets fully replaced on every
// render, so listeners bound to individual <th> elements would be lost;
// binding once to the container that survives re-renders avoids that.
salesReportList.addEventListener('click', e => {
  const th = e.target.closest('th.sortable');
  if (!th) return;
  const { table, field } = th.dataset;
  if (table === 'sale') toggleSort(saleTableSort, field);
  else if (table === 'sold') toggleSort(soldTableSort, field);
  else if (table === 'unsold') toggleSort(unsoldTableSort, field);
  applySalesReportFiltersAndSort();
});

function applySalesReportFiltersAndSort() {
  const vendor = salesReportFilterVendor.value;
  const method = salesReportFilterMethod.value;

  visibleSales = allSales.filter(sale =>
    (!method || sale.paymentMethod === method) &&
    (!vendor || sale.items.some(item => item.subVendor === vendor))
  );

  renderCategoryChart(visibleSales, allItems);

  if (salesReportView === 'item') {
    renderItemPerformance(visibleSales, allItems, vendor);
  } else {
    renderSalesReport(visibleSales);
  }
}

// Sold items don't carry category on the sale snapshot itself (it's a
// current-inventory attribute, not fixed at sale time), so this joins
// back to `items` by id - same join used to answer "what sold the
// most" by hand before this chart existed. Respects whatever
// vendor/payment filters are active, same as the two existing tables.
function renderCategoryChart(sales, items) {
  const container = document.getElementById('sales-report-category-chart');
  const categoryById = new Map(items.map(it => [it.id, it.category]));
  const byCategory = {};
  for (const sale of sales) {
    for (const item of sale.items) {
      const qty = parseInt(item.quantity, 10) || 0;
      const revenue = (parseFloat(item.price) || 0) * qty;
      const cat = categoryById.get(item.id) || 'Uncategorized';
      if (!byCategory[cat]) byCategory[cat] = { qty: 0, revenue: 0 };
      byCategory[cat].qty += qty;
      byCategory[cat].revenue += revenue;
    }
  }

  const rows = Object.entries(byCategory).sort((a, b) => b[1].qty - a[1].qty);
  if (!rows.length) {
    container.innerHTML = '';
    return;
  }

  const maxQty = Math.max(...rows.map(([, v]) => v.qty));
  container.innerHTML = `
    <div class="category-chart-title">Sold by Category</div>
    ${rows.map(([cat, { qty, revenue }]) => `
      <div class="category-bar-row">
        <div class="category-bar-label">${esc(cat)}</div>
        <div class="category-bar-track"><div class="category-bar-fill" style="width:${(qty / maxQty * 100).toFixed(1)}%;"></div></div>
        <div class="category-bar-value">${qty} &middot; $${revenue.toFixed(2)}</div>
      </div>
    `).join('')}
  `;
}

// Aggregates every sale's items into total quantity sold + revenue per
// item, then cross-references current inventory to find items that have
// quantity in stock but never appear in any (filtered) sale - i.e. things
// that haven't sold. Matched by item id, which cart items already carry
// forward from the inventory record they came from (see addToCart) and
// which survives into the sale snapshot regardless of later inventory edits.
function renderItemPerformance(sales, items, vendorFilter) {
  const soldById = new Map();
  for (const sale of sales) {
    for (const item of sale.items) {
      const quantity = parseInt(item.quantity, 10) || 0;
      const revenue = (parseFloat(item.price) || 0) * quantity;
      const existing = soldById.get(item.id);
      if (existing) {
        existing.quantity += quantity;
        existing.revenue += revenue;
      } else {
        soldById.set(item.id, { name: item.name || '(no name)', uniqueId: item.uniqueId || '', subVendor: item.subVendor || '', quantity, revenue });
      }
    }
  }

  // Every item currently in stock that's never appeared in a sale -
  // regardless of whether it has a sub-vendor. Items with a sub-vendor
  // still get called out as "return to vendor" in the row itself (that's
  // the consignment-reconciliation case this was originally built for),
  // but items with no sub-vendor (the main vendor's own stock) are no
  // longer excluded - this is meant to be a full "what's sold vs. what's
  // still sitting in inventory" report, not just the consignment subset.
  const unsoldRowsRaw = items
    .filter(r => !soldById.has(r.id) && (parseInt(r.quantity, 10) || 0) > 0 && (!vendorFilter || r.subVendor === vendorFilter))
    .map(r => ({ name: r.item || r.name || '(no name)', uniqueId: r.uniqueId || '', subVendor: r.subVendor || '', quantity: parseInt(r.quantity, 10) || 0, price: r.price || '', returned: r.status === 'returned' }));

  const soldRows = sortRows(Array.from(soldById.values()), soldTableSort, {
    id: r => r.uniqueId,
    name: r => r.name,
    subVendor: r => r.subVendor,
    quantity: r => r.quantity,
    revenue: r => r.revenue
  });
  const unsoldRows = sortRows(unsoldRowsRaw, unsoldTableSort, {
    id: r => r.uniqueId,
    name: r => r.name,
    subVendor: r => r.subVendor,
    quantity: r => r.quantity,
    price: r => parseFloat(r.price) || 0
  });

  soldRowsForExport = soldRows;
  unsoldRowsForExport = unsoldRows;

  const totalSoldQty = soldRows.reduce((sum, r) => sum + r.quantity, 0);
  const totalRevenue = soldRows.reduce((sum, r) => sum + r.revenue, 0);
  salesReportSummary.innerHTML = `
    <div class="sales-report-grand-total">${soldRows.length} item${soldRows.length === 1 ? '' : 's'} sold (${totalSoldQty} unit${totalSoldQty === 1 ? '' : 's'}) · $${totalRevenue.toFixed(2)} · ${unsoldRows.length} unsold</div>
  `;

  const soldHtml = soldRows.length
    ? `
      <div class="sales-report-table-wrap">
        <table class="sales-report-table">
          <thead><tr>
            ${sortTh('ID', 'id', soldTableSort, 'sold')}
            ${sortTh('Item', 'name', soldTableSort, 'sold')}
            ${sortTh('Sub-vendor', 'subVendor', soldTableSort, 'sold')}
            ${sortTh('Qty Sold', 'quantity', soldTableSort, 'sold')}
            ${sortTh('Revenue', 'revenue', soldTableSort, 'sold')}
          </tr></thead>
          <tbody>${soldRows.map(r => `
            <tr>
              <td>${esc(r.uniqueId || '—')}</td>
              <td>${esc(r.name)}</td>
              <td>${esc(r.subVendor || '—')}</td>
              <td>${r.quantity}</td>
              <td>$${r.revenue.toFixed(2)}</td>
            </tr>
          `).join('')}</tbody>
        </table>
      </div>
    `
    : '<div class="empty-state">No items sold yet.</div>';

  const unsoldHtml = unsoldRows.length
    ? `
      <div class="sales-report-table-wrap">
        <table class="sales-report-table">
          <thead><tr>
            ${sortTh('ID', 'id', unsoldTableSort, 'unsold')}
            ${sortTh('Item', 'name', unsoldTableSort, 'unsold')}
            ${sortTh('Sub-vendor', 'subVendor', unsoldTableSort, 'unsold')}
            ${sortTh('Qty', 'quantity', unsoldTableSort, 'unsold')}
            ${sortTh('Price', 'price', unsoldTableSort, 'unsold')}
            <th>Status</th>
          </tr></thead>
          <tbody>${unsoldRows.map(r => `
            <tr>
              <td>${esc(r.uniqueId || '—')}</td>
              <td>${esc(r.name)}</td>
              <td>${esc(r.subVendor || '—')}</td>
              <td>${r.quantity}</td>
              <td>${r.price ? `$${esc(r.price)}` : '—'}</td>
              <td>${r.subVendor ? (r.returned ? 'Returned' : 'Return to vendor') : 'Unsold'}</td>
            </tr>
          `).join('')}</tbody>
        </table>
      </div>
    `
    : '<div class="empty-state">No unsold items - everything currently in stock has sold at least once.</div>';

  salesReportList.innerHTML = `
    <h3 class="sales-report-subheading">Sold</h3>
    ${soldHtml}
    <h3 class="sales-report-subheading">Unsold</h3>
    ${unsoldHtml}
  `;
}

function setSalesReportView(view) {
  salesReportView = view;
  btnSalesReportViewSale.classList.toggle('active', view === 'sale');
  btnSalesReportViewItem.classList.toggle('active', view === 'item');
  applySalesReportFiltersAndSort();
}

function renderSalesReport(sales) {
  const totalsByMethod = {};
  const totalsByVendor = {};
  let grandTotal = 0;
  for (const sale of sales) {
    grandTotal += parseFloat(sale.total) || 0;
    totalsByMethod[sale.paymentMethod] = (totalsByMethod[sale.paymentMethod] || 0) + (parseFloat(sale.total) || 0);
    for (const item of sale.items) {
      const amount = (parseFloat(item.price) || 0) * (parseInt(item.quantity, 10) || 0);
      const vendorKey = item.subVendor || NO_SUB_VENDOR;
      totalsByVendor[vendorKey] = (totalsByVendor[vendorKey] || 0) + amount;
    }
  }

  const methodBreakdown = Object.entries(totalsByMethod)
    .map(([method, amount]) => `${paymentMethodLabel(method)}: $${amount.toFixed(2)}`)
    .join(' · ');
  const vendorBreakdown = Object.entries(totalsByVendor)
    .sort((a, b) => b[1] - a[1])
    .map(([vendor, amount]) => `${vendor}: $${amount.toFixed(2)}`)
    .join(' · ');
  salesReportSummary.innerHTML = `
    <div class="sales-report-grand-total">${sales.length} sale${sales.length === 1 ? '' : 's'} · $${grandTotal.toFixed(2)}</div>
    ${methodBreakdown ? `<div class="sales-report-breakdown">${esc(methodBreakdown)}</div>` : ''}
    ${vendorBreakdown ? `<div class="sales-report-breakdown">By sub-vendor: ${esc(vendorBreakdown)}</div>` : ''}
  `;

  if (!sales.length) {
    salesReportList.innerHTML = '<div class="empty-state">No sales match these filters.</div>';
    return;
  }

  const rows = sales.map(sale => {
    const itemsSummary = sale.items
      .map(item => `${item.quantity}x ${item.name || '(no name)'}${item.subVendor ? ` (${item.subVendor})` : ''}`)
      .join(', ');
    const ids = sale.items.map(item => item.uniqueId).filter(Boolean).join(', ');
    return {
      dateValue: new Date(sale.createdAt).getTime(),
      dateText: new Date(sale.createdAt).toLocaleString(),
      ids,
      itemsSummary,
      paymentText: paymentMethodLabel(sale.paymentMethod),
      total: parseFloat(sale.total) || 0
    };
  });

  const sorted = sortRows(rows, saleTableSort, {
    date: r => r.dateValue,
    id: r => r.ids,
    items: r => r.itemsSummary,
    payment: r => r.paymentText,
    total: r => r.total
  });

  const rowsHtml = sorted.map(r => `
    <tr>
      <td>${r.dateText}</td>
      <td>${esc(r.ids || '—')}</td>
      <td class="col-wrap">${esc(r.itemsSummary)}</td>
      <td>${esc(r.paymentText)}</td>
      <td>$${r.total.toFixed(2)}</td>
    </tr>
  `).join('');

  salesReportList.innerHTML = `
    <div class="sales-report-table-wrap">
      <table class="sales-report-table">
        <thead>
          <tr>
            ${sortTh('Date', 'date', saleTableSort, 'sale')}
            ${sortTh('ID', 'id', saleTableSort, 'sale')}
            ${sortTh('Items', 'items', saleTableSort, 'sale')}
            ${sortTh('Payment', 'payment', saleTableSort, 'sale')}
            ${sortTh('Total', 'total', saleTableSort, 'sale')}
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
  `;
}

async function loadSalesReport() {
  salesReportSummary.textContent = '';
  salesReportList.innerHTML = '<div class="empty-state">Loading...</div>';
  try {
    [allSales, allItems] = await Promise.all([getSales(), getRecords()]);
  } catch (err) {
    salesReportList.innerHTML = '<div class="empty-state">Failed to load sales.</div>';
    return;
  }
  populateSalesReportVendorFilter(allSales);
  applySalesReportFiltersAndSort();
}

function exportSalesCSV(sales) {
  const rows = [['Timestamp', 'ID', 'Items', 'Sub-vendors', 'Total', 'Payment Method']];
  const sorted = sortRows(sales, saleTableSort, {
    date: s => new Date(s.createdAt).getTime(),
    id: s => s.items.map(i => i.uniqueId).filter(Boolean).join(', '),
    items: s => s.items.map(i => i.name).join(', '),
    payment: s => paymentMethodLabel(s.paymentMethod),
    total: s => parseFloat(s.total) || 0
  });
  sorted.forEach(sale => {
    const ids = sale.items.map(item => item.uniqueId).filter(Boolean).join('; ');
    const itemsSummary = sale.items.map(item => `${item.quantity}x ${item.name || '(no name)'}`).join('; ');
    const subVendors = Array.from(new Set(sale.items.map(item => item.subVendor).filter(Boolean))).join('; ');
    rows.push([
      sale.createdAt || '',
      ids,
      `"${itemsSummary.replace(/"/g, '""')}"`,
      `"${subVendors.replace(/"/g, '""')}"`,
      sale.total || '',
      paymentMethodLabel(sale.paymentMethod)
    ]);
  });
  const csv = rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sales-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportItemPerformanceCSV(soldRows, unsoldRows) {
  const rows = [['Status', 'ID', 'Item', 'Sub-vendor', 'Quantity', 'Revenue/Price']];
  soldRows.forEach(r => {
    rows.push(['Sold', r.uniqueId || '', `"${r.name.replace(/"/g, '""')}"`, `"${(r.subVendor || '').replace(/"/g, '""')}"`, r.quantity, r.revenue.toFixed(2)]);
  });
  unsoldRows.forEach(r => {
    const status = r.subVendor ? (r.returned ? 'Unsold - returned' : 'Unsold - return to vendor') : 'Unsold';
    rows.push([status, r.uniqueId || '', `"${r.name.replace(/"/g, '""')}"`, `"${(r.subVendor || '').replace(/"/g, '""')}"`, r.quantity, r.price || '']);
  });
  const csv = rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `item-performance-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

btnSalesReportViewSale.addEventListener('click', () => setSalesReportView('sale'));
btnSalesReportViewItem.addEventListener('click', () => setSalesReportView('item'));

salesReportFilterVendor.addEventListener('change', applySalesReportFiltersAndSort);
salesReportFilterMethod.addEventListener('change', applySalesReportFiltersAndSort);
btnSalesReportExport.addEventListener('click', () => {
  if (salesReportView === 'item') {
    if (!soldRowsForExport.length && !unsoldRowsForExport.length) { toast('Nothing to export', 'error'); return; }
    exportItemPerformanceCSV(soldRowsForExport, unsoldRowsForExport);
  } else {
    if (!visibleSales.length) { toast('No sales to export', 'error'); return; }
    exportSalesCSV(visibleSales);
  }
  toast('CSV downloaded', 'success');
});

loadSalesReport();
