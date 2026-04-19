/**
 * 範囲選択OCR モジュール (Tesseract.js)
 *
 * initSelOcr(state) を呼んでから使う。
 * AI OCR に差し替える場合はこのファイルを置き換えるだけでよい。
 *
 * Exports:
 *   initSelOcr(state)
 *   toggleSelectionMode(page)
 *   exitSelectionMode()
 *   isInSelectionMode()
 *   openSelOcrModal(rawText, page, title?)
 *   closeSelOcrModal()
 */

let _state = null; // { additions, nextAddKey, saveToLocalStorage, makeAdditionItem, updateStatus }

let selectionMode = false;
let selCurrentPage = null;
let tesseractWorker = null;
let tesseractReady = false;
let dragStart = null;

// ── 公開 API ──────────────────────────────────────────────

export function initSelOcr(state) {
  _state = state;
  const canvas = document.getElementById('selCanvas');
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseup', onMouseUp);
  document.getElementById('selOcrCancel').addEventListener('click', closeSelOcrModal);
}

export function isInSelectionMode() { return selectionMode; }

export function toggleSelectionMode(page) {
  const canvas = document.getElementById('selCanvas');
  const btn = document.getElementById('btnSelOcr');
  selectionMode = !selectionMode;
  selCurrentPage = page;
  canvas.classList.toggle('active', selectionMode);
  btn.classList.toggle('active', selectionMode);
  btn.textContent = selectionMode ? 'キャンセル' : '範囲選択OCR';
  if (selectionMode) { syncCanvas(); ensureTesseract(); }
}

export function exitSelectionMode() {
  selectionMode = false;
  const canvas = document.getElementById('selCanvas');
  const btn = document.getElementById('btnSelOcr');
  const ctx2d = canvas.getContext('2d');
  ctx2d.clearRect(0, 0, canvas.width, canvas.height);
  canvas.classList.remove('active');
  btn.classList.remove('active');
  btn.textContent = '範囲選択OCR';
}

export function openSelOcrModal(rawText, page, title = 'OCR 結果（編集可）') {
  const ta = document.getElementById('selOcrRaw');
  ta.value = rawText || '';
  document.getElementById('selOcrTitle').textContent = title;
  document.getElementById('selOcrModal').classList.add('visible');
  ta.focus();
  document.getElementById('selOcrApply').onclick = () => applySelOcr(page);
}

export function closeSelOcrModal() {
  document.getElementById('selOcrModal').classList.remove('visible');
}

// ── 内部 ──────────────────────────────────────────────────

function syncCanvas() {
  const img = document.getElementById('noteImage');
  const canvas = document.getElementById('selCanvas');
  canvas.width = img.offsetWidth;
  canvas.height = img.offsetHeight;
}

function loadTesseract() {
  return new Promise((resolve, reject) => {
    if (window.Tesseract) { resolve(); return; }
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function ensureTesseract() {
  if (tesseractReady) return tesseractWorker;
  const btn = document.getElementById('btnSelOcr');
  const prevText = btn.textContent;
  btn.textContent = '初期化中…';
  btn.disabled = true;
  await loadTesseract();
  tesseractWorker = await Tesseract.createWorker('eng', 1, {
    workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js',
    corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core.wasm.js',
  });
  await tesseractWorker.setParameters({ tessedit_char_whitelist: '0123456789.,' });
  tesseractReady = true;
  btn.textContent = prevText;
  btn.disabled = false;
  return tesseractWorker;
}

function onMouseDown(e) {
  if (!selectionMode) return;
  e.preventDefault();
  syncCanvas();
  const r = e.currentTarget.getBoundingClientRect();
  dragStart = { x: e.clientX - r.left, y: e.clientY - r.top };
}

function onMouseMove(e) {
  if (!selectionMode || !dragStart) return;
  const canvas = e.currentTarget;
  const r = canvas.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  const ctx2d = canvas.getContext('2d');
  ctx2d.clearRect(0, 0, canvas.width, canvas.height);
  ctx2d.fillStyle = 'rgba(58,120,200,0.12)';
  ctx2d.strokeStyle = 'rgba(58,120,200,0.85)';
  ctx2d.lineWidth = 1.5;
  const rx = Math.min(dragStart.x, x), ry = Math.min(dragStart.y, y);
  const rw = Math.abs(x - dragStart.x), rh = Math.abs(y - dragStart.y);
  ctx2d.fillRect(rx, ry, rw, rh);
  ctx2d.strokeRect(rx, ry, rw, rh);
}

async function onMouseUp(e) {
  if (!selectionMode || !dragStart) return;
  const canvas = e.currentTarget;
  const r = canvas.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  const rx = Math.min(dragStart.x, x), ry = Math.min(dragStart.y, y);
  const rw = Math.abs(x - dragStart.x), rh = Math.abs(y - dragStart.y);
  dragStart = null;
  if (rw < 5 || rh < 5) return;

  const img = document.getElementById('noteImage');
  const scaleX = img.naturalWidth / img.offsetWidth;
  const scaleY = img.naturalHeight / img.offsetHeight;

  const tmpCanvas = document.createElement('canvas');
  tmpCanvas.width = Math.round(rw * scaleX);
  tmpCanvas.height = Math.round(rh * scaleY);
  const tc = tmpCanvas.getContext('2d');
  tc.drawImage(img,
    Math.round(rx * scaleX), Math.round(ry * scaleY),
    tmpCanvas.width, tmpCanvas.height,
    0, 0, tmpCanvas.width, tmpCanvas.height
  );

  exitSelectionMode();

  const btn = document.getElementById('btnSelOcr');
  btn.textContent = 'OCR中…';
  btn.disabled = true;

  try {
    const worker = await ensureTesseract();
    const { data: { text } } = await worker.recognize(tmpCanvas);
    openSelOcrModal(text.trim(), selCurrentPage);
  } catch (err) {
    alert('OCRエラー: ' + err.message);
  } finally {
    btn.textContent = '範囲選択OCR';
    btn.disabled = false;
  }
}

function applySelOcr(page) {
  const lines = document.getElementById('selOcrRaw').value
    .split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const listEl = document.getElementById('locList');
  const btnAdd = listEl.querySelector('.btn-add-loc');
  lines.forEach(val => {
    const addKey = _state.nextAddKey(page);
    _state.additions.set(addKey, { batch: page.batch, source_image: page.source_image, correction: val, comment: '' });
    _state.saveToLocalStorage();
    const item = _state.makeAdditionItem(addKey, page.batch, page.source_image, { correction: val, comment: '' });
    if (btnAdd) btnAdd.before(item);
    else listEl.appendChild(item);
  });
  _state.updateStatus();
  closeSelOcrModal();
}
