const LAJ_NOTE_CHANNEL_NAME = 'laj-note-sync';

function extractLajMapNumber(id) {
  if (!id) return null;
  const m = String(id).match(/(\d+)$/);
  return m ? m[1].padStart(3, '0') : null;
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
