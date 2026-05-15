import { supabase, session, loadSession, saveSession } from './supabase.js';
import { initAuth } from './modules/auth.js';
import { initTables } from './modules/tables.js';

const $ = i => document.getElementById(i);
const $$ = s => document.querySelectorAll(s);

const app = {
    session: session, loadSession: loadSession, saveSession: saveSession,
    state: { tables: [], activeChecks: [], tariffs: { day_start: 10, day_end: 18, day_price: 2000, night_price: 3000 } },

    init: async () => {
        app.auth.checkSession();
        app.setupNavigation();
        app.setupHotkeys(); // ГОРЯЧИЕ КЛАВИШИ
        
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
            app.tick();
        }, 1000);
    },

    setupHotkeys: () => {
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                $$('.side-panel').forEach(p => p.classList.remove('active'));
                $$('.overlay').forEach(p => p.classList.add('hidden'));
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
        
        // ЗВУКИ (Синтезатор прямо в браузере, без файлов!)
        playSound: (type) => {
            try {
                const ctx = new (window.AudioContext || window.webkitAudioContext)();
                const osc = ctx.createOscillator(); const gain = ctx.createGain();
                osc.connect(gain); gain.connect(ctx.destination);
                if(type === 'start') { osc.frequency.setValueAtTime(600, ctx.currentTime); osc.type = 'sine'; gain.gain.setValueAtTime(0.1, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1); osc.start(); osc.stop(ctx.currentTime + 0.1); }
                if(type === 'pay') { osc.frequency.setValueAtTime(800, ctx.currentTime); osc.frequency.setValueAtTime(1200, ctx.currentTime + 0.1); osc.type = 'square'; gain.gain.setValueAtTime(0.05, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2); osc.start(); osc.stop(ctx.currentTime + 0.2); }
            } catch(e){}
        }
    },

    logActivity: (text, icon) => {
        const feed = $('activity-feed'); if(!feed) return;
        const time = new Date().toLocaleTimeString('ru-RU').slice(0,5);
        const item = document.createElement('div');
        item.className = `feed-item`;
        item.innerHTML = `<span class="feed-time">${time}</span> <span class="feed-icon">${icon}</span> <span class="text-white">${text}</span>`;
        feed.prepend(item);
        if(feed.children.length > 15) feed.lastChild.remove();
    },

    // РЕНДЕР КАРТОЧЕК ОПЛАТЫ (GRID)
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
            // Индикатор срочности (Зеленый -> Желтый -> Красный)
            let msWaited = Date.now() - new Date(c.created_at).getTime();
            let urgencyClass = msWaited > 1800000 ? 'urgency-red' : (msWaited > 600000 ? 'urgency-yellow' : '');
            
            return `
            <div class="payment-card ${urgencyClass}">
                <div class="flex-between mb-15">
                    <b class="text-white">${c.guest_name}</b>
                    <span class="badge" style="background: rgba(255,255,255,0.05);">Ст. ${c.table_id}</span>
                </div>
                <div class="gold-text text-24 bold mb-20">${c.total.toLocaleString()} ₸</div>
                <div class="flex-row">
                    <button class="btn-gold flex-1 shadow-gold" onclick="app.openPayModal(${c.id}, ${c.total})">💳 ОПЛАТИТЬ</button>
                    <button class="btn-dark" style="width: 45px;" onclick="app.ui.toast('Печать...', 'success')">🧾</button>
                    <button class="btn-dark" style="width: 45px;" onclick="app.ui.toast('Меню', 'warning')">⋮</button>
                </div>
            </div>`;
        }).join('');
    },

    // БЫСТРАЯ ОПЛАТА (MINI MODAL)
    openPayModal: (id, total) => {
        $('pay-check-id').value = id;
        $('pay-sum').innerText = total.toLocaleString() + ' ₸';
        // Сброс кнопок выбора
        $$('.pay-method-btn').forEach(b => b.classList.remove('active'));
        $('pay-method').value = '';
        $('modal-pay').classList.remove('hidden');
    },
    closePayModal: () => { $('modal-pay').classList.add('hidden'); },
    setPayMethod: (method, btnEl) => {
        $$('.pay-method-btn').forEach(b => b.classList.remove('active'));
        btnEl.classList.add('active');
        $('pay-method').value = method;
    },
    confirmPay: async () => {
        let id = $('pay-check-id').value;
        let method = $('pay-method').value;
        if (!method) return app.ui.toast('Выберите способ оплаты!', 'danger');
        
        app.ui.playSound('pay');
        await supabase.from('active_checks').delete().eq('id', id);
        
        // В будущем здесь будет запись в Архив. Пока просто удаляем.
        app.closePayModal();
        app.ui.toast(`Счет оплачен (${method})`, 'success');
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
                if (timerEl) timerEl.innerText = app.math.formatTime(ms);
                if (sumEl) sumEl.innerText = cost.toLocaleString() + " ₸";
            }
        });
        if($('head-cash')) $('head-cash').innerText = liveRevenue.toLocaleString() + " ₸";
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
