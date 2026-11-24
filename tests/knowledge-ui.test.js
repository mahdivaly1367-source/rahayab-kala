'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'public', 'knowledge-explorer.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'knowledge-explorer.css'), 'utf8');
const graph = require('../data/knowledge/knowledge-graph-fa.json');

test('homepage mounts a graphical explorer instead of a vertical tree menu', () => {
  const explorerIndex = html.indexOf('id="knowledgeExplorer"');
  const liveSearchIndex = html.indexOf('<section class="hero">');
  assert.ok(explorerIndex >= 0, 'knowledge explorer is missing');
  assert.ok(liveSearchIndex > explorerIndex, 'graph explorer must appear before live search');
  assert.doesNotMatch(html, /id="discovery"|function renderDiscovery\(/, 'legacy flat discovery menu must stay removed');
  assert.match(html, /id="kgGraphViewport"/);
  assert.match(html, /id="kgGraph"/);
  assert.match(html, /href="\/knowledge-explorer\.css"/);
  assert.match(html, /src="\/knowledge-explorer\.js"/);
});

test('graph explorer loads versioned graph data and semantic search results', () => {
  assert.match(js, /fetch\(['"]\/api\/knowledge\/graph['"]/);
  assert.match(js, /fetch\(['"]\/api\/knowledge\/search\?/);
  assert.match(js, /graph\.relations/);
  assert.match(js, /graph\.axes/);
});

test('all current graph axes have a visible exploration mode', () => {
  for (const axis of ['nature', 'system', 'application', 'technical_feature', 'store_taxonomy', 'product']) {
    assert.ok(js.includes(axis), 'missing graph axis: ' + axis);
  }
  for (const axis of ['ماهیت کالا', 'مجموعه و سامانه', 'کاربرد و کارکرد', 'ویژگی فنی']) {
    assert.ok(html.includes(axis) || js.includes(axis), 'missing axis label: ' + axis);
  }
});

test('right-to-left horizontal graph supports expansion, focus and zoom', () => {
  assert.match(js, /kg-svg-link/);
  assert.match(js, /kg-svg-node/);
  assert.match(js, /expanded\.has/);
  assert.match(js, /function focusNode/);
  assert.match(js, /function zoomBy/);
  assert.match(html, /id="kgZoomIn"/);
  assert.match(html, /id="kgZoomOut"/);
  assert.match(html, /id="kgFocusButton"/);
  assert.match(css, /kg-svg-link/);
  assert.match(css, /@keyframes kgFlow/);
});

test('product evidence is not presented as confirmed stock or price', () => {
  assert.match(js, /موجودی: بررسی‌نشده/);
  assert.match(js, /قیمت: مشاهده نشده/);
  assert.match(js, /فروشنده: مشاهده نشده/);
  const candidate = graph.nodes.find(node => node.node_type === 'product_candidate');
  assert.ok(candidate, 'candidate record must remain represented separately');
  assert.equal(candidate.availability_status, 'unknown');
  assert.equal(candidate.digikala_url, null);
});

test('current knowledge graph contains several independent root families', () => {
  const nature = graph.nodes.filter(node => node.axis === 'nature');
  const systems = graph.nodes.filter(node => node.axis === 'system');
  const applications = graph.nodes.filter(node => node.axis === 'application');
  const products = graph.nodes.filter(node => node.axis === 'product');
  assert.ok(nature.length >= 25);
  assert.ok(systems.length >= 6);
  assert.ok(applications.length >= 10);
  assert.ok(products.length >= 20);
});

test('existing live product search remains available below the graph', () => {
  assert.match(html, /id="query"/);
  assert.match(html, /id="searchBtn"/);
  assert.match(html, /function search\(categoryId=null/);
  assert.match(js, /rahayabLiveSearch|searchBtn/);
});

test('graph layout remains responsive and pannable', () => {
  assert.match(css, /@media\(max-width:900px\)/);
  assert.match(css, /@media\(max-width:580px\)/);
  assert.match(css, /overflow:auto/);
  assert.match(js, /pointerdown/);
  assert.match(js, /scrollLeft/);
});


test('graph inspector loads real product photos through the local image proxy', () => {
  assert.match(html, /id="kgImageGallery"/);
  assert.match(js, /async function loadPhotoGallery/);
  assert.match(js, /fetch\('\/api\/search\?/);
  assert.match(js, /isTrustedProductImage/);
  assert.match(js, /imageProxyUrl\(product\.image\)/);
  assert.match(js, /imageByNodeId/);
  assert.match(css, /\.kg-gallery-grid/);
  assert.match(css, /\.kg-photo-frame/);
});

test('graph nodes and Persian labels use the larger image-card layout', () => {
  assert.match(js, /const nodeWidth = 276/);
  assert.match(js, /const nodeHeight = 88/);
  assert.match(js, /class: 'kg-node-image'/);
  assert.match(css, /\.kg-svg-label\{[^}]*font-size:14px/);
  assert.match(css, /\.kg-inspector h3\{font-size:20px/);
  assert.match(css, /@media\(max-width:580px\)/);
});

test('photo gallery does not imply verified price or availability', () => {
  assert.match(js, /تطبیق قطعی با رکورد انتخاب‌شده نیست/);
  assert.match(js, /قیمت، فروشنده و موجودی نیز تأیید نشده‌اند/);
  assert.match(js, /موجودی: بررسی‌نشده/);
  assert.match(js, /قیمت: مشاهده نشده/);
});
