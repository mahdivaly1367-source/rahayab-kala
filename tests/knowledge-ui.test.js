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

test('homepage opens with live search and a graphical topic explorer', () => {
  const liveSearchIndex = html.indexOf('<section class="hero">');
  const explorerIndex = html.indexOf('id="knowledgeExplorer"');
  assert.ok(liveSearchIndex >= 0, 'live search section is missing');
  assert.ok(explorerIndex > liveSearchIndex, 'topic explorer follows the general search entry');
  assert.doesNotMatch(html, /id="discovery"|function renderDiscovery\(/);
  assert.doesNotMatch(html, /id="kgAxes"/, 'flat axis selector must stay removed');
  assert.match(html, /id="kgGraphViewport"/);
  assert.match(html, /id="kgGraph"/);
  assert.match(html, /id="kgShowAllRoots"/);
  assert.match(html, /href="\/knowledge-explorer\.css"/);
  assert.match(html, /src="\/knowledge-explorer\.js"/);
});

test('graph explorer loads the versioned knowledge graph and semantic search', () => {
  assert.match(js, /fetch\(['"]\/api\/knowledge\/graph['"]/);
  assert.match(js, /fetch\(['"]\/api\/knowledge\/search\?/);
  assert.match(js, /graph\.relations/);
  assert.match(js, /node\.node_type === 'topic'/);
  assert.match(js, /topic_contains/);
});

test('the first layer contains 13 broad topics rather than narrow products or vehicles', () => {
  const topics = graph.nodes.filter(node => node.node_type === 'topic')
    .sort((a, b) => a.display_order - b.display_order);
  assert.equal(topics.length, 13);
  assert.equal(topics[0].label, 'فناوری و ارتباطات');
  assert.ok(topics.some(node => node.label === 'خانه و زندگی'));
  assert.ok(topics.some(node => node.label === 'ابزار، صنعت و ساخت'));
  assert.ok(topics.some(node => node.label === 'کشاورزی و فضای سبز'));
  assert.ok(!topics.some(node => node.label === 'موتورسیکلت'));
  assert.ok(!topics.some(node => node.label === 'موتور'));
});

test('vehicles and motorcycles appear only under the broader mobility topic', () => {
  const topics = graph.nodes.filter(node => node.node_type === 'topic');
  const mobility = topics.find(node => node.id === 'topic.mobility');
  assert.ok(mobility);
  assert.ok(graph.relations.some(edge =>
    edge.type === 'topic_contains' &&
    edge.source === mobility.id &&
    edge.target === 'store.root.09'
  ));
  const motorcycle = graph.nodes.find(node =>
    node.axis === 'store_taxonomy' && node.label === 'موتورسیکلت'
  );
  assert.ok(motorcycle);
  assert.ok(graph.relations.some(edge =>
    edge.type === 'child_of' &&
    edge.source === motorcycle.id &&
    edge.target === 'store.root.09'
  ));
});

test('topic layer is clearly documented as editorial rather than official store taxonomy', () => {
  assert.match(graph.topic_layer_policy, /دسته‌بندی رسمی دیجی‌کالا نیستند/);
  assert.match(html, /گروه‌بندی پیشنهادی راه‌یاب/);
  assert.match(html, /دسته‌بندی رسمی دیجی‌کالا نیستند/);
});

test('topic tree traverses the different knowledge axes without a flat axis menu', () => {
  for (const axis of ['nature', 'system', 'application', 'technical_feature', 'store_taxonomy']) {
    assert.ok(js.includes("node.axis === '" + axis + "'"), 'missing traversal for axis: ' + axis);
  }
  assert.match(js, /function relationChildren\(node\)/);
  assert.match(js, /function rootNodes\(\)/);
  assert.match(js, /function focusNode\(node\)/);
});

test('horizontal right-to-left graph supports expansion, focus, pan and zoom', () => {
  assert.match(js, /kg-svg-link/);
  assert.match(js, /kg-svg-node/);
  assert.match(js, /expanded\.has/);
  assert.match(js, /function zoomBy/);
  assert.match(js, /pointerdown/);
  assert.match(js, /scrollLeft/);
  assert.match(html, /id="kgZoomIn"/);
  assert.match(html, /id="kgZoomOut"/);
  assert.match(html, /id="kgFocusButton"/);
  assert.match(css, /kg-svg-link/);
  assert.match(css, /@keyframes kgFlow/);
});

test('homepage does not launch a motor search automatically', () => {
  assert.doesNotMatch(html, /id="query"[^>]*value="موتور"/);
  assert.doesNotMatch(html, /search\(\);\s*<\/script>/);
  assert.match(html, /data-query="فناوری"/);
  assert.match(html, /data-query="خانه"/);
  assert.match(html, /data-query="کشاورزی"/);
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

test('live product search remains available independently of topic navigation', () => {
  assert.match(html, /id="query"/);
  assert.match(html, /id="searchBtn"/);
  assert.match(html, /function search\(categoryId=null/);
  assert.match(js, /rahayabLiveSearch|searchBtn/);
});

test('explorer layout remains responsive and pannable', () => {
  assert.match(css, /@media\(max-width:900px\)/);
  assert.match(css, /@media\(max-width:600px\)/);
  assert.match(css, /overflow:auto/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(js, /pointermove/);
});

test('graph inspector loads product photos through the local image proxy', () => {
  assert.match(html, /id="kgImageGallery"/);
  assert.match(js, /async function loadPhotoGallery/);
  assert.match(js, /fetch\('\/api\/search\?/);
  assert.match(js, /isTrustedProductImage/);
  assert.match(js, /imageProxyUrl\(product\.image\)/);
  assert.match(js, /imageByNodeId/);
  assert.match(css, /\.kg-gallery-grid/);
  assert.match(css, /\.kg-photo-frame/);
});

test('graph nodes and Persian labels use the corrected spacious card layout', () => {
  assert.match(js, /const nodeWidth = 308/);
  assert.match(js, /const nodeHeight = 112/);
  assert.match(js, /class: 'kg-node-image'/);
  assert.match(css, /\.kg-svg-label\{[^}]*font-size:13px/);
  assert.match(css, /\.kg-inspector h3\{[^}]*font-size:17px/);
  assert.match(css, /@media\(max-width:600px\)/);
});

test('long Persian and Latin names are wrapped within graph nodes and cards', () => {
  assert.match(js, /function wrapLabel\(label, maxChars = 17, maxLines = 3\)/);
  assert.match(js, /const labelStartY/);
  assert.match(js, /nodeHeight = 112/);
  assert.match(css, /overflow-wrap:anywhere/);
  assert.match(css, /\.kg-inspector-link span,.kg-inspector-link small/);
  assert.match(html, /\.producttitle,.meta,.tag/);
});

test('only approved Affilio media and product-specific links can be used for commission tracking', () => {
  assert.match(html, /fetch\('\/api\/affiliate\/config'/);
  assert.match(html, /function affiliateLinkFor\(productId, directUrl\)/);
  assert.match(html, /const match = destination\.match/);
  assert.match(html, /affiliateConfig\.tracking_enabled/);
  assert.match(html, /sponsored nofollow noopener noreferrer/);
  assert.match(html, /خرید از دیجی‌کالا/);
  assert.match(html, /پورسانتی برای راه‌یاب رهگیری نمی‌شود/);
  assert.match(html, /این سه جست‌وجوی بیرونی لینک افیلیت نیستند/);
  assert.match(html, /destination\.match/);
  assert.match(js, /rahayabAffiliateLinkFor/);
});

test('Digikala-inspired visual palette does not claim official ownership', () => {
  assert.match(html, /--green:#ef394e/);
  assert.match(html, /رسانه مستقل راهنمای خرید/);
  assert.match(html, /راه‌یاب کالا یک رسانه مستقل است/);
  assert.match(css, /\.kg-svg-node\.topic \.kg-svg-card/);
});

test('photo gallery does not imply verified price or availability', () => {
  assert.match(js, /تطبیق قطعی با رکورد انتخاب‌شده نیست/);
  assert.match(js, /قیمت، فروشنده و موجودی نیز تأیید نشده‌اند/);
  assert.match(js, /موجودی: بررسی‌نشده/);
  assert.match(js, /قیمت: مشاهده نشده/);
});
