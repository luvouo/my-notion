// ---------- TODO ----------
const input = document.getElementById("todo-input");
const list = document.getElementById("todo-list");
const btn = document.getElementById("add-btn");

btn?.addEventListener("click", addTodo);
input?.addEventListener("keydown", e => { if (e.key === "Enter") addTodo(); });

function addTodo(){
  const text = input.value.trim();
  if(!text) return;

  const li = document.createElement("li");

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.addEventListener("change", () => li.classList.toggle("done", checkbox.checked));

  const span = document.createElement("span");
  span.textContent = text;

  li.appendChild(checkbox);
  li.appendChild(span);
  list.appendChild(li);

  input.value = "";
}

// ---------- TIMER (10:00 기본) ----------
let total = 10 * 60; // seconds
let interval = null;

const display = document.getElementById("timer-display");
const startBtn = document.getElementById("timer-start");
const resetBtn = document.getElementById("timer-reset");

function renderTimer(){
  const m = String(Math.floor(total / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  display.textContent = `${m}:${s}`;
}
renderTimer();

startBtn?.addEventListener("click", () => {
  if(interval) return;
  interval = setInterval(() => {
    if(total <= 0){
      clearInterval(interval);
      interval = null;
      return;
    }
    total -= 1;
    renderTimer();
  }, 1000);
});

resetBtn?.addEventListener("click", () => {
  clearInterval(interval);
  interval = null;
  total = 10 * 60;
  renderTimer();
});

// ---------- CALENDAR ----------
const calGrid = document.getElementById("cal-grid");
const calMonth = document.getElementById("cal-month");
const prev = document.getElementById("cal-prev");
const next = document.getElementById("cal-next");

let view = new Date();
view.setDate(1);

const dows = ["Mo","Tu","We","Th","Fr","Sa","Su"];

function drawCalendar(){
  calGrid.innerHTML = "";
  dows.forEach(d => {
    const el = document.createElement("div");
    el.className = "dow";
    el.textContent = d;
    calGrid.appendChild(el);
  });

  const year = view.getFullYear();
  const month = view.getMonth();

  const monthLabel = view.toLocaleString("en-US", { month: "short" }).toUpperCase();
  calMonth.textContent = `${monthLabel} ${year}`;

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  // Monday-start offset
  let start = firstDay.getDay(); // 0 Sun ... 6 Sat
  start = (start + 6) % 7; // convert to Mon=0 ... Sun=6

  // prev month filler
  const prevLast = new Date(year, month, 0).getDate();
  for(let i = 0; i < start; i++){
    const el = document.createElement("div");
    el.className = "day muted";
    el.textContent = String(prevLast - (start - 1 - i));
    calGrid.appendChild(el);
  }

  const today = new Date();
  for(let d = 1; d <= lastDay.getDate(); d++){
    const el = document.createElement("div");
    el.className = "day";
    el.textContent = String(d);

    if(today.getFullYear() === year && today.getMonth() === month && today.getDate() === d){
      el.classList.add("today");
    }
    calGrid.appendChild(el);
  }

  // next month filler to complete grid (optional)
  const cells = calGrid.querySelectorAll(".day, .dow").length;
  const remainder = (7 - (cells % 7)) % 7;
  for(let i = 1; i <= remainder; i++){
    const el = document.createElement("div");
    el.className = "day muted";
    el.textContent = String(i);
    calGrid.appendChild(el);
  }
}
drawCalendar();

prev?.addEventListener("click", () => { view.setMonth(view.getMonth() - 1); drawCalendar(); });
next?.addEventListener("click", () => { view.setMonth(view.getMonth() + 1); drawCalendar(); });

// ---------- SEARCH (예시: 구글 검색으로 연결) ----------
const sInput = document.getElementById("search-input");
const sBtn = document.getElementById("search-btn");
const chips = document.querySelectorAll(".chip");

function runSearch(q){
  const query = encodeURIComponent(q.trim());
  if(!query) return;
  window.open(`https://www.google.com/search?q=${query}`, "_blank");
}

sBtn?.addEventListener("click", () => runSearch(sInput.value));
sInput?.addEventListener("keydown", e => { if(e.key === "Enter") runSearch(sInput.value); });

chips.forEach(ch => {
  ch.addEventListener("click", () => runSearch(ch.dataset.q || ch.textContent));
});
