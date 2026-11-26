'use strict';

const graph = require('../../data/knowledge/knowledge-graph-fa.json');

function normalizeFa(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[يى]/g, 'ی')
    .replace(/[ك]/g, 'ک')
    .replace(/[\u200c\u200f\u200e\u200b]/g, ' ')
    .replace(/[ًٌٍَُِّْ]/g, '')
    .replace(/[.,،؛:()[\]{}"'«»!?؟]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const nodeById = new Map(graph.nodes.map(node => [node.id, node]));
const relationByNode = new Map();

for (const relation of graph.relations) {
  for (const nodeId of [relation.source, relation.target]) {
    if (!relationByNode.has(nodeId)) relationByNode.set(nodeId, []);
    relationByNode.get(nodeId).push(relation);
  }
}

function getGraph() {
  return graph;
}

function getSummary() {
  const nodeTypes = {};
  const axes = {};
  const relationTypes = {};
  for (const node of graph.nodes) {
    nodeTypes[node.node_type] = (nodeTypes[node.node_type] || 0) + 1;
    axes[node.axis] = (axes[node.axis] || 0) + 1;
  }
  for (const relation of graph.relations) {
    relationTypes[relation.type] = (relationTypes[relation.type] || 0) + 1;
  }

  return {
    graph_id: graph.graph_id,
    graph_version: graph.graph_version,
    schema_version: graph.schema_version,
    status: graph.status,
    generated_at: graph.generated_at,
    counts: {
      nodes: graph.nodes.length,
      relations: graph.relations.length,
      products: graph.nodes.filter(node => node.node_type === 'product_observation').length,
      product_candidates: graph.nodes.filter(node => node.node_type === 'product_candidate').length,
      unresolved_concepts: graph.nodes.filter(node => node.node_type === 'concept' && node.status === 'needs_store_evidence').length,
      topics: graph.nodes.filter(node => node.node_type === 'topic').length,
    },
    node_types: nodeTypes,
    axes,
    relation_types: relationTypes,
    availability_policy: graph.availability_policy,
  };
}

function productSummary(node) {
  return {
    node_id: node.id,
    node_type: node.node_type,
    title: node.label,
    product_id: node.product_id || null,
    candidate_product_id: node.candidate_product_id || null,
    identity_status: node.identity_status,
    evidence_status: node.evidence_status,
    availability_status: node.availability_status,
    digikala_url: node.digikala_url || null,
  };
}

function collectRelatedProducts(node) {
  if (node.node_type === 'product_observation' || node.node_type === 'product_candidate') return [node];

  const productIds = new Set();
  for (const relation of relationByNode.get(node.id) || []) {
    const sourceNode = nodeById.get(relation.source);
    const targetNode = nodeById.get(relation.target);
    if (sourceNode && ['product_observation', 'product_candidate'].includes(sourceNode.node_type)) productIds.add(sourceNode.id);
    if (targetNode && ['product_observation', 'product_candidate'].includes(targetNode.node_type)) productIds.add(targetNode.id);
  }
  return [...productIds].map(id => nodeById.get(id)).filter(Boolean);
}

function collectPaths(node) {
  const output = [];
  for (const relation of relationByNode.get(node.id) || []) {
    const otherId = relation.source === node.id ? relation.target : relation.source;
    const other = nodeById.get(otherId);
    if (!other || ['evidence_source', 'product_observation', 'product_candidate'].includes(other.node_type)) continue;
    output.push({
      relation: relation.type,
      node_id: other.id,
      node_type: other.node_type,
      axis: other.axis,
      label: other.label,
      confidence: relation.confidence || null,
    });
  }
  return output;
}

function searchKnowledge(query, options = {}) {
  const normalizedQuery = normalizeFa(query);
  if (!normalizedQuery) {
    return { query: String(query || ''), total: 0, results: [], error: 'عبارت جست‌وجو خالی است.' };
  }

  const allowedAxes = new Set(graph.axes.map(axis => axis.id));
  const axis = options.axis && allowedAxes.has(options.axis) ? options.axis : null;
  const limit = Math.max(1, Math.min(Number(options.limit) || 20, 50));
  const searchableTypes = new Set([
    'topic', 'concept', 'system', 'application', 'technical_feature',
    'store_category', 'product_observation', 'product_candidate'
  ]);

  const matches = [];
  for (const node of graph.nodes) {
    if (!searchableTypes.has(node.node_type)) continue;
    if (axis && node.axis !== axis) continue;

    const label = normalizeFa(node.label);
    const aliases = Array.isArray(node.aliases) ? node.aliases.map(normalizeFa) : [];
    const description = normalizeFa(node.description || '');
    const idText = normalizeFa(node.id);
    let score = 0;
    let matchedBy = '';

    if (label === normalizedQuery) {
      score = 100; matchedBy = 'label_exact';
    } else if (aliases.includes(normalizedQuery)) {
      score = 95; matchedBy = 'alias_exact';
    } else if (label.includes(normalizedQuery)) {
      score = 80; matchedBy = 'label_contains';
    } else if (aliases.some(alias => alias.includes(normalizedQuery))) {
      score = 75; matchedBy = 'alias_contains';
    } else if (description.includes(normalizedQuery) || idText.includes(normalizedQuery)) {
      score = 45; matchedBy = 'description_or_id';
    }

    if (!score) continue;
    matches.push({
      node_id: node.id,
      node_type: node.node_type,
      axis: node.axis,
      label: node.label,
      description: node.description || null,
      aliases: node.aliases || [],
      status: node.status || node.evidence_status || null,
      score,
      matched_by: matchedBy,
      paths: collectPaths(node),
      related_products: collectRelatedProducts(node).slice(0, 12).map(productSummary),
    });
  }

  const typePriority = {
    topic: -1,
    concept: 0,
    system: 1,
    application: 2,
    technical_feature: 3,
    store_category: 4,
    product_observation: 5,
    product_candidate: 6,
  };
  matches.sort((a, b) =>
    b.score - a.score ||
    (typePriority[a.node_type] ?? 99) - (typePriority[b.node_type] ?? 99) ||
    a.label.localeCompare(b.label, 'fa')
  );
  return {
    query: String(query),
    normalized_query: normalizedQuery,
    axis: axis || null,
    graph_version: graph.graph_version,
    total: matches.length,
    results: matches.slice(0, limit),
  };
}

module.exports = { getGraph, getSummary, searchKnowledge, normalizeFa };
