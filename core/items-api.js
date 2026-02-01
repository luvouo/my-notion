// core/items-api.js
import { sbFetch } from "./supabase-rest.js";
import { nowIso } from "./date-utils.js";

export function rowToItem(row){
  return {
    id: row.id,
    text: row.title || "",
    done: row.status === "done",
    due_at: row.due_at ?? null, // null 가능
  };
}

export function itemToRow({ id, text, done, due_at }, workspace_id){
  return {
    id,
    workspace_id,
    title: (text || "").trim(),
    status: done ? "done" : "todo",
    due_at: due_at ?? null, // null 허용
    deleted: false,
    updated_at: nowIso(),
  };
}

export async function upsertItemRow(row){
  // on_conflict=id upsert
  return sbFetch("items?on_conflict=id", { method: "POST", body: [row] });
}

export async function patchItemRow(id, patch){
  return sbFetch(`items?id=eq.${id}`, { method: "PATCH", body: patch });
}

export async function softDeleteItem(id){
  return patchItemRow(id, { deleted: true, updated_at: nowIso() });
}

/** Upcoming: due_at 있는 것(오늘 이후 등) + due_at null(undated) */
export async function loadUpcoming({ workspace_id, startIso=null, includeUndated=true, limit=500 }){
  // 1) dated
  const datedQuery = {
    select: "id,title,status,due_at,updated_at",
    workspace_id: `eq.${workspace_id}`,
    deleted: "eq.false",
    due_at: "not.is.null",
    order: "due_at.asc,updated_at.desc",
    limit: String(limit),
  };
  if (startIso) datedQuery.due_at = `gte.${startIso}`; // startIso 이후만

  const dated = await sbFetch("items", { query: datedQuery });

  // 2) undated
  let undated = [];
  if (includeUndated){
    undated = await sbFetch("items", {
      query: {
        select: "id,title,status,due_at,updated_at",
        workspace_id: `eq.${workspace_id}`,
        deleted: "eq.false",
        due_at: "is.null",
        order: "updated_at.desc",
        limit: String(Math.min(limit, 500)),
      }
    });
  }

  return {
    dated: dated.map(rowToItem),
    undated: undated.map(rowToItem),
  };
}

/** This Week: due_at 범위 (월~일) */
export async function loadThisWeek({ workspace_id, startIso, endIso, limit=700 }){
  const rows = await sbFetch("items", {
    query: {
      select: "id,title,status,due_at,updated_at",
      workspace_id: `eq.${workspace_id}`,
      deleted: "eq.false",
      due_at: `gte.${startIso}`,
      and: `(due_at.lt.${endIso})`,
      order: "due_at.asc,updated_at.desc",
      limit: String(limit),
    }
  });
  return rows.map(rowToItem);
}

