export function initTables() {

const tableCards = document.querySelectorAll(".table-card");
const liveLog = document.querySelector("#live-log");

function addLive(text) {

if (!liveLog) return;

const item = document.createElement("div");

item.className = "live-item";

item.innerHTML = `
<div class="live-time">
${new Date().toLocaleTimeString()}
</div>

<div class="live-text">
${text}
</div>
`;

liveLog.prepend(item);

}

function toast(text, type = "success") {

const toast = document.createElement("div");

toast.className = `sensei-toast ${type}`;

toast.innerText = text;

document.body.appendChild(toast);

setTimeout(() => {
toast.classList.add("show");
}, 50);

setTimeout(() => {

toast.classList.remove("show");

setTimeout(() => {
toast.remove();
}, 300);

}, 2500);

}

tableCards.forEach(card => {

const startBtn = card.querySelector(".btn-start");
const pauseBtn = card.querySelector(".btn-pause");
const stopBtn = card.querySelector(".btn-stop");

const statusEl = card.querySelector(".table-status");
const timerEl = card.querySelector(".table-timer");

let seconds = 0;
let interval = null;
let paused = false;

function updateTimer() {

seconds++;

const h = String(Math.floor(seconds / 3600)).padStart(2, "0");
const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
const s = String(seconds % 60).padStart(2, "0");

if (timerEl) {
timerEl.innerText = `${h}:${m}:${s}`;
}

}

if (startBtn) {

startBtn.addEventListener("click", () => {

if (interval) return;

card.classList.remove("table-free");
card.classList.add("table-active");

if (statusEl) {
statusEl.innerText = "ИГРАЕТ";
}

interval = setInterval(updateTimer, 1000);

toast("Стол запущен");

addLive("🎱 Стол запущен");

});

}

if (pauseBtn) {

pauseBtn.addEventListener("click", () => {

if (!interval) return;

if (!paused) {

clearInterval(interval);

paused = true;

card.classList.remove("table-active");
card.classList.add("table-paused");

if (statusEl) {
statusEl.innerText = "ПАУЗА";
}

toast("Стол поставлен на паузу", "warning");

addLive("⏸ Стол на паузе");

} else {

interval = setInterval(updateTimer, 1000);

paused = false;

card.classList.remove("table-paused");
card.classList.add("table-active");

if (statusEl) {
statusEl.innerText = "ИГРАЕТ";
}

toast("Стол продолжен");

addLive("▶ Игра продолжена");

}

});

}

if (stopBtn) {

stopBtn.addEventListener("click", () => {

clearInterval(interval);

interval = null;

seconds = 0;

paused = false;

card.classList.remove("table-active");
card.classList.remove("table-paused");

card.classList.add("table-free");

if (statusEl) {
statusEl.innerText = "СВОБОДЕН";
}

if (timerEl) {
timerEl.innerText = "--:--:--";
}

toast("Стол завершен", "danger");

addLive("⏹ Стол завершен");

});

}

});

}
