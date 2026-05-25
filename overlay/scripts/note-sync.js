const LAJ_NOTE_CHANNEL_NAME = 'laj-note-sync';
const LAJ_NOTE_OCR_SETS = [
  '001', '002', '003-015', '005', '006', '008', '009', '010',
  '011-013', '012', '014-016', '017-019', '020', '021', '022-023',
  '024', '025', '026', '027', '028', '029', '030-031', '032-033',
  '034-035', '036', '037', '038', '039', '040', '041', '043', '044',
  '045-046', '047', '048', '049', '050', '052', '053', '054-055',
  '056', '059', '060', '061', '062', '063', '064', '065', '066',
  '067', '068', '070', '071', '072', '077', '078', '079', '080',
  '081-082', '083-084', '085-086', '087-088', '089-090', '091-092',
  '093', '094', '096', '097', '101', '102', '103', '104', '105',
  '106', '107', '108-109', '110', '111', '112', '113', '114', '115',
  '116', '117', '118', '119', '121', '122', '123', '124', '125',
  '127', '128', '129', '130', '131', '132', '133', '134', '136',
  '137-138', '139', '140', '141', '142', '143', '144', '145', '146',
  '147', '148', '149-150', '151', '152', '153', '155', '156', '157',
  '158', '159', '160', '161', '162', '163', '164', '165-166', '167',
  '168', '169', '170', '171-173', '172', '174-175', '176', '177',
  '179', '180', '181', '182', '183', '185', '186', '187', '188',
  '189', '190', '191', '192', '193', '194', '195', '196', '197',
];

function extractLajMapNumber(id) {
  if (!id) return null;
  const m = String(id).match(/(\d+)$/);
  return m ? m[1].padStart(3, '0') : null;
}

function noteOcrSetForMapId(id) {
  if (/S\d+$/i.test(String(id || ''))) return null;
  const n = extractLajMapNumber(id);
  if (!n) return null;
  if (LAJ_NOTE_OCR_SETS.includes(n)) return n;
  const mapNumber = Number(n);
  return LAJ_NOTE_OCR_SETS.find(set => {
    const m = set.match(/^(\d{3})-(\d{3})$/);
    return m && mapNumber >= Number(m[1]) && mapNumber <= Number(m[2]);
  }) || null;
}

function createLajNoteBroadcaster(getState) {
  if (typeof BroadcastChannel === 'undefined') return null;
  const channel = new BroadcastChannel(LAJ_NOTE_CHANNEL_NAME);

  function normalizeState(state) {
    if (!state) return null;
    const mapId = state.mapId || state.overlayId || state.baseId || null;
    const mapNumber = state.mapNumber || extractLajMapNumber(mapId);
    if (!mapNumber) return null;
    return {
      ...state,
      mapId: mapId || `LAJ_${mapNumber}`,
      mapNumber,
      sentAt: new Date().toISOString(),
    };
  }

  function publish(extraState = {}) {
    const state = normalizeState({ ...(getState?.() || {}), ...extraState });
    if (!state) return;
    channel.postMessage({ type: 'current-map', ...state });
  }

  channel.addEventListener('message', event => {
    if (event.data?.type === 'request-current-map') publish();
  });

  return {
    publish,
    close() {
      channel.close();
    },
  };
}
