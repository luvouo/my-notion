export const pencilIcon = `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`;

export const dragHandle = `<span class="dragHandle" draggable="true" title="드래그하여 순서 변경" aria-hidden="true">⠿</span>`;

export function enableListReordering(container, onMove) {
  let source = null;
  let marker = null;
  const groupOf = row => row.dataset.orderGroup || "";
  const rowOf = target => target.closest("[data-order-id]");
  const isAfter = (row, event) => {
    const rect = row.getBoundingClientRect();
    return event.clientY > rect.top + rect.height / 2;
  };
  const clearMarker = () => {
    marker?.classList.remove("drop-before", "drop-after");
    marker = null;
  };
  const clearDrag = () => {
    clearMarker();
    source?.classList.remove("dragging");
    source = null;
  };
  const targetOf = event => {
    const row = rowOf(event.target);
    return source && row && row !== source && groupOf(row) === groupOf(source) ? row : null;
  };

  container.addEventListener("dragstart", event => {
    const handle = event.target.closest(".dragHandle");
    const row = handle && rowOf(handle);
    if (!row || !event.dataTransfer) return;
    source = row;
    source.classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", source.dataset.orderId);
    event.dataTransfer.setDragImage(source, 12, Math.round(source.offsetHeight / 2));
  });
  container.addEventListener("dragover", event => {
    if (!source) return;
    clearMarker();
    const row = targetOf(event);
    if (!row) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    marker = row;
    marker.classList.add(isAfter(row, event) ? "drop-after" : "drop-before");
  });
  container.addEventListener("dragleave", event => {
    if (!container.contains(event.relatedTarget)) clearMarker();
  });
  container.addEventListener("drop", event => {
    if (!source) return;
    const row = targetOf(event);
    const fromId = source.dataset.orderId;
    clearDrag();
    if (!row) return;
    event.preventDefault();
    onMove(fromId, row.dataset.orderId, isAfter(row, event), groupOf(row));
  });
  container.addEventListener("dragend", clearDrag);
  return () => Boolean(source);
}

export function moveItem(items, fromId, toId, after) {
  const from = items.findIndex(item => String(item.id) === fromId);
  const to = items.findIndex(item => String(item.id) === toId);
  if (from < 0 || to < 0 || from === to) return items;
  const position = to + Number(after) - Number(from < to);
  if (position === from) return items;
  const ordered = items.slice();
  const [item] = ordered.splice(from, 1);
  ordered.splice(position, 0, item);
  return ordered;
}

export function rankDayItems(items) {
  const base = Date.now() + items.length;
  return items.map((item, index) => ({ ...item, sort_order: base - index }));
}

export function captureInlineInput(input) {
  if (!input) return null;
  return {
    value: input.value,
    focused: input === input.ownerDocument.activeElement,
    start: input.selectionStart,
    end: input.selectionEnd,
    direction: input.selectionDirection,
    scrollLeft: input.scrollLeft
  };
}

export function restoreInlineCaret(input, draft) {
  if (!input || !draft?.focused) return;
  input.focus({ preventScroll: true });
  input.setSelectionRange(draft.start, draft.end, draft.direction);
  input.scrollLeft = draft.scrollLeft;
}
