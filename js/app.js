import { supabase, session, loadSession, saveSession } from './supabase.js';
import { initAuth } from './modules/auth.js';

const $ = i => document.getElementById(i);
const $$ = s => document.querySelectorAll(s);

const app = {
    session: session,
    loadSession: loadSession,
    saveSession: saveSession,

    init: () => {
        app.auth.checkSession();
        app.setupNavigation();
        
        // Живой пульс времени
        setInterval(() => {
            let clock = $('live-clock');
            if (clock) clock.innerText = new Date().toLocaleTimeString('ru-RU');
        }, 1000);
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
            
            // Скрываем/показываем админку
            $$('.owner-only').forEach(el => {
                el.style.display = app.session.user.role === 'owner' ? 'inline-block' : 'none';
            });
        }
    }
};

app.auth = initAuth(app, supabase);
window.app = app;
window.onload = app.init;
