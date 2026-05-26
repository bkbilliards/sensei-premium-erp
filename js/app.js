import { supabase, session, loadSession, saveSession } from './supabase.js';
import { initAuth } from './modules/auth.js';
import { initTables } from './modules/tables.js';

const app = {
    session: session, loadSession: loadSession, saveSession: saveSession,
    state: { tables: [], activeChecks: [], shiftStart: Date.now() },

    init: () => {
        app.auth.checkSession();
        app.setupNavigation();
        
        // Realtime
        supabase.channel('public:tables').on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tables' }, payload => {
            const index = app.state.tables.findIndex(t => t.id === payload.new.id);
            if(index !== -1) app.state.tables[index] = payload.new;
            app.tables.render();
        }).subscribe();

        supabase.channel('public:active_checks').on('postgres_changes', { event: '*', schema: 'public', table: 'active_checks' }, () => {
            app.loadChecks();
        }).subscribe();

        setInterval(() => {
            let clock = document.getElementById('live-clock');
            if (clock) clock.innerText = new Date().toLocaleTimeString('ru-RU').slice(0,5);
            app.tables.tick();
        }, 1000);
        
        // Привязка глобальных событий
        document.addEventListener('click', (e) => {
            if(e.target.id === 'btn-login-submit') app.auth.login();
            if(e.target.id === 'btn-logout') { app.session.isAuth = false; app.saveSession(); location.reload(); }
        });
    },

    loadChecks: async () => {
        const { data } = await supabase.from('active_checks').select('*');
        if(data) { app.state.activeChecks = data; app.renderChecks(); }
    },

    renderChecks: () => {
        const list = document.getElementById('waiting-payments-list'); const count = document.getElementById('waiting-count');
        if (!list || !count) return;
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
        document.getElementById('pay-check-id').value = id; 
        document.getElementById('pay-sum').innerText = c.total.toLocaleString() + ' ₸'; 
        app.ui.openModal('modal-pay');
    },

    confirmPayActiveCheck: async (method) => {
        let id = document.getElementById('pay-check-id').value; if (!id) return;
        let c = app.state.activeChecks.find(x => x.id == id); if (!c) return;
        try {
            await supabase.from('archived_checks').insert([{ id: c.id, table_id: c.table_id, guest_name: c.guest_name, total: c.total, pay_method: method, created_by: app.session.user.name }]);
            await supabase.from('active_checks').delete().eq('id', id);
            app.ui.closeModals(); app.ui.toast(`Оплата: ${method}`, 'success');
        } catch(e) { app.ui.toast('Ошибка', 'danger'); }
    },

    ui: {
        toast: (msg, type='success') => {
            const c = document.getElementById('toast-container'); if(!c) return;
            const t = document.createElement('div');
            t.className = type === 'danger' ? `toast toast-danger` : `toast`; t.innerText = msg;
            c.appendChild(t); setTimeout(() => t.remove(), 2500);
        },
        openModal: (id) => { document.getElementById(id).classList.remove('hidden'); },
        closeModals: () => { document.querySelectorAll('.overlay').forEach(p => p.classList.add('hidden')); }
    },

    setupNavigation: () => {
        document.querySelectorAll('.nav-btn, .m-nav-item, .action-btn[data-trigger]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                let tabId = e.currentTarget.dataset.tab || e.currentTarget.dataset.trigger;
                if(!tabId) return;
                document.querySelectorAll('.nav-btn, .m-nav-item').forEach(b => b.classList.remove('active'));
                document.querySelectorAll(`[data-tab="${tabId}"]`).forEach(b => b.classList.add('active'));
                document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
                let tab = document.getElementById(`tab-${tabId}`); if (tab) tab.classList.remove('hidden');
            });
        });
    }
};

app.auth = initAuth(app, supabase);
app.tables = initTables(app, supabase);
window.app = app;
window.onload = app.init;
