import { supabase, session, loadSession, saveSession } from './supabase.js';
import { initAuth } from './modules/auth.js';
import { initTables } from './modules/tables.js';

const $ = i => document.getElementById(i);
const $$ = s => document.querySelectorAll(s);

const app = {
    session: session, loadSession: loadSession, saveSession: saveSession,
    state: { tables: [], activeChecks: [], archivedChecks: [], inventory: [], cart: [], guests: [], debts: [], shiftStart: Date.now() },

    init: async () => {
        app.auth.checkSession();
        app.setupNavigation();
        app.setupHotkeys(); 
        
        const { data: settings } = await supabase.from('settings').select('*').single();
        if(settings) app.state.tariffs = settings;

        const { data: tables } = await supabase.from('tables').select('*').order('id');
        if(tables) { app.state.tables = tables; app.render(); }

        const { data: checks } = await supabase.from('active_checks').select('*');
        if(checks) { app.state.activeChecks = checks; app.renderChecks(); }

        const today = new Date().toISOString().split('T')[0];
        const { data: archive } = await supabase.from('archived_checks').select('*').gte('closed_at', today).order('closed_at', { ascending: false });
        if(archive) { app.state.archivedChecks = archive; app.renderArchive(); }

        const { data: inv } = await supabase.from('inventory').select('*').eq('is_active', true).order('name');
        if(inv) { app.state.inventory = inv; app.pos.renderItems(); app.inventory.render(); app.inventory.populateSelect(); }

        const { data: guests } = await supabase.from('guests').select('*').order('name');
        if(guests) { app.state.guests = guests; app.crm.render(); app.crm.populateDatalist(); }

        const { data: debts } = await supabase.from('debts').select('*').eq('status', 'АКТИВЕН').order('created_at', { ascending: false });
        if(debts) { app.state.debts = debts; app.debts.render(); }

        setTimeout(() => {
            if($('finance-activity-feed') && $('finance-activity-feed').children.length === 0) {
                app.logActivity('Оплата QR (4500 ₸) - Стол 2', '🟢');
                setTimeout(() => app.logActivity('Стол 4 установлен на паузу', '🟡'), 1000);
            }
        }, 1000);

        supabase.channel('public:tables').on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tables' }, payload => {
            const index = app.state.tables.findIndex(t => t.id === payload.new.id);
            if(index !== -1) app.state.tables[index] = payload.new;
            app.tables.render(); 
            app.pos.updateTargetOptions(); 
        }).subscribe();

        supabase.channel('public:active_checks').on('postgres_changes', { event: '*', schema: 'public', table: 'active_checks' }, () => {
            supabase.from('active_checks').select('*').then(({data}) => { if(data) { app.state.activeChecks = data; app.renderChecks(); } });
        }).subscribe();

        supabase.channel('public:archived_checks').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'archived_checks' }, payload => {
            app.state.archivedChecks.unshift(payload.new); app.renderArchive();
        }).subscribe();

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
            app.tick();
        }, 1000);
    },

    setupHotkeys: () => {
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') app.closeModals();
            if (e.key === 'Enter') {
                const payModal = $('modal-pay');
                if (payModal && !payModal.classList.contains('hidden')) app.confirmPay('НАЛ');
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
        openSidePanel: (id) => { $(id).classList.add('active'); },
        closeSidePanel: (id) => { $(id).classList.remove('active'); },
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
        $$('.side-panel').forEach(p => p.classList.remove('active'));
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

    pos: {
        renderItems: () => {
            const grid = $('pos-items-grid');
            if(!grid) return;
            if(app.state.inventory.length === 0) { grid.innerHTML = '<div class="muted-text">Склад пуст</div>'; return; }
            grid.innerHTML = app.state.inventory.map(item => {
                let stockClass = item.stock <= 0 ? 'danger' : (item.stock <= 5 ? 'warning' : 'success');
                let stockText = item.stock <= 0 ? 'НЕТ' : item.stock;
                let isOut = item.stock <= 0 ? 'out-of-stock' : '';
                let icon = '🥤';
                if(item.category === 'Снеки') icon = '🍫';
                if(item.category === 'Кальян') icon = '💨';
                if(item.category === 'Чай') icon = '🫖';
                return `
                <div class="pos-item ${isOut}" onclick="${item.stock > 0 ? `app.pos.addToCart(${item.id})` : ''}">
                    <div class="item-badge ${stockClass}">${stockText} шт</div>
                    <div class="item-icon">${icon}</div>
                    <div class="pos-item-name">${item.name}</div>
                    <div class="pos-item-price">${item.price} ₸</div>
                    <div class="pos-add-btn">+ В КОРЗИНУ</div>
                </div>`;
            }).join('');
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
            app.pos.renderCart();
        },

        changeQty: (id, delta) => {
            let index = app.state.cart.findIndex(c => c.id === id);
            if(index !== -1) {
                let item = app.state.inventory.find(i => i.id === id);
                if (delta > 0 && app.state.cart[index].qty >= item.stock) return app.ui.toast('Недостаточно на складе', 'danger');
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
            let html = '<option value="none">📍 БЫСТРЫЙ ЧЕК (БАР)</option>';
            app.state.tables.forEach(t => { if(t.status === 'В ИГРЕ') html += `<option value="${t.id}">🎱 СТОЛ ${t.id}</option>`; });
            select.innerHTML = html;
            if(app.state.tables.find(t => t.id == currentVal && t.status === 'В ИГРЕ')) select.value = currentVal;
            else select.value = 'none';
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

        checkout: async (method) => {
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
            app.state.cart = [];
            app.pos.renderCart();
            
            const { data: inv } = await supabase.from('inventory').select('*').eq('is_active', true).order('name');
            if(inv) { app.state.inventory = inv; app.pos.renderItems(); app.inventory.render(); }
        },

        sendToTable: async () => {
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
            app.state.cart = [];
            app.pos.renderCart();
            
            const { data: inv } = await supabase.from('inventory').select('*').eq('is_active', true).order('name');
            if(inv) { app.state.inventory = inv; app.pos.renderItems(); app.inventory.render(); }
            app.switchTab('hall');
        }
    },

    crm: {
        render: () => {
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
        populateDatalist: () => {
            const dl = $('guest-datalist');
            if(!dl) return;
            dl.innerHTML = app.state.guests.map(g => `<option value="${g.name}">Скидка: ${g.discount_percent}%</option>`).join('');
        },
        addGuest: async () => {
            let name = $('crm-name').value.trim();
            let phone = $('crm-phone').value.trim();
            let discount = parseInt($('crm-discount').value) || 0;
            if(!name) return app.ui.toast('Введите имя!', 'danger');
            
            await supabase.from('guests').insert([{ name, phone, discount_percent: discount }]);
            app.ui.toast('Гость добавлен', 'success');
            app.closeModals();
            
            const { data: guests } = await supabase.from('guests').select('*').order('name');
            if(guests) { app.state.guests = guests; app.crm.render(); app.crm.populateDatalist(); }
        }
    },

    debts: {
        render: () => {
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
                    <td class="text-right"><button class="btn-dark btn-sm success-text ml-auto" onclick="app.debts.payDebt(${d.id})">ПОГАСИТЬ</button></td>
                </tr>`;
            }).join('');
            
            let totalDebts = app.state.debts.reduce((sum, d) => sum + Number(d.amount), 0);
            if($('head-debts')) $('head-debts').innerText = totalDebts.toLocaleString() + ' ₸';
        },
        payDebt: async (id) => {
            app.ui.playSound('pay');
            await supabase.from('debts').update({ status: 'ПОГАШЕН' }).eq('id', id);
            app.ui.toast('Долг успешно погашен', 'success');
            
            const { data: debts } = await supabase.from('debts').select('*').eq('status', 'АКТИВЕН').order('created_at', { ascending: false });
            app.state.debts = debts || [];
            app.debts.render();
        }
    },

    inventory: {
        render: () => {
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
        populateSelect: () => {
            const sel = $('pur-item');
            if(!sel) return;
            sel.innerHTML = app.state.inventory.map(i => `<option value="${i.id}">${i.name}</option>`).join('');
        },
        addPurchase: async () => {
            let id = parseInt($('pur-item').value);
            let qty = parseInt($('pur-qty').value);
            let cost = parseFloat($('pur-cost').value);
            if(!qty || qty <= 0 || !cost) return app.ui.toast('Заполните все поля!', 'danger');
            
            let item = app.state.inventory.find(i => i.id === id);
            if(!item) return;

            await supabase.from('purchases').insert([{ item_name: item.name, quantity: qty, cost_price: cost, created_by: app.session.user.name }]);
            await supabase.from('inventory').update({ stock: item.stock + qty, cost_price: cost }).eq('id', id);
            
            app.ui.toast(`Оприходовано: ${item.name} (${qty} шт)`, 'success');
            app.closeModals();
            
            const { data: inv } = await supabase.from('inventory').select('*').eq('is_active', true).order('name');
            if(inv) { app.state.inventory = inv; app.pos.renderItems(); app.inventory.render(); }
        }
    },

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
                    <button class="btn-dark btn-sm success-text" onclick="app.confirmPay('НАЛ', ${c.id})">💵 НАЛ</button>
                    <button class="btn-dark btn-sm blue-text" onclick="app.confirmPay('QR', ${c.id})">📱 QR</button>
                    <button class="btn-dark btn-sm danger-text" onclick="app.confirmPay('ДОЛГ', ${c.id})">💸 ДОЛГ</button>
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
        if(debts) { app.state.debts = debts; app.debts.render(); }
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
        let liveRevenue = 0; let liveBar = 0; let activeCount = 0;
        
        app.state.tables.forEach(t => {
            if (t.status === 'В ИГРЕ') {
                activeCount++;
                let ms = (t.accumulated_time || 0);
                if (!t.paused) ms += (Date.now() - t.started_at);
                
                let rent = app.math.getCost(t);
                let bar = t.bar_amount || 0;
                let total = rent + bar;
                liveRevenue += rent; liveBar += bar;
                
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
        if($('head-bar')) $('head-bar').innerText = liveBar.toLocaleString() + " ₸";
        if($('head-total')) $('head-total').innerText = (liveRevenue + liveBar).toLocaleString() + " ₸";
    },

    switchTab: (tabId) => {
        $$('.nav-btn, .m-nav-item').forEach(b => b.classList.remove('active'));
        $$(`[data-tab="${tabId}"]`).forEach(b => b.classList.add('active'));
        $$('.tab-pane').forEach(p => p.classList.add('hidden'));
        let tab = $(`tab-${tabId}`);
        if (tab) tab.classList.remove('hidden');
        if(tabId === 'stock' && app.pos) app.pos.updateTargetOptions();
    },

    setupNavigation: () => {
        window.app.switchTab = app.switchTab;
        $$('.nav-btn, .m-nav-item').forEach(btn => {
            btn.addEventListener('click', (e) => app.switchTab(e.currentTarget.dataset.tab));
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
            
            // Скрытие элементов для админов
            if (app.session.user.role !== 'owner') {
                $$('.owner-only').forEach(el => el.style.display = 'none');
            } else {
                $$('.owner-only').forEach(el => el.style.display = 'flex');
            }

            app.tables.render();
            app.renderChecks();
        }
    }
};

app.auth = initAuth(app, supabase);
app.tables = initTables(app, supabase);
window.app = app;
window.onload = app.init;
