// ===== アフィン最小二乗フィット: GCP全体から (px,py)→{lon,lat} を推定 =====
function fitAffine(gcps) {
  const AtA = [[0,0,0],[0,0,0],[0,0,0]];
  const AtbLon = [0,0,0], AtbLat = [0,0,0];
  for (const g of gcps) {
    const row = [g.px, g.py, 1];
    for (let j = 0; j < 3; j++) {
      for (let k = 0; k < 3; k++) AtA[j][k] += row[j] * row[k];
      AtbLon[j] += row[j] * g.lon;
      AtbLat[j] += row[j] * g.lat;
    }
  }
  function solve3(M, b) {
    const det = m =>
      m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1])
     -m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0])
     +m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0]);
    const d = det(M);
    if (Math.abs(d) < 1e-15) return [0,0,0];
    const col = (m, i, v) => m.map((r, ri) => r.map((c, ci) => ci === i ? v[ri] : c));
    return [0,1,2].map(i => det(col(M, i, b)) / d);
  }
  const [aL, bL, cL] = solve3(AtA, AtbLon);
  const [aT, bT, cT] = solve3(AtA, AtbLat);
  return (px, py) => ({ lon: aL*px + bL*py + cL, lat: aT*px + bT*py + cT });
}

// ===== 三角形2組の対応点からアフィン変換行列を計算 =====
// imgPts → scrPts: canvas の setTransform(a,b,c,d,e,f) 用
function affineFromTriangles(imgPts, scrPts) {
  const ix = imgPts.map(p => p.x), iy = imgPts.map(p => p.y);
  const sx = scrPts.map(p => p.x), sy = scrPts.map(p => p.y);
  const detM = ix[0]*(iy[1]-iy[2]) - ix[1]*(iy[0]-iy[2]) + ix[2]*(iy[0]-iy[1]);
  if (Math.abs(detM) < 0.5) return null;
  const invM = [
    [(iy[1]-iy[2])/detM, (ix[2]-ix[1])/detM, (ix[1]*iy[2]-ix[2]*iy[1])/detM],
    [(iy[2]-iy[0])/detM, (ix[0]-ix[2])/detM, (ix[2]*iy[0]-ix[0]*iy[2])/detM],
    [(iy[0]-iy[1])/detM, (ix[1]-ix[0])/detM, (ix[0]*iy[1]-ix[1]*iy[0])/detM]
  ];
  const a = sx[0]*invM[0][0] + sx[1]*invM[1][0] + sx[2]*invM[2][0];
  const c = sx[0]*invM[0][1] + sx[1]*invM[1][1] + sx[2]*invM[2][1];
  const e = sx[0]*invM[0][2] + sx[1]*invM[1][2] + sx[2]*invM[2][2];
  const b = sy[0]*invM[0][0] + sy[1]*invM[1][0] + sy[2]*invM[2][0];
  const d = sy[0]*invM[0][1] + sy[1]*invM[1][1] + sy[2]*invM[2][1];
  const f = sy[0]*invM[0][2] + sy[1]*invM[1][2] + sy[2]*invM[2][2];
  return [a, b, c, d, e, f];
}

// ===== SVG polygon → 画像ピクセル座標配列 =====
function parseSvgPolygon(svgStr) {
  const m = svgStr.match(/points="([^"]+)"/);
  if (!m) return [];
  return m[1].trim().split(/\s+/).map(pair => {
    const [px, py] = pair.split(',').map(Number);
    return { px, py };
  });
}

// ===== ポリゴン辺を step px 以下に細分化 =====
// TPS が非線形なので直線辺を密にしてから変換する
function densifyPolygon(pts, step) {
  const result = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const dx = b.px - a.px, dy = b.py - a.py;
    const n = Math.max(1, Math.ceil(Math.sqrt(dx*dx + dy*dy) / step));
    for (let j = 0; j < n; j++) {
      result.push({ px: a.px + dx*j/n, py: a.py + dy*j/n });
    }
  }
  return result;
}

// ===== ガウス消去法（部分ピボット付き、非破壊）=====
function gaussianElimination(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) maxRow = row;
    }
    [M[col], M[maxRow]] = [M[maxRow], M[col]];
    if (Math.abs(M[col][col]) < 1e-12) continue;
    for (let row = col + 1; row < n; row++) {
      const f = M[row][col] / M[col][col];
      for (let k = col; k <= n; k++) M[row][k] -= f * M[col][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    x[i] = M[i][n];
    for (let j = i + 1; j < n; j++) x[i] -= M[i][j] * x[j];
    x[i] /= M[i][i];
  }
  return x;
}

// ===== TPS カーネル: U(r²) = r² log(r²),  U(0) = 0 =====
function tpsU(r2) { return r2 < 1e-10 ? 0 : r2 * Math.log(r2); }

// ===== Thin Plate Spline ソルバー =====
// gcps: {px, py, lon, lat}[]
// 返り値: (px, py) → {lon, lat}  ※GCP点で厳密一致
function solveTPS(gcps) {
  const n = gcps.length;
  const N = n + 3; // n個のTPS重み + アフィン3項 (1, x, y)

  const A = Array.from({length: N}, () => new Array(N).fill(0));

  // K ブロック (n×n)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const dx = gcps[i].px - gcps[j].px;
      const dy = gcps[i].py - gcps[j].py;
      A[i][j] = tpsU(dx*dx + dy*dy);
    }
  }
  // P ブロックと Pᵀ ブロック
  for (let i = 0; i < n; i++) {
    A[i][n]   = A[n][i]   = 1;
    A[i][n+1] = A[n+1][i] = gcps[i].px;
    A[i][n+2] = A[n+2][i] = gcps[i].py;
  }

  const bLon = [...gcps.map(g => g.lon), 0, 0, 0];
  const bLat = [...gcps.map(g => g.lat), 0, 0, 0];
  const wLon = gaussianElimination(A, bLon);
  const wLat = gaussianElimination(A, bLat);

  return (px, py) => {
    let lon = wLon[n] + wLon[n+1]*px + wLon[n+2]*py;
    let lat = wLat[n] + wLat[n+1]*px + wLat[n+2]*py;
    for (let i = 0; i < n; i++) {
      const dx = px - gcps[i].px, dy = py - gcps[i].py;
      const u = tpsU(dx*dx + dy*dy);
      lon += wLon[i] * u;
      lat += wLat[i] * u;
    }
    return { lon, lat };
  };
}
