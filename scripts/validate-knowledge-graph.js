'use strict';

const fs = require('node:fs');
const path = require('node:path');

const graphPath = path.resolve(__dirname, '../data/knowledge/knowledge-graph-fa.json');
const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
const errors = [];
const warnings = [];

const fail = message => errors.push(message);
const nodeTypes = new Set(graph.node_types || []);
const axes = new Set((graph.axes || []).map(axis => axis.id));
const relationSpecs = new Map((graph.relation_types || []).map(item => [item.id, item]));
const nodes = new Map();

if (graph.schema_version !== '1.0.0') fail('Unsupported schema_version.');
if (!graph.graph_id || !graph.graph_version) fail('Missing graph_id or graph_version.');
if (!Array.isArray(graph.nodes) || !Array.isArray(graph.relations)) fail('nodes and relations must be arrays.');

for (const node of graph.nodes || []) {
  if (!node.id || typeof node.id !== 'string') { fail('Node without a string id.'); continue; }
  if (nodes.has(node.id)) fail('Duplicate node id: ' + node.id);
  nodes.set(node.id, node);
  if (!nodeTypes.has(node.node_type)) fail('Unknown node_type on ' + node.id + ': ' + node.node_type);
  if (!axes.has(node.axis)) fail('Unknown axis on ' + node.id + ': ' + node.axis);
  if (typeof node.label !== 'string' || !node.label.trim()) fail('Missing label on ' + node.id);
  if (node.aliases != null && !Array.isArray(node.aliases)) fail('aliases must be an array on ' + node.id);
  if (node.node_type === 'evidence_source' && node.url != null && !(node.url.startsWith('https://') || node.url.startsWith('http://'))) fail('Evidence URL must be absolute or null: ' + node.id);
}

const dkpReferences = new Map();
for (const node of nodes.values()) {
  if (node.node_type !== 'product_observation' && node.node_type !== 'product_candidate') continue;
  const dkp = node.product_id || node.candidate_product_id;
  if (!/^dkp-\d+$/.test(String(dkp || ''))) fail('Invalid DKP reference on ' + node.id);
  if (dkpReferences.has(dkp)) fail('Duplicate DKP reference: ' + dkp);
  dkpReferences.set(dkp, node.id);
  if (node.availability_status !== 'unknown') fail('Product availability must remain unknown until live verification: ' + node.id);
  if (node.node_type === 'product_observation') {
    if (node.identity_status !== 'affiliate_redirect_target_identified') fail('Unexpected product identity status: ' + node.id);
    if (!/^https:\/\/www\.digikala\.com\/product\/dkp-\d+\/$/.test(node.digikala_url || '')) fail('Invalid canonical product URL: ' + node.id);
  } else {
    if (node.identity_status !== 'unverified_candidate') fail('Candidate node must be marked unverified: ' + node.id);
    if (node.digikala_url !== null) fail('Unverified candidate must not expose a verified Digikala URL: ' + node.id);
  }
}

const relationIds = new Set();
const relationCounts = new Set();
for (const relation of graph.relations || []) {
  if (relationIds.has(relation.id)) fail('Duplicate relation id: ' + relation.id);
  relationIds.add(relation.id);
  if (relation.source === relation.target) fail('Self-referential relation: ' + relation.id);
  const source = nodes.get(relation.source);
  const target = nodes.get(relation.target);
  if (!source) { fail('Dangling relation source: ' + relation.id + ' -> ' + relation.source); continue; }
  if (!target) { fail('Dangling relation target: ' + relation.id + ' -> ' + relation.target); continue; }
  const spec = relationSpecs.get(relation.type);
  if (!spec) { fail('Unknown relation type: ' + relation.type); continue; }
  const allowedFrom = spec.from.split('|');
  const allowedTo = spec.to.split('|');
  if (!allowedFrom.includes(source.node_type)) fail('Invalid source type for ' + relation.type + ': ' + relation.id);
  if (!allowedTo.includes(target.node_type)) fail('Invalid target type for ' + relation.type + ': ' + relation.id);
  const signature = relation.source + '|' + relation.target + '|' + relation.type;
  if (relationCounts.has(signature)) fail('Duplicate semantic relation: ' + signature);
  relationCounts.add(signature);
}

for (const node of nodes.values()) {
  if (node.node_type !== 'product_observation' && node.node_type !== 'product_candidate') continue;
  const outgoing = (graph.relations || []).filter(relation => relation.source === node.id);
  for (const required of ['classified_as','used_in','serves_application','has_evidence']) {
    if (!outgoing.some(relation => relation.type === required)) fail('Product node missing required relation ' + required + ': ' + node.id);
  }
  if (!outgoing.some(relation => relation.type === 'has_evidence' && nodes.get(relation.target)?.node_type === 'evidence_source')) {
    fail('Product node missing evidence source: ' + node.id);
  }
}

for (const relation of graph.relations || []) {
  if (relation.type === 'discovery_route_in_store') {
    if (!relation.evidence_id || !nodes.has(relation.evidence_id)) fail('Store discovery route missing valid evidence_id: ' + relation.id);
    if (relation.confidence === 'low' && !relation.note) warnings.push('Low-confidence route has no note: ' + relation.id);
  }
  if (relation.type === 'has_evidence' && nodes.get(relation.target)?.node_type !== 'evidence_source') {
    fail('has_evidence must point to evidence_source: ' + relation.id);
  }
}

if (errors.length) {
  console.error('Knowledge graph validation failed:');
  for (const item of errors) console.error(' - ' + item);
  process.exitCode = 1;
} else {
  const products = [...nodes.values()].filter(node => node.node_type === 'product_observation').length;
  const candidates = [...nodes.values()].filter(node => node.node_type === 'product_candidate').length;
  console.log('Knowledge graph validation passed.');
  console.log('Nodes: ' + nodes.size + ' | Relations: ' + graph.relations.length);
  console.log('Product observations: ' + products + ' | Unverified candidates: ' + candidates);
  console.log('Warnings: ' + warnings.length);
}
