import {
  initSelOcr,
  toggleSelectionMode,
  exitSelectionMode,
  isInSelectionMode,
  openSelOcrModal,
  closeSelOcrModal,
} from './ocr-sel-ocr.js';

const DATA_URL = 'data/ocr-review-pages.json';

// ── suggest modal state ──────────────────────────────────
let suggestTargetKey = null;
let suggestTargetOriginal = null;
let suggestCallback = null;

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({length: m + 1}, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

function suggestCandidates(original) {
  const prefix2 = original.slice(0, 2);
  const pinned = [], others = [];
  for (const [id, sp] of Object.entries(surveyIndex)) {
    const dist = levenshtein(original, id);
    if (dist < 1 || dist > 1) continue;
    const entry = { id, name: sp.name, pref: sp.pref };
    if (id.startsWith(prefix2)) pinned.push(entry);
    else others.push(entry);
  }
  pinned.sort((a, b) => a.id.localeCompare(b.id));
  others.sort((a, b) => a.id.localeCompare(b.id));
  return { pinned, others };
}

function makeSuggestItem(c) {
  const li = document.createElement('li');
  li.innerHTML = `
    <span class="suggest-id">${escHtml(c.id)}</span>
    <span class="suggest-place">${escHtml(c.name)}</span>
    <span class="suggest-pref">${escHtml(c.pref)}</span>
  `;
  li.title = `クリックで「${c.id}」を修正値に設定`;
  li.addEventListener('click', () => applySuggestion(c.id));
  return li;
}

function openSuggestModal(key, original, callback = null) {
  suggestTargetKey = key;
  suggestTargetOriginal = original;
  suggestCallback = callback;
  document.getElementById('suggestTitle').textContent = `「${original}」の候補（1文字違い）`;
  const list = document.getElementById('suggestList');
  list.innerHTML = '';
  const { pinned, others } = suggestCandidates(original);
  if (!pinned.length && !others.length) {
    list.innerHTML = '<li class="no-suggest">該当する候補がありませんでした</li>';
  } else {
    if (pinned.length) {
      const hdr = document.createElement('li');
      hdr.className = 'suggest-section';
      hdr.textContent = `頭2桁固定（${original.slice(0,2)}xx）`;
      list.appendChild(hdr);
      pinned.forEach(c => list.appendChild(makeSuggestItem(c)));
    }
    if (others.length) {
      const sep = document.createElement('li');
      sep.className = 'suggest-sep';
      list.appendChild(sep);
      const hdr = document.createElement('li');
      hdr.className = 'suggest-section';
      hdr.textContent = '頭2桁を問わず';
      list.appendChild(hdr);
      others.forEach(c => list.appendChild(makeSuggestItem(c)));
    }
  }
  document.getElementById('suggestModal').classList.add('visible');
}

function closeSuggestModal() {
  document.getElementById('suggestModal').classList.remove('visible');
  suggestTargetKey = null;
  suggestTargetOriginal = null;
}

function applySuggestion(id) {
  if (suggestCallback) {
    suggestCallback(id);
  } else if (suggestTargetKey) {
    const input = document.querySelector(`input[data-key="${CSS.escape(suggestTargetKey)}"]`);
    if (input) { input.value = id; input.dispatchEvent(new Event('change')); }
  }
  closeSuggestModal();
}

// ── アプリ状態 ────────────────────────────────────────────
let allPages = [];
let surveyIndex = {};
let filteredPages = [];
let currentIndex = 0;
let filterUnmatchedOnly = false;

const corrections = new Map();
const additions = new Map();
let additionSeq = 0;

// ── localStorage ─────────────────────────────────────────
const LS_KEY = 'ocr-review-corrections-v1';

function saveToLocalStorage() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({
      corrections: Array.from(corrections.entries()),
      additions: Array.from(additions.entries()),
      additionSeq,
    }));
  } catch (e) { console.warn('localStorage 保存失敗', e); }
}

function loadFromLocalStorage() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const { corrections: c, additions: a, additionSeq: seq } = JSON.parse(raw);
    c?.forEach(([k, v]) => corrections.set(k, v));
    a?.forEach(([k, v]) => additions.set(k, v));
    if (typeof seq === 'number') additionSeq = seq;
  } catch (e) { console.warn('localStorage 読み込み失敗', e); }
}

// ── ユーティリティ ────────────────────────────────────────
function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function corrKey(batch, source_image, original) {
  return `${batch}|${source_image}|${original}`;
}

function isUnmatched(num) { return !surveyIndex[num]; }
function hasUnmatched(page) { return page.location_numbers.some(isUnmatched); }

function rebuildFilteredPages() {
  filteredPages = filterUnmatchedOnly ? allPages.filter(hasUnmatched) : allPages;
}

function updateStatus() {
  const total = filteredPages.length;
  const idx = total > 0 ? currentIndex + 1 : 0;
  const input = document.getElementById('pageInput');
  if (document.activeElement !== input) input.value = idx;
  document.getElementById('pageTotalLabel').textContent = `/ ${total} ページ`;
  document.getElementById('corrBadge').textContent = String(corrections.size + additions.size);
  if (total > 0) history.replaceState(null, '', `#p${idx}`);
}

function buildImageUrl(serviceId) {
  if (!serviceId) return null;
  const base = serviceId.replace(/\/info\.json$/, '').replace(/\/$/, '');
  return `${base}/full/900,/0/default.jpg`;
}

// ── レンダリング ──────────────────────────────────────────
function renderPage(page) {
  if (!page) return;

  const batchSelect = document.getElementById('batchSelect');
  if (batchSelect.value !== page.batch) batchSelect.value = page.batch;

  // left: page info
  const infoEl = document.getElementById('pageInfo');
  const mapNums = page.source_map_numbers || [];
  const mapLinksHtml = mapNums.map(n =>
    `<a href="calibration-preview.html?map=LAJ_${escHtml(n)}" target="_blank" rel="noopener">LAJ_${escHtml(n)}</a>`
  ).join('');
  infoEl.innerHTML = `
    <h2>${escHtml(page.source_title || page.source_ljc_id || '')}</h2>
    <div class="meta">
      <div>バッチ: <strong>${escHtml(page.batch)}</strong></div>
      <div>ページ: <strong>${escHtml(page.source_image)}</strong> (カード ${escHtml(String(page.source_canvas_label ?? '?'))})</div>
      <div><code style="font-size:0.82em">${escHtml(page.source_ljc_id || '')}</code></div>
    </div>
    ${mapLinksHtml ? `<div class="map-links">${mapLinksHtml}</div>` : ''}
  `;

  // left: location numbers
  const listEl = document.getElementById('locList');
  listEl.innerHTML = '';
  if (!page.location_numbers.length) {
    listEl.innerHTML = '<li style="color:var(--muted)">地点番号なし</li>';
  } else {
    for (const num of page.location_numbers) {
      const unmatched = isUnmatched(num);
      const li = document.createElement('li');
      li.className = unmatched ? 'loc-unmatched' : 'loc-matched';
      const key = corrKey(page.batch, page.source_image, num);
      const existing = corrections.get(key);
      const idSpan = document.createElement('span');
      idSpan.className = 'loc-id ' + (unmatched ? 'unmatched' : 'matched');
      idSpan.textContent = num;

      if (!unmatched) {
        const sp = surveyIndex[num];
        const head = document.createElement('div');
        head.className = 'loc-matched-head';
        head.appendChild(idSpan);
        const btnEdit = document.createElement('button');
        btnEdit.type = 'button';
        btnEdit.className = 'btn-edit-matched';
        btnEdit.textContent = existing ? '修正中' : '修正';
        head.appendChild(btnEdit);
        li.appendChild(head);
        const placeEl = document.createElement('div');
        placeEl.className = 'loc-place';
        placeEl.textContent = sp ? `${sp.pref} ${sp.name}` : '';
        li.appendChild(placeEl);
        const editArea = document.createElement('div');
        editArea.className = 'loc-matched-edit' + (existing ? ' open' : '');
        editArea.appendChild(buildEditSection(key, page, num, existing));
        li.appendChild(editArea);
        btnEdit.addEventListener('click', () => {
          const open = editArea.classList.toggle('open');
          btnEdit.textContent = open ? '閉じる' : (corrections.get(key) ? '修正中' : '修正');
        });
      } else {
        li.appendChild(idSpan);
        appendEditSection(li, key, page, num, existing);
      }
      listEl.appendChild(li);
    }
  }

  // 既存の追加アイテムを復元
  for (const [addKey, add] of additions) {
    if (add.batch === page.batch && add.source_image === page.source_image) {
      listEl.appendChild(makeAdditionItem(addKey, page.batch, page.source_image, add));
    }
  }

  // 追加ボタン
  const btnAdd = document.createElement('button');
  btnAdd.type = 'button';
  btnAdd.className = 'btn-add-loc';
  btnAdd.textContent = '＋ 地点番号を追加';
  btnAdd.addEventListener('click', () => openSelOcrModal('', page, '地点番号を追加（1行1件）'));
  listEl.appendChild(btnAdd);

  // right: image
  const imgEl = document.getElementById('noteImage');
  const noImgEl = document.getElementById('noImage');
  const captionEl = document.getElementById('imageCaption');
  const ocrBtn = document.getElementById('btnOcr');
  const url = buildImageUrl(page.source_service_id);
  if (url) {
    imgEl.src = url;
    imgEl.style.display = '';
    noImgEl.style.display = 'none';
    captionEl.textContent = `${page.source_image} — カード ${page.source_canvas_label ?? '?'}`;
  } else {
    imgEl.style.display = 'none';
    noImgEl.style.display = '';
    captionEl.textContent = '';
  }
  ocrBtn.style.display = '';
  ocrBtn.onclick = () => openOcrModal(page);
  const selOcrBtn = document.getElementById('btnSelOcr');
  selOcrBtn.style.display = '';
  selOcrBtn.onclick = () => toggleSelectionMode(page);

  updateStatus();
}

// ── ナビゲーション ────────────────────────────────────────
function goTo(idx) {
  if (!filteredPages.length) return;
  currentIndex = Math.max(0, Math.min(filteredPages.length - 1, idx));
  renderPage(filteredPages[currentIndex]);
}

function goToError(dir) {
  if (!filteredPages.length) return;
  let idx = currentIndex + dir;
  while (idx >= 0 && idx < filteredPages.length) {
    if (hasUnmatched(filteredPages[idx])) { goTo(idx); return; }
    idx += dir;
  }
}

// ── 修正 UI ───────────────────────────────────────────────
function onInputChange(e) {
  const { key, batch, sourceImage, original } = e.target.dataset;
  const val = e.target.value.trim();
  if (val === original) {
    corrections.delete(key);
    e.target.classList.remove('corrected', 'deleted');
  } else {
    const prev = corrections.get(key) || {};
    corrections.set(key, { batch, source_image: sourceImage, original, correction: val, deleted: false, comment: prev.comment || '' });
    e.target.classList.remove('deleted');
    e.target.classList.add('corrected');
    e.target.disabled = false;
  }
  saveToLocalStorage();
  updateStatus();
  const li = e.target.closest('li');
  let hint = li.querySelector('.loc-place');
  if (!hint) { hint = document.createElement('div'); hint.className = 'loc-place'; li.appendChild(hint); }
  if (val && surveyIndex[val]) {
    hint.textContent = `→ ${surveyIndex[val].pref} ${surveyIndex[val].name}`;
    hint.style.color = '';
  } else if (val) {
    hint.textContent = '（未照合）';
    hint.style.color = 'var(--unmatched)';
  } else {
    hint.textContent = '';
  }
}

function buildEditSection(key, page, num, existing) {
  const frag = document.createDocumentFragment();
  const editRow = document.createElement('div');
  editRow.className = 'loc-edit-row';

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = '修正値（空=削除）';
  input.dataset.key = key;
  input.dataset.batch = page.batch;
  input.dataset.sourceImage = page.source_image;
  input.dataset.original = num;
  if (existing) {
    if (existing.deleted) { input.value = ''; input.classList.add('deleted'); input.disabled = true; }
    else { input.value = existing.correction; input.classList.add('corrected'); }
  } else {
    input.value = num;
  }
  input.addEventListener('change', onInputChange);
  input.addEventListener('input', onInputChange);

  const btnSuggest = document.createElement('button');
  btnSuggest.type = 'button';
  btnSuggest.className = 'btn-suggest';
  btnSuggest.textContent = '候補';
  btnSuggest.dataset.key = key;
  btnSuggest.dataset.original = num;
  btnSuggest.addEventListener('click', e => openSuggestModal(e.target.dataset.key, e.target.dataset.original));

  const btnDel = document.createElement('button');
  btnDel.type = 'button';
  btnDel.className = 'btn-delete' + (existing?.deleted ? ' active' : '');
  btnDel.textContent = existing?.deleted ? '削除済' : '削除';
  btnDel.dataset.key = key;
  btnDel.dataset.batch = page.batch;
  btnDel.dataset.sourceImage = page.source_image;
  btnDel.dataset.original = num;
  btnDel.addEventListener('click', onDeleteClick);

  editRow.appendChild(input);
  editRow.appendChild(btnSuggest);
  editRow.appendChild(btnDel);
  frag.appendChild(editRow);

  const textarea = document.createElement('textarea');
  textarea.className = 'loc-comment' + (existing?.comment ? ' has-comment' : '');
  textarea.placeholder = 'コメント（任意）';
  textarea.dataset.key = key;
  textarea.dataset.batch = page.batch;
  textarea.dataset.sourceImage = page.source_image;
  textarea.dataset.original = num;
  textarea.value = existing?.comment || '';
  textarea.addEventListener('input', onCommentChange);
  frag.appendChild(textarea);

  if (existing && !existing.deleted && surveyIndex[existing.correction]) {
    const hint = document.createElement('div');
    hint.className = 'loc-place';
    const sp = surveyIndex[existing.correction];
    hint.textContent = `→ ${sp.pref} ${sp.name}`;
    frag.appendChild(hint);
  }
  return frag;
}

function appendEditSection(parent, key, page, num, existing) {
  parent.appendChild(buildEditSection(key, page, num, existing));
}

function makeAdditionItem(addKey, batch, source_image, existing = null) {
  const li = document.createElement('li');
  li.className = 'loc-added';
  li.dataset.addKey = addKey;

  const label = document.createElement('span');
  label.className = 'loc-id';
  label.textContent = '＋追加';
  li.appendChild(label);

  const editRow = document.createElement('div');
  editRow.className = 'loc-edit-row';

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = '追加する地点番号';
  input.value = existing?.correction || '';
  if (existing?.correction) input.classList.add('corrected');
  input.addEventListener('input', e => {
    const val = e.target.value.trim();
    const prev = additions.get(addKey) || { batch, source_image, correction: '', comment: '' };
    additions.set(addKey, { ...prev, correction: val });
    saveToLocalStorage();
    input.classList.toggle('corrected', val.length > 0);
    let hint = li.querySelector('.loc-place');
    if (!hint) { hint = document.createElement('div'); hint.className = 'loc-place'; li.appendChild(hint); }
    if (val && surveyIndex[val]) {
      hint.textContent = `${surveyIndex[val].pref} ${surveyIndex[val].name}`;
      hint.style.color = '';
    } else if (val) {
      hint.textContent = '（未照合）';
      hint.style.color = 'var(--unmatched)';
    } else {
      hint.textContent = '';
    }
    updateStatus();
  });

  const btnSuggest = document.createElement('button');
  btnSuggest.type = 'button';
  btnSuggest.className = 'btn-suggest';
  btnSuggest.textContent = '候補';
  btnSuggest.addEventListener('click', () => {
    const val = input.value.trim() || '';
    if (val) openSuggestModal(null, val, id => { input.value = id; input.dispatchEvent(new Event('input')); });
  });

  const btnRemove = document.createElement('button');
  btnRemove.type = 'button';
  btnRemove.className = 'btn-delete';
  btnRemove.textContent = '削除';
  btnRemove.addEventListener('click', () => {
    additions.delete(addKey);
    saveToLocalStorage();
    li.remove();
    updateStatus();
  });

  editRow.appendChild(input);
  editRow.appendChild(btnSuggest);
  editRow.appendChild(btnRemove);
  li.appendChild(editRow);

  const textarea = document.createElement('textarea');
  textarea.className = 'loc-comment' + (existing?.comment ? ' has-comment' : '');
  textarea.placeholder = 'コメント（任意）';
  textarea.value = existing?.comment || '';
  textarea.addEventListener('input', e => {
    const prev = additions.get(addKey) || { batch, source_image, correction: '', comment: '' };
    additions.set(addKey, { ...prev, comment: e.target.value });
    saveToLocalStorage();
    e.target.classList.toggle('has-comment', e.target.value.length > 0);
    updateStatus();
  });
  li.appendChild(textarea);

  if (existing?.correction && surveyIndex[existing.correction]) {
    const hint = document.createElement('div');
    hint.className = 'loc-place';
    const sp = surveyIndex[existing.correction];
    hint.textContent = `${sp.pref} ${sp.name}`;
    li.appendChild(hint);
  }
  return li;
}

function onCommentChange(e) {
  const { key, batch, sourceImage, original } = e.target.dataset;
  const comment = e.target.value;
  const prev = corrections.get(key) || { batch, source_image: sourceImage, original, correction: original, deleted: false };
  corrections.set(key, { ...prev, comment });
  saveToLocalStorage();
  e.target.classList.toggle('has-comment', comment.length > 0);
  updateStatus();
}

function onDeleteClick(e) {
  const { key, batch, sourceImage, original } = e.target.dataset;
  const existing = corrections.get(key);
  if (existing?.deleted) {
    corrections.delete(key);
    saveToLocalStorage();
    e.target.classList.remove('active');
    e.target.textContent = '削除';
    const input = document.querySelector(`input[data-key="${CSS.escape(key)}"]`);
    if (input) { input.disabled = false; input.value = original; input.classList.remove('deleted', 'corrected'); }
  } else {
    const prev2 = corrections.get(key) || {};
    corrections.set(key, { batch, source_image: sourceImage, original, correction: null, deleted: true, comment: prev2.comment || '' });
    saveToLocalStorage();
    e.target.classList.add('active');
    e.target.textContent = '削除済';
    const input = document.querySelector(`input[data-key="${CSS.escape(key)}"]`);
    if (input) { input.disabled = true; input.value = ''; input.classList.add('deleted'); input.classList.remove('corrected'); }
  }
  updateStatus();
}

function downloadCorrections() {
  if (!corrections.size && !additions.size) {
    document.getElementById('dlHint').textContent = '修正がありません';
    setTimeout(() => { document.getElementById('dlHint').textContent = ''; }, 2000);
    return;
  }
  const out = [
    ...Array.from(corrections.values()).map(c => ({
      batch: c.batch, source_image: c.source_image, original: c.original,
      correction: c.deleted ? null : c.correction,
      ...(c.comment ? { comment: c.comment } : {}),
    })),
    ...Array.from(additions.values()).filter(a => a.correction).map(a => ({
      batch: a.batch, source_image: a.source_image, original: null,
      correction: a.correction,
      ...(a.comment ? { comment: a.comment } : {}),
    })),
  ];
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ocr-corrections.json';
  a.click();
  document.getElementById('dlHint').textContent = `${out.length}件をダウンロードしました`;
  setTimeout(() => { document.getElementById('dlHint').textContent = ''; }, 3000);
}

function resetCorrections() {
  const total = corrections.size + additions.size;
  if (total === 0) return;
  if (!confirm(`${total}件の修正・追加をリセットしますか？`)) return;
  corrections.clear();
  additions.clear();
  localStorage.removeItem(LS_KEY);
  renderPage(filteredPages[currentIndex]);
}

// ── OCR 全文モーダル ──────────────────────────────────────
function openOcrModal(page) {
  document.getElementById('ocrModalTitle').textContent =
    `OCR 生データ: ${page.source_title || page.source_ljc_id || page.source_image}`;
  const raw = JSON.stringify(page, null, 2);
  const html = raw
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\\n/g, '<span class="json-nl">\\n</span>\n');
  document.getElementById('ocrRaw').innerHTML = html;
  document.getElementById('ocrModal').classList.add('visible');
}

function closeOcrModal() {
  document.getElementById('ocrModal').classList.remove('visible');
}

// ── 初期化 ────────────────────────────────────────────────
async function init() {
  loadFromLocalStorage();

  // sel-ocr モジュールに共有状態を渡す
  initSelOcr({
    additions,
    nextAddKey: (page) => `${page.batch}|${page.source_image}|+${++additionSeq}`,
    saveToLocalStorage,
    makeAdditionItem,
    updateStatus,
  });

  const res = await fetch(DATA_URL);
  if (!res.ok) throw new Error(`データ読み込み失敗: ${res.status}`);
  const data = await res.json();

  allPages = data.pages || [];
  surveyIndex = data.surveyIndex || {};
  filterUnmatchedOnly = document.getElementById('filterUnmatched').checked;
  rebuildFilteredPages();

  // バッチセレクト構築
  const batchSelect = document.getElementById('batchSelect');
  (data.batches || []).forEach(b => {
    const opt = document.createElement('option');
    opt.value = b;
    const batchPages = allPages.filter(p => p.batch === b);
    const errCount = batchPages.filter(hasUnmatched).length;
    const zeroCount = batchPages.filter(p => p.location_numbers.length === 0).length;
    opt.textContent = `${b}  (${batchPages.length}p / 未照合${errCount} / 0件${zeroCount})`;
    batchSelect.appendChild(opt);
  });
  batchSelect.addEventListener('change', () => {
    const batch = batchSelect.value;
    if (!batch) return;
    const idx = filteredPages.findIndex(p => p.batch === batch);
    if (idx >= 0) goTo(idx);
  });

  const unmatchedPageCount = allPages.filter(hasUnmatched).length;
  document.getElementById('status').textContent =
    `${data.batches?.length ?? 0}バッチ / ${allPages.length}ページ / 未照合ページ${unmatchedPageCount}件`;

  const hashMatch = window.location.hash.match(/^#p(\d+)$/);
  const initPage = hashMatch ? parseInt(hashMatch[1], 10) - 1 : 0;
  if (filteredPages.length) goTo(Math.min(initPage, filteredPages.length - 1));
  else document.getElementById('status').textContent += ' — 未照合ページなし';
}

// ── イベント登録 ──────────────────────────────────────────
document.getElementById('ocrModalClose').addEventListener('click', closeOcrModal);
document.getElementById('ocrModal').addEventListener('click', e => {
  if (e.target === document.getElementById('ocrModal')) closeOcrModal();
});

document.getElementById('suggestClose').addEventListener('click', closeSuggestModal);
document.getElementById('suggestCopy').addEventListener('click', () => {
  const { pinned, others } = suggestCandidates(suggestTargetOriginal || '');
  const lines = [`「${suggestTargetOriginal}」の候補`];
  if (pinned.length) { lines.push('[頭2桁固定]'); pinned.forEach(c => lines.push(`${c.id}\t${c.pref} ${c.name}`)); }
  if (others.length) { lines.push('[頭2桁を問わず]'); others.forEach(c => lines.push(`${c.id}\t${c.pref} ${c.name}`)); }
  if (!pinned.length && !others.length) lines.push('（該当なし）');
  navigator.clipboard.writeText(lines.join('\n')).then(() => {
    const btn = document.getElementById('suggestCopy');
    const orig = btn.innerHTML;
    btn.innerHTML = '✓';
    setTimeout(() => { btn.innerHTML = orig; }, 1500);
  });
});
document.getElementById('suggestModal').addEventListener('click', e => {
  if (e.target === document.getElementById('suggestModal')) closeSuggestModal();
});

document.getElementById('filterUnmatched').addEventListener('change', e => {
  filterUnmatchedOnly = e.target.checked;
  rebuildFilteredPages();
  goTo(Math.min(currentIndex, filteredPages.length - 1));
});

const pageInput = document.getElementById('pageInput');
pageInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const n = parseInt(pageInput.value, 10);
    if (!isNaN(n)) goTo(n - 1);
    pageInput.blur();
  } else if (e.key === 'Escape') {
    updateStatus();
    pageInput.blur();
  }
});
pageInput.addEventListener('focus', () => pageInput.select());

document.getElementById('btnErrPrev').addEventListener('click', () => goToError(-1));
document.getElementById('btnErrNext').addEventListener('click', () => goToError(1));
document.getElementById('btnPrev').addEventListener('click', () => goTo(currentIndex - 1));
document.getElementById('btnNext').addEventListener('click', () => goTo(currentIndex + 1));
document.getElementById('btnDownload').addEventListener('click', downloadCorrections);
document.getElementById('btnReset').addEventListener('click', resetCorrections);

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (document.getElementById('selOcrModal').classList.contains('visible')) { closeSelOcrModal(); return; }
    if (document.getElementById('ocrModal').classList.contains('visible')) { closeOcrModal(); return; }
    if (isInSelectionMode()) { exitSelectionMode(); return; }
    closeSuggestModal(); return;
  }
  if (document.getElementById('suggestModal').classList.contains('visible')) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  if (e.key === 'z' || e.key === 'Z') goToError(-1);
  else if (e.key === 'x' || e.key === 'X') goToError(1);
  else if (e.key === 'a' || e.key === 'A') goTo(currentIndex - 1);
  else if (e.key === 's' || e.key === 'S') goTo(currentIndex + 1);
  else if (e.key === 'Enter' && e.shiftKey) downloadCorrections();
});

init().catch(e => {
  console.error(e);
  document.getElementById('status').textContent = `エラー: ${e.message}`;
});
