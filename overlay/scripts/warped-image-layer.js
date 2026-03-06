// ===== カスタム Leaflet レイヤ: 三角分割ワープ描画 + IIIF 高解像度領域取得 =====
// 依存: tps-warp.js (solveTPS, parseSvgPolygon, densifyPolygon, affineFromTriangles)
//       iiif-utils.js ($)
const WarpedImageLayer = L.Layer.extend({
  initialize(gcps, svc, fullW, fullH, options) {
    this._gcps  = gcps;
    this._svc   = svc;
    this._fullW = fullW;
    this._fullH = fullH;
    this._opacity  = (options && options.opacity != null) ? options.opacity : 0.7;
    this._maskDefs = (options && options.masks) ? options.masks : [];
    this._maskGeos = [];
    this._regionImg  = null;
    this._regionRect = null;
    this._loadedUrl  = null;
    this._regionTimer = null;
  },

  onAdd(map) {
    this._map = map;
    this._canvas = document.createElement('canvas');
    Object.assign(this._canvas.style, {
      position: 'absolute', top: '0', left: '0', pointerEvents: 'none',
      zIndex: '450'
    });
    map.getContainer().appendChild(this._canvas);

    this._buildTriangulation();

    this._img = new Image();
    this._img.crossOrigin = 'anonymous';
    this._img.onload  = () => {
      this._imgLoaded = true;
      this._render();
      this._scheduleRegionLoad();
    };
    this._img.onerror = () => $('status').textContent = '方言地図の読み込み失敗';
    this._img.src = `${this._svc}/full/1024,/0/default.jpg`;

    map.on('viewreset zoom move resize', this._render, this);
    map.on('moveend zoomend', this._scheduleRegionLoad, this);
    const sz = map.getSize();
    this._canvas.width  = sz.x;
    this._canvas.height = sz.y;
    return this;
  },

  onRemove(map) {
    this._canvas.remove();
    map.off('viewreset zoom move resize', this._render, this);
    map.off('moveend zoomend', this._scheduleRegionLoad, this);
    clearTimeout(this._regionTimer);
  },

  setOpacity(v) { this._opacity = v; this._render(); },

  setMasks(masks) {
    this._maskDefs = masks;
    if (this._tps) {
      this._maskGeos = this._computeMaskGeos(this._tps);
      this._render();
    }
  },

  _computeMaskGeos(tps) {
    return this._maskDefs.map(({ svg }) => {
      const raw   = parseSvgPolygon(svg);
      const dense = densifyPolygon(raw, 400);
      return dense.map(p => tps(p.px, p.py));
    });
  },

  _buildTriangulation() {
    const tps = solveTPS(this._gcps);
    this._tps = tps;

    const COLS = 50, ROWS = 37;
    const pts = [];
    for (let row = 0; row <= ROWS; row++) {
      for (let col = 0; col <= COLS; col++) {
        const px = this._fullW * col / COLS;
        const py = this._fullH * row / ROWS;
        const { lon, lat } = tps(px, py);
        pts.push({ px, py, lon, lat });
      }
    }
    this._pts = pts;

    this._maskGeos = this._computeMaskGeos(tps);

    const W = COLS + 1;
    this._tris = [];
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const tl = col     + row*W,  tr = (col+1) + row*W;
        const bl = col     + (row+1)*W, br = (col+1) + (row+1)*W;
        this._tris.push([tl, tr, bl]);
        this._tris.push([tr, br, bl]);
      }
    }
  },

  _geoToImage(lon, lat) {
    for (const [i0, i1, i2] of this._tris) {
      const A = this._pts[i0], B = this._pts[i1], C = this._pts[i2];
      const denom = (B.lat - C.lat)*(A.lon - C.lon) + (C.lon - B.lon)*(A.lat - C.lat);
      if (Math.abs(denom) < 1e-15) continue;
      const s = ((B.lat - C.lat)*(lon - C.lon) + (C.lon - B.lon)*(lat - C.lat)) / denom;
      const t = ((C.lat - A.lat)*(lon - C.lon) + (A.lon - C.lon)*(lat - C.lat)) / denom;
      const u = 1 - s - t;
      if (s >= -0.01 && t >= -0.01 && u >= -0.01) {
        return { px: s*A.px + t*B.px + u*C.px, py: s*A.py + t*B.py + u*C.py };
      }
    }
    return null;
  },

  _viewToImageRect() {
    const bounds = this._map.getBounds();
    const N = bounds.getNorth(), S = bounds.getSouth();
    const W = bounds.getWest(),  E = bounds.getEast();
    const pxs = [], pys = [];
    for (let i = 0; i <= 5; i++) {
      for (let j = 0; j <= 5; j++) {
        const pt = this._geoToImage(W + (E-W)*j/5, S + (N-S)*i/5);
        if (pt) { pxs.push(pt.px); pys.push(pt.py); }
      }
    }
    if (!pxs.length) return null;
    const pad = 200;
    const x  = Math.max(0, Math.floor(Math.min(...pxs)) - pad);
    const y  = Math.max(0, Math.floor(Math.min(...pys)) - pad);
    const x2 = Math.min(this._fullW, Math.ceil(Math.max(...pxs)) + pad);
    const y2 = Math.min(this._fullH, Math.ceil(Math.max(...pys)) + pad);
    if (x2 <= x || y2 <= y) return null;
    return { x, y, w: x2 - x, h: y2 - y };
  },

  _scheduleRegionLoad() {
    clearTimeout(this._regionTimer);
    this._regionTimer = setTimeout(() => this._loadRegion(), 350);
  },

  _loadRegion() {
    const rect = this._viewToImageRect();
    if (!rect) return;

    const sz  = this._map.getSize();
    const dpr = window.devicePixelRatio || 1;
    const outW = Math.max(256, Math.min(Math.ceil(Math.max(sz.x, sz.y) * dpr), rect.w, 4096));
    const outH = Math.round(outW * rect.h / rect.w);

    const url = `${this._svc}/${rect.x},${rect.y},${rect.w},${rect.h}/${outW},/0/default.jpg`;
    if (url === this._loadedUrl) return;
    this._loadedUrl = url;

    $('status').textContent = `高解像度取得中 (${outW}×${outH}px)…`;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (url !== this._loadedUrl) return;
      this._regionImg  = img;
      this._regionRect = rect;
      $('status').textContent = `高解像度表示中 ${outW}×${outH}px (領域: ${rect.w}×${rect.h}px)`;
      this._render();
    };
    img.onerror = () => { $('status').textContent = 'IIIF 高解像度取得失敗'; };
    img.src = url;
  },

  _render() {
    if (!this._imgLoaded) return;
    const map = this._map;
    const canvas = this._canvas;
    const sz = map.getSize();
    if (canvas.width !== sz.x || canvas.height !== sz.y) {
      canvas.width = sz.x; canvas.height = sz.y;
    }

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, sz.x, sz.y);

    if (this._maskGeos.length > 0) {
      ctx.save();
      ctx.beginPath();
      for (const geo of this._maskGeos) {
        geo.forEach(({ lon, lat }, i) => {
          const s = map.latLngToContainerPoint([lat, lon]);
          i === 0 ? ctx.moveTo(s.x, s.y) : ctx.lineTo(s.x, s.y);
        });
        ctx.closePath();
      }
      ctx.clip('evenodd');
    }

    const useRegion = this._regionImg && this._regionRect;
    const imgRef = useRegion ? this._regionImg : this._img;
    const r      = useRegion ? this._regionRect : null;
    const scaleX = useRegion ? imgRef.naturalWidth  / r.w : imgRef.naturalWidth  / this._fullW;
    const scaleY = useRegion ? imgRef.naturalHeight / r.h : imgRef.naturalHeight / this._fullH;
    const offX   = useRegion ? -r.x * scaleX : 0;
    const offY   = useRegion ? -r.y * scaleY : 0;

    for (const [i0, i1, i2] of this._tris) {
      const p0 = this._pts[i0], p1 = this._pts[i1], p2 = this._pts[i2];

      const s0 = map.latLngToContainerPoint([p0.lat, p0.lon]);
      const s1 = map.latLngToContainerPoint([p1.lat, p1.lon]);
      const s2 = map.latLngToContainerPoint([p2.lat, p2.lon]);

      const i0s = { x: p0.px*scaleX + offX, y: p0.py*scaleY + offY };
      const i1s = { x: p1.px*scaleX + offX, y: p1.py*scaleY + offY };
      const i2s = { x: p2.px*scaleX + offX, y: p2.py*scaleY + offY };

      if (useRegion) {
        const inRegion = p => p.px >= r.x && p.px <= r.x+r.w && p.py >= r.y && p.py <= r.y+r.h;
        if (!inRegion(p0) || !inRegion(p1) || !inRegion(p2)) {
          const fbScaleX = this._img.naturalWidth  / this._fullW;
          const fbScaleY = this._img.naturalHeight / this._fullH;
          const fb0 = { x: p0.px*fbScaleX, y: p0.py*fbScaleY };
          const fb1 = { x: p1.px*fbScaleX, y: p1.py*fbScaleY };
          const fb2 = { x: p2.px*fbScaleX, y: p2.py*fbScaleY };
          const fbTf = affineFromTriangles([fb0, fb1, fb2], [s0, s1, s2]);
          if (fbTf) {
            ctx.save();
            ctx.globalAlpha = this._opacity;
            ctx.beginPath(); ctx.moveTo(s0.x, s0.y); ctx.lineTo(s1.x, s1.y); ctx.lineTo(s2.x, s2.y); ctx.closePath(); ctx.clip();
            ctx.setTransform(...fbTf);
            ctx.drawImage(this._img, 0, 0);
            ctx.restore();
          }
          continue;
        }
      }

      const tf = affineFromTriangles([i0s, i1s, i2s], [s0, s1, s2]);
      if (!tf) continue;

      ctx.save();
      ctx.globalAlpha = this._opacity;
      ctx.beginPath();
      ctx.moveTo(s0.x, s0.y);
      ctx.lineTo(s1.x, s1.y);
      ctx.lineTo(s2.x, s2.y);
      ctx.closePath();
      ctx.clip();
      ctx.setTransform(...tf);
      ctx.drawImage(imgRef, 0, 0);
      ctx.restore();
    }

    if (this._maskGeos.length > 0) ctx.restore();
  }
});
