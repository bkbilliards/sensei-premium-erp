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
                let rentCost = isPlaying ? app.math.getCost(t) : 0;
                let barCost = t.bar_amount || 0;
                let totalCost = rentCost + barCost;
                let statusText = isPlaying ? (t.paused ? 'ПАУЗА' : 'В ИГРЕ') : 'СВОБОДЕН';
                
                // КНОПКИ (ИЕРАРХИЯ)
                let btnsFree = `
                    <button class="btn-gold" style="flex: 2;" onclick="app.tables.quickStart(${t.id})">▶ ПУСК</button>
                    <button class="btn-dark" style="flex: 1;" onclick="app.tables.openManage(${t.id})">⚙ МЕНЮ</button>`;
                
                let btnsActive = `
                    <button class="btn-danger" style="flex: 2;" onclick="app.tables.openStopPanel(${t.id})">⏹ СТОП</button>
                    <button class="btn-dark" style="flex: 1;" onclick="app.tables.openFastBar(${t.id})">🍹 БАР</button>
                    <button class="btn-dark" style="width: 50px;" onclick="app.tables.togglePause(${t.id})">${t.paused ? '▶' : '⏸'}</button>
                    <button class="btn-dark" style="width: 50px;" onclick="app.tables.openManage(${t.id})">⚙</button>`;

                return `
                <div class="table-card ${cls}">
                    <div class="table-cloth"></div>
                    <div class="table-content">
                        <div class="t-header">
                            <span class="t-num"><span class="t-status-dot"></span>🎱 СТОЛ ${t.id}</span>
                        </div>
                        
                        <div class="t-center-info">
                            ${isPlaying ? `
                                <div class="t-timer" id="timer-${t.id}">00:00:00</div>
                                <div class="t-cost" id="sum-${t.id}">${totalCost} ₸</div>
                            ` : `
                                <div class="t-idle-text">${t.accumulated_cost ? t.accumulated_cost + ' ₸' : 'СВОБОДЕН'}</div>
                            `}
                        </div>

                        ${isPlaying ? `
                            <div class="t-meta">
                                <span>👤 ${t.active_check_id || 'Гость'}</span>
                                ${barCost > 0 ? `<span style="background: rgba(212,175,55,0.15); color: var(--gold);">🍹 ${barCost} ₸</span>` : `<span>🍹 0 ₸</span>`}
                            </div>
                        ` : ''}
                        
                        <div class="flex-row mt-auto">
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
                let rentCost = app.math.getCost(t);
                let barCost = t.bar_amount || 0;
                $('manage-timer').innerText = app.math.formatTime(ms);
                $('manage-cost').innerText = (rentCost + barCost) + ' ₸';
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

        openFastBar: (id) => {
            let t = app.state.tables.find(x => x.id === id);
            $('bar-table-id').innerText = id;
            $('bar-total-sum').innerText = (t.bar_amount || 0) + ' ₸';
            app.ui.openSidePanel('side-fast-bar');
        },

        addBarItem: async (name, price) => {
            let id = parseInt($('bar-table-id').innerText);
            let t = app.state.tables.find(x => x.id === id);
            let currentBar = t.bar_amount || 0;
            let newBar = currentBar + price;
            
            app.ui.playSound('start');
            await supabase.from('tables').update({ bar_amount: newBar }).eq('id', id);
            
            $('bar-total-sum').innerText = newBar + ' ₸';
            app.ui.toast(`${name} добавлено`, 'success');
            app.logActivity(`Добавлен ${name} (Стол ${id})`, '🍹');
        },

        openStopPanel: (id) => {
            let t = app.state.tables.find(x => x.id === id);
            let rentCost = app.math.getCost(t);
            let barCost = t.bar_amount || 0;
            let total = rentCost + barCost;

            $('stop-table-id').innerText = id;
            $('stop-rent-sum').innerText = rentCost.toLocaleString() + ' ₸';
            $('stop-bar-sum').innerText = barCost.toLocaleString() + ' ₸';
            $('stop-total-sum').innerText = total.toLocaleString() + ' ₸';
            $('stop-guest-name').value = t.active_check_id === 'Гость' ? `Гость ${id}` : t.active_check_id;
            app.ui.openSidePanel('side-stop-table');
        },

        confirmStop: async () => {
            let id = parseInt($('stop-table-id').innerText);
            let name = $('stop-guest-name').value.trim() || `Гость ${id}`;
            let t = app.state.tables.find(x => x.id === id);
            
            let rentCost = app.math.getCost(t);
            let barCost = t.bar_amount || 0;
            let total = rentCost + barCost;
            let playedMs = (t.accumulated_time || 0) + (Date.now() - t.started_at);

            await supabase.from('active_checks').insert([{
                id: Date.now(), table_id: id.toString(), guest_name: name, time_amount: rentCost, bar_amount: barCost, total: total, created_by: app.session.user.name, 
                created_at: new Date().toISOString(), played_ms: playedMs 
            }]);

            await supabase.from('tables').update({ 
                status: 'СВОБОДЕН', started_at: null, accumulated_cost: total, accumulated_time: 0, bar_amount: 0, paused: false, active_check_id: null 
            }).eq('id', id);

            app.ui.closeSidePanel('side-stop-table');
            app.ui.toast(`Счет передан на кассу`, 'success');
            app.logActivity(`Остановлен: Стол ${id}`, '⏹');
        }
    };
}
