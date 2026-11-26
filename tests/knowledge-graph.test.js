'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getGraph, getSummary, searchKnowledge, normalizeFa } = require('../src/knowledge/knowledge-service');

test('graph has stable version and populated multidimensional axes', () => {
  const graph = getGraph();
  const summary = getSummary();
  assert.equal(graph.graph_version, '1.1.0');
  assert.equal(summary.counts.topics, 13);
  assert.ok(summary.counts.nodes > 100);
  assert.ok(summary.counts.relations > 100);
  assert.ok(summary.axes.nature > 0);
  assert.ok(summary.axes.system > 0);
  assert.ok(summary.axes.application > 0);
  assert.ok(summary.axes.store_taxonomy > 0);
});

test('first discovery layer uses broad topic headings, not store subcategories', () => {
  const graph = getGraph();
  const topics = graph.nodes.filter(node => node.node_type === 'topic').sort((a, b) => a.display_order - b.display_order);
  assert.equal(topics.length, 13);
  assert.equal(topics[0].label, 'فناوری و ارتباطات');
  const mobility = topics.find(node => node.id === 'topic.mobility');
  assert.ok(mobility);
  assert.ok(graph.relations.some(edge => edge.type === 'topic_contains' && edge.source === mobility.id && edge.target === 'store.root.09'));
  assert.ok(!topics.some(node => node.id === 'store.root.09'));
  const motorcycle = graph.nodes.find(node => node.axis === 'store_taxonomy' && node.label === 'موتورسیکلت');
  assert.ok(motorcycle);
  assert.ok(graph.relations.some(edge => edge.type === 'child_of' && edge.source === motorcycle.id && edge.target === 'store.root.09'));
});

test('topic aliases are indexed by semantic search', () => {
  const result = searchKnowledge('فناوری');
  assert.ok(result.results.some(item => item.node_id === 'topic.technology'));
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
