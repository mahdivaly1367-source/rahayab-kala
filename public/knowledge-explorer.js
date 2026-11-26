'use strict';

/*
 * Rahayab Kala Graph Explorer
 * Interactive, right-to-left horizontal concept graph inspired by visual query exploration.
 * The data source is the versioned knowledge graph served by the local application.
 */
async function initKnowledgeExplorer() {
  const $ = id => document.getElementById(id);
  const svgNS = 'http://www.w3.org/2000/svg';
  if (window.rahayabAffiliateReady) await window.rahayabAffiliateReady;
  const labels = {
    topic: 'موضوعات اصلی',
    nature: 'ماهیت کالا',
    system: 'مجموعه و سامانه',
    application: 'کاربرد و کارکرد',
    technical_feature: 'ویژگی فنی',
    store_taxonomy: 'دسته‌های مشاهده‌شده فروشگاه',
    product: 'محصول و شواهد کالا'
  };
  const typeLabels = {
    topic: 'موضوع اصلی راه‌یاب',
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
    discovery_route_in_store: 'مسیر پیشنهادی در فروشگاه',
    topic_contains: 'گروه‌بندی موضوعی'
  };
  let graph = null;
  let nodeMap = new Map();
  let focusedNodeId = null;
  let selectedNodeId = null;
  let expanded = new Set();
  let searchTimer = null;
  let searchRequest = 0;
  let zoom = 1;
  let lastLayout = null;
  const photoSearchCache = new Map();
  const imageByNodeId = new Map();
  let activePhotoRequest = 0;

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

  function isTrustedProductImage(value) {
    try {
      const url = new URL(String(value || ''));
      return url.protocol === 'https:' &&
        /^dkstatics-public(?:-\d+)?\.digikala\.com$/i.test(url.hostname) &&
        url.pathname.startsWith('/digikala-products/');
    } catch { return false; }
  }

  function imageProxyUrl(value) {
    return '/api/image?url=' + encodeURIComponent(value);
  }

  function nodeIcon(node) {
    if (node.node_type === 'topic') return node.icon || '◆';
    if (isProduct(node)) return '▣';
    if (node.axis === 'store_taxonomy') return '▤';
    if (node.node_type === 'system') return '⌂';
    if (node.node_type === 'application') return '↗';
    if (node.node_type === 'technical_feature') return '◇';
    if (node.axis === 'nature') return '✦';
    return '•';
  }

  function photoTermsForNode(node) {
    const terms = [];
    const add = value => {
      const term = String(value || '').trim();
      if (!term || terms.some(old => old.toLocaleLowerCase() === term.toLocaleLowerCase())) return;
      terms.push(term);
    };

    if (isProduct(node)) add(node.label);
    (Array.isArray(node.aliases) ? node.aliases : []).slice(0, 2).forEach(add);
    add(node.label);

    const related = relationChildren(node, node.id === focusedNodeId);
    related.filter(item => !isProduct(item.node)).slice(0, 2).forEach(item => add(item.node.label));
    related.filter(item => isProduct(item.node)).slice(0, 2).forEach(item => add(item.node.label));

    return terms.slice(0, 3);
  }

  async function fetchPhotoSearch(term) {
    if (photoSearchCache.has(term)) return photoSearchCache.get(term);
    const promise = (async () => {
      const params = new URLSearchParams({ query: term, wide: 'false' });
      const response = await fetch('/api/search?' + params.toString(), { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'جست‌وجوی تصویر ناموفق بود.');
      return Array.isArray(payload.products) ? payload.products : [];
    })();
    photoSearchCache.set(term, promise);
    try {
      return await promise;
    } catch (error) {
      photoSearchCache.delete(term);
      throw error;
    }
  }

  function mapPhotoResultsToGraph(node, products) {
    const first = products.find(product => isTrustedProductImage(product.image));
    if (first) imageByNodeId.set(node.id, first.image);

    const graphProducts = graph.nodes.filter(isProduct);
    for (const product of products) {
      if (!isTrustedProductImage(product.image)) continue;
      const liveDigits = String(product.id || '').replace(/\D/g, '');
      const liveTitle = String(product.title || '').trim().toLocaleLowerCase();
      const match = graphProducts.find(candidate => {
        const candidateDigits = String(candidate.product_id || candidate.candidate_product_id || '').replace(/\D/g, '');
        return (liveDigits && candidateDigits && liveDigits === candidateDigits) ||
          (liveTitle && candidate.label.toLocaleLowerCase() === liveTitle);
      });
      if (match) imageByNodeId.set(match.id, product.image);
    }
  }

  function renderPhotoGallery(node, products, term) {
    const host = $('kgImageGallery');
    host.hidden = false;
    host.replaceChildren();

    const header = make('div', 'kg-gallery-heading');
    header.append(
      make('strong', '', 'تصاویر و کالاهای مرتبط'),
      make('small', '', 'عبارت جست‌وجو: ' + term)
    );
    host.appendChild(header);

    const visualProducts = products.filter(product =>
      product && isTrustedProductImage(product.image) && product.title
    ).slice(0, 4);

    if (!visualProducts.length) {
      host.appendChild(make('div', 'kg-gallery-empty',
        'برای این مفهوم تصویر قابل نمایش از جست‌وجوی فعلی دریافت نشد. این به معنی نبود کالا نیست.'));
      return;
    }

    const grid = make('div', 'kg-gallery-grid');
    visualProducts.forEach(product => {
      const directUrl = safeProductUrl(product.url);
      const linkInfo = window.rahayabAffiliateLinkFor
        ? window.rahayabAffiliateLinkFor(product.id, directUrl)
        : { url: directUrl, tracked: false };
      const url = linkInfo.url;
      const card = url ? make('a', 'kg-photo-card') : make('article', 'kg-photo-card');
      if (url) {
        card.href = url;
        card.target = '_blank';
        card.rel = linkInfo.tracked ? 'sponsored nofollow noopener noreferrer' : 'nofollow noopener noreferrer';
      }

      const imageFrame = make('div', 'kg-photo-frame');
      const image = document.createElement('img');
      image.src = imageProxyUrl(product.image);
      image.alt = product.title;
      image.loading = 'lazy';
      image.decoding = 'async';
      image.onerror = () => {
        if (!image.dataset.directTried) {
          image.dataset.directTried = '1';
          image.src = product.image;
        } else {
          image.remove();
          imageFrame.appendChild(make('span', 'kg-photo-fallback', 'تصویر بارگذاری نشد'));
        }
      };
      imageFrame.appendChild(image);
      card.append(
        imageFrame,
        make('strong', 'kg-photo-title', product.title),
        make('small', 'kg-photo-source', url ? (linkInfo.tracked ? 'خرید از دیجی‌کالا با لینک رهگیری ↗' : 'مشاهده مستقیم در دیجی‌کالا ↗') : 'نتیجه جست‌وجو')
      );
      grid.appendChild(card);
    });
    host.appendChild(grid);
    host.appendChild(make('div', 'kg-gallery-note',
      'این تصاویر نمونه‌هایی از نتایج جست‌وجوی همان عبارت‌اند و لزوماً تطبیق قطعی با رکورد انتخاب‌شده نیستند؛ قیمت، فروشنده و موجودی نیز تأیید نشده‌اند.'));
  }

  async function loadPhotoGallery(node) {
    const host = $('kgImageGallery');
    if (window.rahayabAffiliateReady) await window.rahayabAffiliateReady;
    const requestId = ++activePhotoRequest;
    const terms = photoTermsForNode(node);
    host.hidden = false;
    host.replaceChildren(
      make('div', 'kg-gallery-heading', 'تصاویر و کالاهای مرتبط'),
      make('div', 'kg-gallery-loading', 'در حال یافتن تصاویر مرتبط…')
    );

    if (!terms.length) {
      host.replaceChildren(make('div', 'kg-gallery-empty', 'برای این گره عبارت جست‌وجوی تصویری در دسترس نیست.'));
      return;
    }

    let products = [];
    let selectedTerm = terms[0];
    let lastError = null;

    for (const term of terms) {
      try {
        const found = await fetchPhotoSearch(term);
        if (requestId !== activePhotoRequest) return;
        const images = found.filter(product => isTrustedProductImage(product.image));
        if (images.length) {
          products = images;
          selectedTerm = term;
          break;
        }
        if (!products.length) products = found;
      } catch (error) {
        lastError = error;
      }
    }

    if (requestId !== activePhotoRequest) return;

    if (!products.some(product => isTrustedProductImage(product.image)) && lastError && !products.length) {
      host.replaceChildren(make('div', 'kg-gallery-empty',
        'دریافت تصاویر از سرویس جست‌وجو ناموفق بود: ' + String(lastError.message || lastError)));
      return;
    }

    mapPhotoResultsToGraph(node, products);
    renderPhotoGallery(node, products, selectedTerm);
    drawGraph();
  }

  function relationChildren(node) {
    const found = new Map();
    const add = (edge, otherId) => {
      const other = nodeMap.get(otherId);
      if (!other || other.id === node.id || other.node_type === 'evidence_source') return;
      if (!found.has(other.id)) found.set(other.id, { node: other, relation: edge.type });
    };

    for (const edge of graph.relations) {
      if (node.node_type === 'topic') {
        if (edge.type === 'topic_contains' && edge.source === node.id) add(edge, edge.target);
        continue;
      }
      if (node.axis === 'nature') {
        if (edge.type === 'is_a' && edge.target === node.id) add(edge, edge.source);
        if (edge.type === 'has_component' && edge.source === node.id) add(edge, edge.target);
        if (edge.type === 'discovery_route_in_store' && edge.source === node.id) add(edge, edge.target);
        if (edge.type === 'classified_as' && edge.target === node.id) add(edge, edge.source);
      } else if (node.axis === 'system') {
        if (edge.type === 'part_of' && edge.target === node.id) add(edge, edge.source);
        if (edge.type === 'used_in' && edge.target === node.id) add(edge, edge.source);
      } else if (node.axis === 'store_taxonomy') {
        if (['child_of', 'listed_under'].includes(edge.type) && edge.target === node.id) add(edge, edge.source);
        if (edge.type === 'discovery_route_in_store' && edge.target === node.id) add(edge, edge.source);
      } else if (node.axis === 'application') {
        if (edge.type === 'serves_application' && edge.target === node.id) add(edge, edge.source);
      } else if (node.axis === 'technical_feature') {
        if (['may_have_feature', 'has_feature'].includes(edge.type) && edge.target === node.id) add(edge, edge.source);
      }
    }

    return [...found.values()].sort((a, b) => {
      const priority = item => isProduct(item.node) ? 4
        : item.node.node_type === 'store_category' ? 1
        : item.node.node_type === 'system' ? 2
        : item.node.node_type === 'application' ? 3
        : 0;
      return priority(a) - priority(b) || String(a.node.label).localeCompare(String(b.node.label), 'fa');
    });
  }

  function rootNodes() {
    if (focusedNodeId && nodeMap.has(focusedNodeId)) return [nodeMap.get(focusedNodeId)];
    return graph.nodes
      .filter(node => node.node_type === 'topic')
      .sort((a, b) => (a.display_order || 999) - (b.display_order || 999));
  }

  function buildVisibleTree() {
    const roots = rootNodes();
    const seenPerPath = new Set();
    const entries = [];
    let maxDepth = 0;
    let leafCount = 0;

    function visit(node, depth, pathSet) {
      maxDepth = Math.max(maxDepth, depth);
      const entry = { node, depth, children: [], x: 0, y: 0, relation: null };
      if (depth >= 5 || !expanded.has(node.id)) {
        leafCount++;
        return entry;
      }

      const nextPath = new Set(pathSet);
      nextPath.add(node.id);
      const children = relationChildren(node);
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

    const nodeWidth = 308;
    const nodeHeight = 112;
    const columnGap = 366;
    const width = Math.max(1160, 414 + maxDepth * columnGap);
    let cursorY = 54;

    function position(entry) {
      entry.x = width - nodeWidth - 38 - entry.depth * columnGap;
      if (entry.children.length) {
        entry.children.forEach(position);
        entry.y = (entry.children[0].y + entry.children[entry.children.length - 1].y) / 2;
      } else {
        entry.y = cursorY;
        cursorY += 130;
      }
    }

    entries.forEach((entry, index) => {
      position(entry);
      cursorY += index < entries.length - 1 ? 20 : 0;
    });

    const height = Math.max(500, cursorY + 56);
    return { roots: entries, width, height, nodeWidth, nodeHeight, maxDepth };
  }

  function wrapLabel(label, maxChars = 17, maxLines = 3) {
    const words = String(label || '').trim().split(/\s+/).filter(Boolean);
    const chunks = [];
    for (const word of words) {
      const chars = Array.from(word);
      for (let index = 0; index < chars.length; index += maxChars) {
        chunks.push(chars.slice(index, index + maxChars).join(''));
      }
    }
    const lines = [];
    let line = '';
    for (const chunk of chunks) {
      const candidate = line ? line + ' ' + chunk : chunk;
      if (Array.from(candidate).length > maxChars && line) {
        lines.push(line);
        line = chunk;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
    if (lines.length > maxLines) {
      const visible = lines.slice(0, maxLines);
      const last = Array.from(visible[maxLines - 1]);
      visible[maxLines - 1] = last.slice(0, Math.max(1, maxChars - 1)).join('') + '…';
      return visible;
    }
    return lines.length ? lines : [''];
  }

  function createNodeGroup(entry, layout) {
    const node = entry.node;
    const group = svg('g', {
      class: 'kg-svg-node' + (node.node_type === 'topic' ? ' topic' : '') +
        (selectedNodeId === node.id ? ' selected' : '') +
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

    const thumbnail = imageByNodeId.get(node.id);
    group.appendChild(svg('rect', {
      class: 'kg-thumb-back',
      x: 11, y: 15, width: 58, height: 58, rx: 12
    }));
    if (thumbnail && isTrustedProductImage(thumbnail)) {
      const clipId = 'kg-clip-' + node.id.replace(/[^a-zA-Z0-9_-]/g, '-');
      const defs = svg('defs');
      const clip = svg('clipPath', { id: clipId });
      clip.appendChild(svg('rect', { x: 11, y: 15, width: 58, height: 58, rx: 12 }));
      defs.appendChild(clip);
      group.appendChild(defs);
      group.appendChild(svg('image', {
        href: imageProxyUrl(thumbnail),
        x: 11, y: 15, width: 58, height: 58,
        preserveAspectRatio: 'xMidYMid slice',
        'clip-path': 'url(#' + clipId + ')',
        class: 'kg-node-image'
      }));
    } else {
      const iconClass = isProduct(node) ? 'product' : node.axis === 'store_taxonomy' ? 'store' : 'concept';
      group.appendChild(svg('rect', {
        class: 'kg-thumb-placeholder ' + iconClass,
        x: 11, y: 15, width: 58, height: 58, rx: 12
      }));
      group.appendChild(svg('text', {
        class: 'kg-node-icon',
        x: 40, y: 52,
        'text-anchor': 'middle'
      }, nodeIcon(node)));
    }

    const labelLines = wrapLabel(node.label, 17, 3);
    const labelStartY = labelLines.length === 1 ? 51 : labelLines.length === 2 ? 41 : 31;
    const labelText = svg('text', {
      class: 'kg-svg-label', x: layout.nodeWidth - 27, y: labelStartY,
      'text-anchor': 'end', direction: 'rtl'
    });
    labelLines.forEach((line, index) => {
      labelText.appendChild(svg('tspan', { x: layout.nodeWidth - 27, dy: index === 0 ? 0 : 18 }, line));
    });
    labelText.appendChild(svg('title', {}, node.label));
    group.appendChild(labelText);

    const childCount = relationChildren(node).length;
    const subText = childCount ? childCount + ' شاخه مرتبط'
      : isProduct(node) ? 'رکورد پژوهشی' : (typeLabels[node.node_type] || 'گره مفهومی');
    group.appendChild(svg('text', {
      class: 'kg-svg-subtitle',
      x: layout.nodeWidth - 15,
      y: 98,
      'text-anchor': 'end',
      direction: 'rtl'
    }, subText));

    if (childCount) {
      group.appendChild(svg('circle', {
        class: 'kg-svg-expand',
        cx: layout.nodeWidth - 18,
        cy: 15,
        r: 11
      }));
      group.appendChild(svg('text', {
        class: 'kg-svg-expand-text',
        x: layout.nodeWidth - 18,
        y: 20,
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

    loadPhotoGallery(node);

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
    const productLink = window.rahayabAffiliateLinkFor
      ? window.rahayabAffiliateLinkFor(node.product_id || node.candidate_product_id, productUrl)
      : { url: productUrl, tracked: false };
    const linkHost = $('kgInspectorProductLink');
    linkHost.replaceChildren();
    if (productUrl) {
      const anchor = make('a', 'kg-evidence-link', productLink.tracked ? 'خرید از دیجی‌کالا با لینک رهگیری ↗' : 'بازکردن مقصد شناسایی‌شده در دیجی‌کالا ↗');
      anchor.href = productLink.url;
      anchor.target = '_blank';
      anchor.rel = productLink.tracked ? 'sponsored nofollow noopener noreferrer' : 'nofollow noopener noreferrer';
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
    const children = relationChildren(node);
    if (children.length) {
      if (expanded.has(node.id)) expanded.delete(node.id);
      else expanded.add(node.id);
    }
    describeSelection(node);
  }

  function focusNode(node) {
    focusedNodeId = node.id;
    selectedNodeId = node.id;
    expanded = new Set([node.id]);
    renderGraph();
    describeSelection(node);
    $('kgGraphViewport').scrollLeft = $('kgGraphViewport').scrollWidth;
  }

  function renderGraph() {
    const roots = rootNodes();
    if (!roots.length) {
      $('kgGraph').replaceChildren();
      $('kgGraphSummary').textContent = 'موضوعی برای نمایش ثبت نشده است.';
      return;
    }
    drawGraph();
  }

  function resetInspector() {
    $('kgInspectorType').textContent = 'نقشه تعاملی دانش';
    $('kgInspectorTitle').textContent = 'یک گره را انتخاب کن';
    $('kgInspectorDescription').textContent =
      'از یکی از موضوعات اصلی شروع کن، شاخه‌های آن را باز کن و از دسته‌های فروشگاه به مفاهیم فنی، سامانه‌ها و کالاهای مرتبط برس.';
    $('kgInspectorBadges').replaceChildren();
    $('kgInspectorRelations').replaceChildren();
    $('kgInspectorProductLink').replaceChildren();
    $('kgImageGallery').hidden = true;
    $('kgImageGallery').replaceChildren();
    activePhotoRequest++;
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
    nodeMap = new Map(graph.nodes.map(node => [node.id, node]));

    $('kgVersion').textContent = 'گراف دانش ' + graph.graph_version;
    $('kgCounts').textContent =
      graph.nodes.filter(node => node.node_type === 'topic').length + ' موضوع اصلی · ' +
      graph.nodes.length + ' گره · ' + graph.relations.length + ' ارتباط';
    resetInspector();
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
