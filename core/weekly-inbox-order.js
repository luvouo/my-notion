// Keep inbox order independent of title/status timestamps in weekly_inbox_items.
export function createWeeklyInboxOrder({ workspaceId, sbFetch, storage = localStorage }) {
  const prefix = "weekly_inbox_order_v1.";
  const cacheKey = `soft_schedule_${workspaceId}_weekly_inbox_order_v1`;
  const orders = new Map();
  let running = null;

  function keyFor(weekId, inbox) {
    return `${prefix}${weekId.slice(0, 10)}.${inbox}`;
  }

  try {
    const cached = JSON.parse(storage.getItem(cacheKey) || "{}");
    for (const [key, value] of Object.entries(cached)) {
      if (key.startsWith(prefix) && Array.isArray(value?.ids)) orders.set(key, value);
    }
  } catch (error) {
    console.warn("[This Week Widget] Could not read the cached inbox order.", error);
  }

  function persist() {
    storage.setItem(cacheKey, JSON.stringify(Object.fromEntries(orders)));
  }

  function apply(weekId, inbox, items) {
    const order = orders.get(keyFor(weekId, inbox));
    if (!order) return items;
    const rank = new Map(order.ids.map((id, index) => [id, index]));
    // New items appear ahead of the ones that were explicitly ordered.
    return items.slice().sort((a, b) => (rank.get(String(a.id)) ?? -1) - (rank.get(String(b.id)) ?? -1));
  }

  function set(weekId, inbox, items) {
    orders.set(keyFor(weekId, inbox), {
      ids: items.map(item => String(item.id)),
      pending: Boolean(sbFetch)
    });
    persist();
  }

  async function synchronize() {
    const rows = await sbFetch("widget_state", { query: {
      workspace_id: `eq.${workspaceId}`,
      widget_key: `like.${prefix}*`,
      select: "widget_key,payload"
    }});
    for (const row of rows || []) {
      const key = row.widget_key;
      if (key?.startsWith(prefix) && Array.isArray(row.payload?.ids) && !orders.get(key)?.pending) {
        orders.set(key, { ids: row.payload.ids.map(String), pending: false });
      }
    }

    // Save independent Inbox sections in one request. If a drag happens during
    // this request, its newer order stays pending for the next loop.
    let dirty = [...orders].filter(([, order]) => order.pending);
    while (dirty.length) {
      const updated_at = new Date().toISOString();
      const saved = await sbFetch("widget_state?on_conflict=workspace_id,widget_key", {
        method: "POST",
        prefer: "return=representation,resolution=merge-duplicates",
        body: dirty.map(([widget_key, order]) => ({
          workspace_id: workspaceId,
          widget_key,
          updated_at,
          payload: { ids: order.ids }
        }))
      });
      if (!Array.isArray(saved) || saved.length !== dirty.length) throw new Error("Inbox 순서를 서버에 저장하지 못했습니다.");
      for (const [key, order] of dirty) if (orders.get(key) === order) order.pending = false;
      persist();
      dirty = [...orders].filter(([, order]) => order.pending);
    }
    persist();
  }

  function sync() {
    if (!sbFetch) return;
    if (!running) running = synchronize().finally(() => { running = null; });
    return running;
  }

  return { apply, set, sync };
}
