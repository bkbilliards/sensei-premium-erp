export function initTables(app, supabase) {
    const $ = i => document.getElementById(i);

    return {
        render: () => {
            const grid = $('tablesGrid');
            if (!grid) return;
            if (!app.state.tables || app.state.tables.length === 0) {
                grid.innerHTML = '<div class="muted-text text-center w-100 mt-40">Подключение к базе...</div>';
                return;
            }

            grid.innerHTML = app.state.tables.sort((a,b)=>a.id-b.id).map(t => {
                let isPlaying = t.status === 'В ИГРЕ';
                let cls = isPlaying ? (t.paused ? 'paused' : 'playing') : 'free';
                let statusText = isPlaying ? (t.paused ? 'ПАУЗА' : 'В ИГРЕ') : 'СВОБОДЕН';
                let cost = isPlaying ? app.math.getCost(t) : 0;
                
                // ИЕРАРХИЯ КНОПОК
                let btnsFree = `
                    <button class="btn-primary flex-1 shadow-gold" onclick="app.tables.quickStart(${t.id})">▶ ПУСК</button>
                    <button class="btn-secondary flex-1" onclick="app.ui.toast('Бронь скоро', 'warning')">📅 БРОНЬ</button>
                    <button class="btn-ghost flex-1" onclick="app.ui.toast('Настройки скоро', 'warning')">⚙️</button>`;
                
                let btnsActive = `
                    <button class="btn-danger flex-1" onclick="app.tables.openStopPanel(${t.id})">⏹ СТОП</button>
                    <button class="btn-secondary flex-1" onclick="app.ui.toast('Бар скоро', 'warning')">🍹 БАР</button>
                    <button class="btn-secondary flex-1" onclick="app.tables.togglePause(${t.id})">${t.paused ? '▶ ИГРАТЬ' : '⏸ ПАУЗА'}</button>
                    <button class="btn-ghost" onclick="app.ui.toast('Перенос скоро', 'warning')">🔁</button>`;

                return `
                <div class="table-card ${cls}">
                    <div class="t-header">
                        <div class="flex-column">
                            <span class="t-num">СТОЛ ${t.id}</span>
                            <span class="t-status mt-10 text-10 bold text-white letter-spacing"><span class="t-status-indicator"></span>${statusText}</span>
                        </div>
                        <div class="flex-column text-right">
                            <span class="t-timer" id="timer-${t.id}">${isPlaying ? '00:00:00' : '--:--'}</span>
                            <span class="t-cost" id="sum-${t.id}">${isPlaying ? cost + ' ₸' : ''}</span>
                        </div>
                    </div>
                    ${isPlaying ? `<div class="t-info mb-20 flex-between"><span>👥 ${t.current_players || 2} игрока</span> <span class="gold-text">👤 ${t.active_check_id || 'Гость'}</span></div>` : '<div class="t-info mb-20 text-center muted-text" style="height:15px;"></div>'}
                    <div class="flex-row gap-10 mt-auto">
                        ${isPlaying ? btnsActive : btnsFree}
                    </div>
                </div>`;
            }).join('');
        },

        quickStart: async (id) => {
            await supabase.from('tables').update({ 
                status: 'В ИГРЕ', 
                started_at: Date.now(), 
                accumulated_cost: 0, 
                accumulated_time: 0, 
                paused: false,
                current_players: 2, 
                active_check_id: `Гость (Стол ${id})`
            }).eq('id', id);

            app.ui.toast(`Стол ${id} запущен!`, 'success');
            app.logActivity(`▶ Запущен Стол ${id}`);
        },

        openStopPanel: (id) => {
            let t = app.state.tables.find(x => x.id === id);
            let cost = app.math.getCost(t);
            $('stop-table-id').innerText = id;
            $('stop-total-sum').innerText = cost.toLocaleString() + ' ₸';
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
                status: 'СВОБОДЕН', started_at: null, accumulated_cost: 0, accumulated_time: 0, paused: false, active_check_id: null 
            }).eq('id', id);

            app.ui.closeSidePanel('side-stop-table');
            app.ui.toast(`Чек на ${cost}₸ создан!`, 'success');
            app.logActivity(`⏹ Остановлен Стол ${id}. Чек: ${cost}₸`);
        },

        togglePause: async (id) => {
            let t = app.state.tables.find(x => x.id === id);
            if (t.paused) {
                await supabase.from('tables').update({ paused: false, started_at: Date.now() }).eq('id', id);
                app.logActivity(`▶ Снята пауза (Стол ${id})`);
            } else {
                let ms = (t.accumulated_time || 0) + (Date.now() - t.started_at);
                let cost = app.math.getCost(t);
                await supabase.from('tables').update({ paused: true, accumulated_time: ms, accumulated_cost: cost, started_at: null }).eq('id', id);
                app.logActivity(`⏸ Пауза (Стол ${id})`);
            }
        }
    };
}
