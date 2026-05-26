// ТВОИ КЛЮЧИ SUPABASE
const SUPABASE_URL = 'https://huryvmmweiyfgmumzxzh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1cnl2bW13ZWl5ZmdtdW16eHpoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4MDc3MzAsImV4cCI6MjA5NDM4MzczMH0._kHBRzXqiQ16Lo1vz8xUeZnJBIv1bTpG5iX-3FZKhAg';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ЖЕЛЕЗНЫЙ СПИСОК ПЕРСОНАЛА (НИКОГДА НЕ ПРОПАДЕТ)
const DEFAULT_USERS = [
    { id: 1, name: 'Хозяин', role: 'owner', pin: '0000' },
    { id: 2, name: 'Админ Султан', role: 'admin', pin: '1111' },
    { id: 3, name: 'Админ Дидар', role: 'admin', pin: '2222' }
];

const app = {
    session: { isAuth: false, user: null },
    state: { tables: [], activeChecks: [], shiftStart: Date.now() },

    init: async () => {
        app.loadSession();
        app.setupUI();
        app.checkSession();
        
        // Таймер и ночной режим
        setInterval(() => {
            let clock = document.getElementById('live-clock');
            if (clock) clock.innerText = new Date().toLocaleTimeString('ru-RU').slice(0,5);
            
            // Ночной режим после 22:00
            const h = new Date().getHours();
            if (h >= 22 || h < 6) document.body.classList.add('night-mode');
            else document.body.classList.remove('night-mode');
            
            app.tickTables();
        }, 1000);
    },

    saveSession: () => localStorage.setItem('sensei_session', JSON.stringify(app.session)),
    loadSession: () => {
        const s = localStorage.getItem('sensei_session');
        if (s) app.session = JSON.parse(s);
    },

    checkSession: () => {
        if (!app.session.isAuth) {
            document.getElementById('authScreen').classList.add('active');
            document.getElementById('appScreen').classList.add('hidden');
            app.renderStaff();
        } else {
            document.getElementById('authScreen').classList.remove('active');
            document.getElementById('appScreen').classList.remove('hidden');
            document.getElementById('userName').innerText = app.session.user.name;
            
            // Роли
            document.querySelectorAll('.owner-only').forEach(el => {
                el.style.display = app.session.user.role === 'owner' ? 'flex' : 'none';
            });
            
            app.loadData();
        }
    },

    renderStaff: async () => {
        const sel = document.getElementById('staffSelect');
        if(!sel) return;

        let usersToRender = DEFAULT_USERS;

        // Пробуем подтянуть из Supabase, если таблица users существует и не пустая
        try {
            const { data, error } = await supabase.from('users').select('*');
            if (data && data.length > 0) usersToRender = data;
        } catch(e) {
            console.log("Загружен железный список персонала");
        }

        sel.innerHTML = usersToRender.map(u => `<option value="${u.pin}" data-user='${JSON.stringify(u)}'>${u.name} (${u.role})</option>`).join('');
    },

    login: () => {
        const sel = document.getElementById('staffSelect');
        const pinInput = document.getElementById('pinInput').value;
        const selectedOpt = sel.options[sel.selectedIndex];
        
        if(!selectedOpt) return;
        const correctPin = selectedOpt.value;
        const userObj = JSON.parse(selectedOpt.dataset.user);

        if (pinInput === correctPin) {
            app.session.isAuth = true;
            app.session.user = userObj;
            app.saveSession();
            app.toast('Авторизация успешна', 'success');
            app.checkSession();
        } else {
            app.toast('Неверный PIN-код', 'danger');
        }
    },

    logout: () => {
        app.session.isAuth = false;
        app.session.user = null;
        app.saveSession();
        location.reload();
    },

    loadData: async () => {
        try {
            const { data: tables } = await supabase.from('tables').select('*').order('id');
            if(tables) { app.state.tables = tables; app.renderTables(); }
            
            const { data: checks } = await supabase.from('active_checks').select('*');
            if(checks) { app.state.activeChecks = checks; app.renderChecks(); }
        } catch(e) { console.log("Ошибка загрузки данных", e); }
    },

    // ЛОГИКА СТОЛОВ
    renderTables: () => {
        const grid = document.getElementById('tablesGrid');
        if (!grid || app.state.tables.length === 0) return;
        
        grid.innerHTML = app.state.tables.map(t => {
            let isPlaying = t.status === 'В ИГРЕ'; let isPaused = t.paused;
            let cls = isPlaying ? (isPaused ? 'paused' : 'playing') : 'free';
            let totalCost = (isPlaying ? app.getCost(t) : 0) + (t.bar_amount || 0);
            
            let btnsFree = `<button class="btn-gold flex-1" onclick="app.startTable(${t.id})">▶ ПУСК</button><button class="btn-dark" style="width: 50px;" onclick="app.openManageTable(${t.id})">⚙</button>`;
            let btnsActive = `<button class="btn-dark" style="width: 50px;" onclick="app.pauseTable(${t.id})">${isPaused ? '▶' : '⏸'}</button><button class="btn-danger" style="flex: 1;" onclick="app.openStopPanel(${t.id})">💳 СЧЕТ</button><button class="btn-dark" style="width: 50px;" onclick="app.openManageTable(${t.id})">⚙</button>`;

            return `
            <div class="table-card ${cls}">
                <div class="table-cloth"></div>
                <div class="table-content flex-column h-100">
                    <div class="flex-between align-center mb-10">
                        <span class="t-num"><span class="t-status-dot"></span>СТОЛ ${t.id}</span>
                    </div>
                    <div class="t-center-info my-auto">
                        ${isPlaying ? `
                            <div class="t-timer font-mono" id="timer-${t.id}">00:00:00</div>
                            <div class="t-cost gold-text font-mono mt-5" id="sum-${t.id}">${totalCost.toLocaleString()} ₸</div>
                        ` : `<div class="t-idle-text muted-text">СВОБОДЕН</div>`}
                    </div>
                    <div class="flex-row mt-auto pt-15" style="border-top: 1px solid rgba(255,255,255,0.05); z-index:10;">
                        ${isPlaying ? btnsActive : btnsFree}
                    </div>
                </div>
            </div>`;
        }).join('');
    },

    startTable: async (id) => {
        app.playSound('start');
        try {
            await supabase.from('tables').update({ status: 'В ИГРЕ', started_at: Date.now(), accumulated_cost: 0, accumulated_time: 0, bar_amount: 0, paused: false }).eq('id', id);
            app.toast(`Стол ${id} запущен`, 'success');
            app.loadData();
        } catch(e) {}
    },

    pauseTable: async (id) => {
        let t = app.state.tables.find(x => x.id === id); if(!t) return;
        try {
            if (t.paused) {
                await supabase.from('tables').update({ paused: false, started_at: Date.now() }).eq('id', id);
            } else {
                let ms = (t.accumulated_time || 0) + (Date.now() - t.started_at); let cost = app.getCost(t);
                await supabase.from('tables').update({ paused: true, accumulated_time: ms, accumulated_cost: cost, started_at: null }).eq('id', id);
            }
            app.loadData();
        } catch(e) {}
    },

    openManageTable: (id) => {
        let t = app.state.tables.find(x => x.id === id);
        document.getElementById('m-table-id').innerText = id;
        if (t.status === 'В ИГРЕ') {
            document.getElementById('m-actions-active').classList.remove('hidden'); document.getElementById('m-actions-free').classList.add('hidden');
            let ms = (t.accumulated_time || 0) + (Date.now() - t.started_at);
            document.getElementById('m-table-timer').innerText = app.formatTime(ms); 
            document.getElementById('m-table-cost').innerText = (app.getCost(t) + (t.bar_amount || 0)).toLocaleString() + ' ₸';
        } else {
            document.getElementById('m-actions-active').classList.add('hidden'); document.getElementById('m-actions-free').classList.remove('hidden');
            document.getElementById('m-table-timer').innerText = '--:--:--'; document.getElementById('m-table-cost').innerText = '0 ₸';
        }
        app.openModal('modal-manage-table');
    },

    openStopPanel: (id) => {
        let t = app.state.tables.find(x => x.id === id); 
        if(!t) t = app.state.tables.find(x => x.id === parseInt(document.getElementById('m-table-id').innerText));
        if(!t) return; 
        app.closeModals();
        let rent = app.getCost(t); let bar = t.bar_amount || 0;
        document.getElementById('stop-table-id').innerText = t.id; 
        document.getElementById('stop-rent-sum').innerText = rent.toLocaleString() + ' ₸';
        document.getElementById('stop-bar-sum').innerText = bar.toLocaleString() + ' ₸'; 
        document.getElementById('stop-total-sum').innerText = (rent + bar).toLocaleString() + ' ₸';
        app.openModal('modal-stop-table');
    },

    confirmStopTable: async () => {
        let id = parseInt(document.getElementById('stop-table-id').innerText);
        let name = document.getElementById('stop-guest-name').value.trim() || `Гость ${id}`;
        let t = app.state.tables.find(x => x.id === id); let rent = app.getCost(t); let bar = t.bar_amount || 0; let total = rent + bar;
        
        try {
            await supabase.from('active_checks').insert([{ id: Date.now(), table_id: id.toString(), guest_name: name, time_amount: rent, bar_amount: bar, total: total, created_by: app.session.user.name }]);
            await supabase.from('tables').update({ status: 'СВОБОДЕН', started_at: null, accumulated_cost: total, accumulated_time: 0, bar_amount: 0, paused: false, active_check_id: null }).eq('id', id);
            app.closeModals(); app.playSound('pay'); app.toast(`Счет в кассе`, 'success');
            app.loadData();
        } catch(e) {}
    },

    renderChecks: () => {
        const list = document.getElementById('waiting-payments-list'); const count = document.getElementById('waiting-count');
        if (!list || !count) return;
        count.innerText = app.state.activeChecks.length;
        if (app.state.activeChecks.length === 0) { list.innerHTML = '<div class="muted-text text-center py-10 w-100">Касса пуста ✅</div>'; return; }
        list.innerHTML = app.state.activeChecks.map(c => `
            <div class="payment-row">
                <div class="payment-info"><span class="badge" style="background: rgba(255,255,255,0.05);">🎱 Стол ${c.table_id}</span><b class="text-white text-12">${c.guest_name}</b></div>
                <div class="payment-sum font-mono">${c.total.toLocaleString()} ₸</div>
                <div class="payment-actions"><button class="btn-gold btn-sm success-text" onclick="app.openPayCheck(${c.id})">💳 ОПЛАТИТЬ</button></div>
            </div>`).join('');
    },

    openPayCheck: (id) => {
        let c = app.state.activeChecks.find(x => x.id === id); if(!c) return;
        document.getElementById('pay-check-id').value = id; 
        document.getElementById('pay-sum').innerText = c.total.toLocaleString() + ' ₸'; 
        app.openModal('modal-pay');
    },

    confirmPayActiveCheck: async (method) => {
        let id = document.getElementById('pay-check-id').value; if (!id) return;
        try {
            await supabase.from('active_checks').delete().eq('id', id);
            app.closeModals(); app.toast(`Оплата ${method} прошла`, 'success');
            app.loadData();
        } catch(e) {}
    },

    // МАТЕМАТИКА
    getCost: (t) => {
        if (!t.started_at) return t.accumulated_cost || 0;
        let cost = t.accumulated_cost || 0;
        if (!t.paused) {
            let ms = t.started_at; let end = Date.now(); let cMs = ms; 
            while(cMs < end) { 
                let h = new Date(cMs).getHours(); 
                let rate = (h >= 14 && h < 18) ? 2500 : 3000; cost += rate / 60; cMs += 60000; 
            }
        }
        return Math.ceil(cost / 50) * 50; 
    },
    formatTime: (ms) => { 
        let s = Math.floor(ms / 1000); let h = Math.floor(s / 3600); let m = Math.floor((s % 3600) / 60); let sec = s % 60;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`; 
    },
    tickTables: () => {
        if (!app.session.isAuth || app.state.tables.length === 0) return;
        let liveRev = 0;
        app.state.tables.forEach(t => {
            if (t.status === 'В ИГРЕ') {
                let ms = (t.accumulated_time || 0); if (!t.paused) ms += (Date.now() - t.started_at);
                let rent = app.getCost(t); let total = rent + (t.bar_amount || 0);
                liveRev += rent;
                let timerEl = document.getElementById(`timer-${t.id}`); let sumEl = document.getElementById(`sum-${t.id}`);
                if (timerEl) timerEl.innerText = app.formatTime(ms);
                if (sumEl) sumEl.innerText = total.toLocaleString() + " ₸";
            }
        });
        if(document.getElementById('head-tables-rev')) document.getElementById('head-tables-rev').innerText = liveRev.toLocaleString() + " ₸";
    },

    // UI & EVENTS
    toast: (msg, type='success') => {
        const c = document.getElementById('toast-container'); if(!c) return;
        const t = document.createElement('div');
        t.className = type === 'danger' ? `toast toast-danger` : `toast`; t.innerText = msg;
        c.appendChild(t); setTimeout(() => t.remove(), 2500);
    },
    openModal: (id) => { document.getElementById(id).classList.remove('hidden'); },
    closeModals: () => { document.querySelectorAll('.overlay').forEach(p => p.classList.add('hidden')); },
    playSound: (type) => {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator(); const gain = ctx.createGain();
            osc.connect(gain); gain.connect(ctx.destination);
            if(type === 'start') { osc.frequency.setValueAtTime(420, ctx.currentTime); osc.type = 'sine'; gain.gain.setValueAtTime(0.01, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25); osc.start(); osc.stop(ctx.currentTime + 0.25); }
            if(type === 'pay') { osc.frequency.setValueAtTime(580, ctx.currentTime); osc.frequency.setValueAtTime(880, ctx.currentTime + 0.08); osc.type = 'triangle'; gain.gain.setValueAtTime(0.01, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.2); osc.start(); osc.stop(ctx.currentTime + 0.2); }
        } catch(e){}
    },

    switchTab: (tabId) => {
        document.querySelectorAll('.nav-btn, .m-nav-item').forEach(b => b.classList.remove('active'));
        document.querySelectorAll(`[data-tab="${tabId}"]`).forEach(b => b.classList.add('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
        let tab = document.getElementById(`tab-${tabId}`); if (tab) tab.classList.remove('hidden');
    },

    setupNavigation: () => {
        document.querySelectorAll('.nav-btn, .m-nav-item, .action-btn[data-trigger]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                let tabId = e.currentTarget.dataset.tab || e.currentTarget.dataset.trigger;
                if(tabId) app.switchTab(tabId);
            });
        });
    },

    setupHotkeys: () => {
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') app.closeModals();
            if (e.key === 'F1') { e.preventDefault(); app.confirmPayActiveCheck('НАЛ'); }
            if (e.key === 'F2') { e.preventDefault(); app.confirmPayActiveCheck('QR'); }
            if (e.key === ' ') { 
                const m = document.getElementById('modal-manage-table');
                if (m && !m.classList.contains('hidden')) {
                    e.preventDefault(); app.startTable(parseInt(document.getElementById('m-table-id').innerText)); app.closeModals();
                }
            }
        });
    },

    bindEvents: () => {
        document.getElementById('btn-login-submit')?.addEventListener('click', app.login);
        document.getElementById('btn-logout')?.addEventListener('click', app.logout);
        document.getElementById('btn-m-start')?.addEventListener('click', () => { app.startTable(parseInt(document.getElementById('m-table-id').innerText)); app.closeModals(); });
        document.getElementById('btn-m-pause')?.addEventListener('click', () => { app.pauseTable(parseInt(document.getElementById('m-table-id').innerText)); app.closeModals(); });
        document.getElementById('btn-m-stop')?.addEventListener('click', () => { app.openStopPanel(parseInt(document.getElementById('m-table-id').innerText)); });
        document.querySelectorAll('.modal-close').forEach(btn => btn.addEventListener('click', app.closeModals));
        document.getElementById('btn-close-pay')?.addEventListener('click', app.closeModals);
        document.getElementById('btn-pay-nal')?.addEventListener('click', () => app.confirmPayActiveCheck('НАЛ'));
        document.getElementById('btn-pay-qr')?.addEventListener('click', () => app.confirmPayActiveCheck('QR'));
    }
};

window.app = app;
window.onload = () => { app.init(); app.bindEvents(); };
