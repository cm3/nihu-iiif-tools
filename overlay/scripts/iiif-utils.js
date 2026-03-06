// ===== 共通ユーティリティ =====
const $ = id => document.getElementById(id);

// ===== IIIF マニフェスト関連 =====
function buildManifestUrl(id) {
  return `https://iiif.nihu.jp/iiif/archives/${encodeURIComponent(id)}/manifest.json`;
}

function infoFromManifest(man) {
  // IIIF v3
  try {
    const body = man?.items?.[0]?.items?.[0]?.items?.[0]?.body;
    const svc  = Array.isArray(body?.service) ? body.service[0] : body?.service;
    const id   = svc?.['@id'] || svc?.id;
    if (id) return id.endsWith('/info.json') ? id : id.replace(/\/info\.json$/, '') + '/info.json';
  } catch {}
  // IIIF v2
  try {
    const img = man?.sequences?.[0]?.canvases?.[0]?.images?.[0]?.resource;
    const svc = img?.service;
    const id  = svc?.['@id'] || svc?.id;
    if (id) return id.endsWith('/info.json') ? id : id.replace(/\/info\.json$/, '') + '/info.json';
  } catch {}
  return null;
}

const stripInfo = u => u.replace(/\/info\.json(\?.*)?$/, '');
