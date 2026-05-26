import { supabase, session, loadSession, saveSession } from './supabase.js';

const $ = i => document.getElementById(i);
const $$ = s => document.querySelectorAll(s);

const app = {
    session: session, loadSession: loadSession, saveSession: saveSession,
    state: { tables: [], activeChecks: [], archivedChecks: [], inventory: [], cart: [], guests: [], debts: [], shiftStart: Date.now(), tariffs: { day_start: 10, day_end: 18, day_price: 2000, night_price: 3000 } },

    init: async () => {
        app.checkSession();
        app.setupNavigation();
        app.setupHotkeys(); 
        
        try {
            // 1. ЗАГРУЗКА БАЗ С ЗАЩИТОЙ
            const { data: tables, error: e1 } = await supabase.from('tables').select('*').order('id');
            if(e1) throw e1;
            if(tables) { app.state.tables = tables; app.renderTables(); }

            const { data: checks } = await supabase.from('active_checks').select('*');
            if(checks) { app.state.activeChecks = checks; app.renderChecks(); }

            const { data: inv } = await supabase.from('inventory').select('*').eq('is_active', true).order('name');
            if(inv) { app.state.inventory = inv; app.renderPosItems(); }

            const { data: guests } = await supabase.from('guests').select('*').order('name');
            if(guests) { app.state.guests = guests; app.populateGuestDatalist(); }

            // 2. ПОДПИСКИ REALTIME
            supabase.channel('public:tables').on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tables' }, payload => {
                const index = app.state.tables.findIndex(t => t.id === payload.new.id);
                if(index !== -1) app.state.tables[index] = payload.new;
                app.renderTables(); app.updateTargetOptions(); 
            }).subscribe();

            supabase.channel('public:active_checks').on('postgres_changes', { event: '*', schema: 'public', table: 'active_checks' }, () => {
                supabase.from('active_checks').select('*').then(({data}) => { if(data) { app.state.activeChecks = data; app.renderChecks(); } });
            }).subscribe();

            // 3. ТАЙМЕРЫ
            setInterval(() => {
                let clock = $('live-clock');
                if (clock) clock.innerText = new Date().toLocaleTimeString('ru-RU').slice(0,5);
                app.tickTables();
            }, 1000);

            app.logActivity('Смена открыта', '🔓');

        } catch (error) {
            console.error("Supabase Init Error:", error);
            app.ui.toast('Ошибка БД: Проверьте подключение', 'danger');
        }
    },

    // АВТОРИЗАЦИЯ
    checkSession: () => {
        app.loadSession();
        if (!app.session.isAuth) {
            $('authScreen').classList.remove('hidden');
            $('appScreen').classList.add('hidden');
            app.renderStaff(); 
        } else {
            $('authScreen').classList.add('hidden'); 
            $('appScreen').classList.remove('hidden');
            $('userName').innerText = app.session.user.name;
            if(!app.state.shiftStart) app.state.shiftStart = Date.now();
            
            if (app.session.user.role !== 'owner') {
                $$('.owner-only').forEach(el => el.style.display = 'none');
            } else {
                $$('.owner-only').forEach(el => el.style.display = 'flex');
            }
            app.renderTables(); app.renderChecks();
        }
    },

    renderStaff: async () => {
        try {
            const { data } = await supabase.from('users').select('id, name, role');
            const sel = $('staffSelect');
            if(sel && data) sel.innerHTML = data.map(u => `<option value="${u.id}">${u.name} (${u.role})</option>`).join('');
        } catch(e) { app.ui.toast('Ошибка загрузки сотрудников', 'danger'); }
    },

    login: async () => {
        const uid = $('staffSelect').value; const pin = $('pinInput').value;
        try {
            const { data: user, error } = await supabase.from('users').select('*').eq('id', uid).eq('pin', pin).single();
            if(error) throw error;
            if(user) {
                app.session.isAuth = true; app.session.user = user; app.saveSession();
                app.ui.toast('Авторизация успешна', 'success');
                app.checkSession();
            }
        } catch(e) { app.ui.toast('Неверный PIN', 'danger'); }
    },

    logout: () => {
        app.session.isAuth = false; app.session.user = null; app.saveSession();
        location.reload();
    },

    // ГОРЯЧИЕ КЛАВИШИ И UI
    setupHotkeys: () => {
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') app.closeModals();
            if (e.key === 'F1') { e.preventDefault(); app.confirmPayActiveCheck('НАЛ'); }
            if (e.key === 'F2') { e.preventDefault(); app.confirmPayActiveCheck('QR'); }
            if (e.key === ' ') { // Пробел для старта из модалки
                const m = $('modal-manage-table');
                if (m && !m.classList.contains('hidden') && !$('m-actions-free').classList.contains('hidden')) {
                    e.preventDefault(); app.startTableFromManage();
                }
            }
        });
    },

    ui: {
        toast: (msg, type='success') => {
            const c = $('toast-container'); if(!c) return;
            const t = document.createElement('div');
            t.className = `toast toast-${type}`;
            t.innerText = msg;
            c.appendChild(t);
            setTimeout(() => t.remove(), 3000);
        },
        openModal: (id) => { $(id).classList.remove('hidden'); },
        playSound: (type) => {
            try {
                const ctx = new (window.AudioContext || window.webkitAudioContext)();
                const osc = ctx.createOscillator(); const gain = ctx.createGain();
                osc.connect(gain); gain.connect(ctx.destination);
                if(type === 'start') { osc.frequency.setValueAtTime(400, ctx.currentTime); osc.type = 'sine'; gain.gain.setValueAtTime(0.01, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3); osc.start(); osc.stop(ctx.currentTime + 0.3); }
                if(type === 'pay') { osc.frequency.setValueAtTime(600, ctx.currentTime); osc.frequency.setValueAtTime(900, ctx.currentTime + 0.1); osc.type = 'triangle'; gain.gain.setValueAtTime(0.01, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.2); osc.start(); osc.stop(ctx.currentTime + 0.2); }
            } catch(e){}
        }
    },

    closeModals: () => { $$('.overlay').forEach(p => p.classList.add('hidden')); },

    logActivity: (text, icon = '⚪') => {
        const feed = $('activity-feed'); if(!feed) return;
        const time = new Date().toLocaleTimeString('ru-RU').slice(0,5);
        const item = document.createElement('div');
        item.className = `feed-item`;
        item.innerHTML = `<span class="feed-time">${time}</span> <span class="feed-icon">${icon}</span> <span class="text-white">${text}</span>`;
        feed.prepend(item);
        if(feed.children.length > 30) feed.lastChild.remove();
    },

    logIncident: () => {
        let type = $('inc-type').value; let amount = $('inc-amount').value;
        app.logActivity(`Инцидент: ${type} (${amount}₸)`, '🚨');
        app.ui.toast('Инцидент зафиксирован', 'danger');
        app.closeModals();
    },

    // 1. СТОЛЫ (ЗАЛ)
    renderTables: () => {
        const grid = $('tablesGrid');
        if (!grid || !app.state.tables) return;
        grid.innerHTML = app.state.tables.sort((a,b)=>a.id-b.id).map(t => {
            let isPlaying = t.status === 'В ИГРЕ'; let isPaused = t.paused;
            let cls = isPlaying ? (isPaused ? 'paused' : 'playing') : 'free';
            let totalCost = (isPlaying ? app.getCost(t) : 0) + (t.bar_amount || 0);
            
            let btnsFree = `<button class="btn-gold flex-1" onclick="app.startTable(${t.id})">▶ ПУСК</button><button class="btn-dark" style="width: 50px;" onclick="app.openManageTable(${t.id})">⚙</button>`;
            let btnsActive = `<button class="btn-dark" style="width: 50px;" onclick="app.pauseTable(${t.id})">${isPaused ? '▶' : '⏸'}</button><button class="btn-dark" style="flex: 1;" onclick="app.openBarForTable(${t.id})">🍹 БАР</button><button class="btn-danger" style="flex: 1;" onclick="app.openStopPanel(${t.id})">💳 СЧЕТ</button><button class="btn-dark" style="width: 50px;" onclick="app.openManageTable(${t.id})">⚙</button>`;

            return `
            <div class="table-card ${cls}">
                <div class="table-cloth"></div>
                <div class="table-content flex-column h-100">
                    <div class="flex-between align-center mb-10">
                        <span class="t-num"><span class="t-status-dot"></span>СТОЛ ${t.id}</span>
                        ${isPlaying ? `<span class="badge" style="background: rgba(0,0,0,0.5);"><span class="icon text-10">👤</span> ${t.active_check_id || 'Гость'}</span>` : ''}
                    </div>
                    <div class="t-center-info my-auto">
                        ${isPlaying ? `
                            <div class="t-timer font-mono" id="timer-${t.id}">00:00:00</div>
                            <div class="flex-row justify-center gap-10 mt-5"><span class="t-cost gold-text font-mono">${totalCost.toLocaleString()} ₸</span></div>
                            ${t.bar_amount > 0 ? `<div class="muted-text text-10 mt-5">БАР: ${t.bar_amount.toLocaleString()} ₸</div>` : ''}
                        ` : `<div class="t-idle-text muted-text">СВОБОДЕН</div>`}
                    </div>
                    <div class="flex-row mt-auto pt-15" style="border-top: 1px solid rgba(255,255,255,0.05);">${isPlaying ? btnsActive : btnsFree}</div>
                </div>
            </div>`;
        }).join('');
    },

    startTable: async (id) => {
        try {
            app.ui.playSound('start');
            const { error } = await supabase.from('tables').update({ status: 'В ИГРЕ', started_at: Date.now(), accumulated_cost: 0, accumulated_time: 0, bar_amount: 0, paused: false, active_check_id: `Гость` }).eq('id', id);
            if(error) throw error;
            app.ui.toast(`Стол ${id} запущен`, 'success');
            app.logActivity(`Запущен Стол ${id}`, '🟢');
        } catch(e) { app.ui.toast('Ошибка запуска стола', 'danger'); }
    },

    pauseTable: async (id) => {
        let t = app.state.tables.find(x => x.id === id); if(!t) return;
        try {
            if (t.paused) {
                await supabase.from('tables').update({ paused: false, started_at: Date.now() }).eq('id', id);
                app.ui.toast(`Игра продолжена`, 'success'); app.logActivity(`Продолжение: Стол ${id}`, '▶');
            } else {
                let ms = (t.accumulated_time || 0) + (Date.now() - t.started_at); let cost = app.getCost(t);
                await supabase.from('tables').update({ paused: true, accumulated_time: ms, accumulated_cost: cost, started_at: null }).eq('id', id);
                app.ui.toast(`Стол на паузе`, 'warning'); app.logActivity(`Пауза: Стол ${id}`, '⏸');
            }
        } catch(e) { app.ui.toast('Ошибка паузы', 'danger'); }
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
            $('m-table-timer').innerText = '--:--:--'; $('m-table-cost').innerText = t.accumulated_cost ? t.accumulated_cost + ' ₸' : 'Ожидание';
        }
        app.ui.openModal('modal-manage-table');
    },

    startTableFromManage: () => { let id = parseInt($('m-table-id').innerText); app.startTable(id); app.closeModals(); },
    pauseTableFromManage: () => { let id = parseInt($('m-table-id').innerText); app.pauseTable(id); app.closeModals(); },
    
    openBarForTable: (id) => {
        let tid = id || parseInt($('m-table-id').innerText);
        app.closeModals(); app.switchTab('stock');
        let select = $('pos-target'); if(select) { select.value = tid; app.updateTargetUI(); }
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
        $('stop-guest-name').value = t.active_check_id || '';
        app.ui.openModal('modal-stop-table');
    },

    confirmStopTable: async () => {
        let id = parseInt($('stop-table-id').innerText);
        let name = $('stop-guest-name').value.trim() || `Гость ${id}`;
        let t = app.state.tables.find(x => x.id === id);
        let rent = app.getCost(t); let bar = t.bar_amount || 0; let total = rent + bar;
        let playedMs = (t.accumulated_time || 0) + (Date.now() - t.started_at);

        try {
            await supabase.from('active_checks').insert([{ id: Date.now(), table_id: id.toString(), guest_name: name, time_amount: rent, bar_amount: bar, total: total, created_by: app.session.user.name, played_ms: playedMs }]);
            await supabase.from('tables').update({ status: 'СВОБОДЕН', started_at: null, accumulated_cost: total, accumulated_time: 0, bar_amount: 0, paused: false, active_check_id: null }).eq('id', id);
            app.closeModals(); app.ui.playSound('pay'); app.ui.toast(`Счет передан на кассу`, 'success'); app.logActivity(`Остановлен: Стол ${id}`, '⏹');
        } catch(e) { app.ui.toast('Ошибка остановки стола', 'danger'); }
    },

    // МАТЕМАТИКА И ТАЙМЕРЫ
    getCost: (t) => {
        if (!t.started_at) return t.accumulated_cost || 0;
        let cost = t.accumulated_cost || 0;
        if (!t.paused) {
            let ms = t.started_at; let end = Date.now(); let cMs = ms; 
            let tDayS = app.state.tariffs.day_start; let tDayE = app.state.tariffs.day_end; 
            let pDay = app.state.tariffs.day_price; let pNight = app.state.tariffs.night_price;
            while(cMs < end) { 
                let h = new Date(cMs).getHours(); 
                let rate = (h >= tDayS && h < tDayE) ? pDay : pNight; 
                cost += rate / 60; cMs += 60000; 
            }
        }
        return Math.ceil(cost / 50) * 50; 
    },
    formatTime: (ms) => { 
        let s = Math.floor(ms / 1000); let h = Math.floor(s / 3600); let m = Math.floor((s % 3600) / 60); let sec = s % 60;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`; 
    },
    tickTables: () => {
        if (!app.session.isAuth) return;
        let liveRevenue = 0; let liveBar = 0;
        app.state.tables.forEach(t => {
            if (t.status === 'В ИГРЕ') {
                let ms = (t.accumulated_time || 0); if (!t.paused) ms += (Date.now() - t.started_at);
                let rent = app.getCost(t); let bar = t.bar_amount || 0; let total = rent + bar;
                liveRevenue += rent; liveBar += bar;
                let timerEl = $(`timer-${t.id}`); let sumEl = $(`sum-${t.id}`);
                if (timerEl) timerEl.innerText = app.formatTime(ms);
                if (sumEl) sumEl.innerText = total.toLocaleString() + " ₸";
            }
        });
        if($('head-tables-rev')) $('head-tables-rev').innerText = liveRevenue.toLocaleString() + " ₸";
        if($('head-bar')) $('head-bar').innerText = liveBar.toLocaleString() + " ₸";
        if($('head-total')) $('head-total').innerText = (liveRevenue + liveBar).toLocaleString() + " ₸";
    },

    // 2. POS КАССА
    renderPosItems: (category = 'Все') => {
        const grid = $('pos-items-grid'); if(!grid) return;
        let items = app.state.inventory; if(category !== 'Все') items = items.filter(i => i.category === category);
        if(items.length === 0) { grid.innerHTML = '<div class="muted-text">Пусто</div>'; return; }
        grid.innerHTML = items.map(item => {
            let stockClass = item.stock <= 0 ? 'danger' : (item.stock <= 5 ? 'warning' : 'success');
            let isOut = item.stock <= 0 ? 'out-of-stock' : '';
            let icon = '🥤'; if(item.category === 'Снеки') icon = '🍫'; if(item.category === 'Кальян') icon = '💨'; if(item.category === 'Чай') icon = '🫖';
            return `<div class="pos-item ${isOut}" onclick="${item.stock > 0 ? `app.addToCart(${item.id})` : ''}">
                <div class="item-badge ${stockClass}">${item.stock <= 0 ? 'НЕТ' : item.stock} шт</div>
                <div class="item-icon">${icon}</div><div class="pos-item-name">${item.name}</div><div class="pos-item-price">${item.price} ₸</div>
                <div class="pos-add-btn">+ В КОРЗИНУ</div></div>`;
        }).join('');
    },

    addToCart: (id) => {
        app.ui.playSound('start');
        let item = app.state.inventory.find(i => i.id === id); if(!item || item.stock <= 0) return;
        let existing = app.state.cart.find(c => c.id === id);
        if(existing) { if (existing.qty < item.stock) existing.qty++; else app.ui.toast('Недостаточно на складе', 'danger'); } 
        else { app.state.cart.push({ id: item.id, name: item.name, price: item.price, qty: 1 }); }
        app.renderCart();
    },

    changeCartQty: (id, delta) => {
        let index = app.state.cart.findIndex(c => c.id === id);
        if(index !== -1) {
            let item = app.state.inventory.find(i => i.id === id);
            if (delta > 0 && app.state.cart[index].qty >= item.stock) return app.ui.toast('Недостаточно', 'danger');
            app.state.cart[index].qty += delta;
            if(app.state.cart[index].qty <= 0) app.state.cart.splice(index, 1);
            app.renderCart();
        }
    },

    clearCart: () => { app.state.cart = []; app.renderCart(); },

    renderCart: () => {
        const list = $('pos-cart-list'); const totalEl = $('pos-total');
        if(!list || !totalEl) return;
        let total = 0;
        if(app.state.cart.length === 0) { list.innerHTML = '<div class="muted-text text-center py-20">Корзина пуста</div>'; totalEl.innerText = '0 ₸'; return; }
        list.innerHTML = app.state.cart.map(c => {
            total += (c.price * c.qty);
            return `<div class="cart-item"><div class="cart-item-info"><div class="cart-item-name">${c.name}</div><div class="cart-item-price">${c.price} ₸</div></div>
            <div class="qty-controls"><button class="qty-btn" onclick="app.changeCartQty(${c.id}, -1)">-</button><div class="qty-val">${c.qty}</div><button class="qty-btn" onclick="app.changeCartQty(${c.id}, 1)">+</button></div></div>`;
        }).join('');
        totalEl.innerText = total.toLocaleString() + ' ₸';
    },

    updateTargetOptions: () => {
        const select = $('pos-target'); if(!select) return;
        let currentVal = select.value;
        let html = '<option value="none">📍 БЫСТРЫЙ ЧЕК (БАР)</option>';
        app.state.tables.forEach(t => { if(t.status === 'В ИГРЕ') html += `<option value="${t.id}">🎱 СТОЛ ${t.id}</option>`; });
        select.innerHTML = html;
        if(app.state.tables.find(t => t.id == currentVal && t.status === 'В ИГРЕ')) select.value = currentVal; else select.value = 'none';
        app.updateTargetUI();
    },

    updateTargetUI: () => {
        let val = $('pos-target').value;
        if(val === 'none') { $('pos-actions-quick').classList.remove('hidden'); $('pos-actions-table').classList.add('hidden'); } 
        else { $('pos-actions-quick').classList.add('hidden'); $('pos-actions-table').classList.remove('hidden'); }
    },

    checkoutCart: async (method) => {
        if(app.state.cart.length === 0) return app.ui.toast('Корзина пуста', 'danger');
        let total = app.state.cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
        let guest = $('pos-guest').value.trim() || 'Гость бара';
        app.ui.playSound('pay');
        
        try {
            if (method === 'ДОЛГ') await supabase.from('debts').insert([{ guest_name: guest, amount: total, created_by: app.session.user.name }]);
            await supabase.from('archived_checks').insert([{ id: Date.now(), table_id: 'БАР', guest_name: guest, time_amount: 0, bar_amount: total, total: total, pay_method: method, created_by: app.session.user.name }]);
            for(let item of app.state.cart) {
                let dbItem = app.state.inventory.find(i => i.id === item.id);
                if(dbItem) await supabase.from('inventory').update({stock: dbItem.stock - item.qty}).eq('id', item.id);
            }
            app.ui.toast(`Оплата ${method} успешна`, 'success'); app.logActivity(`Бар: Оплата ${method} (${total} ₸)`, '🍹');
            app.state.cart = []; app.renderCart();
        } catch(e) { app.ui.toast('Ошибка кассы', 'danger'); }
    },

    sendCartToTable: async () => {
        let tableId = $('pos-target').value;
        if(tableId === 'none' || app.state.cart.length === 0) return;
        let total = app.state.cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
        let t = app.state.tables.find(x => x.id == tableId); if(!t) return;

        try {
            let newBarSum = (t.bar_amount || 0) + total;
            app.ui.playSound('start');
            await supabase.from('tables').update({ bar_amount: newBarSum }).eq('id', tableId);
            for(let item of app.state.cart) {
                let dbItem = app.state.inventory.find(i => i.id === item.id);
                if(dbItem) await supabase.from('inventory').update({stock: dbItem.stock - item.qty}).eq('id', item.id);
            }
            app.ui.toast(`Добавлено на Стол ${tableId}`, 'success'); app.logActivity(`Бар -> Стол ${tableId} (${total} ₸)`, '🍹');
            app.state.cart = []; app.renderCart(); app.switchTab('hall');
        } catch(e) { app.ui.toast('Ошибка добавления', 'danger'); }
    },

    // 3. КАССА ОЖИДАНИЯ
    renderChecks: () => {
        const list = $('waiting-payments-list'); const count = $('waiting-count');
        if (!list || !count) return;
        count.innerText = app.state.activeChecks.length;
        if (app.state.activeChecks.length === 0) { list.innerHTML = '<div class="muted-text py-10 w-100">Все счета оплачены</div>'; return; }
        
        list.innerHTML = app.state.activeChecks.map(c => {
            let msWaited = Date.now() - new Date(c.created_at).getTime();
            let urgencyClass = msWaited > 1800000 ? 'urgency-red' : (msWaited > 600000 ? 'urgency-yellow' : '');
            return `
            <div class="payment-row ${urgencyClass}">
                <div class="payment-info"><span class="badge" style="background: rgba(255,255,255,0.05); color: var(--gray);">🎱 Ст. ${c.table_id}</span><b class="text-white text-12">${c.guest_name}</b></div>
                <div class="payment-sum font-mono">${c.total.toLocaleString()} ₸</div>
                <div class="payment-actions"><button class="btn-dark btn-sm success-text" onclick="app.openPayActiveCheck(${c.id})">💳 ОПЛАТИТЬ</button></div>
            </div>`;
        }).join('');
    },

    openPayActiveCheck: (id) => {
        let c = app.state.activeChecks.find(x => x.id === id); if(!c) return;
        $('pay-check-id').value = id; $('pay-sum').innerText = c.total.toLocaleString() + ' ₸';
        app.ui.openModal('modal-pay');
    },

    confirmPayActiveCheck: async (method) => {
        let id = $('pay-check-id').value; if (!id) return;
        let checkToArchive = app.state.activeChecks.find(c => c.id == id); if (!checkToArchive) return;

        try {
            app.ui.playSound('pay');
            if (method === 'ДОЛГ') await supabase.from('debts').insert([{ guest_name: checkToArchive.guest_name || 'Гость', amount: checkToArchive.total, created_by: app.session.user.name }]);
            await supabase.from('archived_checks').insert([{ id: checkToArchive.id, table_id: checkToArchive.table_id, guest_name: checkToArchive.guest_name, time_amount: checkToArchive.time_amount, bar_amount: checkToArchive.bar_amount, total: checkToArchive.total, pay_method: method, created_by: checkToArchive.created_by, played_ms: checkToArchive.played_ms }]);
            await supabase.from('active_checks').delete().eq('id', id);
            
            app.closeModals(); app.ui.toast(`Оплата ${method} проведена`, 'success'); app.logActivity(`Оплата чека (${method})`, '🟢');
        } catch(e) { app.ui.toast('Ошибка кассы', 'danger'); }
    },

    // НАВИГАЦИЯ
    switchTab: (tabId) => {
        $$('.nav-btn, .m-nav-item').forEach(b => b.classList.remove('active'));
        $$(`[data-tab="${tabId}"]`).forEach(b => b.classList.add('active'));
        $$('.tab-pane').forEach(p => p.classList.add('hidden'));
        let tab = $(`tab-${tabId}`); if (tab) tab.classList.remove('hidden');
        if(tabId === 'stock') app.updateTargetOptions();
    },

    setupNavigation: () => {
        $$('.nav-btn, .m-nav-item').forEach(btn => {
            btn.addEventListener('click', (e) => {
                if(e.currentTarget.dataset.tab) app.switchTab(e.currentTarget.dataset.tab);
            });
        });
    },
    
    // Пустые заглушки для CRM и Склада, чтобы не перегружать файл. Данные подтянутся позже.
    populateGuestDatalist: () => {},
    renderCrm: () => {},
    renderDebts: () => {}
};

window.app = app;
window.onload = app.init;
