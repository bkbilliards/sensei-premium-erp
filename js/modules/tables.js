import { supabase } from "../supabase.js";

let realtimeChannel = null;
let tablesData = [];
let timers = {};

const HOUR_RATE_DAY = 2500;
const HOUR_RATE_NIGHT = 3000;

const container = document.getElementById("tables-container");
const liveCenter = document.getElementById("live-center");

function toast(message, type = "success") {
    const toast = document.createElement("div");

    toast.className = `toast toast-${type}`;
    toast.innerText = message;

    document.body.appendChild(toast);

    setTimeout(() => {
        toast.classList.add("show");
    }, 50);

    setTimeout(() => {
        toast.classList.remove("show");

        setTimeout(() => {
            toast.remove();
        }, 300);

    }, 3000);
}

function logLiveEvent(text) {

    if (!liveCenter) return;

    const item = document.createElement("div");

    item.className = "live-event";

    const now = new Date();

    item.innerHTML = `
        <span>${now.toLocaleTimeString()}</span>
        <strong>${text}</strong>
    `;

    liveCenter.prepend(item);
}

function getRate() {

    const hour = new Date().getHours();

    if (hour >= 14 && hour < 18) {
        return HOUR_RATE_DAY;
    }

    return HOUR_RATE_NIGHT;
}

function formatTime(seconds) {

    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;

    return `
        ${String(h).padStart(2, "0")}:
        ${String(m).padStart(2, "0")}:
        ${String(s).padStart(2, "0")}
    `;
}

async function loadTables() {

    const { data, error } = await supabase
        .from("tables")
        .select("*")
        .order("id");

    if (error) {

        toast("Ошибка загрузки столов", "error");
        console.error(error);

        return;
    }

    tablesData = data;

    renderTables();
}

function getStatusClass(status) {

    switch (status) {

        case "PLAYING":
            return "table-playing";

        case "PAUSED":
            return "table-paused";

        case "BOOKED":
            return "table-booked";

        case "PROBLEM":
            return "table-problem";

        default:
            return "table-free";
    }
}

function renderTables() {

    if (!container) return;

    container.innerHTML = "";

    tablesData.forEach(table => {

        const card = document.createElement("div");

        card.className = `
            premium-table
            ${getStatusClass(table.status)}
        `;

        const seconds = table.accumulated_time || 0;

        const total = table.accumulated_cost || 0;

        card.innerHTML = `

            <div class="table-top">

                <div class="table-name">
                    🎱 СТОЛ ${table.id}
                </div>

                <div class="table-status">
                    ${table.status}
                </div>

            </div>

            <div class="table-center">

                <div class="table-timer">
                    ${formatTime(seconds)}
                </div>

                <div class="table-price">
                    ${total} ₸
                </div>

            </div>

            <div class="table-actions">

                ${
                    table.status === "FREE"
                    ?
                    `
                    <button
                        class="btn btn-start"
                        onclick="window.startTable(${table.id})"
                    >
                        ▶ ПУСК
                    </button>
                    `
                    :
                    `
                    <button
                        class="btn btn-stop"
                        onclick="window.stopTable(${table.id})"
                    >
                        ⏹ ЗАВЕРШИТЬ
                    </button>

                    <button
                        class="btn btn-pause"
                        onclick="window.pauseTable(${table.id})"
                    >
                        ⏸ ПАУЗА
                    </button>
                    `
                }

            </div>

        `;

        container.appendChild(card);

        if (table.status === "PLAYING") {
            startLocalTimer(table.id);
        }
    });
}

function startLocalTimer(tableId) {

    if (timers[tableId]) return;

    timers[tableId] = setInterval(async () => {

        const table = tablesData.find(t => t.id === tableId);

        if (!table) return;

        if (table.status !== "PLAYING") {

            clearInterval(timers[tableId]);

            delete timers[tableId];

            return;
        }

        table.accumulated_time += 1;

        const pricePerSecond = getRate() / 3600;

        table.accumulated_cost += pricePerSecond;

        renderTables();

    }, 1000);
}

window.startTable = async function(tableId) {

    toast("Запуск стола...", "loading");

    const { error } = await supabase
        .from("tables")
        .update({
            status: "PLAYING",
            started_at: Date.now()
        })
        .eq("id", tableId);

    if (error) {

        toast("Ошибка запуска", "error");

        return;
    }

    toast("Стол запущен");

    logLiveEvent(`Стол ${tableId} стартовал`);
}

window.pauseTable = async function(tableId) {

    const table = tablesData.find(t => t.id === tableId);

    if (!table) return;

    const newStatus =
        table.status === "PAUSED"
        ? "PLAYING"
        : "PAUSED";

    const { error } = await supabase
        .from("tables")
        .update({
            status: newStatus
        })
        .eq("id", tableId);

    if (error) {

        toast("Ошибка паузы", "error");

        return;
    }

    toast("Статус обновлен");

    logLiveEvent(`Стол ${tableId}: ${newStatus}`);
}

window.stopTable = async function(tableId) {

    const table = tablesData.find(t => t.id === tableId);

    if (!table) return;

    const confirmClose = confirm(`
        Завершить стол ${tableId}?
        Сумма: ${Math.floor(table.accumulated_cost)} ₸
    `);

    if (!confirmClose) return;

    const { error } = await supabase
        .from("tables")
        .update({
            status: "FREE",
            accumulated_time: 0,
            accumulated_cost: 0,
            started_at: null
        })
        .eq("id", tableId);

    if (error) {

        toast("Ошибка завершения", "error");

        return;
    }

    toast("Стол завершен");

    logLiveEvent(`Стол ${tableId} завершен`);
}

function subscribeRealtime() {

    realtimeChannel = supabase
        .channel("tables-live")

        .on(
            "postgres_changes",
            {
                event: "*",
                schema: "public",
                table: "tables"
            },
            payload => {

                const updated = payload.new;

                const index = tablesData.findIndex(
                    t => t.id === updated.id
                );

                if (index !== -1) {
                    tablesData[index] = updated;
                }

                renderTables();
            }
        )

        .subscribe(status => {

            console.log("Realtime:", status);

            if (status === "SUBSCRIBED") {

                toast("Realtime подключен");

                logLiveEvent("Realtime активирован");
            }
        });
}

loadTables();
subscribeRealtime();
