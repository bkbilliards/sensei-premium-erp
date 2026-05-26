import { supabase, session, loadSession, saveSession } from './supabase.js';
import { initAuth } from './auth.js';
import { initTables } from './tables.js';

const $ = id => document.getElementById(id);

const app = {
    session: session, loadSession: loadSession, saveSession: saveSession,
    state: { tables: [], activeChecks: [], cart: [], inventory: [], shiftStart: Date.now() },

    init: () => {
        app.auth.checkSession();
        app.setupNavigation();
        app.setupHotkeys();
        app.checkNightMode();

        // Подписки Realtime
        try {
            supabase.channel('public:tables').on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tables' }, payload => {
                const index = app.state.tables.findIndex(t => t.id === payload.new.id);
                if(index !== -1) app.state.tables[index] = payload.new;
                app.tables.render();
            }).subscribe();

            supabase.channel('public:active_checks').on('postgres_changes', { event: '*', schema: 'public', table: 'active_checks' }, () => {
                app.loadChecks();
            }).subscribe();
        } catch(e) { console.log("Realtime skip for now"); }

        setInterval(() => {
            let clock = $('live-clock'); if (clock) clock.innerText = new Date().toLocaleTimeString('ru-RU').slice(0,5);
            app.tables.tick();
            app.checkNightMode();
        }, 1000);
        
        app.bindEvents(); // Привязка кнопок
    },

    bindEvents: () => {
        $('btn-login-submit')?.addEventListener('click', () => app.auth.login());
        $('btn-logout')?.addEventListener('click', () => { app.session.isAuth = false; app.saveSession(); location.reload(); });
        
        // Модалки Стола
        $('btn-close-manage')?.addEventListener('click', app.ui.closeModals);
        $('btn-m-pause')?.addEventListener('click', () => { app.tables.pause(parseInt($('m-table-id').innerText)); app.ui.closeModals(); });
        $('btn-m-stop')?.addEventListener('click', () => { app.tables.stop(parseInt($('m-table-id').innerText)); });
        $('btn-m-start')?.addEventListener('click', () => { app.tables.start(parseInt($('m-table-id').innerText)); app.ui.closeModals(); });
        $('btn-m-bar')?.addEventListener('click', () => { 
            let id = parseInt($('m-table-id').innerText); 
            app.ui.closeModals(); app.switchTab('stock'); 
            let s = $('pos-target'); if(s) { s.value = id; app.pos.updateTargetUI(); }
        });

        // Модалка Стоп
        $('btn-close-stop')?.addEventListener('click', app.ui.closeModals);
        $('btn-confirm-stop')?.addEventListener('click', () => app.tables.confirmStop());

        // Касса Ожидания
        $('btn-close-pay')?.addEventListener('click', app.ui.closeModals);
        $('btn-pay-nal')?.addEventListener('click', () => app.confirmPayActiveCheck('НАЛ'));
        $('btn-pay-qr')?.addEventListener('click', () => app.confirmPayActiveCheck('QR'));
        $('btn-pay-mix')?.addEventListener('click', () => app.confirmPayActiveCheck('MIX'));
        $('btn-pay-debt')?.addEventListener('click', () => app.confirmPayActiveCheck('ДОЛГ'));
        
        // Инциденты
        $('btn-incident')?.addEventListener('click', () => app.ui.toast('Окно инцидентов скоро', 'warning'));
    },

    checkNightMode: () => {
        const h = new Date().getHours();
        if (h >= 22 || h < 6) document.body.classList.add('night-mode');
        else document.body.classList.remove('night-mode');
    },

    setupHotkeys: () => {
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') app.ui.closeModals();
            if (e.key === 'F1') { e.preventDefault(); app.confirmPayActiveCheck('НАЛ'); }
            if (e.key === 'F2') { e.preventDefault(); app.confirmPayActiveCheck('QR'); }
            if (e.key === 'F3') { e.preventDefault(); app.confirmPayActiveCheck('ДОЛГ'); }
            if (e.key === ' ') { 
                const m = $('modal-manage-table');
                if (m && !m.classList.contains('hidden') && !$('m-actions-free').classList.contains('hidden')) {
                    e.preventDefault(); app.tables.start(parseInt($('m-table-id').innerText)); app.ui.closeModals();
                }
            }
        });
    },

    loadChecks: async () => {
        try {
            const { data } = await supabase.from('active_checks').select('*');
            if(data) { app.state.activeChecks = data; app.renderChecks(); }
        } catch(e) {}
    },

    renderChecks: () => {
        const list = $('waiting-payments-list'); const count = $('waiting-count'); if (!list || !count) return;
        count.innerText = app.state.activeChecks.length;
        if (app.state.activeChecks.length === 0) { list.innerHTML = '<div class="muted-text py-10 text-center w-100">Все счета закрыты ✅</div>'; return; }
        list.innerHTML = app.state.activeChecks.map(c => `
            <div class="payment-row">
                <div class="payment-info"><span class="badge" style="background: rgba(255,255,255,0.05);">🎱 Стол ${c.table_id}</span><b class="text-white text-12">${c.guest_name}</b></div>
                <div class="payment-sum font-mono">${c.total.toLocaleString()} ₸</div>
                <div class="payment-actions"><button class="btn-gold btn-sm success-text" onclick="app.openPayActiveCheck(${c.id})">💳 ПРОВЕСТИ</button></div>
            </div>`).join('');
    },

    openPayActiveCheck: (id) => {
        let c = app.state.activeChecks.find(x => x.id === id); if(!c) return;
        $('pay-check-id').value = id; $('pay-sum').innerText = c.total.toLocaleString() + ' ₸'; 
        app.ui.openModal('modal-pay');
    },

    confirmPayActiveCheck: async (method) => {
        let id = $('pay-check-id').value; if (!id) return;
        let c = app.state.activeChecks.find(x => x.id == id); if (!c) return;
        try {
            await supabase.from('archived_checks').insert([{ id: c.id, table_id: c.table_id, guest_name: c.guest_name, total: c.total, pay_method: method, created_by: app.session.user.name }]);
            await supabase.from('active_checks').delete().eq('id', id);
            app.ui.closeModals(); app.ui.toast(`Оплата: ${method}`, 'success');
        } catch(e) { app.ui.toast('Ошибка', 'danger'); }
    },

    pos: {
        updateTargetUI: () => {
            let val = $('pos-target').value;
            if(val === 'none') { $('pos-actions-quick').classList.remove('hidden'); $('pos-actions-table').classList.add('hidden'); } 
            else { $('pos-actions-quick').classList.add('hidden'); $('pos-actions-table').classList.remove('hidden'); }
        }
        // Здесь в будущем будет добавлена логика рендера товаров (пока оставил заглушку для легкости)
    },

    ui: {
        toast: (msg, type='success') => {
            const c = $('toast-container'); if(!c) return;
            const t = document.createElement('div');
            t.className = type === 'danger' ? `toast toast-danger` : `toast`; t.innerText = msg;
            c.appendChild(t); setTimeout(() => t.remove(), 2500);
        },
        openModal: (id) => { $(id).classList.remove('hidden'); },
        closeModals: () => { document.querySelectorAll('.overlay').forEach(p => p.classList.add('hidden')); },
        playSound: (type) => {
            try {
                const ctx = new (window.AudioContext || window.webkitAudioContext)();
                const osc = ctx.createOscillator(); const gain = ctx.createGain();
                osc.connect(gain); gain.connect(ctx.destination);
                if(type === 'start') { osc.frequency.setValueAtTime(420, ctx.currentTime); osc.type = 'sine'; gain.gain.setValueAtTime(0.01, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25); osc.start(); osc.stop(ctx.currentTime + 0.25); }
            } catch(e){}
        }
    },

    switchTab: (tabId) => {
        document.querySelectorAll('.nav-btn, .m-nav-item').forEach(b => b.classList.remove('active'));
        document.querySelectorAll(`[data-tab="${tabId}"]`).forEach(b => b.classList.add('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
        let tab = $(`tab-${tabId}`); if (tab) tab.classList.remove('hidden');
    },

    setupNavigation: () => {
        document.querySelectorAll('.nav-btn, .m-nav-item, .action-btn[data-trigger]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                let tabId = e.currentTarget.dataset.tab || e.currentTarget.dataset.trigger;
                if(tabId) app.switchTab(tabId);
            });
        });
    }
};

window.app = app;
app.auth = initAuth(app, supabase);
app.tables = initTables(app, supabase);
window.onload = app.init;
