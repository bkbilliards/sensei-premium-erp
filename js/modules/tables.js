export function initTables(app, supabase) {
    const $ = id => document.getElementById(id);
    return {
        load: async () => {
            const { data } = await supabase.from('tables').select('*').order('id');
            if(data) { app.state.tables = data; app.tables.render(); }
        },
        render: () => {
            const grid = $('tablesGrid'); if (!grid || !app.state.tables) return;
            grid.innerHTML = app.state.tables.map(t => {
                let isPlaying = t.status === 'В ИГРЕ'; let isPaused = t.paused;
                let cls = isPlaying ? (isPaused ? 'paused' : 'playing') : 'free';
                let totalCost = (isPlaying ? app.tables.getCost(t) : 0) + (t.bar_amount || 0);
                
                let btnsFree = `<button class="btn-gold flex-1" onclick="app.tables.start(${t.id})">▶ ПУСК</button><button class="btn-dark" style="width: 50px;" onclick="app.tables.manage(${t.id})">⚙</button>`;
                let btnsActive = `<button class="btn-dark" style="width: 50px;" onclick="app.tables.pause(${t.id})">${isPaused ? '▶' : '⏸'}</button><button class="btn-danger" style="flex: 1;" onclick="app.tables.stop(${t.id})">💳 СЧЕТ</button><button class="btn-dark" style="width: 50px;" onclick="app.tables.manage(${t.id})">⚙</button>`;

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
                                <div class="t-cost gold-text font-mono mt-5">${totalCost.toLocaleString()} ₸</div>
                                ${t.bar_amount > 0 ? `<div class="muted-text text-10 mt-5">БАР: ${t.bar_amount.toLocaleString()} ₸</div>` : ''}
                            ` : `<div class="t-idle-text muted-text">СВОБОДЕН</div>`}
                        </div>
                        <div class="flex-row mt-auto pt-15" style="border-top: 1px solid rgba(255,255,255,0.05);">${isPlaying ? btnsActive : btnsFree}</div>
                    </div>
                </div>`;
            }).join('');
        },
        start: async (id) => {
            try {
                await supabase.from('tables').update({ status: 'В ИГРЕ', started_at: Date.now(), accumulated_cost: 0, accumulated_time: 0, bar_amount: 0, paused: false, active_check_id: 'Гость' }).eq('id', id);
                app.ui.toast(`Стол ${id} запущен`, 'success');
            } catch(e) { app.ui.toast('Ошибка сети', 'danger'); }
        },
        pause: async (id) => {
            let t = app.state.tables.find(x => x.id === id); if(!t) return;
            try {
                if (t.paused) {
                    await supabase.from('tables').update({ paused: false, started_at: Date.now() }).eq('id', id);
                } else {
                    let ms = (t.accumulated_time || 0) + (Date.now() - t.started_at); let cost = app.tables.getCost(t);
                    await supabase.from('tables').update({ paused: true, accumulated_time: ms, accumulated_cost: cost, started_at: null }).eq('id', id);
                }
            } catch(e) {}
        },
        manage: (id) => {
            let t = app.state.tables.find(x => x.id === id); $('m-table-id').innerText = id;
            if (t.status === 'В ИГРЕ') {
                $('m-actions-active').classList.remove('hidden'); $('m-actions-free').classList.add('hidden');
                let ms = (t.accumulated_time || 0) + (Date.now() - t.started_at);
                $('m-table-timer').innerText = app.tables.formatTime(ms); $('m-table-cost').innerText = (app.tables.getCost(t) + (t.bar_amount || 0)).toLocaleString() + ' ₸';
            } else {
                $('m-actions-active').classList.add('hidden'); $('m-actions-free').classList.remove('hidden');
                $('m-table-timer').innerText = '--:--:--'; $('m-table-cost').innerText = 'Свободен';
            }
            app.ui.openModal('modal-manage-table');
        },
        stop: (id) => {
            let t = app.state.tables.find(x => x.id === id); if(!t) return; app.ui.closeModals();
            let rent = app.tables.getCost(t); let bar = t.bar_amount || 0;
            $('stop-table-id').innerText = t.id; $('stop-rent-sum').innerText = rent.toLocaleString() + ' ₸';
            $('stop-bar-sum').innerText = bar.toLocaleString() + ' ₸'; $('stop-total-sum').innerText = (rent + bar).toLocaleString() + ' ₸';
            $('stop-guest-name').value = t.active_check_id || ''; app.ui.openModal('modal-stop-table');
        },
        confirmStop: async () => {
            let id = parseInt($('stop-table-id').innerText); let name = $('stop-guest-name').value.trim() || `Гость ${id}`;
            let t = app.state.tables.find(x => x.id === id); let rent = app.tables.getCost(t); let bar = t.bar_amount || 0; let total = rent + bar;
            let playedMs = (t.accumulated_time || 0) + (Date.now() - t.started_at);
            try {
                await supabase.from('active_checks').insert([{ id: Date.now(), table_id: id.toString(), guest_name: name, time_amount: rent, bar_amount: bar, total: total, created_by: app.session.user.name, played_ms: playedMs }]);
                await supabase.from('tables').update({ status: 'СВОБОДЕН', started_at: null, accumulated_cost: total, accumulated_time: 0, bar_amount: 0, paused: false, active_check_id: null }).eq('id', id);
                app.ui.closeModals(); app.ui.toast(`Счет передан в кассу`, 'success');
            } catch(e) { app.ui.toast('Ошибка', 'danger'); }
        },
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
        tick: () => {
            if (!app.session.isAuth || !app.state.tables) return;
            let liveRev = 0;
            app.state.tables.forEach(t => {
                if (t.status === 'В ИГРЕ') {
                    let ms = (t.accumulated_time || 0); if (!t.paused) ms += (Date.now() - t.started_at);
                    let rent = app.tables.getCost(t); let total = rent + (t.bar_amount || 0);
                    liveRev += rent;
                    let timerEl = document.getElementById(`timer-${t.id}`); let sumEl = document.getElementById(`sum-${t.id}`);
                    if (timerEl) timerEl.innerText = app.tables.formatTime(ms);
                    if (sumEl) sumEl.innerText = total.toLocaleString() + " ₸";
                }
            });
            if(document.getElementById('head-tables-rev')) document.getElementById('head-tables-rev').innerText = liveRev.toLocaleString() + " ₸";
        }
    };
}
