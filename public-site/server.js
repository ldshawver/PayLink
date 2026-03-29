const express = require('express');
const http = require('http');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const APP_PORT = 8000;

// ── Proxy helper ────────────────────────────────────────────────────────────
// Forwards any request to the Node app on port 8000 and pipes the response
// back. This ensures /api/*, /app/*, /login, /clock-in, etc. always reach
// the app regardless of the Nginx routing state.
function proxyToApp(req, res) {
  const options = {
    hostname: '127.0.0.1',
    port: APP_PORT,
    path: req.url,
    method: req.method,
    headers: {
      ...req.headers,
      host: req.headers.host || 'mypaylink.app',
    },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on('error', (err) => {
    console.error('[proxy] Error forwarding to app:', err.message);
    res.status(502).json({ error: 'App unavailable', message: err.message });
  });

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    req.pipe(proxyReq, { end: true });
  } else {
    proxyReq.end();
  }
}

// ── Cache headers ────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path === '/' || !req.path.includes('.')) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  } else {
    res.setHeader('Cache-Control', 'public, max-age=86400');
  }
  next();
});

// ── App routes → proxy to port 8000 ─────────────────────────────────────────
// These mirror the Nginx proxy_pass rules. If Nginx is routing correctly this
// code is never reached; if Nginx sends these to port 3000, we proxy them on.
const APP_PREFIXES = [
  '/api/',
  '/app/',
  '/uploads/',
  '/portal/',
  '/pay/',
  '/payments/',
  '/stripe/',
  '/webhooks/',
  '/demo/',
];

const APP_EXACT = ['/login', '/clock-in', '/health', '/ready', '/signing-complete'];

app.use((req, res, next) => {
  const { url } = req;
  if (
    APP_EXACT.includes(url.split('?')[0]) ||
    APP_PREFIXES.some((prefix) => url.startsWith(prefix))
  ) {
    return proxyToApp(req, res);
  }
  next();
});

// ── Static marketing files ────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── Named marketing pages ─────────────────────────────────────────────────────
app.get('/clock', (req, res) => {
  res.redirect(301, '/clock-in');
});

app.get('/docs/guide', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'docs', 'paylink-guide.html'));
});

const pages = ['features', 'pricing', 'security', 'contact', 'vendor-portal', 'terms', 'privacy', 'signup', 'demo'];
pages.forEach((page) => {
  app.get('/' + page, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', page + '.html'));
  });
});

// ── SPA fallback ──────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`PayLink public site running on port ${PORT}`);
  console.log(`Proxying app routes to 127.0.0.1:${APP_PORT}`);
});
