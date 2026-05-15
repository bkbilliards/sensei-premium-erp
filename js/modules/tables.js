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
                
                // ЛОГИКА ERP: Разные кнопки для разных состояний
                let btnsFree = `
                    <button class="btn-gold flex-1" onclick="app.tables.quickStart(${t.id})">▶ ПУСК</button>
                    <button class="btn-dark" style="width: 60px;" onclick="app.ui.toast('Бронь стола', 'warning')">📅</button>
                    <button class="btn-dark" style="width: 60px;" onclick="app.ui.toast('Настройки', 'warning')">⚙️</button>`;
                
                let btnsActive = `
                    <button class="btn-danger flex-1" onclick="app.tables.openStopPanel(${t.id})">⏹ СТОП</button>
                    <button class="btn-dark" style="width: 50px;" onclick="app.ui.toast('Бар', 'warning')">🍹</button>
                    <button class="btn-dark" style="width: 50px;" onclick="app.tables.togglePause(${t.id})">${t.paused ? '▶' : '⏸'}</button>
                    <button class="btn-dark" style="width: 50px;" onclick="app.ui.toast('Печать предчека', 'success')">🧾</button>`;

                return `
                <div class="table-card ${cls}">
                    <div class="flex-between mb-15">
                        <span class="t-num">СТОЛ ${t.id}</span>
                        <span class="t-timer" id="timer-${t.id}">${isPlaying ? '00:00' : '--:--'}</span>
                    </div>
                    
                    <div class="flex-between align-center mb-20" style="min-height: 40px;">
                        <div class="flex-column">
                            <span class="t-cost" id="sum-${t.id}">${isPlaying ? cost + ' ₸' : (t.accumulated_cost ? t.accumulated_cost + ' ₸' : 'Свободен')}</span>
                        </div>
                        ${isPlaying ? `
                        <div class="flex-column text-right gap-5">
                            <span class="badge" style="background:rgba(255,255,255,0.05); color:#828282;">👤 ${t.active_check_id || 'Гость'}</span>
                            <span class="badge" style="background:rgba(212,175,55,0.1); color:var(--gold);">🍹 0 ₸</span>
                        </div>` : ''}
                    </div>
                    
                    <div class="flex-row mt-auto">
                        ${isPlaying ? btnsActive : btnsFree}
                    </div>
                </div>`;
            }).join('');
        },

        quickStart: async (id) => {
            app.ui.playSound('start');
            await supabase.from('tables').update({ 
                status: 'В ИГРЕ', started_at: Date.now(), accumulated_cost: 0, accumulated_time: 0, paused: false,
                current_players: 2, active_check_id: `Гость`
            }).eq('id', id);
            app.ui.toast(`Стол ${id} запущен`, 'success');
            app.logActivity(`Старт: Стол ${id}`, '▶');
        },

        openStopPanel: (id) => {
            let t = app.state.tables.find(x => x.id === id);
            let cost = app.math.getCost(t);
            $('stop-table-id').innerText = id;
            $('stop-total-sum').innerText = cost.toLocaleString() + ' ₸';
            $('stop-guest-name').value = t.active_check_id === 'Гость' ? `Гость ${id}` : t.active_check_id;
            app.ui.openSidePanel('side-stop-table');
        },

        confirmStop: async () => {
            let id = parseInt($('stop-table-id').innerText);
            let name = $('stop-guest-name').value.trim() || `Гость ${id}`;
            let t = app.state.tables.find(x => x.id === id);
            let cost = app.math.getCost(t);
            let playedMs = (t.accumulated_time || 0) + (Date.now() - t.started_at);

            await supabase.from('active_checks').insert([{
                id: Date.now(), table_id: id.toString(), guest_name: name, time_amount: cost, total: cost, created_by: app.session.user.name, 
                created_at: new Date().toISOString(), played_ms: playedMs 
            }]);

            await supabase.from('tables').update({ 
                status: 'СВОБОДЕН', started_at: null, accumulated_cost: cost, accumulated_time: 0, paused: false, active_check_id: null 
            }).eq('id', id);

            app.ui.closeSidePanel('side-stop-table');
            app.ui.toast(`Счет передан на кассу`, 'success');
            app.logActivity(`Стоп: Стол ${id} (${cost} ₸)`, '⏹');
        },

        togglePause: async (id) => {
            let t = app.state.tables.find(x => x.id === id);
            if (t.paused) {
                await supabase.from('tables').update({ paused: false, started_at: Date.now() }).eq('id', id);
                app.logActivity(`Игра: Стол ${id}`, '▶');
            } else {
                let ms = (t.accumulated_time || 0) + (Date.now() - t.started_at);
                let cost = app.math.getCost(t);
                await supabase.from('tables').update({ paused: true, accumulated_time: ms, accumulated_cost: cost, started_at: null }).eq('id', id);
                app.logActivity(`Пауза: Стол ${id}`, '⏸');
            }
        }
    };
}
