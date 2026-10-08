'use strict';

// AI Gang web deployment-target boilerplate.
//
// Deliberately minimal, but real: a working Express server serving a
// static page and a health endpoint, the same role `expo init`/
// `tauri create` play for their targets — a genuine starting point a new
// project can build on immediately, not placeholder content.
//
// Exported (rather than only self-invoked) so test/server.test.js can
// mount it on an ephemeral port without a separate process.

const path = require('node:path');
const express = require('express');

function createApp() {
  const app = express();
  app.use(express.static(path.join(__dirname, 'public')));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  return app;
}

function start(port = process.env.PORT || 3000) {
  const app = createApp();
  return app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`hello-web listening on http://localhost:${port}`);
  });
}

if (require.main === module) {
  start();
}

module.exports = { createApp, start };
