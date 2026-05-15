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
        tariffs: { day_start: 10, day_end: 18, day_price: 2000, night_price: 3000 } 
    },

    init: async () => {
        app.auth.checkSession();
        app.setupNavigation();
        
        // Грузим тарифы
        const { data: settings } = await supabase.from('settings').select('*').single();
        if(settings) app.state.tariffs = settings;

        // Грузим столы
        const { data: tables } = await supabase.from('tables').select('*').order('id');
        if(tables) {
            app.state.tables = tables;
            app.render();
        }

        // ЖИВАЯ СИНХРОНИЗАЦИЯ СТОЛОВ
        supabase.channel('public:tables').on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tables' }, payload => {
            const index = app.state.tables.findIndex(t => t.id === payload.new.id);
            if(index !== -1) app.state.tables[index] = payload.new;
            app.tables.render(); 
        }).subscribe();

        // Часы и Таймеры
        setInterval(() => {
            let clock = $('live-clock');
            if (clock) clock.innerText = new Date().toLocaleTimeString('ru-RU');
            app.tick();
        }, 1000);
    },

    // UX Инструменты (Тосты и Боковые панели)
    ui: {
        toast: (msg, type='success') => {
            const c = $('toast-container');
            if(!c) return;
            const t = document.createElement('div');
            t.className = `toast toast-${type}`;
            t.innerHTML = msg;
            c.appendChild(t);
            setTimeout(() => t.remove(), 4000);
        },
        openSidePanel: (id) => { $(id).classList.add('active'); },
        closeSidePanel: (id) => { $(id).classList.remove('active'); }
    },

    logActivity: (text) => {
        const feed = $('activity-feed');
        if(!feed) return;
        const time = new Date().toLocaleTimeString('ru-RU').slice(0,5);
        const item = document.createElement('div');
        item.className = 'feed-item';
        item.innerHTML = `<span class="gold-text mr-10">${time}</span> ${text}`;
        feed.prepend(item);
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
        app.state.tables.forEach(t => {
            if (t.status === 'В ИГРЕ' && !t.paused) {
                let ms = (t.accumulated_time || 0) + (Date.now() - t.started_at);
                let cost = app.math.getCost(t);
                let timerEl = $(`timer-${t.id}`);
                let sumEl = $(`sum-${t.id}`);
                if (timerEl) timerEl.innerText = app.math.formatTime(ms);
                if (sumEl) sumEl.innerText = cost + " ₸";
            }
        });
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
        }
    }
};

app.auth = initAuth(app, supabase);
app.tables = initTables(app, supabase);
window.app = app;
window.onload = app.init;
