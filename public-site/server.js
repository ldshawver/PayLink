const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const pages = ['features', 'pricing', 'security', 'contact', 'vendor-portal', 'clock', 'terms', 'privacy'];

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
