'use strict';

// Local proof-of-concept. Digikala endpoints used here are undocumented/unofficial.
// Do not use for production or bulk crawling without permission from Digikala/Affilio.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 4173);
const PUBLIC_DIR = path.join(__dirname, 'public');
const cache = new Map();
const CACHE_MS = 30_000;
const MAX_QUERY_LENGTH = 100;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const IMAGE_HOST_RE = /^dkstatics-public(?:-\d+)?\.digikala\.com$/i;

const SEARCH_EXPANSIONS = [
  { key: 'motor', terms: ['موتور', 'engine', 'motor'], variants: ['موتور', 'موتور الکتریکی', 'موتور احتراقی', 'موتور بنزینی کوچک', 'موتور دیزلی کوچک', 'موتور DC', 'موتور براشلس', 'موتور پاراموتور', 'موتور پاراترایک', 'موتور صنعتی', 'موتور کولر', 'موتور سیکلت', 'موتور برق', 'engine'] },
  { key: 'pump', terms: ['پمپ', 'pump', 'کمپرسور'], variants: ['پمپ', 'پمپ آب', 'پمپ هوا', 'پمپ صنعتی', 'پمپ سوخت'] },
  { key: 'battery', terms: ['باتری', 'باطری', 'battery'], variants: ['باتری', 'باتری لیتیومی', 'باتری صنعتی', 'باتری خودرو', 'باتری یو پی اس'] },
  { key: 'tool', terms: ['ابزار', 'tool', 'دریل'], variants: ['ابزار', 'ابزار برقی', 'ابزار صنعتی', 'ابزار اندازه‌گیری'] },
];

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[يى]/g, 'ی')
    .replace(/[ك]/g, 'ک')
    .replace(/[\u200c\u200f\u200e]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function queryPlan(query, wide) {
  if (!wide) return [query];
  const n = normalize(query);

  if (/پاراترایک|پاراموتور|paramotor|paratrike/i.test(n)) {
    return [...new Set([
      query,
      'پاراموتور',
      'موتور پاراموتور',
      'انجین پاراموتور',
      'paramotor engine',
      'paramotor power unit',
      'Nirvana NS200',
      'موتور بنزینی دو زمانه',
      'موتور تک بنزینی'
    ])];
  }

  if (['موتور', 'motor', 'engine'].includes(n)) {
    return [
      query,
      'موتور الکتریکی',
      'موتور احتراقی',
      'موتور تک بنزینی',
      'موتور بنزینی کوچک',
      'موتور پاراموتور',
      'انجین پاراموتور',
      'موتور صنعتی',
      'موتور سیکلت',
      'موتور برق'
    ];
  }

  const matched = SEARCH_EXPANSIONS.find(
    group => group.terms.some(term => normalize(term) === n)
  );

  return matched ? [...new Set(matched.variants)] : [query];
}
function safeNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[,٬\s]/g, ''));
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function getAt(object, pathParts) {
  return pathParts.reduce((current, key) => current && current[key] !== undefined ? current[key] : undefined, object);
}

function pickText(object, keys) {
  for (const key of keys) {
    const value = object && object[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function isAllowedImageUrl(value) {
  try {
    const parsed = new URL(String(value));
    return parsed.protocol === 'https:' && IMAGE_HOST_RE.test(parsed.hostname) && parsed.pathname.startsWith('/digikala-products/');
  } catch {
    return false;
  }
}

function normalizeImageCandidate(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  let candidate = value.trim();
  if (candidate.startsWith('//')) candidate = 'https:' + candidate;
  return isAllowedImageUrl(candidate) ? candidate : '';
}

function getImage(product) {
  // Search the most common known fields first; current Digikala payloads may
  // put the URL inside images.main.url[0] rather than a flat string.
  const preferred = [
    getAt(product, ['images', 'main_url']),
    getAt(product, ['images', 'main', 'url']),
    getAt(product, ['images', 'main', 'url', 0]),
    getAt(product, ['images', 'main']),
    getAt(product, ['image', 'url']),
    getAt(product, ['seo', 'open_graph', 'image']),
    getAt(product, ['thumbnail', 'url']),
    product.image_url,
    product.thumbnail,
    product.image,
    getAt(product, ['images', 0, 'url']),
  ];
  const visited = new Set();
  function scan(value, depth = 0) {
    if (depth > 10 || value == null) return '';
    if (typeof value === 'string') return normalizeImageCandidate(value);
    if (typeof value !== 'object' || visited.has(value)) return '';
    visited.add(value);
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = scan(item, depth + 1);
        if (found) return found;
      }
      return '';
    }
    const entries = Object.entries(value);
    entries.sort(([a], [b]) => {
      const rank = key => /main_url|image|thumbnail|picture|cover|media|url|src/i.test(key) ? 0 : 1;
      return rank(a) - rank(b);
    });
    for (const [, nested] of entries) {
      const found = scan(nested, depth + 1);
      if (found) return found;
    }
    return '';
  }
  for (const candidate of preferred) {
    const found = scan(candidate);
    if (found) return found;
  }
  return scan(product);
}

function getPrice(product) {
  const tomanCandidates = [
    product.selling_price_tooman,
    getAt(product, ['price', 'selling_price_tooman']),
    getAt(product, ['default_variant', 'price', 'selling_price_tooman']),
    getAt(product, ['price', 'toman']),
  ];
  for (const candidate of tomanCandidates) {
    const n = safeNumber(candidate);
    if (n) return Math.round(n);
  }
  const rialCandidates = [
    product.selling_price_rial,
    getAt(product, ['default_variant', 'price', 'selling_price']),
    getAt(product, ['price', 'selling_price']),
    getAt(product, ['variant', 'price', 'selling_price']),
    product.selling_price,
  ];
  for (const candidate of rialCandidates) {
    const n = safeNumber(candidate);
    if (n) return Math.round(n / 10);
  }
  return null;
}

function toProduct(candidate, sourceQuery) {
  const id = candidate.id ?? candidate.product_id ?? candidate.dkp ?? candidate.productId ?? null;
  const title = pickText(candidate, ['title_fa', 'title', 'name', 'product_title', 'display_name']);
  if (!title || !id) return null;
  const nestedUri = getAt(candidate, ['url', 'uri']);
  const maybeUrl = pickText(candidate, ['product_url', 'canonical_url', 'web_url']) ||
    (typeof nestedUri === 'string' ? nestedUri : '') ||
    (typeof candidate.url === 'string' ? candidate.url : '');
  let url = maybeUrl;
  if (url && url.startsWith('//')) url = 'https:' + url;
  else if (url && url.startsWith('/')) url = 'https://www.digikala.com' + url;
  if (!url || !/^https:\/\/(www\.)?digikala\.com\//i.test(url)) {
    url = `https://www.digikala.com/product/dkp-${encodeURIComponent(String(id))}/`;
  }
  const nestedCategory = getAt(candidate, ['category', 'title_fa']);
  const dataLayerCategory = getAt(candidate, ['data_layer', 'category']);
  const category = pickText(candidate, ['category_title', 'category_name']) ||
    (typeof candidate.category === 'string' ? candidate.category : '') ||
    (typeof nestedCategory === 'string' ? nestedCategory : '') ||
    (typeof dataLayerCategory === 'string' ? dataLayerCategory : '');
  return {
    id: String(id),
    title,
    url,
    image: getImage(candidate),
    priceToman: getPrice(candidate),
    category: typeof category === 'string' ? category : '',
    sourceQuery,
  };
}

function extractProducts(payload, sourceQuery) {
  const products = [];
  const seenObjects = new Set();
  const seenProducts = new Set();
  function visit(value, depth) {
    if (!value || typeof value !== 'object' || depth > 8 || seenObjects.has(value)) return;
    seenObjects.add(value);
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry, depth + 1);
      return;
    }
    const title = pickText(value, ['title_fa', 'title', 'product_title', 'display_name', 'name']);
    const id = value.id ?? value.product_id ?? value.dkp ?? value.productId;
    const productLike = Boolean(title && id && (
      value.default_variant || value.product_url || (typeof value.url === 'string' && value.url.includes('/product')) ||
      value.images || value.image_url || value.selling_price || value.selling_price_rial || value.selling_price_tooman ||
      (value.price && typeof value.price === 'object')
    ));
    if (productLike) {
      const product = toProduct(value, sourceQuery);
      if (product && !seenProducts.has(product.id)) {
        seenProducts.add(product.id);
        products.push(product);
      }
    }
    for (const [key, nested] of Object.entries(value)) {
      if (key === 'headers' || key === 'cookies') continue;
      if (nested && typeof nested === 'object') visit(nested, depth + 1);
    }
  }
  visit(payload, 0);
  return products;
}

async function fetchJsonEndpoint(endpoint, timeoutMs = 10_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'accept': 'application/json, text/plain, */*',
        'user-agent': USER_AGENT,
        'accept-language': 'fa-IR,fa;q=0.9,en;q=0.7',
        'referer': 'https://www.digikala.com/',
      },
      signal: controller.signal,
    });
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (!contentType.toLowerCase().includes('json')) throw new Error(`پاسخ JSON نبود (${contentType || 'نوع نامشخص'})`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

const DIGIKALA_MCP_ENDPOINT = process.env.DIGIKALA_MCP_URL || 'https://digikala-mcp.mmdju.workers.dev/mcp';
let mcpRequestId = 0;

function parseMcpText(text) {
  if (text && typeof text === 'object') return text;
  const raw = String(text || '').trim();
  if (!raw) throw new Error('پاسخ MCP خالی بود.');
  try { return JSON.parse(raw); } catch {}
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try { return JSON.parse(raw.slice(first, last + 1)); } catch {}
  }
  throw new Error('ساختار JSON پاسخ MCP قابل خواندن نبود.');
}

async function callDigikalaMcp(toolName, args) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(DIGIKALA_MCP_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept': 'application/json, text/event-stream',
        'user-agent': 'RahayabKala-Prototype/0.3'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: ++mcpRequestId,
        method: 'tools/call',
        params: { name: toolName, arguments: args }
      }),
      signal: controller.signal
    });

    const raw = await response.text();

    if (!response.ok) {
      throw new Error(`MCP HTTP ${response.status}: ${raw.slice(0, 180)}`);
    }

    let envelope;

    try {
      envelope = parseMcpText(raw);
    } catch {
      const lines = raw.split(/\r?\n/).filter(line => line.startsWith('data:'));
      if (!lines.length) throw new Error('پاسخ سرویس MCP معتبر نیست.');
      envelope = parseMcpText(lines[lines.length - 1].slice(5).trim());
    }

    if (envelope.error) {
      throw new Error(envelope.error.message || JSON.stringify(envelope.error));
    }

    const result = envelope.result || envelope;

    if (result.isError) {
      const message = (result.content || [])
        .map(item => item.text || '')
        .filter(Boolean).join('؛ ');
      throw new Error(message || 'ابزار جست‌وجو خطا برگرداند.');
    }

    if (result.structuredContent && typeof result.structuredContent === 'object') {
      return result.structuredContent;
    }

    const block = (result.content || []).find(item => typeof item.text === 'string');
    if (block) return parseMcpText(block.text);

    return result;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('مهلت پاسخ سرویس واسط تمام شد.');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeSuggestionList(values) {
  if (!Array.isArray(values)) return [];

  const output = [];

  for (const item of values) {
    const value = typeof item === 'string'
      ? item
      : pickText(item, ['keyword', 'query', 'title_fa', 'title', 'name', 'text']);

    if (value && !output.some(x => normalize(x) === normalize(value))) {
      output.push(value);
    }
  }

  return output;
}

function normalizeMcpProduct(item, query) {
  if (!item || typeof item !== 'object') return null;

  const candidate = {
    ...item,
    id: item.id ?? item.product_id ?? item.dkp,
    title: item.title ?? item.title_fa ?? item.name_fa ?? item.name,
    product_url: item.url ?? item.product_url ?? item.canonical_url,
    image: item.image ?? item.image_url ?? item.thumbnail,
    selling_price_tooman: item.price_toman ?? item.selling_price_tooman,
    category: item.category_title ?? item.category_name ?? item.category ?? ''
  };

  return toProduct(candidate, query);
}
async function requestAutocomplete(query) {
  const cacheKey = `suggest:${normalize(query)}`;
  const cached = cache.get(cacheKey);

  if (cached && Date.now() - cached.time < 60000) {
    return { ...cached.value, cached: true };
  }

  try {
    const payload = await callDigikalaMcp(
      'digikala_suggest',
      { query, limit: 12 }
    );

    const keywords = normalizeSuggestionList(
      payload.keywords || payload.suggestions || payload.terms || []
    );

    const categories = [];
    const seen = new Set();

    for (const item of (Array.isArray(payload.categories) ? payload.categories : [])) {
      const category = item.category && typeof item.category === 'object'
        ? item.category : item;

      const id = category.id ?? category.category_id ?? item.category_id;
      const titleFa = pickText(category, ['title_fa', 'title', 'name_fa', 'name']);

      if (id == null || !titleFa || seen.has(String(id))) continue;

      seen.add(String(id));

      categories.push({
        id: String(id),
        titleFa,
        titleEn: pickText(category, ['title_en']),
        code: pickText(category, ['code', 'slug']),
        query: pickText(item, ['query', 'keyword', 'term']) || query
      });
    }

    const value = {
      query,
      endpoint: DIGIKALA_MCP_ENDPOINT,
      keywords: keywords.slice(0, 15),
      categories: categories.slice(0, 15),
      error: null
    };

    cache.set(cacheKey, { time: Date.now(), value });
    return { ...value, cached: false };

  } catch (error) {
    return {
      query,
      endpoint: DIGIKALA_MCP_ENDPOINT,
      keywords: [],
      categories: [],
      error: String(error.message || error)
    };
  }
}

async function requestSearch(query) {
  const cacheKey = `mcp-search:${normalize(query)}`;
  const cached = cache.get(cacheKey);

  if (cached && Date.now() - cached.time < 60000) {
    return { ...cached.value, cached: true };
  }

  try {
    const payload = await callDigikalaMcp(
      'search_digikala',
      { query, page: 1, limit: 20 }
    );

    const items = Array.isArray(payload.items)
      ? payload.items
      : Array.isArray(payload.products) ? payload.products : [];

    const products = items
      .map(item => normalizeMcpProduct(item, query))
      .filter(Boolean);

    const value = {
      query,
      endpoint: DIGIKALA_MCP_ENDPOINT,
      products,
      error: null,
      attempts: [],
      lowConfidence: Boolean(payload.low_confidence),
      unmatchedTerms: payload.unmatched_terms || [],
      returned: payload.returned ?? products.length,
      totalItemsEstimate: payload.total_items_estimate ?? null
    };

    cache.set(cacheKey, { time: Date.now(), value });
    return { ...value, cached: false };

  } catch (error) {
    const message = String(error.message || error);

    return {
      query,
      endpoint: DIGIKALA_MCP_ENDPOINT,
      products: [],
      error: message,
      attempts: [{
        endpoint: DIGIKALA_MCP_ENDPOINT,
        status: null,
        reason: message
      }]
    };
  }
}

async function requestCategorySearch(category, fallbackQuery) {
  const categoryId = String(category.id || '');
  const query = String(category.query || fallbackQuery || '').trim();
  const title = String(category.titleFa || category.title_fa || 'دسته‌بندی');

  if (!/^\d+$/.test(categoryId)) {
    return {
      query, categoryId, categoryTitle: title,
      products: [], error: 'شناسه دسته‌بندی معتبر نیست.', attempts: []
    };
  }

  const cacheKey = `mcp-category:${categoryId}:${normalize(query)}`;
  const cached = cache.get(cacheKey);

  if (cached && Date.now() - cached.time < 60000) {
    return { ...cached.value, cached: true };
  }

  try {
    const payload = await callDigikalaMcp('search_digikala', {
      query,
      category_id: Number(categoryId),
      page: 1,
      limit: 20
    });

    const items = Array.isArray(payload.items)
      ? payload.items
      : Array.isArray(payload.products) ? payload.products : [];

    const products = items
      .map(item => normalizeMcpProduct(item, query))
      .filter(Boolean);

    const value = {
      query, categoryId, categoryTitle: title,
      endpoint: DIGIKALA_MCP_ENDPOINT,
      products, error: null, attempts: [],
      lowConfidence: Boolean(payload.low_confidence),
      unmatchedTerms: payload.unmatched_terms || []
    };

    cache.set(cacheKey, { time: Date.now(), value });
    return { ...value, cached: false };

  } catch (error) {
    const message = String(error.message || error);

    return {
      query, categoryId, categoryTitle: title,
      endpoint: DIGIKALA_MCP_ENDPOINT,
      products: [], error: message,
      attempts: [{
        endpoint: DIGIKALA_MCP_ENDPOINT,
        status: null,
        reason: message
      }]
    };
  }
}

async function handleSearch(url, response) {
  const query = String(url.searchParams.get('query') || '').trim().slice(0, MAX_QUERY_LENGTH);
  const wide = url.searchParams.get('wide') !== 'false';
  const requestedCategoryId = String(url.searchParams.get('categoryId') || '').trim();
  const requestedCategoryTitle = String(url.searchParams.get('categoryTitle') || '').trim().slice(0, 100);

  if (!query) {
    sendJson(response, 400, { error: 'عبارت جست‌وجو خالی است.' });
    return;
  }

  let autocomplete = { keywords: [], categories: [], error: null };
  let result;

  if (requestedCategoryId) {
    result = await requestCategorySearch({
      id: requestedCategoryId,
      titleFa: requestedCategoryTitle || 'دسته‌بندی انتخاب‌شده',
      query
    }, query);

  } else {
    // One suggestion request and one search request; no burst of old 404 routes.
    if (wide) autocomplete = await requestAutocomplete(query);
    result = await requestSearch(query);
  }

  const products = result.products || [];
  const results = [{
    ...result,
    kind: requestedCategoryId ? 'category' : 'global'
  }];

  sendJson(response, 200, {
    query,
    wide,
    categoryScoped: Boolean(requestedCategoryId),
    plannedQueries: [query],
    categorySuggestions: requestedCategoryId ? [] : (autocomplete.categories || []),
    autocompleteKeywords: requestedCategoryId ? [] : (autocomplete.keywords || []),
    autocompleteError: requestedCategoryId ? null : (autocomplete.error || null),
    searchedCategoryCount: 0,
    results,
    products,
    total: products.length,
    imageCount: products.filter(product => Boolean(product.image)).length,
    missingImageCount: products.filter(product => !product.image).length,
    totalItemsEstimate: result.totalItemsEstimate ?? null,
    lowConfidence: Boolean(result.lowConfidence),
    unmatchedTerms: result.unmatchedTerms || [],
    sourceType: 'third-party-read-only-mcp-bridge',
    provider: 'MMDJU Digikala MCP - unofficial third-party bridge',
    warning: 'اطلاعات از یک سرویس واسط عمومی و غیررسمی دریافت می‌شود؛ این سرویس متعلق به دیجی‌کالا نیست و برای استفاده تجاری یا تضمین پایداری تأیید نشده است. قیمت و موجودی را در صفحه مقصد بررسی کنید.',
    updatedAt: new Date().toISOString()
  });
}

async function handleImageProxy(url, response) {
  const source = url.searchParams.get('url') || '';
  if (!isAllowedImageUrl(source)) {
    sendJson(response, 400, { error: 'آدرس تصویر معتبر یا مجاز نیست.' });
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const upstream = await fetch(source, {
      headers: {
        'accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'user-agent': USER_AGENT,
        'referer': 'https://www.digikala.com/',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!upstream.ok) {
      console.error(`[image proxy] upstream HTTP ${upstream.status}: ${source}`);
      response.writeHead(502, { 'cache-control': 'no-store' });
      response.end('Image source returned an error');
      return;
    }
    // Re-check the final URL after redirects to prevent fetching an unrelated host.
    if (!isAllowedImageUrl(upstream.url)) {
      response.writeHead(502, { 'cache-control': 'no-store' });
      response.end('Image source redirected to an untrusted host');
      return;
    }
    const contentType = (upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!contentType.startsWith('image/')) {
      response.writeHead(502, { 'cache-control': 'no-store' });
      response.end('The remote response was not an image');
      return;
    }
    const declaredSize = Number(upstream.headers.get('content-length') || 0);
    if (declaredSize > MAX_IMAGE_BYTES) {
      response.writeHead(413, { 'cache-control': 'no-store' });
      response.end('Image is too large');
      return;
    }
    const reader = upstream.body && upstream.body.getReader ? upstream.body.getReader() : null;
    if (!reader) {
      response.writeHead(502); response.end('No image body'); return;
    }
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_IMAGE_BYTES) {
        await reader.cancel().catch(() => {});
        response.writeHead(413, { 'cache-control': 'no-store' });
        response.end('Image is too large');
        return;
      }
      chunks.push(Buffer.from(value));
    }
    const data = Buffer.concat(chunks, total);
    response.writeHead(200, {
      'content-type': contentType,
      'content-length': data.length,
      'cache-control': 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
    });
    response.end(data);
  } catch (error) {
    console.error(`[image proxy] ${String(error.message || error)}: ${source}`);
    response.writeHead(502, { 'cache-control': 'no-store' });
    response.end(error && error.name === 'AbortError' ? 'Image request timed out' : 'Could not fetch image');
  } finally {
    clearTimeout(timer);
  }
}

function sendJson(response, status, payload) {
  const data = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(data),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(data);
}

function serveStatic(url, response) {
  let pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const fullPath = path.resolve(PUBLIC_DIR, '.' + pathname);
  if (!fullPath.startsWith(PUBLIC_DIR + path.sep) && fullPath !== path.join(PUBLIC_DIR, 'index.html')) {
    response.writeHead(403); response.end('Forbidden'); return;
  }
  fs.readFile(fullPath, (error, content) => {
    if (error) { response.writeHead(404); response.end('Not found'); return; }
    const ext = path.extname(fullPath).toLowerCase();
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
    response.writeHead(200, { 'content-type': types[ext] || 'application/octet-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    response.end(content);
  });
}

const server = http.createServer(async (request, response) => {
  const base = `http://${request.headers.host || `${HOST}:${PORT}`}`;
  const url = new URL(request.url, base);
  if (request.method !== 'GET') { response.writeHead(405); response.end('Method not allowed'); return; }
  if (url.pathname === '/api/health') {
    sendJson(response, 200, { ok: true, node: process.version, mode: 'local-prototype', liveApiVerifiedHere: false });
    return;
  }
  if (url.pathname === '/api/search') {
    try { await handleSearch(url, response); }
    catch (error) { sendJson(response, 500, { error: 'خطای داخلی در اجرای جست‌وجو.', detail: String(error.message || error) }); }
    return;
  }
  if (url.pathname === '/api/image') {
    await handleImageProxy(url, response);
    return;
  }
  serveStatic(url, response);
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`Rahayab Kala local prototype: http://${HOST}:${PORT}`);
    console.log('Live Digikala API paths are unofficial/undocumented; this is a technical test, not a production integration.');
  });
  function shutdown() { server.close(() => process.exit(0)); }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = { getImage, extractProducts, isAllowedImageUrl, requestAutocomplete, queryPlan, server };
