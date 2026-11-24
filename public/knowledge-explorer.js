'use strict';

/*
 * Rahayab Kala Graph Explorer
 * Interactive, right-to-left horizontal concept graph inspired by visual query exploration.
 * The data source is the versioned knowledge graph served by the local application.
 */
async function initKnowledgeExplorer() {
  const $ = id => document.getElementById(id);
  const svgNS = 'http://www.w3.org/2000/svg';
  const labels = {
    nature: 'ماهیت کالا',
    system: 'مجموعه و سامانه',
    application: 'کاربرد و کارکرد',
    technical_feature: 'ویژگی فنی',
    store_taxonomy: 'دسته‌های مشاهده‌شده فروشگاه',
    product: 'محصول و شواهد کالا'
  };
  const typeLabels = {
    concept: 'مفهوم کالا',
    system: 'سامانه',
    application: 'کاربرد',
    technical_feature: 'ویژگی فنی',
    store_category: 'دسته فروشگاه',
    product_observation: 'رکورد محصول پژوهشی',
    product_candidate: 'نامزد محصول'
  };
  const statusLabels = {
    active: 'مفهوم فعال',
    needs_store_evidence: 'نیازمند شاهد فروشگاهی',
    official_current_page: 'مشاهده‌شده در صفحه رسمی',
    affiliate_link_resolves_to_dkp: 'شناسه مقصد پیوند افیلیت ثبت شده',
    third_party_listing_digikala_route_unresolved: 'مسیر فروشگاهی حل‌نشده',
    third_party_market_only: 'شاهد بازار شخص ثالث',
    unverified_candidate: 'نامزد تأییدنشده'
  };
  const relationLabels = {
    is_a: 'گونه‌ای از',
    part_of: 'بخشی از',
    child_of: 'زیرشاخه',
    listed_under: 'عبارت ثبت‌شده زیر دسته',
    classified_as: 'طبقه‌بندی شده به‌عنوان',
    used_in: 'به‌کاررفته در',
    serves_application: 'مناسب برای کاربرد',
    has_component: 'دارای جزء',
    has_feature: 'دارای ویژگی',
    may_have_feature: 'ممکن است دارای ویژگی باشد',
    discovery_route_in_store: 'مسیر پیشنهادی در فروشگاه'
  };
  const hierarchyTypes = {
    nature: ['is_a', 'classified_as'],
    system: ['part_of', 'used_in'],
    store_taxonomy: ['child_of', 'listed_under'],
    application: ['serves_application'],
    technical_feature: ['has_feature', 'may_have_feature'],
    product: ['classified_as', 'used_in', 'serves_application', 'has_feature', 'may_have_feature']
  };

  let graph = null;
  let availableAxes = [];
  let nodeMap = new Map();
  let activeAxis = 'nature';
  let focusedNodeId = null;
  let selectedNodeId = null;
  let expanded = new Set();
  let searchTimer = null;
  let searchRequest = 0;
  let zoom = 1;
  let lastLayout = null;

  const make = (tag, cls, text) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  };
  const svg = (tag, attrs = {}, text) => {
    const el = document.createElementNS(svgNS, tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
    if (text !== undefined) el.textContent = text;
    return el;
  };
  const isProduct = node => node && (
    node.node_type === 'product_observation' || node.node_type === 'product_candidate'
  );
  const safeProductUrl = value => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && url.hostname === 'www.digikala.com' ? url.href : '';
    } catch { return ''; }
  };

  function eligibleNodes() {
    return graph.nodes.filter(node => node.axis === activeAxis);
  }

  function relationChildren(node, focused = false) {
    const allowed = new Set(hierarchyTypes[activeAxis] || []);
    const found = new Map();

    for (const edge of graph.relations) {
      if (!allowed.has(edge.type)) continue;

      let otherId = null;
      let relation = edge.type;

      if (activeAxis === 'product') {
        if (edge.source === node.id) otherId = edge.target;
      } else if (activeAxis === 'nature') {
        if (edge.target === node.id) otherId = edge.source;
        else if (focused && edge.source === node.id && edge.type === 'is_a') {
          otherId = edge.target;
          relation = 'parent_of';
        }
      } else if (activeAxis === 'system') {
        if (edge.target === node.id) otherId = edge.source;
        else if (focused && edge.source === node.id && edge.type === 'part_of') {
          otherId = edge.target;
          relation = 'parent_of';
        }
      } else if (activeAxis === 'store_taxonomy') {
        if (edge.target === node.id) otherId = edge.source;
        else if (focused && edge.source === node.id) {
          otherId = edge.target;
          relation = 'parent_of';
        }
      } else {
        if (edge.target === node.id) otherId = edge.source;
        else if (focused && edge.source === node.id) otherId = edge.target;
      }

      const other = otherId ? nodeMap.get(otherId) : null;
      if (!other || other.id === node.id || other.node_type === 'evidence_source') continue;
      if (['nature', 'system', 'store_taxonomy', 'application'].includes(activeAxis) && !isProduct(other) && other.axis !== activeAxis) continue;
      if (activeAxis === 'technical_feature' && other.node_type !== 'concept' && !isProduct(other)) continue;
      if (!found.has(other.id)) found.set(other.id, { node: other, relation });
    }

    return [...found.values()].sort((a, b) => {
      const aProduct = isProduct(a.node) ? 1 : 0;
      const bProduct = isProduct(b.node) ? 1 : 0;
      return aProduct - bProduct || String(a.node.label).localeCompare(String(b.node.label), 'fa');
    });
  }

  function rootNodes() {
    if (focusedNodeId && nodeMap.has(focusedNodeId)) return [nodeMap.get(focusedNodeId)];

    const nodes = eligibleNodes();
    const parentIds = new Set();
    const mainTypes = activeAxis === 'nature' ? new Set(['is_a'])
      : activeAxis === 'system' ? new Set(['part_of'])
      : activeAxis === 'store_taxonomy' ? new Set(['child_of', 'listed_under'])
      : new Set();

    if (mainTypes.size) {
      for (const edge of graph.relations) {
        if (mainTypes.has(edge.type)) parentIds.add(edge.source);
      }
      return nodes.filter(node => !parentIds.has(node.id));
    }

    return nodes;
  }

  function buildVisibleTree() {
    const roots = rootNodes();
    const seenPerPath = new Set();
    const entries = [];
    let maxDepth = 0;
    let leafCount = 0;

    function visit(node, depth, pathSet, focusedRoot = false) {
      maxDepth = Math.max(maxDepth, depth);
      const entry = { node, depth, children: [], x: 0, y: 0, relation: null };
      if (depth >= 4 || !expanded.has(node.id)) {
        leafCount++;
        return entry;
      }

      const nextPath = new Set(pathSet);
      nextPath.add(node.id);
      const children = relationChildren(node, focusedRoot);
      for (const child of children) {
        if (nextPath.has(child.node.id)) continue;
        const childEntry = visit(child.node, depth + 1, nextPath, false);
        childEntry.relation = child.relation;
        entry.children.push(childEntry);
      }
      if (!entry.children.length) leafCount++;
      return entry;
    }

    roots.forEach(root => {
      const rootEntry = visit(root, 0, seenPerPath, Boolean(focusedNodeId));
      entries.push(rootEntry);
    });

    const nodeWidth = 224;
    const nodeHeight = 66;
    const columnGap = 282;
    const width = Math.max(980, 310 + maxDepth * columnGap);
    let cursorY = 58;

    function position(entry) {
      entry.x = width - nodeWidth - 38 - entry.depth * columnGap;
      if (entry.children.length) {
        entry.children.forEach(position);
        entry.y = (entry.children[0].y + entry.children[entry.children.length - 1].y) / 2;
      } else {
        entry.y = cursorY;
        cursorY += 86;
      }
    }

    entries.forEach((entry, index) => {
      position(entry);
      cursorY += index < entries.length - 1 ? 30 : 0;
    });

    const height = Math.max(480, cursorY + 55);
    return { roots: entries, width, height, nodeWidth, nodeHeight, maxDepth };
  }

  function wrapLabel(label, maxChars = 25) {
    const words = String(label || '').split(/\s+/);
    const lines = [];
    let line = '';
    for (const word of words) {
      const candidate = line ? line + ' ' + word : word;
      if (candidate.length > maxChars && line) {
        lines.push(line);
        line = word;
      } else line = candidate;
    }
    if (line) lines.push(line);
    if (lines.length > 2) {
      const second = lines.slice(1).join(' ');
      lines.splice(1, lines.length - 1, second.length > 25 ? second.slice(0, 24) + '…' : second);
    }
    return lines;
  }

  function createNodeGroup(entry, layout) {
    const node = entry.node;
    const group = svg('g', {
      class: 'kg-svg-node' + (selectedNodeId === node.id ? ' selected' : '') +
        (entry.depth === 0 ? ' root' : ''),
      transform: 'translate(' + entry.x + ',' + (entry.y - layout.nodeHeight / 2) + ')',
      tabindex: '0',
      role: 'button',
      'aria-label': node.label + (relationChildren(node).length ? '، دارای شاخه‌های بیشتر' : ''),
      'data-node-id': node.id
    });

    group.appendChild(svg('rect', {
      class: 'kg-svg-card',
      x: 0, y: 0, width: layout.nodeWidth, height: layout.nodeHeight, rx: 15
    }));

    const dotClass = isProduct(node) ? 'kg-svg-dot product'
      : node.axis === 'store_taxonomy' ? 'kg-svg-dot store'
      : 'kg-svg-dot concept';
    group.appendChild(svg('circle', {
      class: dotClass, cx: 19, cy: layout.nodeHeight / 2, r: 7
    }));

    const labelLines = wrapLabel(node.label);
    const labelText = svg('text', {
      class: 'kg-svg-label',
      x: layout.nodeWidth - 15,
      y: labelLines.length > 1 ? 27 : 31,
      'text-anchor': 'end',
      direction: 'rtl'
    });
    labelLines.forEach((line, index) => {
      labelText.appendChild(svg('tspan', {
        x: layout.nodeWidth - 15,
        dy: index === 0 ? 0 : 16
      }, line));
    });
    group.appendChild(labelText);

    const childCount = relationChildren(node, entry.depth === 0 && Boolean(focusedNodeId)).length;
    const subText = childCount ? childCount + ' شاخه مرتبط'
      : isProduct(node) ? 'رکورد پژوهشی' : (typeLabels[node.node_type] || 'گره مفهومی');
    group.appendChild(svg('text', {
      class: 'kg-svg-subtitle',
      x: layout.nodeWidth - 15,
      y: 55,
      'text-anchor': 'end',
      direction: 'rtl'
    }, subText));

    if (childCount) {
      group.appendChild(svg('circle', {
        class: 'kg-svg-expand',
        cx: layout.nodeWidth - 15,
        cy: 0,
        r: 10
      }));
      group.appendChild(svg('text', {
        class: 'kg-svg-expand-text',
        x: layout.nodeWidth - 15,
        y: 4,
        'text-anchor': 'middle'
      }, expanded.has(node.id) ? '−' : '+'));
    }

    group.appendChild(svg('title', {}, node.label));
    group.addEventListener('click', () => onNodeClick(node));
    group.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onNodeClick(node);
      }
    });
    return group;
  }

  function collectEntries(entry, output = []) {
    output.push(entry);
    entry.children.forEach(child => collectEntries(child, output));
    return output;
  }

  function drawGraph() {
    const viewport = $('kgGraphViewport');
    const canvas = $('kgGraph');
    const layout = buildVisibleTree();
    lastLayout = layout;
    canvas.replaceChildren();
    canvas.setAttribute('viewBox', '0 0 ' + layout.width + ' ' + layout.height);
    canvas.setAttribute('width', layout.width);
    canvas.setAttribute('height', layout.height);
    canvas.style.width = (layout.width * zoom) + 'px';
    canvas.style.height = (layout.height * zoom) + 'px';

    const defs = svg('defs');
    const gradient = svg('linearGradient', { id: 'kgLineGradient', x1: '0', x2: '1', y1: '0', y2: '0' });
    gradient.append(svg('stop', { offset: '0%', 'stop-color': '#b8d9c0' }));
    gradient.append(svg('stop', { offset: '100%', 'stop-color': '#83b79b' }));
    defs.appendChild(gradient);
    canvas.appendChild(defs);

    const all = [];
    layout.roots.forEach(root => collectEntries(root, all));
    const entriesById = new Map(all.map(entry => [entry.node.id + ':' + entry.depth, entry]));

    function drawLinks(entry) {
      entry.children.forEach(child => {
        const startX = entry.x;
        const startY = entry.y;
        const endX = child.x + layout.nodeWidth;
        const endY = child.y;
        const bend = Math.max(48, (startX - endX) * .44);
        const path = svg('path', {
          class: 'kg-svg-link',
          d: 'M ' + startX + ' ' + startY +
            ' C ' + (startX - bend) + ' ' + startY + ', ' +
            (endX + bend) + ' ' + endY + ', ' + endX + ' ' + endY
        });
        canvas.appendChild(path);
        drawLinks(child);
      });
    }

    layout.roots.forEach(drawLinks);
    all.forEach(entry => canvas.appendChild(createNodeGroup(entry, layout)));

    $('kgGraphSummary').textContent =
      all.length + ' گره روی نمودار · ' + layout.maxDepth + ' سطح بازشده';
    $('kgZoomValue').textContent = Math.round(zoom * 100) + '%';

    requestAnimationFrame(() => {
      if (viewport && !focusedNodeId) viewport.scrollLeft = viewport.scrollWidth;
    });
  }

  function describeSelection(node) {
    selectedNodeId = node.id;
    $('kgInspectorType').textContent = typeLabels[node.node_type] || labels[node.axis] || 'گره دانش';
    $('kgInspectorTitle').textContent = node.label;
    $('kgInspectorDescription').textContent =
      node.description || node.interpretation || 'برای این گره توضیح تفصیلی ثبت نشده است.';

    const badges = $('kgInspectorBadges');
    badges.replaceChildren();
    const status = node.status || node.evidence_status;
    if (status) addBadge(badges, statusLabels[status] || status,
      status === 'needs_store_evidence' ? 'caution' : 'positive');
    if (isProduct(node)) {
      addBadge(badges, 'موجودی: بررسی‌نشده', 'caution');
      addBadge(badges, 'قیمت: مشاهده نشده', 'caution');
      addBadge(badges, 'فروشنده: مشاهده نشده', 'caution');
    }
    if (node.observed_at) addBadge(badges, 'تاریخ ثبت شاهد: ' + node.observed_at);
    if (node.aliases && node.aliases.length) {
      addBadge(badges, 'نام‌های دیگر: ' + node.aliases.slice(0, 5).join('، '));
    }

    const relationHost = $('kgInspectorRelations');
    relationHost.replaceChildren();
    const incident = graph.relations.filter(edge =>
      (edge.source === node.id || edge.target === node.id) && edge.type !== 'has_evidence'
    );
    if (incident.length) {
      relationHost.appendChild(make('strong', '', 'ارتباط‌های ثبت‌شده'));
      const list = make('div', 'kg-inspector-links');
      incident.slice(0, 12).forEach(edge => {
        const otherId = edge.source === node.id ? edge.target : edge.source;
        const other = nodeMap.get(otherId);
        if (!other || other.node_type === 'evidence_source') return;
        const button = make('button', 'kg-inspector-link');
        const direction = edge.source === node.id ? '←' : '→';
        button.append(
          make('span', '', other.label),
          make('small', '', (relationLabels[edge.type] || edge.type) + ' ' + direction)
        );
        button.type = 'button';
        button.addEventListener('click', () => focusNode(other));
        list.appendChild(button);
      });
      relationHost.appendChild(list);
    }

    const productUrl = safeProductUrl(node.digikala_url);
    const linkHost = $('kgInspectorProductLink');
    linkHost.replaceChildren();
    if (productUrl) {
      const anchor = make('a', 'kg-evidence-link', 'بازکردن مقصد شناسایی‌شده در دیجی‌کالا ↗');
      anchor.href = productUrl;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      linkHost.appendChild(anchor);
    } else if (node.node_type === 'product_candidate') {
      linkHost.appendChild(make('span', 'kg-candidate-note', 'این مورد فقط یک نامزد پژوهشی است؛ مقصد محصول تأیید نشده است.'));
    }

    $('kgFocusButton').hidden = focusedNodeId === node.id;
    $('kgLiveQueryButton').hidden = false;
    $('kgLiveQueryButton').onclick = () => {
      const liveInput = document.getElementById('query');
      if (liveInput) {
        liveInput.value = node.label;
        liveInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (typeof window.rahayabLiveSearch === 'function') window.rahayabLiveSearch();
        else document.getElementById('searchBtn')?.click();
      }
    };
    drawGraph();
  }

  function addBadge(container, text, kind) {
    container.appendChild(make('span', 'kg-inspector-badge' + (kind ? ' ' + kind : ''), text));
  }

  function onNodeClick(node) {
    const children = relationChildren(node, node.id === focusedNodeId);
    if (children.length) {
      if (expanded.has(node.id)) expanded.delete(node.id);
      else expanded.add(node.id);
    }
    describeSelection(node);
  }

  function focusNode(node) {
    activeAxis = node.axis === 'evidence' ? activeAxis : node.axis;
    focusedNodeId = node.id;
    selectedNodeId = node.id;
    expanded = new Set([node.id]);
    renderAxisControls();
    renderGraph();
    describeSelection(node);
    $('kgGraphViewport').scrollLeft = $('kgGraphViewport').scrollWidth;
  }

  function renderGraph() {
    const roots = rootNodes();
    if (!roots.length) {
      $('kgGraph').replaceChildren();
      $('kgGraphSummary').textContent = 'در این محور داده‌ای ثبت نشده است.';
      return;
    }
    if (!focusedNodeId && expanded.size === 0) {
      const sorted = roots.slice().sort((a, b) =>
        relationChildren(b).length - relationChildren(a).length
      );
      if (sorted[0] && relationChildren(sorted[0]).length) expanded.add(sorted[0].id);
    }
    drawGraph();
  }

  function renderAxisControls() {
    const host = $('kgAxes');
    host.replaceChildren();
    availableAxes.forEach(axis => {
      const id = axis.id;
      const label = labels[id] || axis.label || id;
      const button = make('button', 'kg-axis' + (activeAxis === id ? ' active' : ''), label);
      button.type = 'button';
      button.dataset.axis = id;
      button.addEventListener('click', () => {
        activeAxis = id;
        focusedNodeId = null;
        selectedNodeId = null;
        expanded.clear();
        renderAxisControls();
        resetInspector();
        renderGraph();
      });
      host.appendChild(button);
    });
  }

  function resetInspector() {
    $('kgInspectorType').textContent = 'نقشه تعاملی دانش';
    $('kgInspectorTitle').textContent = 'یک گره را انتخاب کن';
    $('kgInspectorDescription').textContent =
      'روی هر گره بزن تا اطلاعاتش را ببینی؛ با علامت مثبت شاخه‌ها باز می‌شوند. می‌توانی هر مفهوم را به مرکز یک نمودار تازه تبدیل کنی.';
    $('kgInspectorBadges').replaceChildren();
    $('kgInspectorRelations').replaceChildren();
    $('kgInspectorProductLink').replaceChildren();
    $('kgFocusButton').hidden = true;
    $('kgLiveQueryButton').hidden = true;
  }

  async function runSemanticSearch() {
    const query = $('kgQuery').value.trim();
    if (!query) {
      searchRequest++;
      $('kgSearchResults').hidden = true;
      $('kgSearchResults').replaceChildren();
      return;
    }
    const thisRequest = ++searchRequest;
    $('kgSearchButton').disabled = true;
    $('kgSearchButton').textContent = 'در حال جست‌وجو…';
    try {
      const params = new URLSearchParams({ q: query, limit: '30' });
      const response = await fetch('/api/knowledge/search?' + params.toString(), { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'جست‌وجوی دانش ناموفق بود.');
      if (thisRequest !== searchRequest) return;

      const host = $('kgSearchResults');
      host.replaceChildren();
      host.hidden = false;
      host.appendChild(make('div', 'kg-search-heading',
        'مفاهیم نزدیک به «' + query + '» · ' + payload.total + ' نتیجه'));
      const list = make('div', 'kg-search-hits');
      payload.results.slice(0, 18).forEach(hit => {
        const button = make('button', 'kg-search-hit');
        button.type = 'button';
        button.append(
          make('strong', '', hit.label),
          make('small', '', labels[hit.axis] || typeLabels[hit.node_type] || hit.node_type)
        );
        button.addEventListener('click', () => {
          const node = nodeMap.get(hit.node_id);
          if (node) {
            focusNode(node);
            $('kgSearchResults').hidden = true;
          }
        });
        list.appendChild(button);
      });
      if (!payload.results.length) list.appendChild(make('div', 'kg-no-hits', 'موردی پیدا نشد؛ عبارت یا محور دیگری را امتحان کن.'));
      host.appendChild(list);
    } catch (error) {
      if (thisRequest === searchRequest) {
        const host = $('kgSearchResults');
        host.hidden = false;
        host.replaceChildren(make('div', 'kg-no-hits',
          'خطا در جست‌وجوی گراف دانش: ' + String(error.message || error)));
      }
    } finally {
      if (thisRequest === searchRequest) {
        $('kgSearchButton').disabled = false;
        $('kgSearchButton').textContent = 'کشف مفهوم';
      }
    }
  }

  function zoomBy(delta) {
    zoom = Math.max(.65, Math.min(1.55, Math.round((zoom + delta) * 100) / 100));
    drawGraph();
  }

  function panCanvas() {
    const viewport = $('kgGraphViewport');
    let drag = null;
    viewport.addEventListener('pointerdown', event => {
      if (event.target.closest && event.target.closest('.kg-svg-node')) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      drag = { x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
      viewport.classList.add('dragging');
      viewport.setPointerCapture(event.pointerId);
    });
    viewport.addEventListener('pointermove', event => {
      if (!drag) return;
      viewport.scrollLeft = drag.left - (event.clientX - drag.x);
      viewport.scrollTop = drag.top - (event.clientY - drag.y);
    });
    const stop = () => { drag = null; viewport.classList.remove('dragging'); };
    viewport.addEventListener('pointerup', stop);
    viewport.addEventListener('pointercancel', stop);
    viewport.addEventListener('lostpointercapture', stop);
  }

  try {
    const response = await fetch('/api/knowledge/graph', { cache: 'no-store' });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    graph = await response.json();
    availableAxes = (graph.axes || []).filter(axis => axis.id !== 'evidence' && graph.nodes.some(node => node.axis === axis.id));
    if (availableAxes.length && !availableAxes.some(axis => axis.id === activeAxis)) activeAxis = availableAxes[0].id;
    nodeMap = new Map(graph.nodes.map(node => [node.id, node]));

    $('kgVersion').textContent = 'گراف دانش ' + graph.graph_version;
    $('kgCounts').textContent = graph.nodes.length + ' گره · ' + graph.relations.length + ' ارتباط';
    renderAxisControls();
    renderGraph();
    panCanvas();

    $('kgSearchButton').addEventListener('click', runSemanticSearch);
    $('kgQuery').addEventListener('keydown', event => {
      if (event.key === 'Enter') runSemanticSearch();
      if (event.key === 'Escape') {
        $('kgQuery').value = '';
        $('kgSearchResults').hidden = true;
      }
    });
    $('kgQuery').addEventListener('input', () => {
      clearTimeout(searchTimer);
      if (!$('kgQuery').value.trim()) {
        searchRequest++;
        $('kgSearchResults').hidden = true;
        $('kgSearchResults').replaceChildren();
        return;
      }
      searchTimer = setTimeout(runSemanticSearch, 360);
    });
    $('kgZoomIn').addEventListener('click', () => zoomBy(.1));
    $('kgZoomOut').addEventListener('click', () => zoomBy(-.1));
    $('kgZoomReset').addEventListener('click', () => {
      zoom = 1;
      drawGraph();
      $('kgGraphViewport').scrollLeft = $('kgGraphViewport').scrollWidth;
    });
    $('kgFocusButton').addEventListener('click', () => {
      const node = nodeMap.get(selectedNodeId);
      if (node) focusNode(node);
    });
    $('kgShowAllRoots').addEventListener('click', () => {
      focusedNodeId = null;
      selectedNodeId = null;
      expanded.clear();
      renderGraph();
      resetInspector();
    });
    $('kgClearSearch').addEventListener('click', () => {
      $('kgQuery').value = '';
      searchRequest++;
      $('kgSearchResults').hidden = true;
      $('kgSearchResults').replaceChildren();
      $('kgClearSearch').blur();
    });
  } catch (error) {
    $('kgVersion').textContent = 'گراف دانش در دسترس نیست';
    $('kgGraph').replaceChildren();
    $('kgGraphSummary').textContent =
      'دریافت گراف دانش ناموفق بود. سرور را با run.ps1 اجرا کن. ' + String(error.message || error);
  }
}
