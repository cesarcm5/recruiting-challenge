const form = document.getElementById('login-form');
const errorEl = document.getElementById('error');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.textContent = '';
  const merchantId = document.getElementById('merchant-id').value.trim();
  const password = document.getElementById('password').value;
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ merchant_id: merchantId, password }),
    });
    if (!res.ok) {
      errorEl.textContent = res.status === 401 ? 'Invalid credentials' : 'Login failed';
      return;
    }
    const body = await res.json();
    localStorage.setItem('auth_token', body.token);
    localStorage.setItem('auth_merchant', JSON.stringify(body.merchant));
    window.location.href = '/';
  } catch {
    errorEl.textContent = 'Network error';
  }
});
