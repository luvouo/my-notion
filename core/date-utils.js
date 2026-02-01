// core/date-utils.js
export function pad2(n){ return String(n).padStart(2, "0"); }

export function ymd(d = new Date()){
  return `${d.getFullYear()}.${pad2(d.getMonth()+1)}.${pad2(d.getDate())}`;
}

export function parseYmdParts(str){
  const m = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(str);
  if(!m) return null;
  return { y:+m[1], m:+m[2], d:+m[3] };
}

/** "YYYY.MM.DD" 로컬 자정 기준 [startIso, endIso) */
export function dayRangeIso(dateStr){
  const p = parseYmdParts(dateStr);
  if(!p) throw new Error("bad dateStr");
  const start = new Date(p.y, p.m-1, p.d, 0,0,0,0);
  const end   = new Date(p.y, p.m-1, p.d+1, 0,0,0,0);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

/** 월요일 시작 주간 범위 */
export function weekRangeIsoMondayStart(base = new Date()){
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 0,0,0,0);
  const day = d.getDay(); // 0=일 ... 1=월
  const diffToMon = (day === 0) ? -6 : (1 - day);
  const mon = new Date(d);
  mon.setDate(d.getDate() + diffToMon);
  const nextMon = new Date(mon);
  nextMon.setDate(mon.getDate() + 7);
  return { startIso: mon.toISOString(), endIso: nextMon.toISOString() };
}

export function nowIso(){ return new Date().toISOString(); }

export function dueAtToYmd(due_at){
  const d = new Date(due_at);
  return `${d.getFullYear()}.${pad2(d.getMonth()+1)}.${pad2(d.getDate())}`;
}

