const input = document.getElementById("todo-input");
const list = document.getElementById("todo-list");
const btn = document.getElementById("add-btn");

btn.addEventListener("click", addTodo);
input.addEventListener("keydown", e => {
  if (e.key === "Enter") addTodo();
});

function addTodo() {
  const text = input.value.trim();
  if (!text) return;

  const li = document.createElement("li");

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.addEventListener("change", () => {
    li.classList.toggle("done", checkbox.checked);
  });

  const span = document.createElement("span");
  span.textContent = text;

  li.appendChild(checkbox);
  li.appendChild(span);
  list.appendChild(li);

  input.value = "";
}
