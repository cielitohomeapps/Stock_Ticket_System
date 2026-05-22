require('dotenv').config();
const fetch = global.fetch;
const token = process.env.INVENTORY_STATIC_BEARER_TOKEN;
const productId = 'jUE9sZN7vhxKiGTdoATi';
const base = (process.env.INVENTORY_API_BASE_URL || 'https://cielitohome-storage-backend.onrender.com/api').replace(/\/$/, '');
const endpoints = [
  {method: 'GET', url: `${base}/productos/${productId}`},
  {method: 'POST', url: `${base}/productos/${productId}/descontar`, body: {cantidad: 1}},
];

(async () => {
  console.log('BASE', base);
  console.log('TOKEN LENGTH', token ? token.length : 'no token');
  for (const ep of endpoints) {
    try {
      const resp = await fetch(ep.url, {
        method: ep.method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: ep.body ? JSON.stringify(ep.body) : undefined,
      });
      const text = await resp.text();
      console.log('---', ep.method, ep.url, 'status', resp.status);
      console.log(text);
    } catch (e) {
      console.error('ERR', e.message);
    }
  }
})();
