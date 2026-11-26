'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { server } = require('../server');

let baseUrl;

test.before(async () => {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  baseUrl = 'http://127.0.0.1:' + address.port;
});

test.after(async () => {
  if (server.listening) await new Promise(resolve => server.close(resolve));
});

test('health endpoint reports the knowledge graph version', async () => {
  const response = await fetch(baseUrl + '/api/health');
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.knowledgeGraphVersion, '1.1.0');
});

test('affiliate configuration stays disabled until publisher and media are approved', async () => {
  const response = await fetch(baseUrl + '/api/affiliate/config');
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.program, 'affilio');
  assert.equal(payload.publisher_status, 'not_registered');
  assert.equal(payload.media_status, 'not_submitted');
  assert.equal(payload.tracking_enabled, false);
  assert.deepEqual(payload.tracked_links, {});
});

test('knowledge summary endpoint returns graph counts and axes', async () => {
  const response = await fetch(baseUrl + '/api/knowledge');
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.ok(payload.counts.nodes > 100);
  assert.equal(payload.counts.topics, 13);
  assert.ok(payload.axes.topic > 0);
  assert.ok(payload.axes.nature > 0);
  assert.ok(payload.axes.system > 0);
});

test('knowledge search endpoint returns separated greenhouse products', async () => {
  const response = await fetch(baseUrl + '/api/knowledge/search?q=' + encodeURIComponent('گلخانه'));
  const payload = await response.json();
  assert.equal(response.status, 200);
  const greenhouse = payload.results.find(item => item.node_id === 'system.greenhouse');
  assert.ok(greenhouse);
  assert.ok(greenhouse.related_products.some(item => item.product_id === 'dkp-7669891'));
});

test('knowledge search can discover broad topic headings', async () => {
  const response = await fetch(baseUrl + '/api/knowledge/search?q=' + encodeURIComponent('فناوری'));
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.ok(payload.results.some(item => item.node_id === 'topic.technology'));
});

test('knowledge search rejects invalid axes and empty queries', async () => {
  const invalidAxis = await fetch(baseUrl + '/api/knowledge/search?q=' + encodeURIComponent('موتور') + '&axis=unknown');
  assert.equal(invalidAxis.status, 400);
  const empty = await fetch(baseUrl + '/api/knowledge/search');
  assert.equal(empty.status, 400);
});

test('full graph endpoint returns versioned nodes and relations', async () => {
  const response = await fetch(baseUrl + '/api/knowledge/graph');
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.graph_version, '1.1.0');
  assert.ok(payload.nodes.length > 100);
  assert.ok(payload.relations.length > 100);
});
