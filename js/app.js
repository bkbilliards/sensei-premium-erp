import { supabase, session, loadSession, saveSession } from './supabase.js';
import { initAuth } from './modules/auth.js';
import { initTables } from './modules/tables.js';

const $ = i => document.getElementById(i);
const $$ = s => document.querySelectorAll(s);

const app = {
    session: session, loadSession: loadSession, saveSession: saveSession,
    state: { tables: [], activeChecks: [], tariffs: { day_start: 10, day_end: 18, day_price: 2000, night_price: 3000 }, shiftStart: Date.now() },

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

        setInterval(() => {
            let clock = $('live-clock');
            if (clock) clock.innerText = new Date().toLocaleTimeString('ru-RU').slice(0,5);
            
            // Таймер смены
            let shiftClock = $('shift-clock');
            if (shiftClock && app.session.isAuth) {
                let ms = Date.now() - app.state.shiftStart;
                let h = Math.floor(ms / 3600000);
                let m = Math.floor((ms % 3600000) / 60000);
                shiftClock.innerText = `Смена: ${String(h).padStart(2,'0')}ч ${String(m).padStart(2,'0')}м`;
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
                if(type === 'start') { osc.frequency.setValueAtTime(600, ctx.currentTime); osc.type = 'sine'; gain.gain.setValueAtTime(0.05, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1); osc.start(); osc.stop(ctx.currentTime + 0.1); }
                if(type === 'pay') { osc.frequency.setValueAtTime(800, ctx.currentTime); osc.frequency.setValueAtTime(1200, ctx.currentTime + 0.1); osc.type = 'square'; gain.gain.setValueAtTime(0.05, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2); osc.start(); osc.stop(ctx.currentTime + 0.2); }
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

    // КАРТОЧКИ ОПЛАТЫ СО ВСЕМИ КНОПКАМИ ERP
    renderChecks: () => {
        const list = $('waiting-payments-list');
        const count = $('waiting-count');
        if (!list || !count) return;
        count.innerText = app.state.activeChecks.length;
        if (app.state.activeChecks.length === 0) {
            list.innerHTML = '<div class="muted-text text-center py-10 w-100">Все счета закрыты</div>';
            return;
        }
        
        list.innerHTML = app.state.activeChecks.map(c => {
            let msWaited = Date.now() - new Date(c.created_at).getTime();
            let urgencyClass = msWaited > 1800000 ? 'urgency-red' : (msWaited > 600000 ? 'urgency-yellow' : '');
            
            return `
            <div class="payment-card ${urgencyClass}">
                <div class="flex-between mb-10">
                    <b class="text-white">${c.guest_name}</b>
                    <span class="badge" style="background: rgba(255,255,255,0.05);">Ст. ${c.table_id}</span>
                </div>
                <div class="gold-text text-24 bold mb-15">${c.total.toLocaleString()} ₸</div>
                <div class="flex-column gap-10">
                    <div class="flex-row gap-10">
                        <button class="btn-dark flex-1" onclick="app.confirmPay('НАЛ', ${c.id})">💵 НАЛ</button>
                        <button class="btn-dark flex-1 blue-text" style="border-color:rgba(10,132,255,0.3);" onclick="app.confirmPay('QR', ${c.id})">📱 QR</button>
                    </div>
                    <div class="flex-row gap-10">
                        <button class="btn-secondary flex-1" onclick="app.ui.toast('Чек в WhatsApp', 'success')">🧾 ЧЕК</button>
                        <button class="btn-secondary flex-1" onclick="app.ui.toast('Разделение счета', 'warning')">👥 SPLIT</button>
                    </div>
                </div>
            </div>`;
        }).join('');
    },

    confirmPay: async (method, overrideId = null) => {
        let id = overrideId || $('pay-check-id').value;
        if (!id) return;
        app.ui.playSound('pay');
        await supabase.from('active_checks').delete().eq('id', id);
        
        app.closeModals();
        app.ui.toast(`Оплата ${method} успешна`, 'success');
        app.logActivity(`Оплата ${method}`, '💳');
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
            return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`; 
        }
    },

    tick: () => {
        if (!app.session.isAuth) return;
        let liveRevenue = 0;
        app.state.tables.forEach(t => {
            if (t.status === 'В ИГРЕ') {
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
        
        // Обновляем виртуальные финансы в шапке
        if($('head-profit')) {
            $('head-profit').innerText = (liveRevenue + 42500).toLocaleString() + " ₸";
            $('head-cash').innerText = (liveRevenue + 12000).toLocaleString() + " ₸";
            $('head-qr').innerText = (30500).toLocaleString() + " ₸";
        }
    },

    setupNavigation: () => {
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
        if($('btn-logout')) $('btn-logout').onclick = () => app.auth.logout();
    },

    render: () => {
        if (!app.session.isAuth) {
            $('authScreen').classList.add('active');
            $('appScreen').classList.add('hidden');
            app.auth.renderStaff(); 
        } else {
            $('authScreen').classList.remove('active');
            $('appScreen').classList.remove('hidden');
            $('userName').innerText = app.session.user.name;
            app.state.shiftStart = Date.now(); // Сброс таймера при логине
            $$('.owner-only').forEach(el => { el.style.display = app.session.user.role === 'owner' ? 'inline-block' : 'none'; });
            app.tables.render();
            app.renderChecks();
        }
    }
};

app.auth = initAuth(app, supabase);
app.tables = initTables(app, supabase);
window.app = app;
window.onload = app.init;
