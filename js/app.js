import { supabase, session, loadSession, saveSession } from './supabase.js';
import { initAuth } from './modules/auth.js';
import { initTables } from './modules/tables.js';

const $ = i => document.getElementById(i);
const $$ = s => document.querySelectorAll(s);

const app = {
    session: session, loadSession: loadSession, saveSession: saveSession,
    state: { tables: [], activeChecks: [], archivedChecks: [], tariffs: { day_start: 10, day_end: 18, day_price: 2000, night_price: 3000 }, shiftStart: Date.now() },

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

        supabase.channel('public:tables').on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tables' }, payload => {
            const index = app.state.tables.findIndex(t => t.id === payload.new.id);
            if(index !== -1) app.state.tables[index] = payload.new;
            app.tables.render(); 
        }).subscribe();

        supabase.channel('public:active_checks').on('postgres_changes', { event: '*', schema: 'public', table: 'active_checks' }, () => {
            supabase.from('active_checks').select('*').then(({data}) => {
                if(data) { app.state.activeChecks = data; app.renderChecks(); }
            });
        }).subscribe();

        supabase.channel('public:archived_checks').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'archived_checks' }, payload => {
            app.state.archivedChecks.unshift(payload.new);
            app.renderArchive();
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

    logActivity: (text, icon) => {
        const feed = $('activity-feed'); if(!feed) return;
        const time = new Date().toLocaleTimeString('ru-RU').slice(0,5);
        const item = document.createElement('div');
        item.className = `feed-item`;
        item.innerHTML = `<span class="feed-time">${time}</span> <span class="feed-icon">${icon}</span> <span class="text-white">${text}</span>`;
        feed.prepend(item);
        if(feed.children.length > 20) feed.lastChild.remove();
    },

    // ГОРИЗОНТАЛЬНЫЕ СТРОКИ ОПЛАТЫ
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
                <div class="payment-sum">${c.total.toLocaleString()} ₸</div>
                <div class="payment-actions">
                    <button class="btn-dark btn-sm success-text" onclick="app.confirmPay('НАЛ', ${c.id})">💵 НАЛ</button>
                    <button class="btn-dark btn-sm blue-text" style="border-color:rgba(10,132,255,0.3);" onclick="app.confirmPay('QR', ${c.id})">📱 QR</button>
                    <button class="btn-dark btn-sm" onclick="app.openReceipt(${c.id})">🧾 ЧЕК</button>
                    <button class="btn-dark btn-sm" onclick="app.ui.toast('Разделение счета', 'warning')">👥 РАЗДЕЛИТЬ</button>
                </div>
            </div>`;
        }).join('');
    },

    // РЕНДЕР АРХИВА И ДАШБОРДА
    renderArchive: () => {
        const list = $('archive-list');
        if (!list) return;

        let totalSum = 0; let cashSum = 0; let qrSum = 0;
        let barSum = 0; let rentSum = 0;

        if (app.state.archivedChecks.length === 0) {
            list.innerHTML = '<tr><td colspan="10" class="text-center py-15 muted-text">Чеков пока нет</td></tr>';
        } else {
            list.innerHTML = app.state.archivedChecks.map(c => {
                let total = Number(c.total); let bar = Number(c.bar_amount || 0); let rent = Number(c.time_amount || total);
                totalSum += total; barSum += bar; rentSum += rent;
                if (c.pay_method === 'НАЛ') cashSum += total;
                if (c.pay_method === 'QR') qrSum += total;

                let timeStr = new Date(c.closed_at).toLocaleTimeString('ru-RU').slice(0,5);
                let tagClass = c.pay_method === 'НАЛ' ? 'nal' : 'qr';
                let dur = app.math.formatTime(c.played_ms || 0).slice(0,5);

                return `
                <tr onclick="app.openAuditModal(${c.id})">
                    <td class="muted-text font-mono">${timeStr}</td>
                    <td><b>Ст. ${c.table_id}</b></td>
                    <td>${c.guest_name}</td>
                    <td class="muted-text text-center">2</td>
                    <td class="font-mono text-white">${dur}</td>
                    <td class="gray-text">${rent.toLocaleString()} ₸</td>
                    <td class="gray-text">${bar.toLocaleString()} ₸</td>
                    <td class="gold-text bold text-14">${total.toLocaleString()} ₸</td>
                    <td><span class="pay-tag ${tagClass}">${c.pay_method}</span></td>
                    <td><span class="badge badge-green">✅ Оплачено</span></td>
                    <td class="text-right muted-text">${c.created_by}</td>
                </tr>`;
            }).join('');
        }

        // Обновляем KPI Дашборд
        if($('f-total')) $('f-total').innerText = totalSum.toLocaleString() + ' ₸';
        if($('f-cash')) $('f-cash').innerText = cashSum.toLocaleString() + ' ₸';
        if($('f-qr')) $('f-qr').innerText = qrSum.toLocaleString() + ' ₸';
        if($('f-tables')) $('f-tables').innerText = rentSum.toLocaleString() + ' ₸';
        if($('f-bar')) $('f-bar').innerText = barSum.toLocaleString() + ' ₸';
        if($('f-count')) $('f-count').innerText = app.state.archivedChecks.length;
    },

    openAuditModal: (id) => {
        let c = app.state.archivedChecks.find(x => x.id === id);
        if(!c) return;
        $('audit-id').innerText = '#' + c.id.toString().slice(-4);
        $('audit-table').innerText = 'СТОЛ ' + c.table_id;
        $('audit-total').innerText = c.total.toLocaleString() + ' ₸';
        $('audit-time').innerText = app.math.formatTime(c.played_ms || 0);
        $('audit-rent').innerText = c.time_amount.toLocaleString() + ' ₸';
        $('audit-method').innerText = '✅ ' + c.pay_method;
        $('audit-guest').innerText = c.guest_name;
        $('audit-admin').innerText = c.created_by;
        $('modal-audit').classList.remove('hidden');
    },

    openReceipt: (id) => {
        let c = app.state.activeChecks.find(x => x.id === id);
        if(!c) {
            let t = app.state.tables.find(x => x.id === id);
            if(!t || t.status !== 'В ИГРЕ') return;
            c = { table_id: t.id, guest_name: t.active_check_id || 'Гость', played_ms: (t.accumulated_time || 0) + (Date.now() - t.started_at), time_amount: app.math.getCost(t), total: app.math.getCost(t) };
        }
        $('rec-table').innerText = c.table_id;
        $('rec-guest').innerText = c.guest_name;
        $('rec-time').innerText = app.math.formatTime(c.played_ms || 0);
        $('rec-time-sum').innerText = c.time_amount.toLocaleString() + ' ₸';
        $('rec-total').innerText = c.total.toLocaleString() + ' ₸';
        $('modal-receipt').classList.remove('hidden');
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
            total: checkToArchive.total,
            pay_method: method,
            created_by: checkToArchive.created_by,
            played_ms: checkToArchive.played_ms
        }]);

        await supabase.from('active_checks').delete().eq('id', id);
        
        app.closeModals();
        app.ui.toast(`Оплата ${method} проведена`, 'success');
        app.logActivity(`Оплата чека (${method})`, '💳');
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
        
        app.state.tables.forEach(t => {
            if (t.status === 'В ИГРЕ') {
                activeCount++;
                let ms = (t.accumulated_time || 0);
                if (!t.paused) ms += (Date.now() - t.started_at);
                let cost = app.math.getCost(t);
                liveRevenue += cost;
                
                let timerEl = $(`timer-${t.id}`);
                let sumEl = $(`sum-${t.id}`);
                if (timerEl) {
                    timerEl.innerText = app.math.formatTime(ms);
                    timerEl.className = 't-timer ' + (ms < 3600000 ? 'timer-green' : (ms < 10800000 ? 'timer-yellow' : 'timer-red'));
                }
                if (sumEl) sumEl.innerText = cost.toLocaleString() + " ₸";
            }
        });
        
        if($('head-tables-rev')) $('head-tables-rev').innerText = liveRevenue.toLocaleString() + " ₸";
        if($('head-active-tables')) $('head-active-tables').innerText = `${activeCount} / 6`;
    },

    setupNavigation: () => {
        window.app.openAuditModal = app.openAuditModal; 
        
        $$('.nav-btn, .m-nav-item').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const tabId = e.currentTarget.dataset.tab;
                if (!tabId) return;
                $$('.nav-btn, .m-nav-item').forEach(b => b.classList.remove('active'));
                $$(`[data-tab="${tabId}"]`).forEach(b => b.classList.add('active'));
                $$('.tab-pane').forEach(p => p.classList.add('hidden'));
                let tab = $(`tab-${tabId}`);
                if (tab) tab.classList.remove('hidden');
            });
        });

        // Навигация внутри вкладки УПРАВЛЕНИЯ
        $$('.sub-nav-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const subId = e.currentTarget.dataset.sub;
                if (!subId) return;
                $$('.sub-nav-btn').forEach(b => b.classList.remove('active'));
                e.currentTarget.classList.add('active');
                $$('.sub-pane').forEach(p => p.classList.add('hidden'));
                let tab = $(`sub-${subId}`);
                if (tab) tab.classList.remove('hidden');
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
            app.renderArchive();
        }
    }
};

app.auth = initAuth(app, supabase);
app.tables = initTables(app, supabase);
window.app = app;
window.onload = app.init;
