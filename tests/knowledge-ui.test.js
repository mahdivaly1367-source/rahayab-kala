'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'public', 'knowledge-explorer.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'knowledge-explorer.css'), 'utf8');

test('homepage visibly mounts the knowledge tree before live search', () => {
  const treeIndex = html.indexOf('id="knowledgeExplorer"');
  const heroIndex = html.indexOf('<section class="hero">');
  assert.ok(treeIndex >= 0, 'knowledge explorer markup is missing');
  assert.ok(heroIndex > treeIndex, 'tree explorer must appear before the live-search hero');
  assert.match(html, /href="\/knowledge-explorer\.css"/);
  assert.match(html, /src="\/knowledge-explorer\.js"/);
});

test('tree explorer loads the graph and uses the knowledge search API', () => {
  assert.match(js, /fetch\(['"]\/api\/knowledge\/graph['"]/);
  assert.match(js, /fetch\(['"]\/api\/knowledge\/search\?/);
  assert.match(js, /graph\.axes/);
  assert.match(js, /graph\.relations/);
  assert.match(js, /id !== 'evidence'/);
});

test('tree explorer exposes the product discovery axes', () => {
  for (const axis of ['nature', 'system', 'application', 'technical_feature', 'store_taxonomy', 'product']) {
    assert.ok(js.includes(axis), 'missing axis: ' + axis);
  }
});

test('existing live product search remains available', () => {
  assert.match(html, /id="query"/);
  assert.match(html, /id="searchBtn"/);
  assert.match(html, /function search\(categoryId=null/);
  assert.match(js, /search\(\);/);
});

test('the explorer and page include responsive presentation rules', () => {
  assert.match(css, /@media\(max-width:900px\)/);
  assert.match(css, /@media\(max-width:580px\)/);
  assert.match(css, /\.kg-main\{[^}]*grid-template-columns/);
});
