'use strict';

async function initKnowledgeExplorer() {
  const $ = id => document.getElementById(id);
  const host = $('knowledgeExplorer');
  if (!host) return;

  const axisNames = {
    nature: 'ماهیت کالا', system: 'مجموعه و سامانه', application: 'کاربرد و کارکرد',
    technical_feature: 'ویژگی فنی', store_taxonomy: 'ساختار مشاهده‌شده فروشگاه',
    product: 'محصول و نامزد محصول'
  };
  const statusNames = {
    active: 'مفهوم فعال',
    needs_store_evidence: 'نیازمند شاهد فروشگاهی',
    official_current_page: 'مشاهده‌شده در صفحه رسمی',
    affiliate_link_resolves_to_dkp: 'شناسه مقصد پیوند افیلیت ثبت شده',
    third_party_listing_digikala_route_unresolved: 'مسیر فروشگاهی حل‌نشده',
    third_party_market_only: 'شاهد بازار شخص ثالث',
    unverified_candidate: 'نامزد تأییدنشده'
  };
  const relationNames = {
    is_a: 'گونه‌ای از', part_of: 'بخشی از', child_of: 'زیرشاخهٔ',
    listed_under: 'در منو زیر', has_component: 'دارای جزء',
    classified_as: 'طبقه‌بندی‌شده به‌عنوان', used_in: 'استفاده در',
    serves_application: 'کاربرد', discovery_route_in_store: 'مسیر پیشنهادی فروشگاه',
    has_feature: 'دارای ویژگی', may_have_feature: 'ممکن است دارای ویژگی باشد',
    has_evidence: 'دارای شاهد'
  };

  let graph, activeAxis = 'nature', selectedId = null;
  let nodeMap = new Map(), childrenMap = new Map(), parentMap = new Map();
  let forest = [], expanded = new Set(), searchTimer = null, requestNo = 0;

  const make = (tag, cls, text) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  };
  const safeDigikalaLink = value => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && url.hostname === 'www.digikala.com' ? url.href : '';
    } catch { return ''; }
  };
  const sortNodes = (a, b) => String(a.label).localeCompare(String(b.label), 'fa');

  function axisNodes() {
    return graph.nodes.filter(node => node.axis === activeAxis && node.node_type !== 'evidence_source');
  }

  function hierarchyTypes() {
    if (activeAxis === 'nature') return new Set(['is_a']);
    if (activeAxis === 'system') return new Set(['part_of']);
    if (activeAxis === 'store_taxonomy') return new Set(['child_of', 'listed_under']);
    return new Set();
  }

  function rebuildTree() {
    const nodes = axisNodes();
    const valid = new Set(nodes.map(node => node.id));
    const relationTypes = hierarchyTypes();
    childrenMap = new Map();
    parentMap = new Map();

    for (const edge of graph.relations) {
      if (!relationTypes.has(edge.type) || !valid.has(edge.source) || !valid.has(edge.target)) continue;
      if (!childrenMap.has(edge.target)) childrenMap.set(edge.target, []);
      childrenMap.get(edge.target).push(edge.source);
      if (!parentMap.has(edge.source)) parentMap.set(edge.source, edge.target);
    }

    for (const [id, childIds] of childrenMap) {
      childrenMap.set(id, childIds.map(id => nodeMap.get(id)).filter(Boolean).sort(sortNodes).map(node => node.id));
    }

    forest = nodes.filter(node => !parentMap.has(node.id)).sort(sortNodes);
    if (!relationTypes.size) forest = nodes.sort(sortNodes);
    expanded = new Set(forest.filter(node => (childrenMap.get(node.id) || []).length).map(node => node.id));
    $('kgTreeTitle').textContent = 'درخت ' + (axisNames[activeAxis] || 'دانش کالا');
    renderTree();
  }

  function renderBranch(node, depth, ancestors) {
    const wrap = make('div', 'kg-tree-item');
    const row = make('div', 'kg-tree-row');
    const childIds = childrenMap.get(node.id) || [];
    const hasChildren = childIds.length > 0;

    const toggle = make('button', 'kg-toggle', hasChildren ? (expanded.has(node.id) ? '−' : '+') : '');
    toggle.type = 'button';
    toggle.disabled = !hasChildren;
    toggle.setAttribute('aria-label', expanded.has(node.id) ? 'بستن شاخه' : 'بازکردن شاخه');
    toggle.addEventListener('click', () => {
      if (expanded.has(node.id)) expanded.delete(node.id);
      else expanded.add(node.id);
      renderTree();
    });

    const button = make('button', 'kg-node' + (selectedId === node.id ? ' selected' : ''));
    button.type = 'button';
    const label = make('span', 'kg-node-label', node.label);
    button.appendChild(label);
    if (hasChildren) button.appendChild(make('span', 'kg-node-count', childIds.length + ' زیرشاخه'));
    else if (node.node_type === 'product_observation' || node.node_type === 'product_candidate') {
      button.appendChild(make('span', 'kg-node-count', 'رکورد کالا'));
    }
    button.addEventListener('click', () => selectNode(node));
    row.append(toggle, button);
    wrap.appendChild(row);

    if (hasChildren && expanded.has(node.id) && depth < 5 && !ancestors.has(node.id)) {
      const childBox = make('div', 'kg-children');
      const nextAncestors = new Set(ancestors);
      nextAncestors.add(node.id);
      childIds.forEach(id => {
        const child = nodeMap.get(id);
        if (child) childBox.appendChild(renderBranch(child, depth + 1, nextAncestors));
      });
      wrap.appendChild(childBox);
    }
    return wrap;
  }

  function renderTree() {
    const tree = $('kgTree');
    tree.replaceChildren();
    if (!forest.length) {
      tree.appendChild(make('div', 'kg-tree-empty', 'برای این محور گره‌ای ثبت نشده است.'));
      return;
    }
    forest.forEach(node => tree.appendChild(renderBranch(node, 0, new Set())));
  }

  function addBadge(container, label, kind) {
    container.appendChild(make('span', 'kg-badge' + (kind ? ' ' + kind : ''), label));
  }

  function selectNode(node) {
    selectedId = node.id;
    renderTree();
    $('kgDetailType').textContent = axisNames[node.axis] || node.node_type;
    $('kgDetailTitle').textContent = node.label;
    $('kgDetailDesc').textContent = node.description || node.interpretation || 'برای این گره توضیح تفصیلی ثبت نشده است.';

    const meta = $('kgDetailMeta');
    meta.replaceChildren();
    const status = node.status || node.evidence_status;
    if (status) addBadge(meta, statusNames[status] || status, status === 'needs_store_evidence' ? 'caution' : 'good');

    if (node.node_type === 'product_observation' || node.node_type === 'product_candidate') {
      addBadge(meta, 'موجودی: بررسی‌نشده', 'caution');
      addBadge(meta, 'قیمت: مشاهده نشده', 'caution');
    }
    if (node.observed_at) addBadge(meta, 'تاریخ ثبت شاهد: ' + node.observed_at);
    if (Array.isArray(node.aliases) && node.aliases.length) {
      addBadge(meta, 'هم‌نام‌ها: ' + node.aliases.slice(0, 4).join('، '));
    }

    const relatedHost = $('kgDetailRelated');
    relatedHost.replaceChildren();
    const incident = graph.relations.filter(edge => edge.source === node.id || edge.target === node.id);
    const related = incident.map(edge => {
      const otherId = edge.source === node.id ? edge.target : edge.source;
      return { edge, node: nodeMap.get(otherId) };
    }).filter(item => item.node && item.node.node_type !== 'evidence_source');

    if (related.length) {
      const section = make('div', 'kg-detail-section');
      section.appendChild(make('strong', '', 'ارتباط‌های ثبت‌شده'));
      const list = make('div', 'kg-related');
      related.slice(0, 9).forEach(item => {
        const row = make('div', 'kg-related-item');
        row.appendChild(make('span', '', relationNames[item.edge.type] || item.edge.type));
        const pick = make('button', 'quiet', item.node.label);
        pick.type = 'button';
        pick.style.padding = '4px 7px';
        pick.style.fontSize = '9px';
        pick.addEventListener('click', () => selectNode(item.node));
        row.appendChild(pick);
        list.appendChild(row);
      });
      section.appendChild(list);
      relatedHost.appendChild(section);
    }

    const products = related.map(item => item.node)
      .filter(item => item.node_type === 'product_observation' || item.node_type === 'product_candidate');
    if (products.length) {
      const section = make('div', 'kg-detail-section');
      section.appendChild(make('strong', '', 'شواهد محصول مرتبط'));
      const list = make('div', 'kg-related');
      products.slice(0, 7).forEach(product => {
        const row = make('div', 'kg-related-item');
        row.appendChild(make('span', '', product.label));
        const url = safeDigikalaLink(product.digikala_url);
        if (url) {
          const link = make('a', '', 'بررسی مقصد ↗');
          link.href = url;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          row.appendChild(link);
        } else {
          row.appendChild(make('span', 'kg-badge caution', 'نامزد؛ مقصد حل‌نشده'));
        }
        list.appendChild(row);
      });
      section.appendChild(list);
      relatedHost.appendChild(section);
    }

    if (!related.length) {
      relatedHost.appendChild(make('div', 'kg-detail-section kg-foot', 'برای این گره هنوز ارتباط مستقیمی ثبت نشده است.'));
    }

    const liveButton = $('kgLiveSearchBtn');
    liveButton.hidden = false;
    liveButton.onclick = () => {
      $('query').value = node.label;
      $('query').scrollIntoView({ behavior: 'smooth', block: 'center' });
      search();
    };
  }

  function renderSearchResults(payload) {
    const host = $('kgSearchResults');
    host.hidden = false;
    host.replaceChildren();
    host.appendChild(make('div', 'kg-result-title', 'نتایج جست‌وجوی معنایی برای «' + payload.query + '» · ' + payload.total + ' مورد'));

    if (!payload.results || !payload.results.length) {
      host.appendChild(make('div', 'kg-tree-empty', 'برای این عبارت در محور انتخاب‌شده نتیجه‌ای پیدا نشد. محور دیگری را امتحان کن.'));
      return;
    }

    const list = make('div', 'kg-result-list');
    payload.results.slice(0, 12).forEach(hit => {
      const button = make('button', 'kg-result');
      button.type = 'button';
      const copy = make('span', '', hit.label);
      copy.appendChild(make('small', '', statusNames[hit.status] || axisNames[hit.axis] || hit.node_type));
      button.append(copy, make('span', '', 'مشاهده ←'));
      button.addEventListener('click', () => {
        const node = nodeMap.get(hit.node_id);
        if (node) {
          selectNode(node);
          $('kgDetailTitle').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      });
      list.appendChild(button);
    });
    host.appendChild(list);
  }

  async function runKnowledgeSearch() {
    const query = $('kgQuery').value.trim();
    if (!query) {
      requestNo++;
      $('kgSearchResults').hidden = true;
      $('kgSearchResults').replaceChildren();
      return;
    }

    const thisRequest = ++requestNo;
    $('kgSearchBtn').disabled = true;
    $('kgSearchBtn').textContent = 'در حال جست‌وجو…';
    try {
      const params = new URLSearchParams({ q: query, axis: activeAxis, limit: '20' });
      const response = await fetch('/api/knowledge/search?' + params.toString(), { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'جست‌وجوی دانش ناموفق بود.');
      if (thisRequest === requestNo) renderSearchResults(payload);
    } catch (error) {
      if (thisRequest === requestNo) {
        const host = $('kgSearchResults');
        host.hidden = false;
        host.replaceChildren(make('div', 'kg-tree-empty', 'خطا در جست‌وجوی گراف دانش: ' + String(error.message || error)));
      }
    } finally {
      if (thisRequest === requestNo) {
        $('kgSearchBtn').disabled = false;
        $('kgSearchBtn').textContent = 'جست‌وجو در دانش';
      }
    }
  }

  function renderAxes() {
    const host = $('kgAxes');
    host.replaceChildren();
    graph.axes.filter(axis => axis.id !== 'evidence').forEach(axis => {
      const button = make('button', 'kg-axis' + (activeAxis === axis.id ? ' active' : ''), axis.label);
      button.type = 'button';
      button.dataset.axis = axis.id;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', activeAxis === axis.id ? 'true' : 'false');
      button.addEventListener('click', () => {
        activeAxis = axis.id;
        selectedId = null;
        renderAxes();
        rebuildTree();
        $('kgDetailType').textContent = 'راهنمای انتخاب';
        $('kgDetailTitle').textContent = 'یک شاخه را انتخاب کن';
        $('kgDetailDesc').textContent = 'با بازکردن شاخه‌ها، زیرگروه‌ها و ارتباط مفاهیم را می‌بینی.';
        $('kgDetailMeta').replaceChildren();
        $('kgDetailRelated').replaceChildren();
        $('kgLiveSearchBtn').hidden = true;
        if ($('kgQuery').value.trim()) runKnowledgeSearch();
      });
      host.appendChild(button);
    });
  }

  try {
    const response = await fetch('/api/knowledge/graph', { cache: 'no-store' });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    graph = await response.json();
    nodeMap = new Map(graph.nodes.map(node => [node.id, node]));

    $('kgVersion').textContent = 'نسخه گراف ' + graph.graph_version;
    $('kgCounts').textContent = graph.nodes.length + ' گره · ' + graph.relations.length + ' ارتباط';
    renderAxes();
    rebuildTree();

    $('kgSearchBtn').addEventListener('click', runKnowledgeSearch);
    $('kgQuery').addEventListener('keydown', event => {
      if (event.key === 'Enter') runKnowledgeSearch();
    });
    $('kgQuery').addEventListener('input', () => {
      clearTimeout(searchTimer);
      if (!$('kgQuery').value.trim()) {
        requestNo++;
        $('kgSearchResults').hidden = true;
        $('kgSearchResults').replaceChildren();
        return;
      }
      searchTimer = setTimeout(runKnowledgeSearch, 420);
    });
    $('kgClearBtn').addEventListener('click', () => {
      $('kgQuery').value = '';
      requestNo++;
      $('kgSearchResults').hidden = true;
      $('kgSearchResults').replaceChildren();
      $('kgSearchBtn').disabled = false;
      $('kgSearchBtn').textContent = 'جست‌وجو در دانش';
      activeAxis = 'nature';
      selectedId = null;
      renderAxes();
      rebuildTree();
      $('kgDetailType').textContent = 'راهنمای انتخاب';
      $('kgDetailTitle').textContent = 'یک شاخه را انتخاب کن';
      $('kgDetailDesc').textContent = 'با بازکردن شاخه‌ها، زیرگروه‌ها و ارتباط مفاهیم را می‌بینی.';
      $('kgDetailMeta').replaceChildren();
      $('kgDetailRelated').replaceChildren();
      $('kgLiveSearchBtn').hidden = true;
    });
  } catch (error) {
    $('kgVersion').textContent = 'گراف دانش در دسترس نیست';
    $('kgTree').replaceChildren(make('div', 'kg-tree-empty',
      'دریافت گراف دانش ناموفق بود. سرور را با run.ps1 اجرا کن. ' + String(error.message || error)));
  }
}
