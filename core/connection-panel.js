import { getSavedPasscode, savePasscode } from "./auth-lite.js";
import { workspaceIdFromPasscode } from "./crypto-utils.js";

// A connection check only reads the current widget's server rows.
async function checkServer(workspaceId, sources) {
  const env = window.__ENV__ || {};
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    throw new Error("서버 설정을 불러오지 못했습니다.");
  }
  const results = await Promise.all(sources.map(async source => {
    const url = new URL(`${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${source.table}`);
    url.searchParams.set("select", "workspace_id");
    url.searchParams.set("workspace_id", `eq.${workspaceId}`);
    url.searchParams.set("limit", "1");
    if (source.widgetKey) url.searchParams.set("widget_key", `eq.${source.widgetKey}`);
    if (source.activeOnly) url.searchParams.set("deleted", "eq.false");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(url, {
        headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}` },
        cache: "no-store", signal: controller.signal
      });
      if (!response.ok) throw new Error(`서버 요청에 실패했습니다. 오류 번호: ${response.status}`);
      const rows = await response.json();
      if (!Array.isArray(rows)) throw new Error("서버 응답 형식을 확인할 수 없습니다.");
      return rows.length > 0;
    } catch (error) {
      if (error.name === "AbortError") throw new Error("서버 응답 시간이 초과되었습니다. 인터넷 연결을 확인해 주세요.");
      if (error instanceof TypeError) throw new Error("서버에 연결하지 못했습니다. 인터넷 연결이나 차단 설정을 확인해 주세요.");
      throw error;
    } finally { clearTimeout(timeout); }
  }));
  return results.some(Boolean);
}

export function mountConnectionPanel({ getWorkspaceId, getServerMode, sources }) {
  if (document.getElementById("widget-connection-host")) return;
  const top = document.querySelector(".wrap .top");
  if (!top) return;
  const opener = document.createElement("button");
  opener.type = "button";
  opener.textContent = "연결";
  opener.setAttribute("aria-label", "기기 연결 설정 열기");
  opener.style.cssText = "flex:0 0 auto;min-height:32px;padding:4px 10px;border:1px solid rgba(180,140,170,.3);border-radius:14px;background:rgba(255,255,255,.7);color:#71616b;font:inherit;font-size:12px;cursor:pointer;";
  top.append(opener);
  const host = document.createElement("div");
  host.id = "widget-connection-host";
  document.body.append(host);
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      :host{font-family:system-ui,-apple-system,sans-serif;color:#473f45}
      *{box-sizing:border-box}dialog{color:#473f45;width:calc(100% - 24px);max-width:420px;max-height:calc(100dvh - 24px);margin:auto;padding:18px;border:1px solid #eadde5;border-radius:18px;background:#fffafb;overflow:auto;font:14px/1.6 system-ui,-apple-system,sans-serif}
      dialog::backdrop{background:rgba(45,35,45,.3)}h2{font-size:17px;margin:0}p{margin:8px 0}.heading,.actions{display:flex;gap:8px;align-items:center;justify-content:space-between}.heading{margin-bottom:12px}
      button{font:inherit;min-height:44px;padding:8px 12px;border:1px solid #e6cbd9;border-radius:12px;background:#fff;color:#55454f;cursor:pointer}button:disabled{opacity:.45;cursor:default}.primary{background:#f7e8ef}.actions{margin-top:10px}.actions button{flex:1}
      label{display:block;margin:10px 0 4px}input{display:block;width:100%;font:16px/1.4 system-ui;padding:11px;border:1px solid #decfd7;border-radius:10px;color:#473f45;background:#fff}input:focus-visible,button:focus-visible{outline:2px solid #c18cac;outline-offset:2px}
      .status{padding:12px;border-radius:12px;background:#f2edf2;overflow-wrap:anywhere}.status strong{font-size:16px}.muted{color:#776a73;font-size:12px}.error{color:#a23d57}details{margin:12px 0}summary{cursor:pointer;min-height:32px}hr{border:0;border-top:1px solid #eadde5;margin:16px 0}[hidden]{display:none!important}
    </style>
    <dialog aria-labelledby="connection-title">
      <div class="heading"><h2 id="connection-title">기기 연결</h2><button id="close" type="button">닫기</button></div>
      <div class="status" aria-live="polite"><strong id="workspace">확인 중입니다.</strong><p id="status"></p><p class="muted" id="mode"></p></div>
      <p class="muted">PC와 모바일의 연결 번호가 같아야 같은 기록을 볼 수 있습니다.</p>
      <div class="actions"><button id="recheck" type="button">다시 확인</button><button id="reload" type="button">위젯 새로고침</button></div>
      <details id="saved-details"><summary>현재 패스코드를 확인합니다.</summary><input id="saved" type="password" readonly aria-label="현재 저장된 패스코드" autocomplete="off"><button id="reveal" type="button" aria-pressed="false">표시</button></details>
      <hr>
      <form id="form">
        <label for="pass">PC에서 사용하는 패스코드를 입력해 주세요.</label>
        <input id="pass" type="password" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" required>
        <button id="show-input" type="button" aria-pressed="false">입력값 표시</button>
        <div class="actions"><button id="check" type="submit">연결 번호 확인</button></div>
        <p id="candidate" role="status"></p>
        <button id="connect" class="primary" type="button" hidden>이 저장 공간으로 연결</button>
      </form>
    </dialog>`;
  const $ = id => root.getElementById(id);
  const dialog = root.querySelector("dialog");
  let generation = 0;
  let candidate = null;
  let checking = false;
  const mode = () => getServerMode() ? "현재 위젯은 서버 모드입니다." : "현재 위젯은 로컬 모드입니다. 서버 확인이 정상이라면 위젯을 새로고침해 주세요.";
  async function refresh() {
    if (checking) return;
    checking = true;
    $("recheck").disabled = true;
    $("status").className = "";
    $("status").textContent = "서버 연결을 확인하고 있습니다.";
    const ws = getWorkspaceId();
    $("workspace").textContent = ws && ws !== "local" ? `연결 번호 · ${ws.slice(0, 8)}` : "연결 번호를 확인할 수 없습니다.";
    $("mode").textContent = mode();
    try {
      const saved = getSavedPasscode().trim();
      const savedWs = saved ? await workspaceIdFromPasscode(saved) : null;
      if (savedWs !== ws) {
        $("status").textContent = "저장된 패스코드와 현재 열린 위젯의 연결이 다릅니다. 위젯을 새로고침해 주세요.";
        return;
      }
      if (!savedWs) throw new Error("패스코드를 입력해 연결해 주세요.");
      const hasRecords = await checkServer(ws, sources);
      $("status").textContent = hasRecords ? "서버 연결이 정상이며, 이 위젯의 저장된 기록이 있습니다." : "서버 연결은 정상입니다. 이 위젯의 저장된 기록은 없습니다. PC의 연결 번호와 비교해 주세요.";
    } catch (error) {
      $("status").className = "error";
      $("status").textContent = error.message || "연결을 확인하지 못했습니다.";
    } finally { checking = false; $("recheck").disabled = false; }
  }
  function clearCandidate() {
    generation++;
    candidate = null;
    $("connect").hidden = true;
    $("candidate").textContent = "";
  }
  opener.addEventListener("click", () => { dialog.showModal(); refresh(); });
  $("close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    clearCandidate(); $("pass").value = ""; $("saved").value = "";
    $("saved-details").open = false;
    for (const [input, toggle, label] of [["saved", "reveal", "표시"], ["pass", "show-input", "입력값 표시"]]) {
      $(input).type = "password"; $(toggle).textContent = label; $(toggle).setAttribute("aria-pressed", "false");
    }
    opener.focus();
  });
  $("recheck").addEventListener("click", refresh);
  $("reload").addEventListener("click", () => location.reload());
  $("saved-details").addEventListener("toggle", () => {
    $("saved").value = $("saved-details").open ? getSavedPasscode().trim() : "";
  });
  for (const [input, toggle, label] of [["saved", "reveal", "표시"], ["pass", "show-input", "입력값 표시"]]) {
    $(toggle).addEventListener("click", () => {
      const show = $(input).type === "password";
      $(input).type = show ? "text" : "password";
      $(toggle).textContent = show ? "숨기기" : label;
      $(toggle).setAttribute("aria-pressed", String(show));
    });
  }
  $("pass").addEventListener("input", clearCandidate);
  $("form").addEventListener("submit", async event => {
    event.preventDefault(); clearCandidate();
    const pass = $("pass").value.trim();
    if (!pass) return;
    const currentGeneration = generation;
    $("candidate").textContent = "입력한 패스코드의 연결을 확인하고 있습니다.";
    $("check").disabled = true;
    try {
      const ws = await workspaceIdFromPasscode(pass);
      const hasRecords = await checkServer(ws, sources);
      if (generation !== currentGeneration) return;
      candidate = { pass, ws };
      $("candidate").textContent = `연결 번호 · ${ws.slice(0, 8)} · ${hasRecords ? "저장된 기록이 있습니다." : "이 위젯의 저장된 기록이 없습니다."} PC의 연결 번호와 같으면 아래 버튼을 눌러 주세요.`;
      $("connect").hidden = false;
    } catch (error) {
      if (generation === currentGeneration) $("candidate").textContent = error.message || "연결을 확인하지 못했습니다.";
    } finally { $("check").disabled = false; }
  });
  $("connect").addEventListener("click", () => {
    if (!candidate || candidate.pass !== $("pass").value.trim()) return;
    try {
      savePasscode(candidate.pass);
      if (getSavedPasscode().trim() !== candidate.pass) throw new Error("이 환경에서 패스코드를 저장할 수 없습니다.");
      location.reload();
    } catch (error) { $("candidate").textContent = error.message || "패스코드를 저장하지 못했습니다."; }
  });
}
