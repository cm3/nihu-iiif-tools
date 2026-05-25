// ===== 地域マスク定義 =====
// SVG は元画像のピクセル座標系（11764×8386px）で定義
const REGION_DEFS = {
  honshu:    '<svg><polygon points="151,3568 138,7752 7554,7661 7341,8308 7940,8304 8229,7070 10120,5559 10866,4697 11563,4851 11559,914 9256,903 8702,2847 6556,3489 4430,3539"/></svg>',
  honshu1:   '<svg><polygon points="0,0 3134,0 3134,8386 0,8386"/></svg>',
  honshu2:   '<svg><polygon points="3134,0 5573,0 5573,8386 3134,8386"/></svg>',
  honshu3:   '<svg><polygon points="5573,0 8439,0 8439,8386 5573,8386"/></svg>',
  honshu4:   '<svg><polygon points="8439,0 11764,0 11764,8386 8439,8386"/></svg>',
  hokkaido:  '<svg><polygon points="4300,0 8800,0 8800,3400 4300,3400"/></svg>',
  ryukyu:    '<svg><polygon points="8259,7038 7868,8312 11608,8303 11576,4881 10830,4715 10263,5443"/></svg>',
  sakishima: '<svg><polygon points="5308,7762 5304,8329 7383,8329 7548,7683 5395,7684"/></svg>',
  legend:    '<svg><polygon points="123,45 141,3573 4442,3565 4428,39"/></svg>',
};

const MASK_HONSHU    = [{ label: '本州',       svg: REGION_DEFS.honshu    }];
const MASK_HONSHU_1  = [{ label: '本州-1', svgs: [REGION_DEFS.honshu, REGION_DEFS.honshu1] }];
const MASK_HONSHU_2  = [{ label: '本州-2', svgs: [REGION_DEFS.honshu, REGION_DEFS.honshu2] }];
const MASK_HONSHU_3  = [{ label: '本州-3', svgs: [REGION_DEFS.honshu, REGION_DEFS.honshu3] }];
const MASK_HONSHU_4  = [{ label: '本州-4', svgs: [REGION_DEFS.honshu, REGION_DEFS.honshu4] }];
const MASK_HOKKAIDO  = [{ label: '北海道',     svg: REGION_DEFS.hokkaido  }];
const MASK_RYUKYU    = [{ label: '琉球・奄美', svg: REGION_DEFS.ryukyu    }];
const MASK_SAKISHIMA = [{ label: '先島諸島',   svg: REGION_DEFS.sakishima }];

// ===== 地図別設定 =====
// 命名規約: data/{KEY}-mapping.tsv, data/{KEY}-mapping-hk.tsv, ...
// KEY = LAJ_NNN の3桁数字部分、または参考図 LAJ_S01 の S01

function splitMapConfigFromNnn(nnn) {
  return {
    regions: [
      { label: '本州-1',           tsv: `data/${nnn}-mapping-h1.tsv`, masks: MASK_HONSHU_1,  dotColor: '#d33', lineColor: '#f66' },
      { label: '本州-2',           tsv: `data/${nnn}-mapping-h2.tsv`, masks: MASK_HONSHU_2,  dotColor: '#d76', lineColor: '#fa8' },
      { label: '本州-3',           tsv: `data/${nnn}-mapping-h3.tsv`, masks: MASK_HONSHU_3,  dotColor: '#c55', lineColor: '#e88' },
      { label: '本州-4',           tsv: `data/${nnn}-mapping-h4.tsv`, masks: MASK_HONSHU_4,  dotColor: '#b22', lineColor: '#d55' },
      { label: '北海道',           tsv: `data/${nnn}-mapping-hk.tsv`, masks: MASK_HOKKAIDO,  dotColor: '#48f', lineColor: '#08f' },
      { label: '琉球・奄美',       tsv: `data/${nnn}-mapping-rk.tsv`, masks: MASK_RYUKYU,    dotColor: '#4c4', lineColor: '#0a0' },
      { label: '先島諸島',         tsv: `data/${nnn}-mapping-sk.tsv`, masks: MASK_SAKISHIMA, dotColor: '#f90', lineColor: '#c60' },
    ],
    legendBbox: { x: 123, y: 39, w: 4319, h: 3534 },
  };
}

function legacyMapConfigFromNnn(nnn) {
  return {
    regions: [
      { label: '本州・四国・九州', tsv: `data/${nnn}-mapping.tsv`,    masks: MASK_HONSHU,    dotColor: '#f44', lineColor: '#f80' },
      { label: '北海道',           tsv: `data/${nnn}-mapping-hk.tsv`, masks: MASK_HOKKAIDO,  dotColor: '#48f', lineColor: '#08f' },
      { label: '琉球・奄美',       tsv: `data/${nnn}-mapping-rk.tsv`, masks: MASK_RYUKYU,    dotColor: '#4c4', lineColor: '#0a0' },
      { label: '先島諸島',         tsv: `data/${nnn}-mapping-sk.tsv`, masks: MASK_SAKISHIMA, dotColor: '#f90', lineColor: '#c60' },
    ],
    legendBbox: { x: 123, y: 39, w: 4319, h: 3534 },
  };
}

function defaultMapConfig(id) {
  const nnn = mapIdToDataKey(id);
  if (!nnn) return null;
  return legacyMapConfigFromNnn(nnn);
}

function mapIdToDataKey(id) {
  const m = id.match(/^LAJ_(S\d+|\d+)$/);
  if (!m) return null;
  return m[1].startsWith('S') ? m[1] : m[1].padStart(3, '0');
}

// 例外設定のみ記載（命名規約に従えば defaultMapConfig と同一だが明示）
const MAP_CONFIGS = {
  'LAJ_017': {
    ...splitMapConfigFromNnn('017'),
  },
};
