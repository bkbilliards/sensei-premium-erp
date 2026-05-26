import { supabase, session, loadSession, saveSession } from './supabase.js';

const $ = i => document.getElementById(i);
const $$ = s => document.querySelectorAll(s);

const app = {
    session: session, loadSession: loadSession, saveSession: saveSession,
    state: { tables: [], activeChecks: [], archivedChecks: [], inventory: [], cart: [], guests: [], debts: [], shiftStart: Date.now() },

    init: async () => {
        app.checkSession();
        app.setupNavigation();
        app.setupHotkeys(); 
        
        // 1. ЗАГРУЗКА БАЗ
        const { data: tables } = await supabase.from('tables').select('*').order('id');
        if(tables) { app.state.tables = tables; app.renderTables(); }

        const { data: checks } = await supabase.from('active_checks').select('*');
        if(checks) { app.state.activeChecks = checks; app.renderChecks(); }

        const today = new Date().toISOString().split('T')[0];
        const { data: archive } = await supabase.from('archived_checks').select('*').gte('closed_at', today).order('closed_at', { ascending: false });
        if(archive) { app.state.archivedChecks = archive; app.renderArchive(); }

        const { data: inv } = await supabase.from('inventory').select('*').eq('is_active', true).order('name');
        if(inv) { app.state.inventory = inv; app.renderPosItems(); app.renderInventory(); app.populatePurItemSelect(); }

        const { data: guests } = await supabase.from('guests').select('*').order('name');
        if(guests) { app.state.guests = guests; app.renderCrm(); app.populateGuestDatalist(); }

        const { data: debts } = await supabase.from('debts').select('*').eq('status', 'АКТИВЕН').order('created_at', { ascending: false });
        if(debts) { app.state.debts = debts; app.renderDebts(); }

        // Генерация стартовых логов для ощущения живой системы
        setTimeout(() => {
            if($('activity-feed') && $('activity-feed').children.length === 0) {
                app.logActivity('Смена открыта', '🔓');
            }
        }, 1000);

        // 2. ПОДПИСКИ REALTIME
        supabase.channel('public:tables').on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tables' }, payload => {
            const index = app.state.tables.findIndex(t => t.id === payload.new.id);
            if(index !== -1) app.state.tables[index] = payload.new;
            app.renderTables(); 
            app.updateTargetOptions(); 
        }).subscribe();

        supabase.channel('public:active_checks').on('postgres_changes', { event: '*', schema: 'public', table: 'active_checks' }, () => {
            supabase.from('active_checks').select('*').then(({data}) => { if(data) { app.state.activeChecks = data; app.renderChecks(); } });
        }).subscribe();

        supabase.channel('public:archived_checks').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'archived_checks' }, payload => {
            app.state.archivedChecks.unshift(payload.new); app.renderArchive();
        }).subscribe();

        // 3. ТАЙМЕРЫ И ЧАСЫ
        setInterval(() => {
            let clock = $('live-clock');
            if (clock) clock.innerText = new Date().toLocaleTimeString('ru-RU').slice(0,5);
            let shiftClock = $('shift-clock');
            if (shiftClock && app.session.isAuth) {
                let ms = Date.now() - app.state.shiftStart;
                let h = Math.floor(ms / 3600000);
                let m = Math.floor((ms % 3600000) / 60000);
                shiftClock.innerText = `СМЕНА: ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
            }
            app.tickTables();
        }, 1000);
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
            
            // Права доступа
            if (app.session.user.role !== 'owner') {
                $$('.owner-only').forEach(el => el.style.display = 'none');
            } else {
                $$('.owner-only').forEach(el => el.style.display = 'flex');
            }
            
            app.renderTables();
            app.renderChecks();
        }
    },

    renderStaff: async () => {
        const { data } = await supabase.from('users').select('id, name, role');
        const sel = $('staffSelect');
        if(sel && data) sel.innerHTML = data.map(u => `<option value="${u.id}">${u.name} (${u.role})</option>`).join('');
        if($('btn-login')) {
            $('btn-login').onclick = async () => {
                const uid = sel.value; const pin = $('pinInput').value;
                const { data: user } = await supabase.from('users').select('*').eq('id', uid).eq('pin', pin).single();
                if(user) {
                    app.session.isAuth = true; app.session.user = user; app.saveSession();
                    app.ui.toast('Авторизация успешна', 'success');
                    app.checkSession();
                } else {
                    app.ui.toast('Неверный PIN', 'danger');
                }
            };
        }
    },

    logout: () => {
        app.session.isAuth = false; app.session.user = null; app.saveSession();
        location.reload();
    },

    // ГОРЯЧИЕ КЛАВИШИ И ЗВУКИ
    setupHotkeys: () => {
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') app.closeModals();
            if (e.key === 'Enter') {
                const payModal = $('modal-pay');
                if (payModal && !payModal.classList.contains('hidden')) app.confirmPayActiveCheck('НАЛ');
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
            setTimeout(() => t.remove(), 2500);
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

    closeModals: () => {
        $$('.overlay').forEach(p => p.classList.add('hidden'));
    },

    logActivity: (text, icon = '⚪') => {
        const createFeedItem = (listId) => {
            const feed = $(listId); if(!feed) return;
            const time = new Date().toLocaleTimeString('ru-RU').slice(0,5);
            const item = document.createElement('div');
            item.className = `feed-item`;
            item.innerHTML = `<span class="feed-time">${time}</span> <span class="feed-icon">${icon}</span> <span class="text-white">${text}</span>`;
            feed.prepend(item);
            if(feed.children.length > 30) feed.lastChild.remove();
        }
        createFeedItem('activity-feed');
        createFeedItem('finance-activity-feed');
    },

    // 1. БЛОК: СТОЛЫ (ЗАЛ)
    renderTables: () => {
        const grid = $('tablesGrid');
        if (!grid || !app.state.tables) return;
        grid.innerHTML = app.state.tables.sort((a,b)=>a.id-b.id).map(t => {
            let isPlaying = t.status === 'В ИГРЕ';
            let isPaused = t.paused;
            let cls = isPlaying ? (isPaused ? 'paused' : 'playing') : 'free';
            let rentCost = isPlaying ? app.getCost(t) : 0;
            let barCost = t.bar_amount || 0;
            let totalCost = rentCost + barCost;
            
            let btnsFree = `
                <button class="btn-gold flex-1" onclick="app.startTable(${t.id})">▶ ПУСК</button>
                <button class="btn-dark" style="width: 50px;" onclick="app.openManageTable(${t.id})">⚙</button>`;
            
            let btnsActive = `
                <button class="btn-dark" style="width: 50px;" onclick="app.pauseTable(${t.id})">${isPaused ? '▶' : '⏸'}</button>
                <button class="btn-dark" style="flex: 1;" onclick="app.openBarForTable(${t.id})">🍹 БАР</button>
                <button class="btn-danger" style="flex: 1;" onclick="app.openStopPanel(${t.id})">💳 СЧЕТ</button>
                <button class="btn-dark" style="width: 50px;" onclick="app.openManageTable(${t.id})">⚙</button>`;

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
                            <div class="flex-row justify-center gap-10 mt-5">
                                <span class="t-cost gold-text font-mono">${totalCost.toLocaleString()} ₸</span>
                            </div>
                            ${barCost > 0 ? `<div class="muted-text text-10 mt-5">БАР: ${barCost.toLocaleString()} ₸</div>` : ''}
                        ` : `
                            <div class="t-idle-text muted-text">СВОБОДЕН</div>
                        `}
                    </div>
                    <div class="flex-row mt-auto pt-15" style="border-top: 1px solid rgba(255,255,255,0.05);">
                        ${isPlaying ? btnsActive : btnsFree}
                    </div>
                </div>
            </div>`;
        }).join('');
    },

    startTable: async (id) => {
        app.ui.playSound('start');
        await supabase.from('tables').update({ 
            status: 'В ИГРЕ', started_at: Date.now(), accumulated_cost: 0, accumulated_time: 0, bar_amount: 0, paused: false,
            current_players: 2, active_check_id: `Гость`
        }).eq('id', id);
        app.ui.toast(`Стол ${id} запущен`, 'success');
        app.logActivity(`Запущен Стол ${id}`, '🟢');
        if(!$('modal-manage-table').classList.contains('hidden')) app.closeModals();
    },

    pauseTable: async (id) => {
        let t = app.state.tables.find(x => x.id === id);
        if(!t) return;
        if (t.paused) {
            await supabase.from('tables').update({ paused: false, started_at: Date.now() }).eq('id', id);
            app.ui.toast(`Игра продолжена`, 'success');
            app.logActivity(`Продолжение: Стол ${id}`, '▶');
        } else {
            let ms = (t.accumulated_time || 0) + (Date.now() - t.started_at);
            let cost = app.getCost(t);
            await supabase.from('tables').update({ paused: true, accumulated_time: ms, accumulated_cost: cost, started_at: null }).eq('id', id);
            app.ui.toast(`Стол на паузе`, 'warning');
            app.logActivity(`Пауза: Стол ${id}`, '⏸');
        }
        if(!$('modal-manage-table').classList.contains('hidden')) app.closeModals();
    },

    openManageTable: (id) => {
        let t = app.state.tables.find(x => x.id === id);
        $('m-table-id').innerText = id;
        
        if (t.status === 'В ИГРЕ') {
            $('m-actions-active').classList.remove('hidden');
            $('m-actions-free').classList.add('hidden');
            let ms = (t.accumulated_time || 0) + (Date.now() - t.started_at);
            $('m-table-timer').innerText = app.formatTime(ms);
            $('m-table-cost').innerText = (app.getCost(t) + (t.bar_amount || 0)).toLocaleString() + ' ₸';
        } else {
            $('m-actions-active').classList.add('hidden');
            $('m-actions-free').classList.remove('hidden');
            $('m-table-timer').innerText = '--:--:--';
            $('m-table-cost').innerText = t.accumulated_cost ? t.accumulated_cost + ' ₸' : 'Ожидание';
        }
        app.ui.openModal('modal-manage-table');
    },

    openStopPanel: (id) => {
        let t = app.state.tables.find(x => x.id === id);
        if(!t) t = app.state.tables.find(x => x.id === parseInt($('m-table-id').innerText)); // Fallback if called from manage
        if(!t) return;
        
        app.closeModals();
        let rent = app.getCost(t);
        let bar = t.bar_amount || 0;
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
        let rent = app.getCost(t);
        let bar = t.bar_amount || 0;
        let total = rent + bar;
        let playedMs = (t.accumulated_time || 0) + (Date.now() - t.started_at);

        await supabase.from('active_checks').insert([{
            id: Date.now(), table_id: id.toString(), guest_name: name, time_amount: rent, bar_amount: bar, total: total, created_by: app.session.user.name, 
            created_at: new Date().toISOString(), played_ms: playedMs 
        }]);

        await supabase.from('tables').update({ 
            status: 'СВОБОДЕН', started_at: null, accumulated_cost: total, accumulated_time: 0, bar_amount: 0, paused: false, active_check_id: null 
        }).eq('id', id);

        app.closeModals();
        app.ui.playSound('pay');
        app.ui.toast(`Счет передан на кассу`, 'success');
        app.logActivity(`Остановлен: Стол ${id}`, '⏹');
    },

    openBarForTable: (id) => {
        let tid = id || parseInt($('m-table-id').innerText);
        app.closeModals();
        app.switchTab('stock');
        let select = $('pos-target');
        if(select) { select.value = tid; app.updateTargetUI(); }
    },

    // МАТЕМАТИКА И ТАЙМЕРЫ
    getCost: (t) => {
        if (!t.started_at) return t.accumulated_cost || 0;
        let cost = t.accumulated_cost || 0;
        if (!t.paused) {
            let ms = t.started_at; 
            let end = Date.now(); 
            let cMs = ms; 
            let tDayS = app.state.tariffs.day_start; 
            let tDayE = app.state.tariffs.day_end; 
            let pDay = app.state.tariffs.day_price; 
            let pNight = app.state.tariffs.night_price;
            while(cMs < end) { 
                let h = new Date(cMs).getHours(); 
                let rate = (h >= tDayS && h < tDayE) ? pDay : pNight; 
                cost += rate / 60; cMs += 60000; 
            }
        }
        return Math.ceil(cost / 50) * 50; 
    },
    
    formatTime: (ms) => { 
        let s = Math.floor(ms / 1000); 
        let h = Math.floor(s / 3600);
        let m = Math.floor((s % 3600) / 60);
        let sec = s % 60;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`; 
    },

    tickTables: () => {
        if (!app.session.isAuth) return;
        let liveRevenue = 0; let liveBar = 0; let activeCount = 0;
        
        app.state.tables.forEach(t => {
            if (t.status === 'В ИГРЕ') {
                activeCount++;
                let ms = (t.accumulated_time || 0);
                if (!t.paused) ms += (Date.now() - t.started_at);
                
                let rent = app.getCost(t);
                let bar = t.bar_amount || 0;
                let total = rent + bar;
                liveRevenue += rent; liveBar += bar;
                
                let timerEl = $(`timer-${t.id}`);
                let sumEl = $(`sum-${t.id}`);
                if (timerEl) timerEl.innerText = app.formatTime(ms);
                if (sumEl) sumEl.innerText = total.toLocaleString() + " ₸";
            }
        });
        
        if($('head-tables-rev')) $('head-tables-rev').innerText = liveRevenue.toLocaleString() + " ₸";
        if($('head-bar')) $('head-bar').innerText = liveBar.toLocaleString() + " ₸";
        if($('head-total')) $('head-total').innerText = (liveRevenue + liveBar).toLocaleString() + " ₸";
    },

    // 2. БЛОК: POS КАССА (БАР)
    renderPosItems: (category = 'Все') => {
        const grid = $('pos-items-grid');
        if(!grid) return;
        let items = app.state.inventory;
        if(category !== 'Все') items = items.filter(i => i.category === category);
        
        if(items.length === 0) { grid.innerHTML = '<div class="muted-text">Пусто</div>'; return; }
        
        grid.innerHTML = items.map(item => {
            let stockClass = item.stock <= 0 ? 'danger' : (item.stock <= 5 ? 'warning' : 'success');
            let stockText = item.stock <= 0 ? 'НЕТ' : item.stock;
            let isOut = item.stock <= 0 ? 'out-of-stock' : '';
            let icon = '🥤';
            if(item.category === 'Снеки') icon = '🍫';
            if(item.category === 'Кальян') icon = '💨';
            if(item.category === 'Чай') icon = '🫖';
            return `
            <div class="pos-item ${isOut}" onclick="${item.stock > 0 ? `app.addToCart(${item.id})` : ''}">
                <div class="item-badge ${stockClass}">${stockText} шт</div>
                <div class="item-icon">${icon}</div>
                <div class="pos-item-name">${item.name}</div>
                <div class="pos-item-price">${item.price} ₸</div>
                <div class="pos-add-btn">+ В КОРЗИНУ</div>
            </div>`;
        }).join('');
    },

    renderPos: (category) => {
        app.renderPosItems(category);
    },

    addToCart: (id) => {
        app.ui.playSound('start');
        let item = app.state.inventory.find(i => i.id === id);
        if(!item || item.stock <= 0) return;
        let existing = app.state.cart.find(c => c.id === id);
        if(existing) {
            if (existing.qty < item.stock) existing.qty++;
            else app.ui.toast('Недостаточно на складе', 'danger');
        } else {
            app.state.cart.push({ id: item.id, name: item.name, price: item.price, qty: 1, cost_price: item.cost_price });
        }
        app.renderCart();
    },

    changeCartQty: (id, delta) => {
        let index = app.state.cart.findIndex(c => c.id === id);
        if(index !== -1) {
            let item = app.state.inventory.find(i => i.id === id);
            if (delta > 0 && app.state.cart[index].qty >= item.stock) return app.ui.toast('Недостаточно на складе', 'danger');
            app.state.cart[index].qty += delta;
            if(app.state.cart[index].qty <= 0) app.state.cart.splice(index, 1);
            app.renderCart();
        }
    },

    renderCart: () => {
        const list = $('pos-cart-list');
        const totalEl = $('pos-total');
        if(!list || !totalEl) return;
        
        let total = 0;
        if(app.state.cart.length === 0) {
            list.innerHTML = '<div class="muted-text text-center py-20">Корзина пуста</div>';
            totalEl.innerText = '0 ₸';
            return;
        }

        list.innerHTML = app.state.cart.map(c => {
            total += (c.price * c.qty);
            return `
            <div class="cart-item">
                <div class="cart-item-info">
                    <div class="cart-item-name">${c.name}</div>
                    <div class="cart-item-price">${c.price} ₸</div>
                </div>
                <div class="qty-controls">
                    <button class="qty-btn" onclick="app.changeCartQty(${c.id}, -1)">-</button>
                    <div class="qty-val">${c.qty}</div>
                    <button class="qty-btn" onclick="app.changeCartQty(${c.id}, 1)">+</button>
                </div>
            </div>`;
        }).join('');
        totalEl.innerText = total.toLocaleString() + ' ₸';
    },

    updateTargetOptions: () => {
        const select = $('pos-target');
        if(!select) return;
        let currentVal = select.value;
        let html = '<option value="none">📍 БЫСТРЫЙ ЧЕК (БАР)</option>';
        app.state.tables.forEach(t => { if(t.status === 'В ИГРЕ') html += `<option value="${t.id}">🎱 СТОЛ ${t.id}</option>`; });
        select.innerHTML = html;
        if(app.state.tables.find(t => t.id == currentVal && t.status === 'В ИГРЕ')) select.value = currentVal;
        else select.value = 'none';
        app.updateTargetUI();
    },

    updateTargetUI: () => {
        let val = $('pos-target').value;
        if(val === 'none') {
            $('pos-actions-quick').classList.remove('hidden');
            $('pos-actions-table').classList.add('hidden');
        } else {
            $('pos-actions-quick').classList.add('hidden');
            $('pos-actions-table').classList.remove('hidden');
        }
    },

    checkoutCart: async (method) => {
        if(app.state.cart.length === 0) return app.ui.toast('Корзина пуста', 'danger');
        let total = app.state.cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
        let guest = $('pos-guest').value.trim() || 'Гость бара';
        app.ui.playSound('pay');
        
        if (method === 'ДОЛГ') {
            await supabase.from('debts').insert([{ guest_name: guest, amount: total, created_by: app.session.user.name }]);
        }

        await supabase.from('archived_checks').insert([{
            id: Date.now(), table_id: 'БАР', guest_name: guest, time_amount: 0, bar_amount: total, total: total, pay_method: method, created_by: app.session.user.name
        }]);

        for(let item of app.state.cart) {
            let dbItem = app.state.inventory.find(i => i.id === item.id);
            if(dbItem) await supabase.from('inventory').update({stock: dbItem.stock - item.qty}).eq('id', item.id);
        }

        app.ui.toast(`Оплата ${method} успешна`, 'success');
        app.logActivity(`Бар: Оплата ${method} (${total} ₸)`, '🍹');
        app.state.cart = [];
        app.renderCart();
        
        const { data: inv } = await supabase.from('inventory').select('*').eq('is_active', true).order('name');
        if(inv) { app.state.inventory = inv; app.renderPosItems(); app.renderInventory(); }
    },

    sendCartToTable: async () => {
        let tableId = $('pos-target').value;
        if(tableId === 'none' || app.state.cart.length === 0) return;
        let total = app.state.cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
        let t = app.state.tables.find(x => x.id == tableId);
        if(!t) return;

        let newBarSum = (t.bar_amount || 0) + total;
        app.ui.playSound('start');
        await supabase.from('tables').update({ bar_amount: newBarSum }).eq('id', tableId);
        
        for(let item of app.state.cart) {
            let dbItem = app.state.inventory.find(i => i.id === item.id);
            if(dbItem) await supabase.from('inventory').update({stock: dbItem.stock - item.qty}).eq('id', item.id);
        }
        
        app.ui.toast(`Добавлено на Стол ${tableId}`, 'success');
        app.logActivity(`Бар -> Стол ${tableId} (${total} ₸)`, '🍹');
        app.state.cart = [];
        app.renderCart();
        
        const { data: inv } = await supabase.from('inventory').select('*').eq('is_active', true).order('name');
        if(inv) { app.state.inventory = inv; app.renderPosItems(); app.renderInventory(); }
        app.switchTab('hall');
    },

    // 3. БЛОК: КАССА ЗАЛА И АРХИВ
    renderChecks: () => {
        const list = $('waiting-payments-list');
        const count = $('waiting-count');
        if (!list || !count) return;
        count.innerText = app.state.activeChecks.length;
        if (app.state.activeChecks.length === 0) { list.innerHTML = '<div class="muted-text py-10 w-100">Все счета оплачены</div>'; return; }
        
        list.innerHTML = app.state.activeChecks.map(c => {
            let msWaited = Date.now() - new Date(c.created_at).getTime();
            let urgencyClass = msWaited > 1800000 ? 'urgency-red' : (msWaited > 600000 ? 'urgency-yellow' : '');
            return `
            <div class="payment-row ${urgencyClass}">
                <div class="payment-info">
                    <span class="badge" style="background: rgba(255,255,255,0.05); color: var(--gray);">🎱 Ст. ${c.table_id}</span>
                    <b class="text-white text-12">${c.guest_name}</b>
                </div>
                <div class="payment-sum font-mono">${c.total.toLocaleString()} ₸</div>
                <div class="payment-actions">
                    <button class="btn-dark btn-sm success-text" onclick="app.openPayActiveCheck(${c.id})">💳 ОПЛАТИТЬ</button>
                </div>
            </div>`;
        }).join('');
    },

    openPayActiveCheck: (id) => {
        let c = app.state.activeChecks.find(x => x.id === id);
        if(!c) return;
        $('pay-check-id').value = id;
        $('pay-sum').innerText = c.total.toLocaleString() + ' ₸';
        app.ui.openModal('modal-pay');
    },

    confirmPayActiveCheck: async (method) => {
        let id = $('pay-check-id').value;
        if (!id) return;
        let checkToArchive = app.state.activeChecks.find(c => c.id == id);
        if (!checkToArchive) return;

        app.ui.playSound('pay');

        if (method === 'ДОЛГ') {
            await supabase.from('debts').insert([{ guest_name: checkToArchive.guest_name || 'Гость', amount: checkToArchive.total, created_by: app.session.user.name }]);
        }

        await supabase.from('archived_checks').insert([{
            id: checkToArchive.id, table_id: checkToArchive.table_id, guest_name: checkToArchive.guest_name, time_amount: checkToArchive.time_amount, bar_amount: checkToArchive.bar_amount, total: checkToArchive.total, pay_method: method, created_by: checkToArchive.created_by, played_ms: checkToArchive.played_ms
        }]);

        await supabase.from('active_checks').delete().eq('id', id);
        app.closeModals();
        app.ui.toast(`Оплата ${method} проведена`, 'success');
        app.logActivity(`Оплата чека (${method})`, '🟢');
        
        const { data: debts } = await supabase.from('debts').select('*').eq('status', 'АКТИВЕН').order('created_at', { ascending: false });
        if(debts) { app.state.debts = debts; app.renderDebts(); }
    },

    renderArchive: () => {
        const listDesktop = $('archive-list');
        const listMobile = $('archive-mobile-list');
        if (!listDesktop || !listMobile) return;

        let totalSum = 0; let profit = 0;

        if (app.state.archivedChecks.length === 0) {
            listDesktop.innerHTML = '<tr><td colspan="10" class="text-center py-15 muted-text">Чеков пока нет</td></tr>';
            listMobile.innerHTML = '<div class="muted-text text-center py-15">Чеков пока нет</div>';
        } else {
            let desktopHTML = ''; let mobileHTML = '';
            app.state.archivedChecks.forEach(c => {
                let total = Number(c.total); let bar = Number(c.bar_amount || 0); let rent = Number(c.time_amount || total);
                totalSum += total; profit += bar; // Упрощенный расчет прибыли бара для демо
                
                let timeStr = new Date(c.closed_at).toLocaleTimeString('ru-RU').slice(0,5);
                let tagClass = c.pay_method === 'НАЛ' ? 'nal' : 'qr';
                let dur = app.formatTime(c.played_ms || 0).slice(0,5);

                desktopHTML += `
                <tr>
                    <td class="muted-text font-mono">${timeStr}</td>
                    <td><b>Ст. ${c.table_id}</b></td>
                    <td>${c.guest_name}</td>
                    <td class="gray-text">${rent.toLocaleString()} ₸</td>
                    <td class="gray-text">${bar.toLocaleString()} ₸</td>
                    <td class="gold-text bold text-14">${total.toLocaleString()} ₸</td>
                    <td><span class="pay-tag ${tagClass}">${c.pay_method}</span></td>
                    <td class="text-right muted-text">${c.created_by}</td>
                </tr>`;

                mobileHTML += `
                <div class="glass-card" style="padding: 15px; border-radius: 8px;">
                    <div class="flex-between">
                        <span class="badge" style="background: rgba(255,255,255,0.05); color: var(--gray);">🎱 Ст. ${c.table_id}</span>
                        <span class="muted-text font-mono">${timeStr}</span>
                    </div>
                    <div class="flex-between align-center mt-10">
                        <b class="text-white text-12">${c.guest_name}</b>
                        <b class="gold-text text-18 font-mono">${total.toLocaleString()} ₸</b>
                    </div>
                    <div class="flex-between mt-5">
                        <span class="pay-tag ${tagClass}">${c.pay_method}</span>
                        <span class="muted-text">${c.created_by}</span>
                    </div>
                </div>`;
            });
            listDesktop.innerHTML = desktopHTML; listMobile.innerHTML = mobileHTML;
        }

        if($('f-total')) $('f-total').innerText = totalSum.toLocaleString() + ' ₸';
        if($('f-profit')) $('f-profit').innerText = (profit * 0.4).toLocaleString() + ' ₸'; // Пример 40% маржи
    },

    // 4. БЛОКИ: CRM, ДОЛГИ, СКЛАД
    renderCrm: () => {
        const list = $('crm-list');
        if(!list) return;
        if(app.state.guests.length === 0) { list.innerHTML = '<tr><td colspan="5" class="text-center py-15 muted-text">База пуста</td></tr>'; return; }
        list.innerHTML = app.state.guests.map(g => {
            let status = g.is_blacklisted ? '<span class="badge badge-red">🔴 ЧС</span>' : '<span class="badge badge-green">АКТИВЕН</span>';
            return `<tr>
                <td><b>${g.name}</b></td>
                <td class="font-mono muted-text">${g.phone || '--'}</td>
                <td class="gold-text">${g.discount_percent}%</td>
                <td class="text-white">${Number(g.total_spent).toLocaleString()} ₸</td>
                <td class="text-right">${status}</td>
            </tr>`;
        }).join('');
    },
    populateGuestDatalist: () => {
        const dl = $('guest-datalist');
        if(!dl) return;
        dl.innerHTML = app.state.guests.map(g => `<option value="${g.name}">Скидка: ${g.discount_percent}%</option>`).join('');
    },
    addGuest: async () => {
        let name = $('crm-name').value.trim(); let phone = $('crm-phone').value.trim(); let discount = parseInt($('crm-discount').value) || 0;
        if(!name) return app.ui.toast('Введите имя!', 'danger');
        await supabase.from('guests').insert([{ name, phone, discount_percent: discount }]);
        app.ui.toast('Гость добавлен', 'success');
        app.closeModals();
        const { data: guests } = await supabase.from('guests').select('*').order('name');
        if(guests) { app.state.guests = guests; app.renderCrm(); app.populateGuestDatalist(); }
    },

    renderDebts: () => {
        const list = $('debts-list');
        if(!list) return;
        if(app.state.debts.length === 0) { list.innerHTML = '<tr><td colspan="5" class="text-center py-15 muted-text">Активных долгов нет</td></tr>'; return; }
        list.innerHTML = app.state.debts.map(d => {
            let dateStr = new Date(d.created_at).toLocaleDateString('ru-RU');
            return `<tr>
                <td class="muted-text font-mono">${dateStr}</td>
                <td><b>${d.guest_name}</b></td>
                <td class="danger-text bold">${Number(d.amount).toLocaleString()} ₸</td>
                <td class="muted-text">${d.created_by}</td>
                <td class="text-right"><button class="btn-dark btn-sm success-text ml-auto" onclick="app.payDebt(${d.id})">ПОГАСИТЬ</button></td>
            </tr>`;
        }).join('');
        
        let totalDebts = app.state.debts.reduce((sum, d) => sum + Number(d.amount), 0);
        if($('f-debts')) $('f-debts').innerText = totalDebts.toLocaleString() + ' ₸';
        if($('head-debts')) $('head-debts').innerText = totalDebts.toLocaleString() + ' ₸';
    },
    payDebt: async (id) => {
        app.ui.playSound('pay');
        await supabase.from('debts').update({ status: 'ПОГАШЕН' }).eq('id', id);
        app.ui.toast('Долг успешно погашен', 'success');
        const { data: debts } = await supabase.from('debts').select('*').eq('status', 'АКТИВЕН').order('created_at', { ascending: false });
        app.state.debts = debts || []; app.renderDebts();
    },

    renderInventory: () => {
        const list = $('inventory-list');
        if(!list) return;
        if(app.state.inventory.length === 0) { list.innerHTML = '<tr><td colspan="6" class="text-center py-15 muted-text">Склад пуст</td></tr>'; return; }
        list.innerHTML = app.state.inventory.map(i => {
            let stockClass = i.stock <= 0 ? 'danger-text' : (i.stock <= 5 ? 'warning-text' : 'success-text');
            return `<tr>
                <td class="muted-text">${i.category}</td>
                <td><b>${i.name}</b></td>
                <td class="muted-text">${Number(i.cost_price).toLocaleString()} ₸</td>
                <td class="gold-text">${Number(i.price).toLocaleString()} ₸</td>
                <td class="${stockClass} bold">${i.stock} шт</td>
                <td class="text-right"><span class="badge ${i.stock <= 0 ? 'badge-red' : 'badge-green'}">${i.stock <= 0 ? 'ПУСТО' : 'В НАЛИЧИИ'}</span></td>
            </tr>`;
        }).join('');
    },
    populatePurItemSelect: () => {
        const sel = $('pur-item');
        if(sel) sel.innerHTML = app.state.inventory.map(i => `<option value="${i.id}">${i.name}</option>`).join('');
    },
    addPurchase: async () => {
        let id = parseInt($('pur-item').value); let qty = parseInt($('pur-qty').value); let cost = parseFloat($('pur-cost').value);
        if(!qty || qty <= 0 || !cost) return app.ui.toast('Заполните все поля!', 'danger');
        let item = app.state.inventory.find(i => i.id === id);
        if(!item) return;

        await supabase.from('purchases').insert([{ item_name: item.name, quantity: qty, cost_price: cost, created_by: app.session.user.name }]);
        await supabase.from('inventory').update({ stock: item.stock + qty, cost_price: cost }).eq('id', id);
        
        app.ui.toast(`Оприходовано: ${item.name}`, 'success');
        app.closeModals();
        
        const { data: inv } = await supabase.from('inventory').select('*').eq('is_active', true).order('name');
        if(inv) { app.state.inventory = inv; app.renderPosItems(); app.renderInventory(); }
    },

    // НАВИГАЦИЯ
    switchTab: (tabId) => {
        $$('.nav-btn, .m-nav-item').forEach(b => b.classList.remove('active'));
        $$(`[data-tab="${tabId}"]`).forEach(b => b.classList.add('active'));
        $$('.tab-pane').forEach(p => p.classList.add('hidden'));
        let tab = $(`tab-${tabId}`);
        if (tab) tab.classList.remove('hidden');
        if(tabId === 'stock') app.updateTargetOptions();
    },

    setupNavigation: () => {
        $$('.nav-btn, .m-nav-item').forEach(btn => {
            btn.addEventListener('click', (e) => app.switchTab(e.currentTarget.dataset.tab));
        });
        if($('btn-logout')) $('btn-logout').onclick = () => app.logout();
    }
};

window.app = app;
window.onload = app.init;
