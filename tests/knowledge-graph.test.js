'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getGraph, getSummary, searchKnowledge, normalizeFa } = require('../src/knowledge/knowledge-service');

test('graph has stable version and populated multidimensional axes', () => {
  const graph = getGraph();
  const summary = getSummary();
  assert.equal(graph.graph_version, '1.0.0');
  assert.ok(summary.counts.nodes > 100);
  assert.ok(summary.counts.relations > 100);
  assert.ok(summary.axes.nature > 0);
  assert.ok(summary.axes.system > 0);
  assert.ok(summary.axes.application > 0);
  assert.ok(summary.axes.store_taxonomy > 0);
});

test('Persian normalization unifies Arabic and Persian character variants', () => {
  assert.equal(normalizeFa('موتور كولر'), normalizeFa('موتور کولر'));
  assert.equal(normalizeFa('استپر‌موتور'), normalizeFa('استپر موتور'));
});

test('search for motor returns multiple semantic concepts instead of one flat product bucket', () => {
  const result = searchKnowledge('موتور');
  assert.ok(result.total > 0);
  const ids = result.results.map(item => item.node_id);
  assert.ok(ids.includes('concept.generator'));
  assert.ok(ids.includes('concept.electric-motor') || ids.includes('concept.motion-power'));
});

test('search distinguishes automotive idle stepper from industrial stepper', () => {
  const result = searchKnowledge('استپر موتور');
  const ids = result.results.map(item => item.node_id);
  assert.ok(ids.includes('concept.automotive-idle-stepper'));
  assert.ok(ids.includes('concept.industrial-stepper'));
});

test('greenhouse search exposes the collection route and evidenced product observations', () => {
  const result = searchKnowledge('گلخانه');
  assert.ok(result.total > 0);
  const greenhouse = result.results.find(item => item.node_id === 'system.greenhouse');
  assert.ok(greenhouse);
  assert.ok(greenhouse.related_products.some(product => product.product_id === 'dkp-7669891'));
});

test('unverified candidate is never represented as an available or verified product', () => {
  const graph = getGraph();
  const candidate = graph.nodes.find(node => node.node_type === 'product_candidate');
  assert.ok(candidate);
  assert.equal(candidate.identity_status, 'unverified_candidate');
  assert.equal(candidate.availability_status, 'unknown');
  assert.equal(candidate.digikala_url, null);
});
