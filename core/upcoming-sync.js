// Upcoming keeps a workspace-scoped cache and merges only locally changed items.
// Deleted items remain as tombstones so another device cannot restore them.
export function createUpcomingStore({ workspaceId, sbFetch, storage = localStorage, onChange = () => {}, onStatus = () => {} }) {
  const widgetKey = "upcoming_v1";
  const cacheKey = `soft_schedule_upcoming_${workspaceId}_v2`;
  const legacyKey = "soft_schedule_upcoming_v1";
  const migrationKey = "soft_schedule_upcoming_migrated_workspace_v2";
  const editableFields = new Set(["*", "text", "date", "done", "deleted", "sortOrder"]);
  let records = new Map();
  let pending = new Map();
  let sequence = 0;
  let running = null;
  let status = { connected: false, error: null };
  const canSync = workspaceId !== "local" && typeof sbFetch === "function";

  function normalize(raw) {
    if (!Array.isArray(raw)) throw new Error("Upcoming 기록의 형식을 확인할 수 없습니다.");
    return raw.filter(item => item && item.id != null && typeof item.text === "string").map(item => ({
      ...item,
      id: String(item.id),
      text: item.text,
      date: /^\d{4}-\d{2}-\d{2}$/.test(item.date || "") ? item.date : null,
      done: Boolean(item.done),
      createdAt: Number(item.createdAt) || 0,
      deleted: Boolean(item.deleted),
      sortOrder: Number.isSafeInteger(item.sortOrder) && item.sortOrder >= 0 ? item.sortOrder : null
    }));
  }
  function setStatus(connected, error = null) {
    status = { connected, error };
    onStatus(status);
  }
  function persist() {
    const pendingFields = Object.fromEntries([...pending].map(([id, fields]) => [id, Object.keys(fields)]));
    storage.setItem(cacheKey, JSON.stringify({ records: [...records.values()], pending: [...pending.keys()], pendingFields }));
  }
  function readCache() {
    const raw = storage.getItem(cacheKey);
    if (!raw) return;
    const cached = JSON.parse(raw);
    records = new Map(normalize(cached.records).map(item => [item.id, item]));
    for (const id of cached.pending || []) {
      if (!records.has(id)) continue;
      const fields = cached.pendingFields?.[id];
      commitLocal(records.get(id), Array.isArray(fields) ? fields.filter(field => editableFields.has(field)) : ["*"]);
    }
  }
  function importLegacy() {
    if (storage.getItem(migrationKey)) return;
    const raw = storage.getItem(legacyKey);
    if (!raw) return;
    const legacy = normalize(JSON.parse(raw));
    if (!legacy.length) return;
    for (const item of legacy) {
      if (!records.has(item.id)) {
        commitLocal(item);
      }
    }
    persist();
    // The original local records stay intact as a backup.
    storage.setItem(migrationKey, workspaceId);
  }
  try { readCache(); importLegacy(); }
  catch (error) { setStatus(false, error); }

  function items() { return [...records.values()].filter(item => !item.deleted); }
  function notify(fromRemote = false) { onChange(items(), fromRemote); }
  function commitLocal(item, fields = ["*"]) {
    records.set(item.id, item);
    if (!fields.length) return;
    const revision = ++sequence;
    const changes = { ...pending.get(item.id) };
    for (const field of fields) changes[field] = revision;
    pending.set(item.id, changes);
  }
  function afterMutation() {
    try { persist(); } catch (error) { setStatus(false, error); }
    notify();
    sync();
  }
  function add(item) {
    commitLocal(normalize([item])[0]);
    afterMutation();
  }
  function toggle(id) {
    const item = records.get(id);
    if (!item || item.deleted) return;
    commitLocal({ ...item, done: !item.done, sortOrder: null }, ["done", "sortOrder"]);
    afterMutation();
  }
  function updateText(id, text) {
    const item = records.get(id);
    const value = String(text || "").trim().slice(0, 80);
    if (!item || item.deleted || !value || value === item.text) return false;
    commitLocal({ ...item, text: value }, ["text"]);
    afterMutation();
    return true;
  }
  function updateDate(id, date) {
    const item = records.get(id);
    if (!item || item.deleted || item.date === date) return false;
    commitLocal({ ...item, date }, ["date"]);
    afterMutation();
    return true;
  }
  function reorder(ids) {
    let changed = false;
    ids.forEach((id, sortOrder) => {
      const item = records.get(id);
      if (!item || item.deleted || item.done || item.sortOrder === sortOrder) return;
      commitLocal({ ...item, sortOrder }, ["sortOrder"]);
      changed = true;
    });
    if (changed) afterMutation();
  }
  function remove(ids) {
    let changed = false;
    for (const id of ids) {
      const item = records.get(id);
      if (!item || item.deleted) continue;
      commitLocal({ ...item, deleted: true }, ["deleted"]);
      changed = true;
    }
    if (changed) afterMutation();
  }
  async function readRemote() {
    const rows = await sbFetch("widget_state", { query: {
      select: "payload,updated_at", workspace_id: `eq.${workspaceId}`,
      widget_key: `eq.${widgetKey}`, limit: "1"
    }});
    if (!Array.isArray(rows)) throw new Error("서버 응답 형식을 확인할 수 없습니다.");
    const row = rows[0];
    if (row && !row.updated_at) throw new Error("서버 기록의 수정 시각을 확인할 수 없습니다.");
    const raw = row && (Array.isArray(row.payload) ? row.payload : row.payload?.items);
    return { row, remote: new Map((row ? normalize(raw) : []).map(item => [item.id, item])) };
  }
  function merge(remote, dirty) {
    const merged = new Map(remote);
    // Order, date and title can change on different devices before the next pull.
    for (const [id, fields] of dirty) {
      const localItem = records.get(id);
      const remoteItem = remote.get(id);
      if (!localItem || remoteItem?.deleted) continue;
      if (!remoteItem || fields["*"]) {
        merged.set(id, localItem);
        continue;
      }
      const item = { ...remoteItem };
      for (const field of Object.keys(fields)) item[field] = localItem[field];
      merged.set(id, item);
    }
    return merged;
  }
  function acknowledge(dirty) {
    for (const [id, savedFields] of dirty) {
      const remaining = { ...pending.get(id) };
      for (const [field, revision] of Object.entries(savedFields)) {
        if (remaining[field] === revision) delete remaining[field];
      }
      if (Object.keys(remaining).length) pending.set(id, remaining);
      else pending.delete(id);
    }
  }
  async function synchronize() {
    if (!canSync) { setStatus(false); return; }
    try {
      for (let attempt = 0; attempt < 5; attempt++) {
        const { row, remote } = await readRemote();
        const dirty = new Map(pending);
        const merged = merge(remote, dirty);
        if (!dirty.size) {
          records = merged;
          persist();
          notify(true);
          setStatus(true);
          return;
        }
        // A conditional PATCH prevents two open devices overwriting each other.
        const updatedAt = new Date(Math.max(Date.now(), (Date.parse(row?.updated_at) || 0) + 1)).toISOString();
        const body = { payload: { version: 2, items: [...merged.values()] }, updated_at: updatedAt };
        const saved = row
          ? await sbFetch("widget_state", {
              method: "PATCH", query: { workspace_id: `eq.${workspaceId}`, widget_key: `eq.${widgetKey}`, updated_at: `eq.${row.updated_at}` }, body
            })
          : await sbFetch("widget_state?on_conflict=workspace_id,widget_key", {
              method: "POST", prefer: "return=representation,resolution=ignore-duplicates",
              body: [{ workspace_id: workspaceId, widget_key: widgetKey, ...body }]
            });
        if (!Array.isArray(saved) || !saved.length) continue;
        acknowledge(dirty);
        records = merge(merged, pending);
        persist();
        notify(true);
        setStatus(true);
        if (!pending.size) return;
      }
      throw new Error("다른 기기의 변경을 반영 중입니다. 잠시 후 다시 연결합니다.");
    } catch (error) {
      setStatus(false, error);
    }
  }
  function sync() {
    if (running) return running;
    running = synchronize().finally(() => { running = null; });
    return running;
  }
  return { items, add, updateText, updateDate, reorder, toggle, remove, sync, getStatus: () => status };
}

