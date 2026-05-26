import { supabase, session, loadSession, saveSession } from './supabase.js';

const $ = i => document.getElementById(i);
const $$ = s => document.querySelectorAll(s);

const app = {
    session: session, loadSession: loadSession, saveSession: saveSession,
    state: { tables: [], activeChecks: [], archivedChecks: [], inventory: [], cart: [], guests: [], debts: [], shiftStart: Date.now(), tariffs: { day_start: 14, day_end: 18, day_price: 2500, night_price: 3000 } },

    init: async () => {
        app.checkSession();
        app.setupNavigation();
        app.setupHotkeys(); 
        
        try {
            // МНОГОУРОВНЕВЫЙ FAIL-SAFE ПЕРЕХВАТ ДАННЫХ ИЗ SUPABASE
            const { data: tables, error: e1 } = await supabase.from('tables').select('*').order('id');
            if(e1) throw e1;
            if(tables) { app.state.tables = tables; app.tables.render(); }

            const { data: checks, error: e2 } = await supabase.from('active_checks').select('*');
            if(e2) throw e2;
            if(checks) { app.state.activeChecks = checks; app.renderChecks(); }

            const today = new Date().toISOString().split('T')[0];
            const { data: archive, error: e3 } = await supabase.from('archived_checks').select('*').gte('closed_at', today).order('closed_at', { ascending: false });
            if(e3) throw e3;
            if(archive) { app.state.archivedChecks = archive; app.renderArchive(); }

            const { data: inv, error: e4 } = await supabase.from('inventory').select('*').eq('is_active', true).order('name');
            if(e4) throw e4;
            if(inv) { app.state.inventory = inv; app.pos.renderItems(); app.inventory.render(); app.inventory.populateSelect(); }

            const { data: guests, error: e5 } = await supabase.from('guests').select('*').order('name');
            if(e5) throw e5;
            if(guests) { app.state.guests = guests; app.crm.render(); app.crm.populateDatalist(); }

            const { data: debts, error: e6 } = await supabase.from('debts').select('*').eq('status', 'АКТИВЕН').order('created_at', { ascending: false });
            if(e6) throw e6;
            if(debts) { app.state.debts = debts; app.debts.render(); }

            // REALTIME ПОДПИСКА НА ОТКРЫТЫЕ СОКЕТЫ ПОСТГРЕСА
            supabase.channel('public:tables').on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tables' }, payload => {
                const index = app.state.tables.findIndex(t => t.id === payload.new.id);
                if(index !== -1) app.state.tables[index] = payload.new;
                app.tables.render(); app.pos.updateTargetOptions(); 
            }).subscribe();

            supabase.channel('public:active_checks').on('postgres_changes', { event: '*', schema: 'public', table: 'active_checks' }, () => {
                supabase.from('active_checks').select('*').then(({data}) => { if(data) { app.state.activeChecks = data; app.renderChecks(); } });
            }).subscribe();

            supabase.channel('public:archived_checks').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'archived_checks' }, payload => {
                app.state.archivedChecks.unshift(payload.new); app.renderArchive();
            }).subscribe();

            app.logActivity('Смена инициализирована ERP', '🔓');

        } catch (error) {
            console.error("Critical Connection Failure Core Engine:", error);
            app.ui.toast(`Критический сбой БД: ${error.message || 'Отключите RLS в Supabase'}`, 'danger');
        }

        // ТАЙМЕРЫ И ЧАСЫ СИНХРОНИЗАЦИИ
        setInterval(() => {
            let clock = $('live-clock');
            if (clock) clock.innerText = new Date().toLocaleTimeString('ru-RU').slice(0,5);
            let shiftClock = $('shift-clock');
            if (shiftClock && app.session.isAuth) {
                let ms = Date.now() - app.state.shiftStart;
                let h = Math.floor(ms / 3600000); let m = Math.floor((ms % 3600000) / 60000);
                shiftClock.innerText = `СМЕНА: ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
            }
            app.tables.tick();
        }, 1000);
    },

    // ГОРЯЧИЕ КЛАВИШИ ПО ТЗ
    setupHotkeys: () => {
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') app.closeModals();
            if (e.key === 'F1') { e.preventDefault(); app.confirmPayActiveCheck('НАЛ'); }
            if (e.key === 'F2') { e.preventDefault(); app.confirmPayActiveCheck('QR'); }
            if (e.key === 'F3') { e.preventDefault(); app.confirmPayActiveCheck('ДОЛГ'); }
            if (e.key === ' ') { 
                const m = $('modal-manage-table');
                if (m && !m.classList.contains('hidden') && !$('m-actions-free').classList.contains('hidden')) {
                    e.preventDefault(); app.tables.startTableFromManage();
                }
            }
        });
    },

    // АВТОРИЗАЦИЯ И УПРАВЛЕНИЕ СЕССИЕЙ
    checkSession: () => {
        app.loadSession();
        if (!app.session.isAuth) {
            $('authScreen').classList.remove('hidden'); $('appScreen').classList.add('hidden'); app.renderStaff(); 
        } else {
            $('authScreen').classList.add('hidden'); $('appScreen').classList.remove('hidden');
            $('userName').innerText = app.session.user.name;
            
            // Распределение ролей
            if (app.session.user.role !== 'owner') {
                $$('.owner-only').forEach(el => el.style.display = 'none');
            } else {
                $$('.owner-only').forEach(el => el.style.display = 'flex');
            }
            app.tables.render(); app.renderChecks();
        }
    },

    renderStaff: async () => {
        try {
            const { data } = await supabase.from('users').select('id, name, role');
            const sel = $('staffSelect');
            if(sel && data) sel.innerHTML = data.map(u => `<option value="${u.id}">${u.name} (${u.role})</option>`).join('');
            $('btn-login-submit').onclick = async () => {
                const uid = sel.value; const pin = $('pinInput').value;
                const { data: user } = await supabase.from('users').select('*').eq('id', uid).eq('pin', pin).single();
                if(user) {
                    app.session.isAuth = true; app.session.user = user; app.saveSession();
                    app.ui.toast('Вход выполнен', 'success'); app.checkSession();
                } else { app.ui.toast('Неверный PIN-код доступа', 'danger'); }
            };
        } catch(e) {}
    },

    logout: () => { app.session.isAuth = false; app.session.user = null; app.saveSession(); location.reload(); },

    // ВНУТРЕННИЙ UI И ЗВУКОВОЙ ДВИЖОК
    ui: {
        toast: (msg, type='success') => {
            const c = $('toast-container'); if(!c) return;
            const t = document.createElement('div');
            t.className = type === 'danger' ? `toast toast-danger` : `toast`; t.innerText = msg;
            c.appendChild(t); setTimeout(() => t.remove(), 2500);
        },
        openModal: (id) => { $(id).classList.remove('hidden'); },
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

    closeModals: () => { $$('.overlay').forEach(p => p.classList.add('hidden')); },

    logActivity: (text, icon = '⚪') => {
        const feed = $('activity-feed'); if(!feed) return;
        const time = new Date().toLocaleTimeString('ru-RU').slice(0,5);
        const item = document.createElement('div'); item.className = `feed-item`;
        item.innerHTML = `<span class="feed-time">${time}</span> <span class="feed-icon">${icon}</span> <span class="text-white">${text}</span>`;
        feed.prepend(item); if(feed.children.length > 30) feed.lastChild.remove();
    },

    logIncident: () => {
        let type = $('inc-type').value; let amount = $('inc-amount').value;
        app.logActivity(`Инцидент: ${type} (${amount}₸)`, '🚨');
        app.ui.toast('Инцидент зафиксирован и отправлен владельцу', 'danger'); app.closeModals();
    },

    // 1. СТРОГИЙ ДВИЖОК ТАРИФИКАЦИИ И БИЛЬЯРДНЫХ СТОЛОВ
    tables: {
        render: () => {
            const grid = $('tablesGrid'); if (!grid || !app.state.tables) return;
            grid.innerHTML = app.state.tables.sort((a,b)=>a.id-b.id).map(t => {
                let isPlaying = t.status === 'В ИГРЕ'; let isPaused = t.paused;
                let cls = isPlaying ? (isPaused ? 'paused' : 'playing') : 'free';
                let totalCost = (isPlaying ? app.tables.getCost(t) : 0) + (t.bar_amount || 0);
                
                let btnsFree = `<button class="btn-gold flex-1" onclick="app.tables.startTable(${t.id})">▶ ПУСК</button><button class="btn-dark" style="width: 50px;" onclick="app.tables.openManage(${t.id})">⚙</button>`;
                let btnsActive = `<button class="btn-dark" style="width: 50px;" onclick="app.tables.togglePause(${t.id})">${isPaused ? '▶' : '⏸'}</button><button class="btn-dark" style="flex: 1;" onclick="app.tables.openBarForTable(${t.id})">🍹 БАР</button><button class="btn-danger" style="flex: 1;" onclick="app.tables.openStopPanel(${t.id})">💳 СЧЕТ</button><button class="btn-dark" style="width: 50px;" onclick="app.tables.openManage(${t.id})">⚙</button>`;

                return `<div class="table-card ${cls}"><div class="table-cloth"></div><div class="table-content flex-column h-100">
                    <div class="flex-between align-center mb-10"><span class="t-num"><span class="t-status-dot"></span>СТОЛ ${t.id}</span>
                    ${isPlaying ? `<span class="badge" style="background: rgba(0,0,0,0.5);"><span class="icon text-10">👤</span> ${t.active_check_id || 'Гость'}</span>` : ''}</div>
                    <div class="t-center-info my-auto">${isPlaying ? `<div class="t-timer font-mono" id="timer-${t.id}">00:00:00</div>
                    <div class="flex-row justify-center gap-10 mt-5"><span class="t-cost gold-text font-mono">${totalCost.toLocaleString()} ₸</span></div>
                    ${t.bar_amount > 0 ? `<div class="muted-text text-10 mt-5">АКТИВНЫЙ БАР: ${t.bar_amount.toLocaleString()} ₸</div>` : ''}` : `<div class="t-idle-text muted-text">СВОБОДЕН</div>`}</div>
                    <div class="flex-row mt-auto pt-15" style="border-top: 1px solid rgba(255,255,255,0.05);">${isPlaying ? btnsActive : btnsFree}</div></div></div>`;
            }).join('');
        },
        startTable: async (id) => {
            app.ui.playSound('start');
            try {
                const { error } = await supabase.from('tables').update({ status: 'В ИГРЕ', started_at: Date.now(), accumulated_cost: 0, accumulated_time: 0, bar_amount: 0, paused: false, active_check_id: `Гость` }).eq('id', id);
                if(error) throw error;
                app.ui.toast(`Стол ${id} переведен в статус ИГРАЕТ`, 'success'); app.logActivity(`Запущен Стол ${id}`, '🟢');
            } catch(e) { app.ui.toast(`Ошибка запуска стола`, 'danger'); }
        },
        togglePause: async (id) => {
            let t = app.state.tables.find(x => x.id === id); if(!t) return;
            try {
                if (t.paused) {
                    await supabase.from('tables').update({ paused: false, started_at: Date.now() }).eq('id', id);
                    app.ui.toast(`Игра возобновлена`, 'success'); app.logActivity(`Продолжение: Стол ${id}`, '▶');
                } else {
                    let ms = (t.accumulated_time || 0) + (Date.now() - t.started_at); let cost = app.tables.getCost(t);
                    await supabase.from('tables').update({ paused: true, accumulated_time: ms, accumulated_cost: cost, started_at: null }).eq('id', id);
                    app.ui.toast(`Установлена программная пауза`, 'warning'); app.logActivity(`Пауза: Стол ${id}`, '⏸');
                }
            } catch(e) { app.ui.toast('Ошибка переключения паузы стола', 'danger'); }
        },
        openManage: (id) => {
            let t = app.state.tables.find(x => x.id === id); $('m-table-id').innerText = id;
            if (t.status === 'В ИГРЕ') {
                $('m-actions-active').classList.remove('hidden'); $('m-actions-free').classList.add('hidden');
                let ms = (t.accumulated_time || 0) + (Date.now() - t.started_at);
                $('m-table-timer').innerText = app.tables.formatTime(ms); $('m-table-cost').innerText = (app.tables.getCost(t) + (t.bar_amount || 0)).toLocaleString() + ' ₸';
            } else {
                $('m-actions-active').classList.add('hidden'); $('m-actions-free').classList.remove('hidden');
                $('m-table-timer').innerText = '--:--:--'; $('m-table-cost').innerText = t.accumulated_cost ? t.accumulated_cost + ' ₸' : 'Ожидание';
            }
            app.ui.openModal('modal-manage-table');
        },
        startTableFromManage: () => { let id = parseInt($('m-table-id').innerText); app.tables.startTable(id); app.closeModals(); },
        pauseTableFromManage: () => { let id = parseInt($('m-table-id').innerText); app.tables.togglePause(id); app.closeModals(); },
        openBarForTable: (id) => {
            let tid = id || parseInt($('m-table-id').innerText); app.closeModals(); app.switchTab('stock');
            let select = $('pos-target'); if(select) { select.value = tid; app.pos.updateTargetUI(); }
        },
        openStopPanel: (id) => {
            let t = app.state.tables.find(x => x.id === id); if(!t) t = app.state.tables.find(x => x.id === parseInt($('m-table-id').innerText));
            if(!t) return; app.closeModals();
            let rent = app.tables.getCost(t); let bar = t.bar_amount || 0;
            $('stop-table-id').innerText = t.id; $('stop-rent-sum').innerText = rent.toLocaleString() + ' ₸';
            $('stop-bar-sum').innerText = bar.toLocaleString() + ' ₸'; $('stop-total-sum').innerText = (rent + bar).toLocaleString() + ' ₸';
            $('stop-guest-name').value = t.active_check_id || ''; app.ui.openModal('modal-stop-table');
        },
        confirmStopTable: async () => {
            let id = parseInt($('stop-table-id').innerText); let name = $('stop-guest-name').value.trim() || `Гость ${id}`;
            let t = app.state.tables.find(x => x.id === id); let rent = app.tables.getCost(t); let bar = t.bar_amount || 0; let total = rent + bar;
            let playedMs = (t.accumulated_time || 0) + (Date.now() - t.started_at);
            try {
                await supabase.from('active_checks').insert([{ id: Date.now(), table_id: id.toString(), guest_name: name, time_amount: rent, bar_amount: bar, total: total, created_by: app.session.user.name, played_ms: playedMs }]);
                await supabase.from('tables').update({ status: 'СВОБОДЕН', started_at: null, accumulated_cost: total, accumulated_time: 0, bar_amount: 0, paused: false, active_check_id: null }).eq('id', id);
                app.closeModals(); app.ui.playSound('pay'); app.ui.toast(`Счет передан в очередь кассы`, 'success'); app.logActivity(`Расчет выставлен: Стол ${id}`, '⏹');
            } catch(e) { app.ui.toast('Ошибка закрытия игровой сессии', 'danger'); }
        },
        getCost: (t) => {
            if (!t.started_at) return t.accumulated_cost || 0;
            let cost = t.accumulated_cost || 0;
            if (!t.paused) {
                let ms = t.started_at; let end = Date.now(); let cMs = ms; 
                let tDayS = app.state.tariffs.day_start; let tDayE = app.state.tariffs.day_end; 
                let pDay = app.state.tariffs.day_price; let pNight = app.state.tariffs.night_price;
                while(cMs < end) { 
                    let h = new Date(cMs).getHours(); 
                    let rate = (h >= tDayS && h < tDayE) ? pDay : pNight; cost += rate / 60; cMs += 60000; 
                }
            }
            return Math.ceil(cost / 50) * 50; 
        },
        formatTime: (ms) => { 
            let s = Math.floor(ms / 1000); let h = Math.floor(s / 3600); let m = Math.floor((s % 3600) / 60); let sec = s % 60;
            return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`; 
        },
        tick: () => {
            if (!app.session.isAuth) return;
            let liveRevenue = 0; let liveBar = 0;
            app.state.tables.forEach(t => {
                if (t.status === 'В ИГРЕ') {
                    let ms = (t.accumulated_time || 0); if (!t.paused) ms += (Date.now() - t.started_at);
                    let rent = app.tables.getCost(t); let bar = t.bar_amount || 0; let total = rent + bar;
                    liveRevenue += rent; liveBar += bar;
                    let timerEl = $(`timer-${t.id}`); let sumEl = $(`sum-${t.id}`);
                    if (timerEl) timerEl.innerText = app.tables.formatTime(ms);
                    if (sumEl) sumEl.innerText = total.toLocaleString() + " ₸";
                }
            });
            if($('head-tables-rev')) $('head-tables-rev').innerText = liveRevenue.toLocaleString() + " ₸";
            if($('head-bar')) $('head-bar').innerText = liveBar.toLocaleString() + " ₸";
            if($('head-total')) $('head-total').innerText = (liveRevenue + liveBar).toLocaleString() + " ₸";
        }
    },

    // 2. POS-МОДУЛЬ (БАР)
    pos: {
        renderItems: (category = 'Все') => {
            const grid = $('pos-items-grid'); if(!grid) return;
            let items = app.state.inventory; if(category !== 'Все') items = items.filter(i => i.category === category);
            if(items.length === 0) { grid.innerHTML = '<div class="muted-text">Каталог пуст</div>'; return; }
            grid.innerHTML = items.map(item => {
                let stockClass = item.stock <= 0 ? 'danger' : (item.stock <= 5 ? 'warning' : 'success');
                let isOut = item.stock <= 0 ? 'out-of-stock' : '';
                let icon = '🥤'; if(item.category === 'Снеки') icon = '🍫'; if(item.category === 'Кальян') icon = '💨'; if(item.category === 'Чай') icon = '🫖';
                return `<div class="pos-item ${isOut}" onclick="${item.stock > 0 ? `app.pos.addToCart(${item.id})` : ''}">
                    <div class="item-badge ${stockClass}">${item.stock <= 0 ? 'НЕТ' : item.stock} шт</div>
                    <div class="item-icon">${icon}</div><div class="pos-item-name">${item.name}</div><div class="pos-item-price">${item.price} ₸</div>
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
            if(existing) { if (existing.qty < item.stock) existing.qty++; else app.ui.toast('Предел остатка склада', 'danger'); } 
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
            let total = 0; if(app.state.cart.length === 0) { list.innerHTML = '<div class="muted-text text-center py-20">Формирование чека...</div>'; totalEl.innerText = '0 ₸'; return; }
            list.innerHTML = app.state.cart.map(c => {
                total += (c.price * c.qty);
                return `<div class="cart-item"><div class="cart-item-info"><div class="cart-item-name">${c.name}</div><div class="cart-item-price">${c.price} ₸</div></div>
                <div class="qty-controls"><button class="qty-btn" onclick="app.pos.changeQty(${c.id}, -1)">-</button><div class="qty-val">${c.qty}</div><button class="qty-btn" onclick="app.pos.changeQty(${c.id}, 1)">+</button></div></div>`;
            }).join('');
            totalEl.innerText = total.toLocaleString() + ' ₸';
        },
        updateTargetOptions: () => {
            const select = $('pos-target'); if(!select) return;
            let currentVal = select.value;
            let html = '<option value="none">📍 БЫСТРЫЙ ЧЕК (ПРЯМАЯ ПРОДАЖА)</option>';
            app.state.tables.forEach(t => { if(t.status === 'В ИГРЕ') html += `<option value="${t.id}">🎱 СТОЛ ${t.id} (${t.active_check_id || ''})</option>`; });
            select.innerHTML = html;
            if(app.state.tables.find(t => t.id == currentVal && t.status === 'В ИГРЕ')) select.value = currentVal; else select.value = 'none';
            app.pos.updateTargetUI();
        },
        updateTargetUI: () => {
            let val = $('pos-target').value;
            if(val === 'none') { $('pos-actions-quick').classList.remove('hidden'); $('pos-actions-table').classList.add('hidden'); } 
            else { $('pos-actions-quick').classList.add('hidden'); $('pos-actions-table').classList.remove('hidden'); }
        },
        checkout: async (method) => {
            if(app.state.cart.length === 0) return app.ui.toast('Корзина пуста', 'danger');
            let total = app.state.cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
            let guest = $('pos-guest').value.trim() || 'Прямая продажа';
            app.ui.playSound('pay');
            try {
                if (method === 'ДОЛГ') await supabase.from('debts').insert([{ guest_name: guest, amount: total, created_by: app.session.user.name }]);
                await supabase.from('archived_checks').insert([{ id: Date.now(), table_id: 'БАР', guest_name: guest, time_amount: 0, bar_amount: total, total: total, pay_method: method, created_by: app.session.user.name }]);
                for(let item of app.state.cart) {
                    let dbItem = app.state.inventory.find(i => i.id === item.id);
                    if(dbItem) await supabase.from('inventory').update({stock: dbItem.stock - item.qty}).eq('id', item.id);
                }
                app.ui.toast(`Продажа оформлена: ${method}`, 'success'); app.logActivity(`Продажа POS: ${total} ₸ (${method})`, '🍹');
                app.state.cart = []; app.pos.renderCart(); app.refreshInventoryCache();
            } catch(e) { app.ui.toast('Ошибка чека', 'danger'); }
        },
        sendToTable: async () => {
            let tableId = $('pos-target').value; if(tableId === 'none' || app.state.cart.length === 0) return;
            let total = app.state.cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
            let t = app.state.tables.find(x => x.id == tableId); if(!t) return;
            try {
                let newBarSum = (t.bar_amount || 0) + total; app.ui.playSound('start');
                await supabase.from('tables').update({ bar_amount: newBarSum }).eq('id', tableId);
                for(let item of app.state.cart) {
                    let dbItem = app.state.inventory.find(i => i.id === item.id);
                    if(dbItem) await supabase.from('inventory').update({stock: dbItem.stock - item.qty}).eq('id', item.id);
                }
                app.ui.toast(`Перенесено на Стол ${tableId}`, 'success'); app.state.cart = []; app.pos.renderCart(); app.refreshInventoryCache(); app.switchTab('hall');
            } catch(e) { app.ui.toast('Ошибка привязки чека', 'danger'); }
        }
    },

    // 3. КАССА ОЖИДАНИЯ И АРХИВ (ФИНАНСЫ)
    renderChecks: () => {
        const list = $('waiting-payments-list'); const count = $('waiting-count'); if (!list || !count) return;
        count.innerText = app.state.activeChecks.length;
        if (app.state.activeChecks.length === 0) { list.innerHTML = '<div class="muted-text py-10 w-100">Все счета закрыты ✅</div>'; return; }
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
        let checkToArchive = app.state.activeChecks.find(c => c.id == id); if (!checkToArchive) return;
        try {
            app.ui.playSound('pay');
            if (method === 'ДОЛГ') await supabase.from('debts').insert([{ guest_name: checkToArchive.guest_name || 'Гость', amount: checkToArchive.total, created_by: app.session.user.name }]);
            await supabase.from('archived_checks').insert([{ id: checkToArchive.id, table_id: checkToArchive.table_id, guest_name: checkToArchive.guest_name, time_amount: checkToArchive.time_amount, bar_amount: checkToArchive.bar_amount, total: checkToArchive.total, pay_method: method, created_by: app.session.user.name, played_ms: checkToArchive.played_ms }]);
            await supabase.from('active_checks').delete().eq('id', id);
            app.closeModals(); app.ui.toast(`Оплата: ${method}`, 'success'); app.logActivity(`Касса закрыта: ${checkToArchive.total} ₸ (${method})`, '🟢');
            app.refreshFinanceArchiveCache();
        } catch(e) { app.ui.toast('Ошибка транзакции', 'danger'); }
    },

    refreshInventoryCache: async () => {
        const { data } = await supabase.from('inventory').select('*').eq('is_active', true).order('name');
        if(data) { app.state.inventory = data; app.pos.renderItems(); app.inventory.render(); }
    },
    refreshFinanceArchiveCache: async () => {
        const today = new Date().toISOString().split('T')[0];
        const { data } = await supabase.from('archived_checks').select('*').gte('closed_at', today).order('closed_at', { ascending: false });
        if(data) { app.state.archivedChecks = data; app.renderArchive(); }
        const { data: dbt } = await supabase.from('debts').select('*').eq('status', 'АКТИВЕН');
        if(dbt) { app.state.debts = dbt; app.debts.render(); }
    },

    renderArchive: () => {
        const list = $('archive-list'); if (!list) return;
        let total = 0; if (app.state.archivedChecks.length === 0) { list.innerHTML = '<tr><td colspan="8" class="text-center py-15 muted-text">Сегодня чеков еще нет 🎱</td></tr>'; return; }
        list.innerHTML = app.state.archivedChecks.map(c => {
            total += Number(c.total); let tc = c.pay_method === 'НАЛ' ? 'nal' : (c.pay_method === 'QR' ? 'qr' : 'debt');
            return `<tr><td>${new Date(c.closed_at).toLocaleTimeString('ru-RU').slice(0,5)}</td><td><b>Стол ${c.table_id}</b></td><td>${c.guest_name}</td>
            <td class="font-mono">${Number(c.time_amount).toLocaleString()} ₸</td><td class="font-mono">${Number(c.bar_amount).toLocaleString()} ₸</td>
            <td class="gold-text bold font-mono">${Number(c.total).toLocaleString()} ₸</td><td><span class="pay-tag ${tc}">${c.pay_method}</span></td><td class="text-right muted-text">${c.created_by}</td></tr>`;
        }).join('');
        if($('f-total')) $('f-total').innerText = total.toLocaleString() + ' ₸';
    },

    // 4. ДОПОЛНИТЕЛЬНЫЕ МОДУЛИ ERP (УЧЕТ, CRM, ДОЛГИ)
    inventory: {
        render: () => {
            const list = $('inventory-list'); if(!list) return;
            if(app.state.inventory.length === 0) { list.innerHTML = '<tr><td colspan="6" class="text-center py-15 muted-text">Каталог пуст</td></tr>'; return; }
            list.innerHTML = app.state.inventory.map(i => `<tr><td>${i.category}</td><td><b>${i.name}</b></td><td class="font-mono">${Number(i.cost_price).toLocaleString()} ₸</td><td class="gold-text font-mono">${Number(i.price).toLocaleString()} ₸</td><td class="bold font-mono">${i.stock} шт</td><td class="text-right"><span class="badge badge-green">АКТИВЕН</span></td></tr>`).join('');
        },
        populateSelect: () => { const sel = $('pur-item'); if(sel) sel.innerHTML = app.state.inventory.map(i => `<option value="${i.id}">${i.name}</option>`).join(''); },
        addPurchase: async () => {
            let id = parseInt($('pur-item').value); let qty = parseInt($('pur-qty').value); let cost = parseFloat($('pur-cost').value);
            if(!qty || qty <= 0 || !cost) return app.ui.toast('Заполните ордер', 'danger');
            try {
                let item = app.state.inventory.find(i => i.id === id);
                await supabase.from('purchases').insert([{ item_name: item.name, quantity: qty, cost_price: cost, created_by: app.session.user.name }]);
                await supabase.from('inventory').update({ stock: item.stock + qty, cost_price: cost }).eq('id', id);
                app.ui.toast('Склад пополнен', 'success'); app.closeModals(); app.refreshInventoryCache();
            } catch(e) { app.ui.toast('Ошибка прихода', 'danger'); }
        }
    },

    crm: {
        render: () => {
            const list = $('crm-list'); if(!list) return;
            if(app.state.guests.length === 0) { list.innerHTML = '<tr><td colspan="5" class="text-center py-15 muted-text">Добавьте первого гостя в CRM 👤</td></tr>'; return; }
            list.innerHTML = app.state.guests.map(g => `<tr><td><b>${g.name}</b></td><td class="font-mono">${g.phone || '--'}</td><td class="gold-text">${g.discount_percent}%</td><td class="font-mono">${Number(g.total_spent).toLocaleString()} ₸</td><td class="text-right"><span class="badge badge-green">АКТИВЕН</span></td></tr>`).join('');
        },
        populateDatalist: () => {
            const dl = $('guest-datalist');
            if(!dl) return;
            dl.innerHTML = app.state.guests.map(g => `<option value="${g.name}">Скидка: ${g.discount_percent}%</option>`).join('');
        },
        addGuest: async () => {
            let name = $('crm-name').value.trim(); let phone = $('crm-phone').value.trim(); let discount = parseInt($('crm-discount').value) || 0;
            if(!name) return app.ui.toast('Укажите имя', 'danger');
            try {
                await supabase.from('guests').insert([{ name, phone, discount_percent: discount }]);
                app.ui.toast('Профиль сохранен', 'success'); app.closeModals();
                const { data } = await supabase.from('guests').select('*').order('name'); if(data) { app.state.guests = data; app.crm.render(); app.crm.populateDatalist(); }
            } catch(e) { app.ui.toast('Ошибка CRM', 'danger'); }
        }
    },

    debts: {
        render: () => {
            const list = $('debts-list'); if(!list) return;
            if(app.state.debts.length === 0) { list.innerHTML = '<tr><td colspan="5" class="text-center py-15 muted-text">Все долги закрыты ✅</td></tr>'; return; }
            list.innerHTML = app.state.debts.map(d => `<tr><td>${new Date(d.created_at).toLocaleDateString('ru-RU')}</td><td><b>${d.guest_name}</b></td><td class="danger-text bold font-mono">${Number(d.amount).toLocaleString()} ₸</td><td>${d.created_by}</td><td class="text-right"><button class="btn-dark btn-sm success-text ml-auto" onclick="app.debts.closeDebt(${d.id})">ПОГАСИТЬ</button></td></tr>`).join('');
            let total = app.state.debts.reduce((sum, d) => sum + Number(d.amount), 0);
            if($('f-debts')) $('f-debts').innerText = total.toLocaleString() + ' ₸'; if($('head-debts')) $('head-debts').innerText = total.toLocaleString() + ' ₸';
        },
        closeDebt: async (id) => {
            app.ui.playSound('pay');
            try {
                await supabase.from('debts').update({ status: 'ПОГАШЕН' }).eq('id', id);
                app.ui.toast('Долг погашен', 'success'); app.refreshFinanceArchiveCache();
            } catch(e) { app.ui.toast('Ошибка БД', 'danger'); }
        }
    },

    // НАВИГАЦИОННАЯ СИСТЕМА
    switchTab: (tabId) => {
        $$('.nav-btn, .m-nav-item').forEach(b => b.classList.remove('active'));
        $$(`[data-tab="${tabId}"]`).forEach(b => b.classList.add('active'));
        $$('.tab-pane').forEach(p => p.classList.add('hidden'));
        let tab = $(`tab-${tabId}`); if (tab) tab.classList.remove('hidden');
        if(tabId === 'stock') app.pos.updateTargetOptions();
    },

    setupNavigation: () => {
        window.app = app;
        $$('.nav-btn, .m-nav-item').forEach(btn => {
            btn.addEventListener('click', (e) => { if(e.currentTarget.dataset.tab) app.switchTab(e.currentTarget.dataset.tab); });
        });
        $$('#pos-filter-buttons button').forEach(btn => {
            btn.addEventListener('click', (e) => { app.pos.renderItems(e.currentTarget.dataset.cat); });
        });
    }
};

window.onload = app.init;
