import { supabase, session, loadSession, saveSession } from './supabase.js';
import { initAuth } from './modules/auth.js';
import { initTables } from './modules/tables.js';

const $ = i => document.getElementById(i);
const $$ = s => document.querySelectorAll(s);

const app = {
    session: session, loadSession: loadSession, saveSession: saveSession,
    state: { tables: [], activeChecks: [], archivedChecks: [], inventory: [], cart: [], tariffs: { day_start: 10, day_end: 18, day_price: 2000, night_price: 3000 }, shiftStart: Date.now() },

    init: async () => {
        app.auth.checkSession();
        app.setupNavigation();
        app.setupHotkeys();
        
        const { data: settings } = await supabase.from('settings').select('*').single();
        if(settings) app.state.tariffs = settings;

        // ЗАГРУЗКА БАЗЫ
        const { data: tables } = await supabase.from('tables').select('*').order('id');
        if(tables) { app.state.tables = tables; app.render(); }

        const { data: checks } = await supabase.from('active_checks').select('*');
        if(checks) { app.state.activeChecks = checks; app.renderChecks(); }

        const today = new Date().toISOString().split('T')[0];
        const { data: archive } = await supabase.from('archived_checks').select('*').gte('closed_at', today).order('closed_at', { ascending: false });
        if(archive) { app.state.archivedChecks = archive; }

        // ЗАГРУЗКА СКЛАДА
        const { data: inv } = await supabase.from('inventory').select('*').eq('is_active', true).order('name');
        if(inv) { app.state.inventory = inv; app.pos.renderItems(); }

        // ПОДПИСКИ
        supabase.channel('public:tables').on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tables' }, payload => {
            const index = app.state.tables.findIndex(t => t.id === payload.new.id);
            if(index !== -1) app.state.tables[index] = payload.new;
            app.tables.render(); 
            app.pos.updateTargetOptions(); // Обновить список столов в кассе
        }).subscribe();

        supabase.channel('public:active_checks').on('postgres_changes', { event: '*', schema: 'public', table: 'active_checks' }, () => {
            supabase.from('active_checks').select('*').then(({data}) => {
                if(data) { app.state.activeChecks = data; app.renderChecks(); }
            });
        }).subscribe();

        setInterval(() => {
            let clock = $('live-clock');
            if (clock) clock.innerText = new Date().toLocaleTimeString('ru-RU').slice(0,5);
            app.tick();
        }, 1000);
    },

    setupHotkeys: () => {
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') app.closeModals();
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
        openSidePanel: (id) => { $(id).classList.add('active'); },
        closeSidePanel: (id) => { $(id).classList.remove('active'); },
        playSound: (type) => {
            try {
                const ctx = new (window.AudioContext || window.webkitAudioContext)();
                const osc = ctx.createOscillator(); const gain = ctx.createGain();
                osc.connect(gain); gain.connect(ctx.destination);
                if(type === 'start') { osc.frequency.setValueAtTime(600, ctx.currentTime); osc.type = 'sine'; gain.gain.setValueAtTime(0.02, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1); osc.start(); osc.stop(ctx.currentTime + 0.1); }
                if(type === 'pay') { osc.frequency.setValueAtTime(800, ctx.currentTime); osc.frequency.setValueAtTime(1200, ctx.currentTime + 0.1); osc.type = 'square'; gain.gain.setValueAtTime(0.02, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2); osc.start(); osc.stop(ctx.currentTime + 0.2); }
            } catch(e){}
        }
    },

    closeModals: () => {
        $$('.side-panel').forEach(p => p.classList.remove('active'));
        $$('.overlay').forEach(p => p.classList.add('hidden'));
    },

    // ЛОГИКА POS КАССЫ (БАР)
    pos: {
        renderItems: () => {
            const grid = $('pos-items-grid');
            if(!grid) return;
            if(app.state.inventory.length === 0) {
                grid.innerHTML = '<div class="muted-text">Склад пуст</div>'; return;
            }
            grid.innerHTML = app.state.inventory.map(item => `
                <div class="pos-item" onclick="app.pos.addToCart(${item.id})">
                    <div class="pos-item-name">${item.name}</div>
                    <div class="pos-item-price">${item.price} ₸</div>
                    <div class="pos-item-stock mt-auto">Остаток: ${item.stock}</div>
                </div>
            `).join('');
        },

        addToCart: (id) => {
            app.ui.playSound('start');
            let item = app.state.inventory.find(i => i.id === id);
            if(!item) return;
            let existing = app.state.cart.find(c => c.id === id);
            if(existing) {
                existing.qty++;
            } else {
                app.state.cart.push({ id: item.id, name: item.name, price: item.price, qty: 1 });
            }
            app.pos.renderCart();
        },

        changeQty: (id, delta) => {
            let index = app.state.cart.findIndex(c => c.id === id);
            if(index !== -1) {
                app.state.cart[index].qty += delta;
                if(app.state.cart[index].qty <= 0) app.state.cart.splice(index, 1);
                app.pos.renderCart();
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
                        <button class="qty-btn" onclick="app.pos.changeQty(${c.id}, -1)">-</button>
                        <div class="qty-val">${c.qty}</div>
                        <button class="qty-btn" onclick="app.pos.changeQty(${c.id}, 1)">+</button>
                    </div>
                </div>`;
            }).join('');
            totalEl.innerText = total.toLocaleString() + ' ₸';
        },

        updateTargetOptions: () => {
            const select = $('pos-target');
            if(!select) return;
            let currentVal = select.value;
            let html = '<option value="none">🧾 БЫСТРЫЙ ЧЕК (БАР)</option>';
            app.state.tables.forEach(t => {
                if(t.status === 'В ИГРЕ') html += `<option value="${t.id}">🎱 СТОЛ ${t.id}</option>`;
            });
            select.innerHTML = html;
            // Восстанавливаем выбор, если стол еще в игре
            if(app.state.tables.find(t => t.id == currentVal && t.status === 'В ИГРЕ')) {
                select.value = currentVal;
            } else {
                select.value = 'none';
            }
            app.pos.updateTargetUI();
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

        // Прямая продажа с бара
        checkout: async (method) => {
            if(app.state.cart.length === 0) return app.ui.toast('Корзина пуста', 'danger');
            let total = app.state.cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
            
            app.ui.playSound('pay');
            
            // В реальной системе тут нужно списывать stock из inventory
            // Упрощенно просто создаем чек в архиве
            await supabase.from('archived_checks').insert([{
                id: Date.now(),
                table_id: 'БАР',
                guest_name: 'Гость бара',
                time_amount: 0,
                bar_amount: total,
                total: total,
                pay_method: method,
                created_by: app.session.user.name
            }]);

            app.ui.toast(`Продажа бара успешна (${method})`, 'success');
            app.state.cart = [];
            app.pos.renderCart();
        },

        // Добавление в счет стола
        sendToTable: async () => {
            let tableId = $('pos-target').value;
            if(tableId === 'none' || app.state.cart.length === 0) return;
            
            let total = app.state.cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
            let t = app.state.tables.find(x => x.id == tableId);
            if(!t) return;

            let newBarSum = (t.bar_amount || 0) + total;
            
            app.ui.playSound('start');
            await supabase.from('tables').update({ bar_amount: newBarSum }).eq('id', tableId);
            
            app.ui.toast(`Добавлено на Стол ${tableId} (${total} ₸)`, 'success');
            app.state.cart = [];
            app.pos.renderCart();
            app.switchTab('hall'); // Возвращаемся в зал
        }
    },

    renderChecks: () => {
        const list = $('waiting-payments-list');
        const count = $('waiting-count');
        if (!list || !count) return;
        count.innerText = app.state.activeChecks.length;
        if (app.state.activeChecks.length === 0) {
            list.innerHTML = '<div class="muted-text py-10 w-100">Все счета оплачены</div>';
            return;
        }
        
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
                    <button class="btn-dark btn-sm success-text" onclick="app.confirmPay('НАЛ', ${c.id})">💵 НАЛ</button>
                    <button class="btn-dark btn-sm blue-text" onclick="app.confirmPay('QR', ${c.id})">📱 QR</button>
                    <button class="btn-dark btn-sm" onclick="app.ui.toast('Чек в WhatsApp', 'success')">🧾 ЧЕК</button>
                </div>
            </div>`;
        }).join('');
    },

    confirmPay: async (method, overrideId = null) => {
        let id = overrideId || $('pay-check-id').value;
        if (!id) return;
        
        let checkToArchive = app.state.activeChecks.find(c => c.id == id);
        if (!checkToArchive) return;

        app.ui.playSound('pay');

        await supabase.from('archived_checks').insert([{
            id: checkToArchive.id,
            table_id: checkToArchive.table_id,
            guest_name: checkToArchive.guest_name,
            time_amount: checkToArchive.time_amount,
            bar_amount: checkToArchive.bar_amount || 0,
            total: checkToArchive.total,
            pay_method: method,
            created_by: checkToArchive.created_by,
            played_ms: checkToArchive.played_ms
        }]);

        await supabase.from('active_checks').delete().eq('id', id);
        
        app.closeModals();
        app.ui.toast(`Оплата ${method} проведена`, 'success');
    },

    math: {
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
        }
    },

    tick: () => {
        if (!app.session.isAuth) return;
        let liveRevenue = 0;
        let activeCount = 0;
        let barTotal = 0;
        
        app.state.tables.forEach(t => {
            if (t.status === 'В ИГРЕ') {
                activeCount++;
                let ms = (t.accumulated_time || 0);
                if (!t.paused) ms += (Date.now() - t.started_at);
                
                let rent = app.math.getCost(t);
                let bar = t.bar_amount || 0;
                let total = rent + bar;
                
                liveRevenue += rent;
                barTotal += bar;
                
                let timerEl = $(`timer-${t.id}`);
                let sumEl = $(`sum-${t.id}`);
                if (timerEl) {
                    timerEl.innerText = app.math.formatTime(ms);
                    timerEl.className = 't-timer ' + (ms < 3600000 ? 'timer-green' : (ms < 10800000 ? 'timer-yellow' : 'timer-red'));
                }
                if (sumEl) sumEl.innerText = total.toLocaleString() + " ₸";
            }
        });
        
        if($('head-tables-rev')) $('head-tables-rev').innerText = liveRevenue.toLocaleString() + " ₸";
        if($('head-bar')) $('head-bar').innerText = barTotal.toLocaleString() + " ₸";
        if($('head-total')) $('head-total').innerText = (liveRevenue + barTotal).toLocaleString() + " ₸";
    },

    switchTab: (tabId) => {
        $$('.nav-btn, .m-nav-item').forEach(b => b.classList.remove('active'));
        $$(`[data-tab="${tabId}"]`).forEach(b => b.classList.add('active'));
        $$('.tab-pane').forEach(p => p.classList.add('hidden'));
        let tab = $(`tab-${tabId}`);
        if (tab) tab.classList.remove('hidden');
        if(tabId === 'stock' && app.pos) app.pos.updateTargetOptions(); // Обновляем селект в кассе
    },

    setupNavigation: () => {
        window.app.switchTab = app.switchTab;
        $$('.nav-btn, .m-nav-item').forEach(btn => {
            btn.addEventListener('click', (e) => {
                app.switchTab(e.currentTarget.dataset.tab);
            });
        });
        if($('btn-logout')) $('btn-logout').onclick = () => app.auth.logout();
    },

    render: () => {
        if (!app.session.isAuth) {
            $('authScreen').classList.remove('hidden');
            $('appScreen').classList.add('hidden');
            app.auth.renderStaff(); 
        } else {
            $('authScreen').classList.add('hidden'); 
            $('appScreen').classList.remove('hidden');
            $('userName').innerText = app.session.user.name;
            if(!app.state.shiftStart) app.state.shiftStart = Date.now();
            $$('.owner-only').forEach(el => { el.style.display = app.session.user.role === 'owner' ? 'inline-block' : 'none'; });
            app.tables.render();
            app.renderChecks();
            app.pos.updateTargetOptions();
        }
    }
};

app.auth = initAuth(app, supabase);
app.tables = initTables(app, supabase);
window.app = app;
window.onload = app.init;
