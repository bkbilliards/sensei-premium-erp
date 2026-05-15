import { supabase, session, loadSession, saveSession } from './supabase.js';
import { initAuth } from './modules/auth.js';
import { initTables } from './modules/tables.js';

const $ = i => document.getElementById(i);
const $$ = s => document.querySelectorAll(s);

const app = {
    session: session,
    loadSession: loadSession,
    saveSession: saveSession,
    
    state: { 
        tables: [], 
        activeChecks: [], // Чеки, ожидающие оплаты
        tariffs: { day_start: 10, day_end: 18, day_price: 2000, night_price: 3000 } 
    },

    init: async () => {
        app.auth.checkSession();
        app.setupNavigation();
        
        // 1. Грузим настройки
        const { data: settings } = await supabase.from('settings').select('*').single();
        if(settings) app.state.tariffs = settings;

        // 2. Грузим столы
        const { data: tables } = await supabase.from('tables').select('*').order('id');
        if(tables) { app.state.tables = tables; app.render(); }

        // 3. Грузим неоплаченные чеки
        const { data: checks } = await supabase.from('active_checks').select('*');
        if(checks) { app.state.activeChecks = checks; app.renderChecks(); }

        // 4. СИНХРОНИЗАЦИЯ: Столы
        supabase.channel('public:tables').on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tables' }, payload => {
            const index = app.state.tables.findIndex(t => t.id === payload.new.id);
            if(index !== -1) app.state.tables[index] = payload.new;
            app.tables.render(); 
        }).subscribe();

        // 5. СИНХРОНИЗАЦИЯ: Чеки
        supabase.channel('public:active_checks').on('postgres_changes', { event: '*', schema: 'public', table: 'active_checks' }, payload => {
            // При любом изменении просто перезапрашиваем чеки для надежности
            supabase.from('active_checks').select('*').then(({data}) => {
                if(data) { app.state.activeChecks = data; app.renderChecks(); }
            });
        }).subscribe();

        // 6. Часы и Таймеры
        setInterval(() => {
            let clock = $('live-clock');
            if (clock) clock.innerText = new Date().toLocaleTimeString('ru-RU').slice(0,5);
            app.tick();
        }, 1000);
    },

    ui: {
        toast: (msg, type='success') => {
            const c = $('toast-container');
            if(!c) return;
            const t = document.createElement('div');
            t.className = `toast toast-${type}`;
            t.innerHTML = msg;
            c.appendChild(t);
            setTimeout(() => t.remove(), 3000);
        },
        openSidePanel: (id) => { $(id).classList.add('active'); },
        closeSidePanel: (id) => { $(id).classList.remove('active'); }
    },

    // Лента событий с цветами
    logActivity: (text, type = 'normal') => {
        const feed = $('activity-feed');
        if(!feed) return;
        const time = new Date().toLocaleTimeString('ru-RU').slice(0,5);
        const item = document.createElement('div');
        item.className = `feed-item feed-${type}`;
        item.innerHTML = `<span class="gold-text bold w-100" style="max-width:40px;">${time}</span> <span>${text}</span>`;
        feed.prepend(item);
    },

    // Отрисовка блока "Ожидают оплаты"
    renderChecks: () => {
        const list = $('waiting-payments-list');
        const count = $('waiting-count');
        if (!list || !count) return;

        count.innerText = app.state.activeChecks.length;

        if (app.state.activeChecks.length === 0) {
            list.innerHTML = '<div class="muted-text text-11 text-center py-10">Все счета оплачены</div>';
            return;
        }

        list.innerHTML = app.state.activeChecks.map(c => `
            <div class="payment-item">
                <div class="flex-column">
                    <span class="text-white bold text-12">${c.guest_name}</span>
                    <span class="muted-text text-10">Стол ${c.table_id} • Создан админом: ${c.created_by}</span>
                </div>
                <div class="flex-row align-center gap-15">
                    <span class="gold-text bold text-18">${c.total.toLocaleString()} ₸</span>
                    <button class="btn-primary shadow-gold btn-sm" onclick="app.ui.toast('Оплата в разработке', 'success')">💳 ОПЛАТИТЬ</button>
                </div>
            </div>
        `).join('');
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
                    cost += rate / 60; 
                    cMs += 60000; 
                }
            }
            return Math.ceil(cost / 50) * 50; 
        },
        formatTime: (ms) => { 
            let s = Math.floor(ms / 1000); 
            return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; 
        }
    },

    tick: () => {
        if (!app.session.isAuth) return;
        
        let activeTables = 0;
        let liveRevenue = 0;

        app.state.tables.forEach(t => {
            if (t.status === 'В ИГРЕ') {
                activeTables++;
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

        let hTables = $('head-active-tables');
        let hRev = $('head-live-rev');
        if (hTables) hTables.innerText = `${activeTables} / 6`;
        if (hRev) hRev.innerText = liveRevenue.toLocaleString() + " ₸";
    },

    setupNavigation: () => {
        $$('.nav-btn, .mobile-nav-item').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const tabId = e.currentTarget.dataset.tab;
                if (!tabId) return;
                $$('.nav-btn, .mobile-nav-item').forEach(b => b.classList.remove('active'));
                $$(`[data-tab="${tabId}"]`).forEach(b => b.classList.add('active'));
                $$('.tab-pane').forEach(p => p.classList.add('hidden'));
                let tab = $(`tab-${tabId}`);
                if (tab) tab.classList.remove('hidden');
            });
        });
        let btnLogout = $('btn-logout');
        if (btnLogout) btnLogout.addEventListener('click', () => app.auth.logout());
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
