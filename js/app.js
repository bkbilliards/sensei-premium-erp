// 1. НАСТРОЙКИ B СВЯЗЬ С БАЗОЙ
const SUPABASE_URL = 'https://huryvmmweiyfgmumzxzh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1cnl2bW13ZWl5ZmdtdW16eHpoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4MDc3MzAsImV4cCI6MjA5NDM4MzczMH0._kHBRzXqiQ16Lo1vz8xUeZnJBIv1bTpG5iX-3FZKhAg';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = id => document.getElementById(id);
const $$ = s => document.querySelectorAll(s);

// ЖЕЛЕЗНЫЙ СПИСОК ПЕРСОНАЛА (Твои логины)
const STAFF_DB = [
    { id: 1, name: 'Хозяин', role: 'owner', pin: '0000' },
    { id: 2, name: 'Админ Султан', role: 'admin', pin: '1111' },
    { id: 3, name: 'Админ Дидар', role: 'admin', pin: '2222' }
];

const app = {
    session: { isAuth: false, user: null },
    state: { tables: [], activeChecks: [], archivedChecks: [], inventory: [], cart: [], guests: [], debts: [], shiftStart: Date.now() },

    init: () => {
        app.loadSession();
        app.setupNavigation();
        app.setupHotkeys();
        app.bindEvents();
        app.checkSession();
        
        // Подписка на Realtime
        try {
            supabaseClient.channel('public:tables').on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tables' }, payload => {
                const index = app.state.tables.findIndex(t => t.id === payload.new.id);
                if(index !== -1) app.state.tables[index] = payload.new;
                app.renderTables();
            }).subscribe();

            supabaseClient.channel('public:active_checks').on('postgres_changes', { event: '*', schema: 'public', table: 'active_checks' }, () => {
                app.loadChecks();
            }).subscribe();
        } catch(e) { console.log("Realtime init failed", e); }

        // Таймеры и Eye Care
        setInterval(() => {
            let clock = $('live-clock'); if (clock) clock.innerText = new Date().toLocaleTimeString('ru-RU').slice(0,5);
            app.tickTables();
            
            const h = new Date().getHours();
            if (h >= 22 || h < 6) document.body.classList.add('night-mode');
            else document.body.classList.remove('night-mode');
        }, 1000);
    },

    saveSession: () => localStorage.setItem('sensei_session', JSON.stringify(app.session)),
    loadSession: () => {
        const s = localStorage.getItem('sensei_session');
        if (s) app.session = JSON.parse(s);
    },

    checkSession: () => {
        if (!app.session.isAuth) {
            $('authScreen').classList.add('active');
            $('appScreen').classList.add('hidden');
            app.renderStaff();
        } else {
            $('authScreen').classList.remove('active');
            $('appScreen').classList.remove('hidden');
            $('userName').innerText = app.session.user.name;
            
            if (app.session.user.role !== 'owner') {
                $$('.owner-only').forEach(el => el.style.display = 'none');
            } else {
                $$('.owner-only').forEach(el => el.style.display = 'flex');
            }
            app.loadData();
        }
    },

    renderStaff: () => {
        const sel = $('staffSelect');
        if(!sel) return;
        
        // МГНОВЕННАЯ ЗАГРУЗКА ИЗ ЖЕЛЕЗНОГО СПИСКА
        sel.innerHTML = STAFF_DB.map(u => `<option value="${u.pin}" data-user='${JSON.stringify(u)}'>${u.name}</option>`).join('');
    },

    login: () => {
        const sel = $('staffSelect');
        const pinInput = $('pinInput').value;
        const selectedOpt = sel.options[sel.selectedIndex];
        
        if(!selectedOpt) return;
        const correctPin = selectedOpt.value;
        const userObj = JSON.parse(selectedOpt.dataset.user);

        if (pinInput === correctPin) {
            app.session.isAuth = true;
            app.session.user = userObj;
            app.saveSession();
            app.toast('Авторизация успешна', 'success');
            app.checkSession();
        } else {
            app.toast('Неверный PIN-код', 'danger');
        }
    },

    logout: () => {
        app.session.isAuth = false;
        app.session.user = null;
        app.saveSession();
        location.reload();
    },

    loadData: async () => {
        try {
            const { data: tables } = await supabaseClient.from('tables').select('*').order('id');
            if(tables) { app.state.tables = tables; app.renderTables(); }
            
            const { data: checks } = await supabaseClient.from('active_checks').select('*');
            if(checks) { app.state.activeChecks = checks; app.renderChecks(); }
            
            const { data: inv } = await supabaseClient.from('inventory').select('*').eq('is_active', true).order('name');
            if(inv) { app.state.inventory = inv; app.renderPosItems(); }
        } catch(e) { console.log("Ошибка загрузки данных из БД", e); }
    },

    // UI и Утилиты
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
    },

    // ЛОГИКА СТОЛОВ
    renderTables: () => {
        const grid = $('tablesGrid');
        if (!grid || app.state.tables.length === 0) return;
        
        grid.innerHTML = app.state.tables.map(t => {
            let isPlaying = t.status === 'В ИГРЕ'; let isPaused = t.paused;
            let cls = isPlaying ? (isPaused ? 'paused' : 'playing') : 'free';
            let totalCost = (isPlaying ? app.getCost(t) : 0) + (t.bar_amount || 0);
            
            let btnsFree = `<button class="btn-gold flex-1" onclick="app.startTable(${t.id})">▶ ПУСК</button><button class="btn-dark" style="width: 50px;" onclick="app.openManageTable(${t.id})">⚙</button>`;
            let btnsActive = `<button class="btn-dark" style="width: 50px;" onclick="app.pauseTable(${t.id})">${isPaused ? '▶' : '⏸'}</button><button class="btn-danger" style="flex: 1;" onclick="app.openStopPanel(${t.id})">💳 СЧЕТ</button><button class="btn-dark" style="width: 50px;" onclick="app.openManageTable(${t.id})">⚙</button>`;

            return `
            <div class="table-card ${cls}">
                <div class="table-cloth"></div>
                <div class="table-content flex-column h-100">
                    <div class="flex-between align-center mb-10">
                        <span class="t-num"><span class="t-status-dot"></span>СТОЛ ${t.id}</span>
                    </div>
                    <div class="t-center-info my-auto">
                        ${isPlaying ? `
                            <div class="t-timer font-mono" id="timer-${t.id}">00:00:00</div>
                            <div class="t-cost gold-text font-mono mt-5" id="sum-${t.id}">${totalCost.toLocaleString()} ₸</div>
                            ${t.bar_amount > 0 ? `<div class="muted-text text-10 mt-5">БАР: ${t.bar_amount.toLocaleString()} ₸</div>` : ''}
                        ` : `<div class="t-idle-text muted-text">СВОБОДЕН</div>`}
                    </div>
                    <div class="flex-row mt-auto pt-15" style="border-top: 1px solid rgba(255,255,255,0.05); z-index:10;">
                        ${isPlaying ? btnsActive : btnsFree}
                    </div>
                </div>
            </div>`;
        }).join('');
    },

    startTable: async (id) => {
        app.playSound('start');
        try {
            await supabaseClient.from('tables').update({ status: 'В ИГРЕ', started_at: Date.now(), accumulated_cost: 0, accumulated_time: 0, bar_amount: 0, paused: false }).eq('id', id);
            app.toast(`Стол ${id} запущен`, 'success');
            app.loadData();
        } catch(e) { app.toast('Ошибка', 'danger'); }
    },

    pauseTable: async (id) => {
        let t = app.state.tables.find(x => x.id === id); if(!t) return;
        try {
            if (t.paused) {
                await supabaseClient.from('tables').update({ paused: false, started_at: Date.now() }).eq('id', id);
            } else {
                let ms = (t.accumulated_time || 0) + (Date.now() - t.started_at); let cost = app.getCost(t);
                await supabaseClient.from('tables').update({ paused: true, accumulated_time: ms, accumulated_cost: cost, started_at: null }).eq('id', id);
            }
            app.loadData();
        } catch(e) {}
    },

    openManageTable: (id) => {
        let t = app.state.tables.find(x => x.id === id);
        $('m-table-id').innerText = id;
        if (t.status === 'В ИГРЕ') {
            $('m-actions-active').classList.remove('hidden'); $('m-actions-free').classList.add('hidden');
            let ms = (t.accumulated_time || 0) + (Date.now() - t.started_at);
            $('m-table-timer').innerText = app.formatTime(ms); 
            $('m-table-cost').innerText = (app.getCost(t) + (t.bar_amount || 0)).toLocaleString() + ' ₸';
        } else {
            $('m-actions-active').classList.add('hidden'); $('m-actions-free').classList.remove('hidden');
            $('m-table-timer').innerText = '--:--:--'; $('m-table-cost').innerText = '0 ₸';
        }
        app.openModal('modal-manage-table');
    },

    openStopPanel: (id) => {
        let t = app.state.tables.find(x => x.id === id); 
        if(!t) t = app.state.tables.find(x => x.id === parseInt($('m-table-id').innerText));
        if(!t) return; 
        app.closeModals();
        let rent = app.getCost(t); let bar = t.bar_amount || 0;
        $('stop-table-id').innerText = t.id; 
        $('stop-rent-sum').innerText = rent.toLocaleString() + ' ₸';
        $('stop-bar-sum').innerText = bar.toLocaleString() + ' ₸'; 
        $('stop-total-sum').innerText = (rent + bar).toLocaleString() + ' ₸';
        app.openModal('modal-stop-table');
    },

    confirmStopTable: async () => {
        let id = parseInt($('stop-table-id').innerText);
        let name = $('stop-guest-name').value.trim() || `Гость ${id}`;
        let t = app.state.tables.find(x => x.id === id); let rent = app.getCost(t); let bar = t.bar_amount || 0; let total = rent + bar;
        
        try {
            await supabaseClient.from('active_checks').insert([{ id: Date.now(), table_id: id.toString(), guest_name: name, time_amount: rent, bar_amount: bar, total: total, created_by: app.session.user.name }]);
            await supabaseClient.from('tables').update({ status: 'СВОБОДЕН', started_at: null, accumulated_cost: total, accumulated_time: 0, bar_amount: 0, paused: false, active_check_id: null }).eq('id', id);
            app.closeModals(); app.playSound('pay'); app.toast(`Счет в кассе`, 'success');
            app.loadData();
        } catch(e) {}
    },

    getCost: (t) => {
        if (!t.started_at) return t.accumulated_cost || 0;
        let cost = t.accumulated_cost || 0;
        if (!t.paused) {
            let ms = t.started_at; let end = Date.now(); let cMs = ms; 
            while(cMs < end) { 
                let h = new Date(cMs).getHours(); 
                let rate = (h >= 14 && h < 18) ? 2500 : 3000; cost += rate / 60; cMs += 60000; 
            }
        }
        return Math.ceil(cost / 50) * 50; 
    },
    formatTime: (ms) => { 
        let s = Math.floor(ms / 1000); let h = Math.floor(s / 3600); let m = Math.floor((s % 3600) / 60); let sec = s % 60;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`; 
    },
    tickTables: () => {
        if (!app.session.isAuth || app.state.tables.length === 0) return;
        let liveRev = 0; let liveBar = 0;
        app.state.tables.forEach(t => {
            if (t.status === 'В ИГРЕ') {
                let ms = (t.accumulated_time || 0); if (!t.paused) ms += (Date.now() - t.started_at);
                let rent = app.getCost(t); let barAmount = t.bar_amount || 0; let total = rent + barAmount;
                liveRev += rent; liveBar += barAmount;
                let timerEl = $(`timer-${t.id}`); let sumEl = $(`sum-${t.id}`);
                if (timerEl) timerEl.innerText = app.formatTime(ms);
                if (sumEl) sumEl.innerText = total.toLocaleString() + " ₸";
            }
        });
        if($('head-tables-rev')) $('head-tables-rev').innerText = liveRev.toLocaleString() + " ₸";
        if($('head-bar')) $('head-bar').innerText = liveBar.toLocaleString() + " ₸";
        if($('head-total')) $('head-total').innerText = (liveRev + liveBar).toLocaleString() + " ₸";
    },

    // КАССА ОЖИДАНИЯ
    loadChecks: async () => {
        try {
            const { data } = await supabaseClient.from('active_checks').select('*');
            if(data) { app.state.activeChecks = data; app.renderChecks(); }
        } catch(e) {}
    },

    renderChecks: () => {
        const list = $('waiting-payments-list'); const count = $('waiting-count');
        if (!list || !count) return;
        count.innerText = app.state.activeChecks.length;
        if (app.state.activeChecks.length === 0) { list.innerHTML = '<div class="muted-text text-center py-10 w-100">Касса пуста ✅</div>'; return; }
        list.innerHTML = app.state.activeChecks.map(c => `
            <div class="payment-row">
                <div class="payment-info"><span class="badge" style="background: rgba(255,255,255,0.05);">🎱 Стол ${c.table_id}</span><b class="text-white text-12">${c.guest_name}</b></div>
                <div class="payment-sum font-mono">${c.total.toLocaleString()} ₸</div>
                <div class="payment-actions"><button class="btn-gold btn-sm success-text" onclick="app.openPayCheck(${c.id})">💳 ОПЛАТИТЬ</button></div>
            </div>`).join('');
    },

    openPayCheck: (id) => {
        let c = app.state.activeChecks.find(x => x.id === id); if(!c) return;
        $('pay-check-id').value = id; 
        $('pay-sum').innerText = c.total.toLocaleString() + ' ₸'; 
        app.openModal('modal-pay');
    },

    confirmPayActiveCheck: async (method) => {
        let id = $('pay-check-id').value; if (!id) return;
        let checkToArchive = app.state.activeChecks.find(c => c.id == id); if (!checkToArchive) return;
        try {
            if (method === 'ДОЛГ') await supabaseClient.from('debts').insert([{ guest_name: checkToArchive.guest_name || 'Гость', amount: checkToArchive.total, created_by: app.session.user.name }]);
            await supabaseClient.from('archived_checks').insert([{ id: checkToArchive.id, table_id: checkToArchive.table_id, guest_name: checkToArchive.guest_name, time_amount: checkToArchive.time_amount, bar_amount: checkToArchive.bar_amount, total: checkToArchive.total, pay_method: method, created_by: app.session.user.name, played_ms: checkToArchive.played_ms }]);
            await supabaseClient.from('active_checks').delete().eq('id', id);
            app.closeModals(); app.toast(`Оплата ${method} прошла`, 'success');
            app.loadChecks();
        } catch(e) { app.toast('Ошибка', 'danger'); }
    },

    // POS БАР
    renderPosItems: (category = 'Все') => {
        const grid = $('pos-items-grid'); if(!grid) return;
        let items = app.state.inventory; if(category !== 'Все') items = items.filter(i => i.category === category);
        if(items.length === 0) { grid.innerHTML = '<div class="muted-text">Каталог пуст</div>'; return; }
        grid.innerHTML = items.map(item => {
            let isOut = item.stock <= 0 ? 'out-of-stock' : '';
            return `<div class="pos-item ${isOut}" onclick="${item.stock > 0 ? `app.addToCart(${item.id})` : ''}">
                <div class="pos-item-name">${item.name}</div><div class="pos-item-price">${item.price} ₸</div>
                <div class="pos-add-btn">+ В КОРЗИНУ</div></div>`;
        }).join('');
    },
    addToCart: (id) => {
        app.playSound('start');
        let item = app.state.inventory.find(i => i.id === id); if(!item || item.stock <= 0) return;
        let existing = app.state.cart.find(c => c.id === id);
        if(existing) { if (existing.qty < item.stock) existing.qty++; else app.toast('Предел склада', 'danger'); } 
        else { app.state.cart.push({ id: item.id, name: item.name, price: item.price, qty: 1 }); }
        app.renderCart();
    },
    changeQty: (id, delta) => {
        let index = app.state.cart.findIndex(c => c.id === id);
        if(index !== -1) {
            let item = app.state.inventory.find(i => i.id === id);
            if (delta > 0 && app.state.cart[index].qty >= item.stock) return app.toast('Склад пуст', 'danger');
            app.state.cart[index].qty += delta;
            if(app.state.cart[index].qty <= 0) app.state.cart.splice(index, 1);
            app.renderCart();
        }
    },
    clearCart: () => { app.state.cart = []; app.renderCart(); },
    renderCart: () => {
        const list = $('pos-cart-list'); const totalEl = $('pos-total'); if(!list || !totalEl) return;
        let total = 0; if(app.state.cart.length === 0) { list.innerHTML = '<div class="muted-text text-center py-20">Корзина пуста</div>'; totalEl.innerText = '0 ₸'; return; }
        list.innerHTML = app.state.cart.map(c => {
            total += (c.price * c.qty);
            return `<div class="cart-item"><div class="cart-item-info"><div class="cart-item-name">${c.name}</div><div class="cart-item-price">${c.price} ₸</div></div>
            <div class="qty-controls"><button class="qty-btn" onclick="app.changeQty(${c.id}, -1)">-</button><div class="qty-val">${c.qty}</div><button class="qty-btn" onclick="app.changeQty(${c.id}, 1)">+</button></div></div>`;
        }).join('');
        totalEl.innerText = total.toLocaleString() + ' ₸';
    },
    updateTargetUI: () => {
        let val = $('pos-target').value;
        if(val === 'none') { $('pos-actions-quick').classList.remove('hidden'); $('pos-actions-table').classList.add('hidden'); } 
        else { $('pos-actions-quick').classList.add('hidden'); $('pos-actions-table').classList.remove('hidden'); }
    },
    checkoutCart: async (method) => {
        if(app.state.cart.length === 0) return app.toast('Корзина пуста', 'danger');
        let total = app.state.cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
        let guest = $('pos-guest').value.trim() || 'Гость бара';
        app.playSound('pay');
        try {
            if (method === 'ДОЛГ') await supabaseClient.from('debts').insert([{ guest_name: guest, amount: total, created_by: app.session.user.name }]);
            await supabaseClient.from('archived_checks').insert([{ id: Date.now(), table_id: 'БАР', guest_name: guest, time_amount: 0, bar_amount: total, total: total, pay_method: method, created_by: app.session.user.name }]);
            for(let item of app.state.cart) {
                let dbItem = app.state.inventory.find(i => i.id === item.id);
                if(dbItem) await supabaseClient.from('inventory').update({stock: dbItem.stock - item.qty}).eq('id', item.id);
            }
            app.toast(`Оплата ${method} успешна`, 'success');
            app.state.cart = []; app.renderCart(); app.loadData();
        } catch(e) { app.toast('Ошибка чека', 'danger'); }
    },
    sendCartToTable: async () => {
        let tableId = $('pos-target').value; if(tableId === 'none' || app.state.cart.length === 0) return;
        let total = app.state.cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
        let t = app.state.tables.find(x => x.id == tableId); if(!t) return;
        try {
            let newBarSum = (t.bar_amount || 0) + total; app.playSound('start');
            await supabaseClient.from('tables').update({ bar_amount: newBarSum }).eq('id', tableId);
            for(let item of app.state.cart) {
                let dbItem = app.state.inventory.find(i => i.id === item.id);
                if(dbItem) await supabaseClient.from('inventory').update({stock: dbItem.stock - item.qty}).eq('id', item.id);
            }
            app.toast(`Добавлено на Стол ${tableId}`, 'success'); app.state.cart = []; app.renderCart(); app.loadData(); app.switchTab('hall');
        } catch(e) {}
    },

    switchTab: (tabId) => {
        $$('.nav-btn, .m-nav-item').forEach(b => b.classList.remove('active'));
        $$(`[data-tab="${tabId}"]`).forEach(b => b.classList.add('active'));
        $$('.tab-pane').forEach(p => p.classList.add('hidden'));
        let tab = $(`tab-${tabId}`); if (tab) tab.classList.remove('hidden');
        if(tabId === 'stock') {
            const select = $('pos-target');
            let html = '<option value="none">📍 БЫСТРЫЙ ЧЕК (БАР)</option>';
            app.state.tables.forEach(t => { if(t.status === 'В ИГРЕ') html += `<option value="${t.id}">🎱 СТОЛ ${t.id}</option>`; });
            if(select) { select.innerHTML = html; app.updateTargetUI(); }
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
            if (e.key === 'Escape') app.closeModals();
            if (e.key === 'F1') { e.preventDefault(); app.confirmPayActiveCheck('НАЛ'); }
            if (e.key === 'F2') { e.preventDefault(); app.confirmPayActiveCheck('QR'); }
            if (e.key === ' ') { 
                const m = $('modal-manage-table');
                if (m && !m.classList.contains('hidden')) {
                    e.preventDefault(); app.startTable(parseInt($('m-table-id').innerText)); app.closeModals();
                }
            }
        });
    },

    bindEvents: () => {
        $('btn-login-submit')?.addEventListener('click', app.login);
        $('btn-logout')?.addEventListener('click', app.logout);
        $('btn-m-pause')?.addEventListener('click', () => { app.pauseTable(parseInt($('m-table-id').innerText)); app.closeModals(); });
        $('btn-m-stop')?.addEventListener('click', () => { app.openStopPanel(parseInt($('m-table-id').innerText)); });
        $('btn-m-start')?.addEventListener('click', () => { app.startTable(parseInt($('m-table-id').innerText)); app.closeModals(); });
        $('btn-m-bar')?.addEventListener('click', () => { 
            let id = parseInt($('m-table-id').innerText); app.closeModals(); app.switchTab('stock'); 
            let s = $('pos-target'); if(s) { s.value = id; app.updateTargetUI(); }
        });
        $('btn-close-manage')?.addEventListener('click', app.closeModals);
        $('btn-close-stop')?.addEventListener('click', app.closeModals);
        $('btn-confirm-stop')?.addEventListener('click', app.confirmStopTable);
        $('btn-close-pay')?.addEventListener('click', app.closeModals);
        $('btn-pay-nal')?.addEventListener('click', () => app.confirmPayActiveCheck('НАЛ'));
        $('btn-pay-qr')?.addEventListener('click', () => app.confirmPayActiveCheck('QR'));
        $('btn-pay-mix')?.addEventListener('click', () => app.confirmPayActiveCheck('MIX'));
        $('btn-pay-debt')?.addEventListener('click', () => app.confirmPayActiveCheck('ДОЛГ'));
        
        $$('#pos-filter-buttons button').forEach(btn => {
            btn.addEventListener('click', (e) => { app.renderPosItems(e.currentTarget.dataset.cat); });
        });
    }
};

window.app = app;
window.onload = () => { app.init(); };
