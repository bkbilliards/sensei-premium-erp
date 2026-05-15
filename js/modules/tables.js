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
                let statusText = isPlaying ? (t.paused ? 'ПАУЗА' : 'В ИГРЕ') : 'СВОБОДЕН';
                let cost = isPlaying ? app.math.getCost(t) : 0;
                
                // Умный текст для пустого стола
                let idleInfo = '';
                if (!isPlaying) {
                    if (t.accumulated_cost > 0) {
                        idleInfo = `Последний чек: <b class="text-white">${t.accumulated_cost} ₸</b>`;
                    } else {
                        idleInfo = 'Стол готов к игре';
                    }
                }

                // Иконки вместо текста для второстепенных действий
                let btnsFree = `
                    <button class="btn-primary flex-1 shadow-gold" onclick="app.tables.openStartPanel(${t.id})">▶ ПУСК</button>
                    <button class="btn-secondary flex-1" onclick="app.ui.toast('Бронь скоро', 'warning')">📅</button>
                    <button class="btn-ghost" style="width:40px;" onclick="app.ui.toast('Настройки', 'warning')">⚙️</button>`;
                
                let btnsActive = `
                    <button class="btn-danger flex-1" onclick="app.tables.openStopPanel(${t.id})">⏹ СТОП</button>
                    <button class="btn-secondary flex-1" onclick="app.ui.toast('Бар скоро', 'warning')">🍹 БАР</button>
                    <button class="btn-secondary flex-1" onclick="app.tables.togglePause(${t.id})">${t.paused ? '▶ ИГРАТЬ' : '⏸ ПАУЗА'}</button>
                    <button class="btn-ghost" style="width:40px;" onclick="app.ui.toast('Перенос', 'warning')">🔁</button>`;

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
                    <div class="t-info mb-20 flex-between">
                        ${isPlaying ? `<span>👥 ${t.current_players || 2} игрока</span> <span class="gold-text">👤 ${t.active_check_id || 'Гость'}</span>` : `<span class="muted-text">${idleInfo}</span>`}
                    </div>
                    <div class="flex-row gap-10 mt-auto">
                        ${isPlaying ? btnsActive : btnsFree}
                    </div>
                </div>`;
            }).join('');
        },

        // --- ВЫБОР ИГРОКОВ В SIDE PANEL ---
        setPlayers: (num, btnEl) => {
            $('start-players').value = num;
            // Убираем активный класс у всех кнопок в этой группе
            const btns = btnEl.parentElement.querySelectorAll('button');
            btns.forEach(b => {
                b.className = 'btn-secondary flex-1';
            });
            // Делаем нажатую золотой
            btnEl.className = 'btn-primary flex-1 shadow-gold';
        },

        openStartPanel: (id) => {
            $('start-table-id').innerText = id;
            $('start-guest-name').value = '';
            app.tables.setPlayers(2, document.getElementById('btn-p2')); // По умолчанию 2
            app.ui.openSidePanel('side-start-table');
        },

        confirmStart: async () => {
            let id = parseInt($('start-table-id').innerText);
            let name = $('start-guest-name').value.trim() || `Гость (Стол ${id})`;
            let players = parseInt($('start-players').value) || 2;

            await supabase.from('tables').update({ 
                status: 'В ИГРЕ', started_at: Date.now(), accumulated_cost: 0, accumulated_time: 0, paused: false,
                current_players: players, active_check_id: name
            }).eq('id', id);

            app.ui.closeSidePanel('side-start-table');
            app.ui.toast(`▶ Стол ${id} в игре!`, 'success');
            app.logActivity(`▶ Старт: Стол ${id} (${name})`, 'start');
        },

        openStopPanel: (id) => {
            let t = app.state.tables.find(x => x.id === id);
            let cost = app.math.getCost(t);
            let ms = (t.accumulated_time || 0) + (Date.now() - t.started_at);
            
            $('stop-table-id').innerText = id;
            $('stop-time-played').innerText = app.math.formatTime(ms);
            $('stop-total-sum').innerText = cost.toLocaleString() + ' ₸';
            $('stop-guest-name').value = t.active_check_id || `Гость ${id}`;
            app.ui.openSidePanel('side-stop-table');
        },

        confirmStop: async () => {
            let id = parseInt($('stop-table-id').innerText);
            let name = $('stop-guest-name').value.trim();
            let t = app.state.tables.find(x => x.id === id);
            let cost = app.math.getCost(t);

            // 1. Создаем чек в БД
            await supabase.from('active_checks').insert([{
                id: Date.now(), table_id: id.toString(), guest_name: name, time_amount: cost, total: cost, created_by: app.session.user.name
            }]);

            // 2. Освобождаем стол (но сохраняем последнюю сумму для истории)
            await supabase.from('tables').update({ 
                status: 'СВОБОДЕН', started_at: null, accumulated_cost: cost, accumulated_time: 0, paused: false, active_check_id: null 
            }).eq('id', id);

            app.ui.closeSidePanel('side-stop-table');
            app.ui.toast(`Чек перенесен в ожидание оплаты!`, 'success');
            app.logActivity(`⏹ Остановка: Стол ${id}. Счёт: ${cost} ₸`, 'stop');
        },

        togglePause: async (id) => {
            let t = app.state.tables.find(x => x.id === id);
            if (t.paused) {
                await supabase.from('tables').update({ paused: false, started_at: Date.now() }).eq('id', id);
                app.logActivity(`▶ Снята пауза: Стол ${id}`, 'start');
            } else {
                let ms = (t.accumulated_time || 0) + (Date.now() - t.started_at);
                let cost = app.math.getCost(t);
                await supabase.from('tables').update({ paused: true, accumulated_time: ms, accumulated_cost: cost, started_at: null }).eq('id', id);
                app.logActivity(`⏸ Пауза: Стол ${id}`, 'pause');
            }
        }
    };
}
