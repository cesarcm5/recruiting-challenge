const totalOrdersEl = document.getElementById('total-orders');
const uniqueCustomersEl = document.getElementById('unique-customers');
const avgOrderEl = document.getElementById('avg-order');
const revenue30dEl = document.getElementById('revenue-30d');
const ordersTbody = document.getElementById('orders-tbody');
const merchantNameEl = document.getElementById('merchant-name');
const logoutBtn = document.getElementById('logout');

const token = localStorage.getItem('auth_token');
if (!token) {
  window.location.href = '/login.html';
}

const merchant = (() => {
  try {
    return JSON.parse(localStorage.getItem('auth_merchant') ?? 'null');
  } catch {
    return null;
  }
})();
if (merchant) merchantNameEl.textContent = `${merchant.name} (${merchant.id})`;

function logout() {
  localStorage.removeItem('auth_token');
  localStorage.removeItem('auth_merchant');
  window.location.href = '/login.html';
}

logoutBtn.addEventListener('click', logout);

async function api(path) {
  const res = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    logout();
    throw new Error('unauthorized');
  }
  return res.json();
}

function money(cents) {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

async function refresh() {
  const summary = await api('/api/metrics/summary');
  totalOrdersEl.textContent = summary.total_orders ?? '—';
  uniqueCustomersEl.textContent = summary.unique_customers ?? '—';
  avgOrderEl.textContent = money(summary.avg_order_value_cents ?? 0);

  const now = new Date();
  const thirtyAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const revenue = await api(`/api/revenue?from=${isoDate(thirtyAgo)}&to=${isoDate(now)}`);
  revenue30dEl.textContent = money(revenue.revenue_cents ?? 0);

  const ordersRes = await api('/api/orders?limit=10');
  ordersTbody.innerHTML = '';
  for (const o of ordersRes.orders ?? []) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${new Date(o.created_at).toLocaleDateString()}</td>
      <td>${o.customer_email}</td>
      <td>${o.type}</td>
      <td>${money(o.total_amount)}</td>
    `;
    ordersTbody.appendChild(tr);
  }
}

refresh().catch((err) => {
  if (err.message !== 'unauthorized') console.error(err);
});
