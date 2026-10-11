import { getSavedPasscode } from './auth-lite.js';

const BUCKET = 'project-images';
const MAX_SOURCE = 20 * 1024 * 1024;
const MAX_UPLOAD = 6 * 1024 * 1024;
const TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const WIDTHS = new Set(['25', '50', '75', '100']);
let webpEncoding;

function outputType(source) {
  if (webpEncoding === undefined) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    webpEncoding = canvas.toDataURL('image/webp').startsWith('data:image/webp');
  }
  // WebP decoding does not imply canvas encoding support in mobile WebViews.
  return webpEncoding ? 'image/webp' : source.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
}

export function validImagePath(path, workspace) {
  return /^[a-f0-9]{64}$/.test(workspace) &&
    new RegExp(`^${workspace}/[A-Za-z0-9_-]{1,100}/[a-f0-9-]{36}\\.(webp|png|jpg)$`).test(path || '');
}

// Rebuild the image reference, never trust pasted attributes, URLs or controls.
export function canonicalImage(node, workspace) {
  const path = node.getAttribute('data-project-image');
  if (!validImagePath(path, workspace)) return null;
  const figure = document.createElement('figure');
  figure.dataset.projectImage = path;
  figure.dataset.imageWidth = WIDTHS.has(node.dataset.imageWidth) ? node.dataset.imageWidth : '100';
  figure.className = 'projectImage';
  figure.contentEditable = 'false';
  const img = document.createElement('img');
  img.alt = '프로젝트 이미지';
  figure.append(img);
  return figure;
}

function openQueue(workspace) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(`project_images_${workspace}_v1`, 1);
    // Some embedded WebViews leave this request pending indefinitely.
    // Local recovery is optional; it must not prevent a server upload.
    let expired = false;
    const timeout = setTimeout(() => {
      expired = true;
      reject(new Error('이미지 임시 저장 공간을 열 수 없습니다.'));
    }, 1500);
    request.onupgradeneeded = () => request.result.createObjectStore('pending', { keyPath: 'path' });
    request.onsuccess = () => {
      clearTimeout(timeout);
      if (expired) request.result.close();
      else resolve(request.result);
    };
    request.onerror = () => { clearTimeout(timeout); reject(request.error); };
    request.onblocked = () => { clearTimeout(timeout); expired = true; reject(new Error('이미지 임시 저장 공간을 열 수 없습니다.')); };
  });
}

async function compress(source) {
  if (!TYPES.has(source.type)) throw new Error('PNG, JPG, WebP 이미지를 붙여넣어 주세요.');
  if (source.size > MAX_SOURCE) throw new Error('20MB 이하의 이미지를 사용해 주세요.');
  const url = URL.createObjectURL(source);
  try {
    const img = new Image();
    img.src = url;
    try { await img.decode(); }
    catch (_) { throw new Error('이미지를 열 수 없습니다. 다른 PNG 또는 JPG로 다시 시도해 주세요.'); }
    if (!img.naturalWidth || img.naturalWidth * img.naturalHeight > 80000000)
      throw new Error('이미지 크기가 너무 큽니다. 크기를 줄여 주세요.');
    const scale = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const type = outputType(source);
    let blob = await new Promise(resolve => canvas.toBlob(resolve, type, 0.86));
    // Keep transparency in PNG fallbacks, reducing dimensions only if needed.
    for (let attempt = 0; blob?.size > MAX_UPLOAD && attempt < 3; attempt++) {
      canvas.width = Math.max(1, Math.round(canvas.width * 0.75));
      canvas.height = Math.max(1, Math.round(canvas.height * 0.75));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      blob = await new Promise(resolve => canvas.toBlob(resolve, type, 0.86));
    }
    if (!blob || !TYPES.has(blob.type) || blob.size > MAX_UPLOAD)
      throw new Error('이미지를 변환할 수 없습니다. 크기를 줄인 PNG 또는 JPG를 사용해 주세요.');
    return blob;
  } finally { URL.revokeObjectURL(url); }
}

export function createProjectImages({ workspace, notify }) {
  const env = window.__ENV__ || {};
  const base = `${String(env.SUPABASE_URL || '').replace(/\/$/, '')}/storage/v1`;
  const entries = new Map();
  const signed = new Map();
  const signing = new Map();
  const attached = new WeakMap();
  const dbPromise = openQueue(workspace).catch(() => null);
  const changed = editor => editor.dispatchEvent(new Event('input', { bubbles: true }));
  let refreshTimer;

  async function queue(method, value) {
    const db = await dbPromise;
    if (!db) throw new Error('이미지 임시 저장 공간을 사용할 수 없습니다.');
    return new Promise((resolve, reject) => {
      const tx = db.transaction('pending', method === 'getAll' ? 'readonly' : 'readwrite');
      const request = tx.objectStore('pending')[method](value);
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  function headers(type) {
    const bytes = new TextEncoder().encode(getSavedPasscode().trim());
    const proof = btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
    return { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
      'x-widget-passcode': proof, 'Content-Type': type };
  }
  async function request(route, body, type = 'application/json') {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 25000);
    try {
      const response = await fetch(base + route, { method: 'POST', headers: headers(type),
        body, signal: abort.signal });
      let data = {};
      try { data = await response.json(); } catch (_) {}
      if (!response.ok) {
        const error = new Error(response.status === 401 || response.status === 403 ||
          /bucket|row.level|policy/i.test(data.message || data.error || '')
          ? '이미지 서버 설정 또는 패스코드를 확인해 주세요.' : '이미지 전송에 실패했습니다. 다시 시도해 주세요.');
        error.status = Number(data.statusCode || response.status);
        throw error;
      }
      return data;
    } finally { clearTimeout(timeout); }
  }
  function figures(path) {
    return [...document.querySelectorAll('figure[data-project-image]')].filter(f => f.dataset.projectImage === path);
  }
  function paint(figure) {
    const path = figure.dataset.projectImage;
    const entry = entries.get(path);
    const img = figure.querySelector('img');
    figure.style.width = `${figure.dataset.imageWidth || '100'}%`;
    if (entry?.preview && img.getAttribute('src') !== entry.preview) img.src = entry.preview;
    const status = figure.querySelector('[data-image-status]');
    if (status) status.textContent = entry?.busy ? '이미지 전송 중…' : entry?.error || '';
    const retry = figure.querySelector('[data-image-retry]');
    if (retry) retry.hidden = !entry?.error;
    figure.classList.toggle('imagePending', !!entry && !entry.uploaded);
  }
  function repaint(path) { figures(path).forEach(paint); }
  async function signedUrl(path, force = false) {
    const cached = signed.get(path);
    if (!force && cached && cached.expires > Date.now()) return cached.url;
    if (signing.has(path)) return signing.get(path);
    const promise = (async () => {
      const data = await request(`/object/sign/${BUCKET}/${path}`, JSON.stringify({ expiresIn: 3600 }));
      const value = data.signedURL || data.signedUrl;
      if (!value) throw new Error('이미지 주소를 불러올 수 없습니다.');
      const url = new URL(value.startsWith('/object/') ? base + value : value, base + '/');
      if (url.origin !== new URL(base).origin || !url.pathname.includes(`/object/sign/${BUCKET}/`))
        throw new Error('이미지 주소를 확인할 수 없습니다.');
      signed.set(path, { url: url.href, expires: Date.now() + 3300000 });
      return url.href;
    })();
    signing.set(path, promise);
    try { return await promise; } finally { signing.delete(path); }
  }
  async function showImage(figure, force = false) {
    const path = figure.dataset.projectImage;
    const entry = entries.get(path);
    if (entry && !entry.uploaded) { paint(figure); return; }
    try {
      const src = await signedUrl(path, force);
      if (!figure.isConnected || figure.dataset.projectImage !== path) return;
      figure.querySelector('img').src = src;
      if (entry) entry.error = '';
      paint(figure);
    } catch (error) {
      if (!entries.has(path)) entries.set(path, { uploaded: true });
      entries.get(path).error = error.message;
      repaint(path);
    }
  }
  async function upload(path) {
    const entry = entries.get(path);
    if (!entry?.blob || entry.busy || entry.uploaded) return;
    entry.busy = true; entry.error = ''; repaint(path);
    try {
      const blob = entry.compressed ? entry.blob : await compress(entry.blob);
      entry.blob = blob; entry.compressed = true;
      try { await queue('put', { path, blob, compressed: true }); entry.durable = true; } catch (_) {}
      try { await request(`/object/${BUCKET}/${path}`, blob, blob.type); }
      catch (error) {
        // An upload can succeed while its response is lost. Never overwrite it.
        if (error.status !== 409 && error.status !== 400) throw error;
        await signedUrl(path, true);
      }
      // Keep the local recovery copy until the server confirms we can read it.
      await signedUrl(path, true);
      entry.uploaded = true;
      await queue('delete', path).catch(() => {});
      entry.blob = null;
      if (entry.preview) URL.revokeObjectURL(entry.preview);
      entry.preview = '';
      await Promise.all(figures(path).map(f => showImage(f)));
    } catch (error) {
      entry.error = `${error.message || '이미지 전송에 실패했습니다.'} ${entry.durable
        ? '이 기기에 임시 보관 중입니다.' : '임시 저장도 실패했습니다. 원본을 보관하고 이 화면에서 재시도해 주세요.'}`;
    } finally { entry.busy = false; repaint(path); }
  }
  function decorate(figure, editable) {
    if (!validImagePath(figure.dataset.projectImage, workspace)) return;
    figure.querySelectorAll('[data-image-tools],[data-image-status]').forEach(el => el.remove());
    const status = document.createElement('figcaption');
    status.dataset.imageStatus = ''; status.setAttribute('aria-live', 'polite');
    const tools = document.createElement('div');
    tools.dataset.imageTools = ''; tools.className = 'imageTools';
    const retry = document.createElement('button');
    retry.type = 'button'; retry.dataset.imageRetry = ''; retry.textContent = '재시도'; retry.hidden = true;
    retry.onclick = () => {
      if (entries.get(figure.dataset.projectImage)?.blob) upload(figure.dataset.projectImage);
      else showImage(figure, true);
    };
    tools.append(retry);
    if (editable) {
      const size = document.createElement('select');
      size.setAttribute('aria-label', '이미지 너비');
      for (const width of WIDTHS) size.add(new Option(`${width}%`, width));
      size.value = figure.dataset.imageWidth || '100';
      size.onchange = () => { figure.dataset.imageWidth = size.value; paint(figure); changed(editable); };
      const remove = document.createElement('button');
      remove.type = 'button'; remove.textContent = '이미지 삭제';
      remove.onclick = () => { figure.remove(); changed(editable); };
      tools.append(size, remove);
    }
    figure.append(status, tools);
    figure.querySelector('img').onerror = () => {
      const path = figure.dataset.projectImage;
      const entry = entries.get(path);
      if (entry?.busy || (entry?.blob && !entry.uploaded)) return;
      if (!entry) entries.set(path, { uploaded: true });
      entries.get(path).error = '이미지를 불러오지 못했습니다. 재시도해 주세요.';
      repaint(path);
    };
    paint(figure); showImage(figure);
  }
  function remember(editor) {
    const selection = getSelection();
    if (selection?.rangeCount && editor.contains(selection.getRangeAt(0).commonAncestorContainer))
      attached.get(editor).range = selection.getRangeAt(0).cloneRange();
  }
  async function add(editor, files) {
    const binding = attached.get(editor);
    if (!binding || !editor.isConnected) return;
    if (!/^[a-f0-9]{64}$/.test(workspace) || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
      notify('같은 패스코드로 서버에 연결한 뒤 이미지를 추가해 주세요.'); return;
    }
    let range = binding.range;
    if (!range || !editor.contains(range.commonAncestorContainer)) {
      range = document.createRange(); range.selectNodeContents(editor); range.collapse(false);
    }
    for (const file of files) {
      if (!TYPES.has(file.type) || file.size > MAX_SOURCE) {
        notify('PNG·JPG·WebP 형식의 20MB 이하 이미지를 사용해 주세요.'); continue;
      }
      const extension = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg' }[outputType(file)];
      const path = `${workspace}/${binding.project.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100) || 'project'}/${crypto.randomUUID()}.${extension}`;
      const seed = document.createElement('figure'); seed.dataset.projectImage = path;
      const figure = canonicalImage(seed, workspace);
      const entry = { blob: file, preview: URL.createObjectURL(file), uploaded: false, busy: true, durable: false };
      entries.set(path, entry);
      range.deleteContents(); range.insertNode(figure);
      const next = document.createElement('div'); next.append(document.createElement('br'));
      figure.after(next); range.setStart(next, 0); range.collapse(true);
      binding.range = range.cloneRange();
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
      decorate(figure, editor); changed(editor);
      // The placeholder is inserted before asynchronous work, so switching
      // projects or rebuilding a modal can never insert into another draft.
      queue('put', { path, blob: file, compressed: false }).then(() => { entry.durable = true; })
        .catch(() => {}).finally(() => { entry.busy = false; upload(path); });
    }
  }
  function attach(editor, project) {
    if (!editor) return;
    let binding = attached.get(editor);
    if (!binding) {
      binding = {}; attached.set(editor, binding);
      ['mouseup', 'keyup', 'focus', 'touchend'].forEach(event => editor.addEventListener(event, () => remember(editor)));
      editor.addEventListener('paste', event => {
        const files = [...(event.clipboardData?.files || [])].filter(file => file.type.startsWith('image/'));
        if (!files.length) return;
        event.preventDefault(); event.stopImmediatePropagation(); remember(editor); add(editor, files);
      }, true);
    }
    binding.project = String(project); binding.range = null;
    const host = editor.parentElement;
    let picker = host.querySelector('[data-image-picker]');
    if (!picker) {
      picker = document.createElement('div'); picker.dataset.imagePicker = ''; picker.className = 'imagePicker';
      const button = document.createElement('button'); button.type = 'button'; button.className = 'textAction';
      button.textContent = '+ 이미지';
      const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp';
      input.multiple = true; input.hidden = true;
      button.onpointerdown = () => remember(editor);
      button.onclick = () => input.click();
      input.onchange = () => { add(editor, [...input.files]); input.value = ''; };
      picker.append(button, input); editor.before(picker);
    }
    editor.querySelectorAll('figure[data-project-image]').forEach(f => decorate(f, editor));
  }
  function show(root) {
    root.querySelectorAll('figure[data-project-image]').forEach(f => decorate(f, null));
  }
  function refresh() {
    document.querySelectorAll('figure[data-project-image]').forEach(f => showImage(f));
    entries.forEach((entry, path) => { if (entry.blob && !entry.busy) upload(path); });
  }
  const ready = queue('getAll').then(rows => {
    for (const row of rows || []) {
      if (!validImagePath(row.path, workspace) || entries.get(row.path)?.blob) continue;
      entries.set(row.path, { ...row, preview: URL.createObjectURL(row.blob), durable: true, uploaded: false });
    }
    refresh();
  }).catch(() => {});
  window.addEventListener('online', refresh);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  refreshTimer = setInterval(() => { if (!document.hidden) refresh(); }, 60000);
  window.addEventListener('pagehide', () => clearInterval(refreshTimer), { once: true });
  return { attach, show, ready };
}
