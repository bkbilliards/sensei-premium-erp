export function initTables(app, supabase) {
    const $ = i => document.getElementById(i);

    return {
        render: () => {
            const grid = $('tablesGrid');
            if (!grid) return;
            if (!app.state.tables || app.state.tables.length === 0) return;

            grid.innerHTML = app.state.tables.sort((a,b)=>a.id-b.id).map(t => {
                let isPlaying = t.status === 'В ИГРЕ';
                let isPaused = t.paused;
                let cls = isPlaying ? (isPaused ? 'paused' : 'playing') : 'free';
                let rentCost = isPlaying ? app.math.getCost(t) : 0;
                let barCost = t.bar_amount || 0;
                let totalCost = rentCost + barCost;
                
                let btnsFree = `
                    <button class="btn-gold flex-1" onclick="app.tables.quickStart(${t.id})">▶ ПУСК</button>
                    <button class="btn-dark" style="width: 50px;" onclick="app.ui.toast('Бронь', 'warning')">📅</button>
                    <button class="btn-dark" style="width: 50px;" onclick="app.tables.openManage(${t.id})">⚙</button>`;
                
                let btnsActive = `
                    <button class="btn-dark" style="width: 50px;" onclick="app.tables.togglePause(${t.id})">${isPaused ? '▶' : '⏸'}</button>
                    <button class="btn-dark" style="flex: 1;" onclick="app.tables.openBarForTable(${t.id})">🍹 БАР</button>
                    <button class="btn-danger" style="flex: 1;" onclick="app.tables.openStopPanel(${t.id})">💳 ОПЛАТА</button>
                    <button class="btn-dark" style="width: 50px;" onclick="app.tables.openManage(${t.id})">⚙</button>`;

                return `
                <div class="table-card ${cls}">
                    <div class="table-cloth"></div>
                    <div class="table-content flex-column h-100">
                        
                        <div class="flex-between align-center mb-10">
                            <span class="t-num"><span class="t-status-dot"></span>СТОЛ ${t.id}</span>
                            ${isPlaying ? `<span class="badge" style="background: rgba(0,0,0,0.5);"><span class="icon text-10">👤</span> ${t.active_check_id || 'Гость'}</span>` : ''}
                        </div>
                        
                        <div class="t-center-info my-auto">
                            ${isPlaying ? `
                                <div class="t-timer font-mono" id="timer-${t.id}">00:00:00</div>
                                <div class="flex-row justify-center gap-10 mt-5">
                                    <span class="t-cost gold-text font-mono">${totalCost.toLocaleString()} ₸</span>
                                </div>
                                ${barCost > 0 ? `<div class="muted-text text-10 mt-5">БАР: ${barCost.toLocaleString()} ₸</div>` : ''}
                            ` : `
                                <div class="t-idle-text muted-text">СВОБОДЕН</div>
                            `}
                        </div>
                        
                        <div class="flex-row mt-auto pt-15" style="border-top: 1px solid rgba(255,255,255,0.05);">
                            ${isPlaying ? btnsActive : btnsFree}
                        </div>
                    </div>
                </div>`;
            }).join('');
        },

        quickStart: async (id) => {
            app.ui.playSound('start');
            await supabase.from('tables').update({ 
                status: 'В ИГРЕ', started_at: Date.now(), accumulated_cost: 0, accumulated_time: 0, bar_amount: 0, paused: false,
                current_players: 2, active_check_id: `Гость`
            }).eq('id', id);
            app.ui.toast(`Стол ${id} запущен`, 'success');
            app.logActivity(`Запущен Стол ${id}`, '🟢');
        },

        openManage: (id) => {
            let t = app.state.tables.find(x => x.id === id);
            $('manage-table-id').innerText = id;
            
            if (t.status === 'В ИГРЕ') {
                $('manage-actions-active').classList.remove('hidden');
                $('manage-actions-free').classList.add('hidden');
                let ms = (t.accumulated_time || 0) + (Date.now() - t.started_at);
                $('manage-timer').innerText = app.math.formatTime(ms);
                $('manage-cost').innerText = (app.math.getCost(t) + (t.bar_amount || 0)) + ' ₸';
            } else {
                $('manage-actions-active').classList.add('hidden');
                $('manage-actions-free').classList.remove('hidden');
                $('manage-timer').innerText = '--:--:--';
                $('manage-cost').innerText = t.accumulated_cost ? t.accumulated_cost + ' ₸' : 'Ожидание';
            }
            app.ui.openSidePanel('side-manage-table');
        },

        togglePause: async (id) => {
            let t = app.state.tables.find(x => x.id === id);
            if (t.paused) {
                await supabase.from('tables').update({ paused: false, started_at: Date.now() }).eq('id', id);
                app.ui.toast(`Игра продолжена`, 'success');
                app.logActivity(`Продолжение: Стол ${id}`, '▶');
            } else {
                let ms = (t.accumulated_time || 0) + (Date.now() - t.started_at);
                let cost = app.math.getCost(t);
                await supabase.from('tables').update({ paused: true, accumulated_time: ms, accumulated_cost: cost, started_at: null }).eq('id', id);
                app.ui.toast(`Стол на паузе`, 'warning');
                app.logActivity(`Пауза: Стол ${id}`, '⏸');
            }
        },

        togglePauseFromManage: () => {
            let id = parseInt($('manage-table-id').innerText);
            app.tables.togglePause(id);
            app.ui.closeSidePanel('side-manage-table');
        },

        openBarForTable: (id) => {
            app.switchTab('stock');
            let select = $('pos-target');
            if(select) { select.value = id; if(app.pos) app.pos.updateTargetUI(); }
        },

        openStopPanel: (id) => {
            let t = app.state.tables.find(x => x.id === id);
            let rent = app.math.getCost(t);
            let bar = t.bar_amount || 0;
            $('stop-table-id').innerText = id;
            $('stop-rent-sum').innerText = rent.toLocaleString() + ' ₸';
            $('stop-bar-sum').innerText = bar.toLocaleString() + ' ₸';
            $('stop-total-sum').innerText = (rent + bar).toLocaleString() + ' ₸';
            $('stop-guest-name').value = t.active_check_id || '';
            app.ui.openSidePanel('side-stop-table');
        },

        confirmStop: async () => {
            let id = parseInt($('stop-table-id').innerText);
            let name = $('stop-guest-name').value.trim() || `Гость ${id}`;
            let t = app.state.tables.find(x => x.id === id);
            let rent = app.math.getCost(t);
            let bar = t.bar_amount || 0;
            let total = rent + bar;
            let playedMs = (t.accumulated_time || 0) + (Date.now() - t.started_at);

            await supabase.from('active_checks').insert([{
                id: Date.now(), table_id: id.toString(), guest_name: name, time_amount: rent, bar_amount: bar, total: total, created_by: app.session.user.name, 
                created_at: new Date().toISOString(), played_ms: playedMs 
            }]);

            await supabase.from('tables').update({ 
                status: 'СВОБОДЕН', started_at: null, accumulated_cost: total, accumulated_time: 0, bar_amount: 0, paused: false, active_check_id: null 
            }).eq('id', id);

            app.ui.closeSidePanel('side-stop-table');
            app.ui.playSound('pay');
            app.ui.toast(`Счет передан на кассу`, 'success');
            app.logActivity(`Остановлен: Стол ${id}`, '⏹');
        }
    };
}
