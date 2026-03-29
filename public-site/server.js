const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

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

app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.get('/clock', (req, res) => {
  res.redirect(301, '/clock-in');
});

const pages = ['features', 'pricing', 'security', 'contact', 'vendor-portal', 'terms', 'privacy', 'signup', 'demo'];

app.get('/docs/guide', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'docs', 'paylink-guide.html'));
});

pages.forEach(page => {
  app.get('/' + page, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', page + '.html'));
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`PayLink public site running on port ${PORT}`);
});
