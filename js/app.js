// 1. ПОДКЛЮЧЕНИЕ SUPABASE
const SUPABASE_URL = 'https://huryvmmweiyfgmumzxzh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1cnl2bW13ZWl5ZmdtdW16eHpoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4MDc3MzAsImV4cCI6MjA5NDM4MzczMH0._kHBRzXqiQ16Lo1vz8xUeZnJBIv1bTpG5iX-3FZKhAg';

// Безопасная инициализация
let supabaseClient = null;

const $ = id => document.getElementById(id);
const $$ = s => document.querySelectorAll(s);

// 2. ЖЕСТКО ВШИТЫЙ ПЕРСОНАЛ (ГАРАНТИЯ ДОСТУПА 100%)
const STAFF_DB = [
    { id: 1, name: 'Хозяин', role: 'owner', pin: '0000' },
    { id: 2, name: 'Админ Султан', role: 'admin', pin: '1111' },
    { id: 3, name: 'Админ Дидар', role: 'admin', pin: '2222' }
];

const app = {
    session: { isAuth: false, user: null },
    state: { tables: [], activeChecks: [], inventory: [], cart: [], shiftStart: Date.now() },

    init: () => {
        try {
            // Пытаемся подключиться к базе. Если нет интернета - просто пропустит.
            supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
        } catch(e) { console.error("Supabase SDK Fail:", e); }

        app.loadSession();
        app.checkSession();
        app.bindGlobalEvents();
        app.setupHotkeys();

        // Часы и Таймеры (работают всегда)
        setInterval(() => {
            let clock = $('live-clock'); if (clock) clock.innerText = new Date().toLocaleTimeString('ru-RU').slice(0,5);
            const h = new Date().getHours();
            if (h >= 22 || h < 6) document.body.classList.add('night-mode'); else document.body.classList.remove('night-mode');
            app.tables.tick();
        }, 1000);
    },

    saveSession: () => localStorage.setItem('sensei_session', JSON.stringify(app.session)),
    loadSession: () => {
        const s = localStorage.getItem('sensei_session');
        if (s) app.session = JSON.parse(s);
    },

    checkSession: () => {
        if (!app.session.isAuth) {
            $('authScreen').classList.add('active'); $('appScreen').classList.add('hidden');
            
            // Вставляем логины из ЖЕЛЕЗНОЙ БАЗЫ мгновенно
            const sel = $('staffSelect');
            sel.innerHTML = STAFF_DB.map(u => `<option value="${u.pin}" data-user='${JSON.stringify(u)}'>${u.name}</option>`).join('');
            
            $('btn-login-submit').onclick = () => {
                const pinInput = $('pinInput').value;
                const opt = sel.options[sel.selectedIndex];
                const correctPin = opt.value;
                const userObj = JSON.parse(opt.dataset.user);

                if (pinInput === correctPin) {
                    app.session.isAuth = true; app.session.user = userObj; app.saveSession();
                    app.ui.toast('Авторизация успешна', 'success');
                    app.checkSession();
                } else { app.ui.toast('Неверный PIN-код', 'danger'); }
            };
        } else {
            $('authScreen').classList.remove('active'); $('appScreen').classList.remove('hidden');
            if($('userName')) $('userName').innerText = app.session.user.name;
            
            if (app.session.user.role !== 'owner') $$('.owner-only').forEach(el => el.style.display = 'none');
            else $$('.owner-only').forEach(el => el.style.display = 'flex');
            
            app.loadData();
        }
    },

    loadData: async () => {
        // Оптимистичная предзагрузка (Даже если интернета нет - столы появятся!)
        if (app.state.tables.length === 0) {
            app.state.tables = [1,2,3,4,5,6].map(id => ({ id: id, status: 'СВОБОДЕН', accumulated_cost: 0 }));
        }
        app.tables.render();

        if (!supabaseClient) return;

        try {
            const { data: tData } = await supabaseClient.from('tables').select('*').order('id');
            if (tData && tData.length > 0) { app.state.tables = tData; app.tables.render(); }

            const { data: cData } = await supabaseClient.from('active_checks').select('*');
            if (cData) { app.state.activeChecks = cData; app.renderChecks(); }

            const { data: iData } = await supabaseClient.from('inventory').select('*').eq('is_active', true);
            if (iData && iData.length > 0) { app.state.inventory = iData; } 
            else {
                // Фейковые товары, если склад пуст
                app.state.inventory = [
                    { id: 1, name: 'RedBull', category: 'Напитки', price: 1500, stock: 50 },
                    { id: 2, name: 'Coca-Cola', category: 'Напитки', price: 700, stock: 50 },
                    { id: 3, name: 'Чайник Ассам', category: 'Чай', price: 1500, stock: 50 }
                ];
            }
            app.pos.renderItems();

            // Подписка Realtime
            supabaseClient.channel('public:tables').on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tables' }, payload => {
                const index = app.state.tables.findIndex(t => t.id === payload.new.id);
                if(index !== -1) app.state.tables[index] = payload.new;
                app.tables.render();
            }).subscribe();

        } catch(e) { console.log("Работаем в Offline-режиме"); app.pos.renderItems(); }
    },

    ui: {
        toast: (msg, type='success') => {
            const c = $('toast-container'); if(!c) return;
            const t = document.createElement('div');
            t.className = type === 'danger' ? `toast toast-danger` : `toast`; t.innerText = msg;
            c.appendChild(t); setTimeout(() => t.remove(), 2500);
        },
        openModal: (id) => { const el = $(id); if(el) el.classList.remove('hidden'); },
        closeModals: () => { $$('.overlay').forEach(p => p.classList.add('hidden')); },
        playSound: (type) => {
            try {
                const ctx = new (window.AudioContext || window.webkitAudioContext)();
                const osc = ctx.createOscillator(); const gain = ctx.createGain();
                osc.connect(gain); gain.connect(ctx.destination);
                if(type === 'start') { osc.frequency.setValueAtTime(420, ctx.currentTime); osc.type = 'sine'; gain.gain.setValueAtTime(0.01, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25); osc.start(); osc.stop(ctx.currentTime + 0.25); }
                if(type === 'pay') { osc.frequency.setValueAtTime(580, ctx.currentTime); osc.frequency.setValueAtTime(880, ctx.currentTime + 0.08); osc.type = 'triangle'; gain.gain.setValueAtTime(0.01, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.2); osc.start(); osc.stop(ctx.currentTime + 0.2); }
            } catch(e){}
        }
    },

    logActivity: (text, icon = '⚪') => {
        const feed = $('activity-feed'); if(!feed) return;
        const time = new Date().toLocaleTimeString('ru-RU').slice(0,5);
        const item = document.createElement('div'); item.className = `feed-item`;
        item.innerHTML = `<span class="feed-time font-mono muted-text">${time}</span> <span class="feed-icon">${icon}</span> <span class="text-white">${text}</span>`;
        feed.prepend(item); if(feed.children.length > 20) feed.lastChild.remove();
    },

    // ЛОГИКА СТОЛОВ (ОПТИМИСТИЧНАЯ)
    tables: {
        render: () => {
            const grid = $('tablesGrid'); if (!grid || app.state.tables.length === 0) return;
            grid.innerHTML = app.state.tables.map(t => {
                let isPlaying = t.status === 'В ИГРЕ'; let isPaused = t.paused;
                let cls = isPlaying ? (isPaused ? 'paused' : 'playing') : 'free';
                let totalCost = (isPlaying ? app.tables.getCost(t) : 0) + (t.bar_amount || 0);
                
                let btnsFree = `<button class="btn-gold flex-1" onclick="app.tables.start(${t.id})">▶ ПУСК</button><button class="btn-dark" style="width: 50px;" onclick="app.tables.manage(${t.id})">⚙</button>`;
                let btnsActive = `<button class="btn-dark" style="width: 50px;" onclick="app.tables.pause(${t.id})">${isPaused ? '▶' : '⏸'}</button><button class="btn-dark" style="flex: 1;" onclick="app.tables.bar(${t.id})">🍹 БАР</button><button class="btn-danger" style="flex: 1;" onclick="app.tables.stop(${t.id})">💳 СЧЕТ</button>`;

                return `<div class="table-card ${cls}"><div class="table-cloth"></div><div class="table-content flex-column h-100">
                    <div class="flex-between align-center mb-10"><span class="t-num"><span class="t-status-dot"></span>СТОЛ ${t.id}</span></div>
                    <div class="t-center-info my-auto">${isPlaying ? `<div class="t-timer font-mono" id="timer-${t.id}">00:00:00</div>
                    <div class="t-cost gold-text font-mono mt-5" id="sum-${t.id}">${totalCost.toLocaleString()} ₸</div>` : `<div class="t-idle-text muted-text">СВОБОДЕН</div>`}</div>
                    <div class="flex-row mt-auto pt-15" style="border-top: 1px solid rgba(255,255,255,0.05); z-index:10;">${isPlaying ? btnsActive : btnsFree}</div></div></div>`;
            }).join('');
        },
        start: async (id) => {
            app.ui.playSound('start');
            let t = app.state.tables.find(x => x.id === id);
            if (t) { t.status = 'В ИГРЕ'; t.started_at = Date.now(); t.accumulated_cost = 0; t.accumulated_time = 0; t.bar_amount = 0; t.paused = false; }
            app.tables.render(); app.ui.toast(`Стол ${id} запущен`, 'success'); app.logActivity(`Запущен Стол ${id}`, '🟢');
            if(supabaseClient) { try { await supabaseClient.from('tables').update({ status: 'В ИГРЕ', started_at: t.started_at, accumulated_cost: 0, accumulated_time: 0, bar_amount: 0, paused: false }).eq('id', id); } catch(e){} }
        },
        pause: async (id) => {
            let t = app.state.tables.find(x => x.id === id); if(!t) return;
            if (t.paused) {
                t.paused = false; t.started_at = Date.now();
                app.logActivity(`Продолжение: Стол ${id}`, '▶');
            } else {
                let ms = (t.accumulated_time || 0) + (Date.now() - t.started_at); let cost = app.tables.getCost(t);
                t.paused = true; t.accumulated_time = ms; t.accumulated_cost = cost; t.started_at = null;
                app.logActivity(`Пауза: Стол ${id}`, '⏸');
            }
            app.tables.render();
            if(supabaseClient) { try { await supabaseClient.from('tables').update({ paused: t.paused, started_at: t.started_at, accumulated_time: t.accumulated_time, accumulated_cost: t.accumulated_cost }).eq('id', id); } catch(e){} }
        },
        manage: (id) => {
            let t = app.state.tables.find(x => x.id === id); $('m-table-id').innerText = id;
            if (t.status === 'В ИГРЕ') {
                $('m-actions-active').classList.remove('hidden'); $('m-actions-free').classList.add('hidden');
                let ms = (t.accumulated_time || 0) + (Date.now() - t.started_at);
                $('m-table-timer').innerText = app.tables.formatTime(ms); $('m-table-cost').innerText = (app.tables.getCost(t) + (t.bar_amount || 0)).toLocaleString() + ' ₸';
            } else {
                $('m-actions-active').classList.add('hidden'); $('m-actions-free').classList.remove('hidden');
                $('m-table-timer').innerText = '--:--:--'; $('m-table-cost').innerText = '0 ₸';
            }
            app.ui.openModal('modal-manage-table');
        },
        bar: (id) => { app.ui.closeModals(); app.switchTab('stock'); let s = $('pos-target'); if(s) { s.value = id; app.pos.updateTargetUI(); } },
        stop: (id) => {
            let t = app.state.tables.find(x => x.id === id); if(!t) return; app.ui.closeModals();
            let rent = app.tables.getCost(t); let bar = t.bar_amount || 0;
            $('stop-table-id').innerText = t.id; $('stop-rent-sum').innerText = rent.toLocaleString() + ' ₸';
            $('stop-bar-sum').innerText = bar.toLocaleString() + ' ₸'; $('stop-total-sum').innerText = (rent + bar).toLocaleString() + ' ₸';
            app.ui.openModal('modal-stop-table');
        },
        confirmStop: async () => {
            let id = parseInt($('stop-table-id').innerText); let name = $('stop-guest-name').value.trim() || `Гость ${id}`;
            let t = app.state.tables.find(x => x.id === id); let rent = app.tables.getCost(t); let bar = t.bar_amount || 0; let total = rent + bar;
            let playedMs = (t.accumulated_time || 0) + (Date.now() - t.started_at);
            
            // Оптимистичный UI
            t.status = 'СВОБОДЕН'; t.started_at = null; t.accumulated_cost = total; t.accumulated_time = 0; t.bar_amount = 0; t.paused = false;
            app.state.activeChecks.push({ id: Date.now(), table_id: id, guest_name: name, total: total });
            app.tables.render(); app.renderChecks(); app.ui.closeModals(); app.ui.playSound('pay'); app.logActivity(`Расчет: Стол ${id}`, '⏹');

            if(supabaseClient) {
                try {
                    await supabaseClient.from('active_checks').insert([{ id: Date.now(), table_id: id.toString(), guest_name: name, time_amount: rent, bar_amount: bar, total: total, created_by: app.session.user.name }]);
                    await supabaseClient.from('tables').update({ status: 'СВОБОДЕН', started_at: null, accumulated_cost: total, accumulated_time: 0, bar_amount: 0, paused: false, active_check_id: null }).eq('id', id);
                } catch(e) {}
            }
        },
        getCost: (t) => {
            if (!t.started_at) return t.accumulated_cost || 0;
            let cost = t.accumulated_cost || 0;
            if (!t.paused) {
                let ms = t.started_at; let end = Date.now(); let cMs = ms; 
                while(cMs < end) { let h = new Date(cMs).getHours(); let rate = (h >= 14 && h < 18) ? 2500 : 3000; cost += rate / 60; cMs += 60000; }
            }
            return Math.ceil(cost / 50) * 50; 
        },
        formatTime: (ms) => { 
            let s = Math.floor(ms / 1000); let h = Math.floor(s / 3600); let m = Math.floor((s % 3600) / 60); let sec = s % 60;
            return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`; 
        },
        tick: () => {
            if (!app.session.isAuth || app.state.tables.length === 0) return;
            let liveRev = 0; let liveBar = 0;
            app.state.tables.forEach(t => {
                if (t.status === 'В ИГРЕ') {
                    let ms = (t.accumulated_time || 0); if (!t.paused) ms += (Date.now() - t.started_at);
                    let rent = app.tables.getCost(t); let barAmount = t.bar_amount || 0; let total = rent + barAmount;
                    liveRev += rent; liveBar += barAmount;
                    let timerEl = $(`timer-${t.id}`); let sumEl = $(`sum-${t.id}`);
                    if (timerEl) timerEl.innerText = app.tables.formatTime(ms);
                    if (sumEl) sumEl.innerText = total.toLocaleString() + " ₸";
                }
            });
            if($('head-tables-rev')) $('head-tables-rev').innerText = liveRev.toLocaleString() + " ₸";
            if($('head-bar')) $('head-bar').innerText = liveBar.toLocaleString() + " ₸";
            if($('head-total')) $('head-total').innerText = (liveRev + liveBar).toLocaleString() + " ₸";
        }
    },

    // POS БАР
    pos: {
        renderItems: (category = 'Все') => {
            const grid = $('pos-items-grid'); if(!grid) return;
            let items = app.state.inventory; if(category !== 'Все') items = items.filter(i => i.category === category);
            if(items.length === 0) { grid.innerHTML = '<div class="muted-text">Пусто</div>'; return; }
            grid.innerHTML = items.map(item => {
                let isOut = item.stock <= 0 ? 'out-of-stock' : '';
                return `<div class="pos-item ${isOut}" onclick="${item.stock > 0 ? `app.pos.addToCart(${item.id})` : ''}">
                    <div class="pos-item-name">${item.name}</div><div class="pos-item-price">${item.price} ₸</div>
                    <div class="pos-add-btn">+ В КОРЗИНУ</div></div>`;
            }).join('');
            if($('pos-filter-buttons')) {
                $$('#pos-filter-buttons button').forEach(b => b.classList.remove('active'));
                let btn = document.querySelector(`button[data-cat="${category}"]`); if(btn) btn.classList.add('active');
            }
        },
        addToCart: (id) => {
            app.ui.playSound('start');
            let item = app.state.inventory.find(i => i.id === id); if(!item || item.stock <= 0) return;
            let existing = app.state.cart.find(c => c.id === id);
            if(existing) { if (existing.qty < item.stock) existing.qty++; else app.ui.toast('Предел склада', 'danger'); } 
            else { app.state.cart.push({ id: item.id, name: item.name, price: item.price, qty: 1 }); }
            app.pos.renderCart();
        },
        changeQty: (id, delta) => {
            let index = app.state.cart.findIndex(c => c.id === id);
            if(index !== -1) {
                let item = app.state.inventory.find(i => i.id === id);
                if (delta > 0 && app.state.cart[index].qty >= item.stock) return app.ui.toast('Склад пуст', 'danger');
                app.state.cart[index].qty += delta;
                if(app.state.cart[index].qty <= 0) app.state.cart.splice(index, 1);
                app.pos.renderCart();
            }
        },
        clearCart: () => { app.state.cart = []; app.pos.renderCart(); },
        renderCart: () => {
            const list = $('pos-cart-list'); const totalEl = $('pos-total'); if(!list || !totalEl) return;
            let total = 0; if(app.state.cart.length === 0) { list.innerHTML = '<div class="muted-text text-center py-20">Корзина пуста</div>'; totalEl.innerText = '0 ₸'; return; }
            list.innerHTML = app.state.cart.map(c => {
                total += (c.price * c.qty);
                return `<div class="cart-item"><div class="cart-item-info"><div class="cart-item-name">${c.name}</div><div class="cart-item-price">${c.price} ₸</div></div>
                <div class="qty-controls"><button class="qty-btn" onclick="app.pos.changeQty(${c.id}, -1)">-</button><div class="qty-val">${c.qty}</div><button class="qty-btn" onclick="app.pos.changeQty(${c.id}, 1)">+</button></div></div>`;
            }).join('');
            totalEl.innerText = total.toLocaleString() + ' ₸';
        },
        updateTargetUI: () => {
            let val = $('pos-target').value;
            if(val === 'none') { $('pos-actions-quick').classList.remove('hidden'); $('pos-actions-table').classList.add('hidden'); } 
            else { $('pos-actions-quick').classList.add('hidden'); $('pos-actions-table').classList.remove('hidden'); }
        },
        checkout: async (method) => {
            if(app.state.cart.length === 0) return app.ui.toast('Корзина пуста', 'danger');
            let total = app.state.cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
            app.ui.playSound('pay');
            app.ui.toast(`Оплата ${method} успешна`, 'success'); app.logActivity(`POS: ${total} ₸ (${method})`, '🍹');
            app.state.cart = []; app.pos.renderCart();
        },
        sendToTable: async () => {
            let tableId = $('pos-target').value; if(tableId === 'none' || app.state.cart.length === 0) return;
            let total = app.state.cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
            let t = app.state.tables.find(x => x.id == tableId); if(!t) return;
            
            t.bar_amount = (t.bar_amount || 0) + total;
            app.ui.playSound('start'); app.ui.toast(`Добавлено на Стол ${tableId}`, 'success');
            app.state.cart = []; app.pos.renderCart(); app.tables.render(); app.switchTab('hall');
            
            if(supabaseClient) { try { await supabaseClient.from('tables').update({ bar_amount: t.bar_amount }).eq('id', tableId); } catch(e){} }
        }
    },

    // КАССА
    renderChecks: () => {
        const list = $('waiting-payments-list'); const count = $('waiting-count'); if (!list || !count) return;
        count.innerText = app.state.activeChecks.length;
        if (app.state.activeChecks.length === 0) { list.innerHTML = '<div class="muted-text text-center py-10 w-100">Все счета закрыты ✅</div>'; return; }
        list.innerHTML = app.state.activeChecks.map(c => `
            <div class="payment-row">
                <div class="payment-info"><span class="badge" style="background: rgba(255,255,255,0.05);">🎱 Стол ${c.table_id}</span><b class="text-white text-12">${c.guest_name}</b></div>
                <div class="payment-sum font-mono">${c.total.toLocaleString()} ₸</div>
                <div class="payment-actions"><button class="btn-gold btn-sm success-text" onclick="app.openPayActiveCheck(${c.id})">💳 ПРОВЕСТИ</button></div>
            </div>`).join('');
    },
    openPayActiveCheck: (id) => {
        let c = app.state.activeChecks.find(x => x.id === id); if(!c) return;
        $('pay-check-id').value = id; $('pay-sum').innerText = c.total.toLocaleString() + ' ₸'; app.ui.openModal('modal-pay');
    },
    confirmPayActiveCheck: async (method) => {
        let id = $('pay-check-id').value; if (!id) return;
        let cIndex = app.state.activeChecks.findIndex(x => x.id == id); if (cIndex === -1) return;
        
        let c = app.state.activeChecks[cIndex];
        app.state.activeChecks.splice(cIndex, 1);
        app.renderChecks(); app.ui.closeModals(); app.ui.playSound('pay'); app.ui.toast(`Оплата ${method}`, 'success');

        if(supabaseClient) {
            try {
                if (method === 'ДОЛГ') await supabaseClient.from('debts').insert([{ guest_name: c.guest_name, amount: c.total, created_by: app.session.user.name }]);
                await supabaseClient.from('archived_checks').insert([{ id: c.id, table_id: c.table_id, guest_name: c.guest_name, total: c.total, pay_method: method, created_by: app.session.user.name }]);
                await supabaseClient.from('active_checks').delete().eq('id', id);
            } catch(e) {}
        }
    },

    // НАВИГАЦИЯ И СОБЫТИЯ
    switchTab: (tabId) => {
        $$('.nav-btn, .m-nav-item').forEach(b => b.classList.remove('active'));
        $$(`[data-tab="${tabId}"]`).forEach(b => b.classList.add('active'));
        $$('.tab-pane').forEach(p => p.classList.add('hidden'));
        let tab = $(`tab-${tabId}`); if (tab) tab.classList.remove('hidden');
        if(tabId === 'stock') {
            let html = '<option value="none">📍 БЫСТРЫЙ ЧЕК (БАР)</option>';
            app.state.tables.forEach(t => { if(t.status === 'В ИГРЕ') html += `<option value="${t.id}">🎱 СТОЛ ${t.id}</option>`; });
            if($('pos-target')) { $('pos-target').innerHTML = html; app.pos.updateTargetUI(); }
        }
    },

    setupNavigation: () => {
        $$('.nav-btn, .m-nav-item, .action-btn[data-trigger]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                let tabId = e.currentTarget.dataset.tab || e.currentTarget.dataset.trigger;
                if(tabId) app.switchTab(tabId);
            });
        });
    },

    setupHotkeys: () => {
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') app.ui.closeModals();
            if (e.key === 'F1') { e.preventDefault(); app.confirmPayActiveCheck('НАЛ'); }
            if (e.key === 'F2') { e.preventDefault(); app.confirmPayActiveCheck('QR'); }
            if (e.key === 'F3') { e.preventDefault(); app.confirmPayActiveCheck('ДОЛГ'); }
            if (e.key === ' ') { 
                const m = $('modal-manage-table');
                if (m && !m.classList.contains('hidden') && !$('m-actions-free').classList.contains('hidden')) {
                    e.preventDefault(); app.tables.start(parseInt($('m-table-id').innerText)); app.ui.closeModals();
                }
            }
        });
    },

    bindGlobalEvents: () => {
        $('btn-login-submit')?.addEventListener('click', app.login);
        $('btn-logout')?.addEventListener('click', app.logout);
        
        $$('.modal-close').forEach(btn => btn.addEventListener('click', app.ui.closeModals));
        
        $('btn-m-start')?.addEventListener('click', () => { app.tables.start(parseInt($('m-table-id').innerText)); app.ui.closeModals(); });
        $('btn-m-pause')?.addEventListener('click', () => { app.tables.pause(parseInt($('m-table-id').innerText)); app.ui.closeModals(); });
        $('btn-m-stop')?.addEventListener('click', () => { app.tables.stop(parseInt($('m-table-id').innerText)); });
        $('btn-m-bar')?.addEventListener('click', () => { app.tables.bar(parseInt($('m-table-id').innerText)); });
        
        $('btn-confirm-stop')?.addEventListener('click', app.tables.confirmStop);
        $('btn-incident')?.addEventListener('click', () => app.ui.openModal('modal-incident'));
    }
};

window.app = app;
window.onload = app.init;
