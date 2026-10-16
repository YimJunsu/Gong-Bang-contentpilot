// MAIN world 전용. window.SmartEditor에 직접 접근하는 유일한 파일.
// content.js와는 window.postMessage로만 대화한다 (ISOLATED world에서는 SmartEditor가 안 보임).
// 네이버가 공개한 에디터 API로 문서모델을 통째로 교체하므로 툴바 클릭·서식 상속·정렬 되돌림이 없다.
(() => {
  'use strict';
  const NS = 'nbh-drv';
  const RES = 'nbh-drv-res';
  if (window.__NBH_DRIVER__) return;
  window.__NBH_DRIVER__ = '1.3.0';

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function getEditor() {
    const SE = window.SmartEditor;
    if (!SE) throw new Error('EDITOR_API_MISSING');
    const ids = Object.keys(SE._editors || {});
    const editor = ids.length ? SE._editors[ids[0]] : SE.getEditor?.();
    if (!editor) throw new Error('EDITOR_API_MISSING');
    return editor;
  }

  // 컴포넌트 배열은 보통 getDocumentData().document.components. 네이버가 래퍼를 바꿔도 찾도록 넓게 탐색.
  function findComponentsSlot(root) {
    if (Array.isArray(root?.document?.components)) return { owner: root.document, key: 'components' };
    const seen = new Set();
    const queue = [root];
    while (queue.length) {
      const node = queue.shift();
      if (!node || typeof node !== 'object' || seen.has(node)) continue;
      seen.add(node);
      for (const key of Object.keys(node)) {
        const value = node[key];
        if (key === 'components' && Array.isArray(value)) return { owner: node, key };
        if (value && typeof value === 'object') queue.push(value);
      }
    }
    return null;
  }

  // 라이브 문서모델은 '@ctype', 클립보드 스키마는 'ctype'. 변환기는 'ctype'으로 만들고 여기서 맞춘다.
  function detectTypeKey(components) {
    for (const component of components) {
      if (!component || typeof component !== 'object') continue;
      if ('@ctype' in component) return '@ctype';
      if ('ctype' in component) return 'ctype';
    }
    return '@ctype';
  }
  function renameTypeKey(value, typeKey) {
    if (typeKey === 'ctype') return value;
    if (Array.isArray(value)) return value.map((item) => renameTypeKey(item, typeKey));
    if (!value || typeof value !== 'object') return value;
    const out = {};
    for (const [key, child] of Object.entries(value)) out[key === 'ctype' ? typeKey : key] = renameTypeKey(child, typeKey);
    return out;
  }
  const componentType = (component) => component?.['@ctype'] || component?.ctype;
  const emptyText = () => ({ id: '', layout: 'default', ctype: 'text', value: [{ id: '', ctype: 'paragraph', nodes: [{ id: '', ctype: 'textNode', value: '' }] }] });

  function dataUrlToFile(dataUrl, fileName) {
    const [header, payload] = String(dataUrl).split(',');
    const mime = header.match(/data:(.*?);base64/)?.[1] || 'application/octet-stream';
    const binary = atob(payload || '');
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new File([bytes], fileName || 'image.png', { type: mime });
  }

  async function componentsOfType(editor, type) {
    try {
      const list = await editor.getComponentsByCtype(type);
      if (Array.isArray(list)) return list;
    } catch { /* 문서 스캔으로 폴백 */ }
    const data = await editor.getDocumentData();
    const slot = findComponentsSlot(data);
    return slot ? slot.owner[slot.key].filter((component) => componentType(component) === type) : [];
  }

  // SE ONE은 화면 밖 contenteditable 하나로 모든 붙여넣기를 받는다. 편집 영역 자체는 contenteditable이 아니다.
  // 그 버퍼는 mainFrame이 아니라 **그 안쪽 iframe**에 있다(1.1에서 확인). 같은 출처 iframe까지 내려가며 찾는다.
  const editableIn = (doc) => {
    if (!doc) return null;
    return doc.querySelector('div[contenteditable="true"][allow*="clipboard"]')
      || doc.querySelector('div[contenteditable="true"][tabindex="-1"]')
      || (doc.body?.isContentEditable ? doc.body : null)
      || doc.querySelector('[contenteditable="true"]');
  };
  function virtualEditable() {
    const seen = new Set();
    const queue = [document];
    while (queue.length) {
      const doc = queue.shift();
      if (!doc || seen.has(doc)) continue;
      seen.add(doc);
      const found = editableIn(doc);
      if (found) return found;
      for (const frame of doc.querySelectorAll('iframe, frame')) {
        try { if (frame.contentDocument) queue.push(frame.contentDocument); } catch { /* cross-origin */ }
      }
    }
    throw new Error('INPUT_BUFFER_NOT_FOUND');
  }
  const transferOf = (file) => { const t = new DataTransfer(); t.items.add(file); return t; };

  // 이벤트는 대상 문서의 생성자로 만든다 (다른 realm의 ClipboardEvent를 무시하는 경우가 있다)
  function pasteFile(file) {
    const target = virtualEditable();
    const view = target.ownerDocument?.defaultView || window;
    target.focus();
    const Clipboard = view.ClipboardEvent || ClipboardEvent;
    target.dispatchEvent(new Clipboard('paste', { bubbles: true, cancelable: true, clipboardData: transferOf(file) }));
  }
  function dropFile(file) {
    const target = document.querySelector('.se-canvas, .se-main-container, .se-components-wrap') || virtualEditable();
    const transfer = transferOf(file);
    for (const type of ['dragenter', 'dragover']) target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }

  // 네이버가 blogfiles.pstatic.net으로 올린 뒤에야 src가 https가 된다.
  // 그 전에 문서모델을 읽으면 로컬 blob 주소가 남아 저장 시 이미지가 사라진다.
  const isUploaded = (component) => typeof component.src === 'string' && /^https:\/\//.test(component.src);

  async function pollFor(timeoutMs, probe) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = await probe();
      if (found) return found;
      await wait(300);
    }
    return null;
  }

  let workingShape = '';
  async function uploadImage({ dataUrl, fileName }) {
    const editor = getEditor();
    const file = dataUrlToFile(dataUrl, fileName);
    // 새 컴포넌트를 "마지막 항목"이 아니라 id 차집합으로 찾는다 (커서 위치에 끼워 넣을 수 있음).
    const beforeIds = new Set((await componentsOfType(editor, 'image')).map((component) => component.id));
    const shapes = [['paste', () => pasteFile(file)], ['drop', () => dropFile(file)]];
    const ordered = workingShape ? shapes.slice().sort(([a]) => (a === workingShape ? -1 : 1)) : shapes;

    for (const [name, call] of ordered) {
      try { await call(); } catch { continue; }
      const created = await pollFor(8000, async () => {
        const list = await componentsOfType(editor, 'image');
        return list.find((component) => !beforeIds.has(component.id)) || null;
      });
      if (!created) continue;
      workingShape = name;
      const uploaded = await pollFor(180000, async () => {
        const list = await componentsOfType(editor, 'image');
        const target = list.find((component) => component.id === created.id) || list.find((component) => !beforeIds.has(component.id));
        return target && isUploaded(target) ? target : null;
      });
      if (!uploaded) throw new Error(`UPLOAD_TIMEOUT:${fileName}`);
      return JSON.parse(JSON.stringify(uploaded));
    }
    throw new Error(`UPLOAD_FAILED:${fileName}`);
  }

  // 장소 레이어는 지연 로드라 한 번도 연 적이 없으면 $service가 없다.
  async function placePlugin() {
    const editor = getEditor();
    const plugin = editor.getPlugin(window.SmartEditor.PLUGIN.PLACE_LAYER);
    if (!plugin) throw new Error('PLACE_PLUGIN_MISSING');
    if (plugin.$service) return { plugin, opened: false };
    try { await plugin.open?.(); } catch { /* 아래에서 다시 확인 */ }
    const ready = await pollFor(8000, () => (plugin.$service ? true : null));
    if (!ready) throw new Error('PLACE_PLUGIN_MISSING');
    return { plugin, opened: true };
  }

  function staticMapUrl(place) {
    const { longitude, latitude } = place.latlng || {};
    const markers = `type:d|color:0x11cc73|size:mid|pos:${longitude} ${latitude}|viewSizeRatio:0.7`;
    return 'https://simg.pstatic.net/static.map/v2/map/staticmap.bin?caller=smarteditor'
      + `&markers=${encodeURIComponent(markers)}&w=700&h=315&scale=2`;
  }
  async function makePlacesMap(service, place) {
    const clean = { ...place };
    for (const key of ['__isDomestic', 'uid', 'isAdded', 'isHighlight', 'zIndex']) delete clean[key];
    for (const shape of [
      () => service.createComponent({ places: [clean], searchEngine: 'naver' }),
      () => service.createComponent({ places: [clean] }),
      () => service.createComponent([clean])
    ]) {
      try {
        const created = await shape();
        const data = JSON.parse(JSON.stringify(created?.getData?.() ?? created));
        if (Array.isArray(data?.places) && data.places.length) return data;
      } catch { /* 다음 형태 */ }
    }
    return { id: '', layout: 'default', ctype: 'placesMap', searchEngine: 'naver', thumbnail: { ctype: 'thumbnail', src: staticMapUrl(clean) }, places: [clean] };
  }

  // placeId 하나로 장소를 가져오는 API가 없다. 이름으로 검색한 뒤 placeId가 같은 항목만 고른다.
  async function insertPlace({ placeId, name }) {
    if (!placeId) throw new Error('PLACE_ID_MISSING');
    if (!name) throw new Error('PLACE_NAME_MISSING');
    const { plugin, opened } = await placePlugin();
    try {
      const service = plugin.$service;
      const id = String(placeId);
      let place = null;
      const seen = [];
      let result = await service.fetchSearch(name);
      for (let page = 0; page < 5; page += 1) {
        const items = result?.items || [];
        seen.push(...items);
        place = items.find((item) => String(item.placeId) === id) || null;
        if (place || !result?.pagination?.hasNextPage) break;
        try { result = await service.fetchNextPage(); } catch { try { result = await service.fetchNextPage(name); } catch { break; } }
      }
      if (!place) {
        const candidates = seen.slice(0, 5).map((item) => `${item.placeId} ${item.name} (${item.address})`).join(' / ');
        throw new Error(`PLACE_NOT_FOUND:"${name}" 검색 ${seen.length}건 중 placeId ${id} 없음. 후보: ${candidates || '없음'}`);
      }
      return { component: await makePlacesMap(service, place), name: place.name, address: place.address };
    } finally {
      if (opened) { try { plugin.close?.(); } catch { /* 무시 */ } }
    }
  }

  async function setTitle(editor, title) {
    if (!title) return { applied: false };
    try { await editor.setDocumentTitle(title); return { applied: true, shape: 'string' }; } catch { /* 문단 배열로 재시도 */ }
    await editor.setDocumentTitle([{ id: '', ctype: 'paragraph', nodes: [{ id: '', ctype: 'textNode', value: title }] }]);
    return { applied: true, shape: 'paragraphs' };
  }

  // 제목은 components[0]의 documentTitle. 본문을 갈아끼울 때 지우면 제목칸을 잃는다.
  // 업로드 때 네이버가 커서 위치에 끼워 넣은 임시 이미지(uploadedIds)는 기존 본문에서 걷어낸다.
  // 안 그러면 방금 올린 사진이 글 맨 위에 한 번 더 남는다.
  async function replaceBody(components, { keepExisting = false, uploadedIds = [] } = {}) {
    const editor = getEditor();
    const data = await editor.getDocumentData();
    const slot = findComponentsSlot(data);
    if (!slot) throw new Error('EDITOR_API_MISSING');
    const current = slot.owner[slot.key];
    const typeKey = detectTypeKey(current);
    const drop = new Set(uploadedIds.filter(Boolean));
    const heads = current.filter((component) => componentType(component) === 'documentTitle');
    const body = keepExisting
      ? current.filter((component) => componentType(component) !== 'documentTitle' && !drop.has(component.id))
      : [];
    slot.owner[slot.key] = [...heads, ...body, ...renameTypeKey(components, typeKey)];
    await editor.setDocumentData(data);
    return { typeKey, total: slot.owner[slot.key].length };
  }

  async function applyDocument({ components, title, keepExisting, skipTitleIfPresent, uploadedIds }) {
    const editor = getEditor();
    const existingTitle = String((await editor.getDocumentTitle?.()) || '').trim();
    const result = await replaceBody(components, { keepExisting, uploadedIds });
    let titleResult = { applied: false, skipped: false };
    if (title) {
      if (existingTitle && skipTitleIfPresent) titleResult = { applied: false, skipped: true };
      else titleResult = await setTitle(editor, title);
    }
    let tags = [];
    try { tags = await editor.getTags(); } catch { /* 태그 조회 실패는 본문 적용과 무관 */ }
    return { components: components.length, title: titleResult, typeKey: result.typeKey, tags };
  }

  async function inspect() {
    const editor = getEditor();
    const data = await editor.getDocumentData();
    const slot = findComponentsSlot(data);
    const components = slot ? slot.owner[slot.key] : [];
    const body = components.filter((component) => componentType(component) !== 'documentTitle');
    return {
      editorIds: Object.keys(window.SmartEditor._editors || {}),
      componentCount: body.length,
      typeKey: detectTypeKey(components),
      isEmpty: await editor.isEmptyDocumentContent?.(),
      title: String((await editor.getDocumentTitle?.()) || '').trim()
    };
  }

  const handlers = {
    PING: inspect,
    CLEAR: async () => { await replaceBody([emptyText()]); return { cleared: true }; },
    UPLOAD_IMAGE: uploadImage,
    INSERT_PLACE: insertPlace,
    APPLY: applyDocument
  };

  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    const message = event.data;
    if (!message || message.ns !== NS) return;
    try {
      const handler = handlers[message.action];
      if (!handler) throw new Error(`UNKNOWN_ACTION:${message.action}`);
      const result = await handler(message.payload || {});
      window.postMessage({ ns: RES, id: message.id, ok: true, result }, '*');
    } catch (error) {
      window.postMessage({ ns: RES, id: message.id, ok: false, error: String(error?.message || error) }, '*');
    }
  });
})();
