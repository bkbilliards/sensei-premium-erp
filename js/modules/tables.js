export function initTables(app, supabase) {
    const $ = i => document.getElementById(i);

    return {
        render: () => {
            const grid = $('tablesGrid');
            if (!grid) return;
            if (!app.state.tables || app.state.tables.length === 0) return;

            grid.innerHTML = app.state.tables.sort((a,b)=>a.id-b.id).map(t => {
                let isPlaying = t.status === 'В ИГРЕ';
                let cls = isPlaying ? (t.paused ? 'paused' : 'playing') : 'free';
                let cost = isPlaying ? app.math.getCost(t) : 0;
                
                // СТАРОЕ СОСТОЯНИЕ (История)
                let lastInfo = !isPlaying && t.accumulated_cost > 0 
                    ? `Чек: <span class="text-white">${t.accumulated_cost} ₸</span>` 
                    : 'Свободен';

                // ИЕРАРХИЯ КНОПОК
                let btnsFree = `
                    <button class="btn-gold flex-1 shadow-gold" onclick="app.tables.quickStart(${t.id})">▶ ПУСК</button>
                    <button class="btn-dark" onclick="app.ui.toast('Бронь скоро', 'warning')">📅</button>
                    <button class="btn-dark" onclick="app.ui.toast('Настройки', 'warning')">⚙️</button>`;
                
                let btnsActive = `
                    <button class="btn-danger flex-1 shadow-red" onclick="app.tables.openStopPanel(${t.id})">⏹ СТОП</button>
                    <button class="btn-dark" onclick="app.ui.toast('Бар скоро', 'warning')">🍹</button>
                    <button class="btn-dark" onclick="app.tables.togglePause(${t.id})">${t.paused ? '▶' : '⏸'}</button>`;

                return `
                <div class="table-card ${cls}">
                    <div class="flex-between mb-15">
                        <span class="t-num">СТОЛ ${t.id}</span>
                        <span class="t-timer" id="timer-${t.id}">${isPlaying ? '00:00' : '--:--'}</span>
                    </div>
                    <div class="flex-between align-center mb-20">
                        <div class="flex-column">
                            <span class="muted-text">${isPlaying ? 'ТЕКУЩИЙ СЧЕТ' : 'СТАТУС'}</span>
                            <span class="t-cost" id="sum-${t.id}">${isPlaying ? cost + ' ₸' : lastInfo}</span>
                        </div>
                        ${isPlaying ? `<div class="badge badge-yellow">👤 ${t.active_check_id || 'Гость'}</div>` : ''}
                    </div>
                    <div class="flex-row gap-10 mt-auto">
                        ${isPlaying ? btnsActive : btnsFree}
                    </div>
                </div>`;
            }).join('');
        },

        quickStart: async (id) => {
            await supabase.from('tables').update({ 
                status: 'В ИГРЕ', started_at: Date.now(), accumulated_cost: 0, accumulated_time: 0, paused: false,
                active_check_id: 'Гость'
            }).eq('id', id);
            app.ui.toast(`Стол ${id} запущен!`, 'success');
            app.logActivity(`▶ Старт: Стол ${id}`, 'start');
        },

        openStopPanel: (id) => {
            let t = app.state.tables.find(x => x.id === id);
            let cost = app.math.getCost(t);
            $('stop-table-id').innerText = id;
            $('stop-total-sum').innerText = cost + ' ₸';
            $('stop-guest-name').value = t.active_check_id || `Гость ${id}`;
            app.ui.openSidePanel('side-stop-table');
        },

        confirmStop: async () => {
            let id = parseInt($('stop-table-id').innerText);
            let name = $('stop-guest-name').value.trim();
            let t = app.state.tables.find(x => x.id === id);
            let cost = app.math.getCost(t);

            await supabase.from('active_checks').insert([{
                id: Date.now(), table_id: id.toString(), guest_name: name, time_amount: cost, total: cost, created_by: app.session.user.name
            }]);

            await supabase.from('tables').update({ 
                status: 'СВОБОДЕН', started_at: null, accumulated_cost: cost, accumulated_time: 0, paused: false, active_check_id: null 
            }).eq('id', id);

            app.ui.closeSidePanel('side-stop-table');
            app.ui.toast(`Чек на ${cost}₸ готов к оплате!`, 'success');
            app.logActivity(`⏹ Стоп: Стол ${id} (${cost} ₸)`, 'stop');
        },

        togglePause: async (id) => {
            let t = app.state.tables.find(x => x.id === id);
            if (t.paused) {
                await supabase.from('tables').update({ paused: false, started_at: Date.now() }).eq('id', id);
                app.logActivity(`▶ Продолжение: Стол ${id}`, 'start');
            } else {
                let ms = (t.accumulated_time || 0) + (Date.now() - t.started_at);
                let cost = app.math.getCost(t);
                await supabase.from('tables').update({ paused: true, accumulated_time: ms, accumulated_cost: cost, started_at: null }).eq('id', id);
                app.logActivity(`⏸ Пауза: Стол ${id}`, 'pause');
            }
        }
    };
}
