export function initTables(app, supabase) {
    const $ = i => document.getElementById(i);

    return {
        render: () => {
            const grid = $('tablesGrid');
            if (!grid) return;
            
            if (!app.state.tables || app.state.tables.length === 0) {
                grid.innerHTML = '<h3 class="gold-text text-center w-100">Загрузка столов из базы...</h3>';
                return;
            }

            // Отрисовываем 6 столов
            grid.innerHTML = app.state.tables.sort((a,b)=>a.id-b.id).map(t => {
                let isPlaying = t.status === 'В ИГРЕ';
                let cls = isPlaying ? 'playing' : '';
                let cost = isPlaying ? app.math.getCost(t) : 0;
                
                let btns = !isPlaying 
                    ? `<button class="btn-primary w-100" onclick="app.tables.start(${t.id})">▶ ПУСК СТОЛА ${t.id}</button>` 
                    : `<button class="btn-danger w-100" onclick="app.tables.stop(${t.id})">■ СТОП СТОЛА ${t.id}</button>`;
                
                return `
                <div class="table-ui">
                    <div class="billiard-cloth ${cls}">
                        <div class="t-num">${t.id}</div>
                        <div class="t-timer" id="timer-${t.id}">${isPlaying ? '00:00:00' : 'СВОБОДЕН'}</div>
                    </div>
                    <div class="t-cost" id="sum-${t.id}">${isPlaying ? cost + ' ₸' : ''}</div>
                    <div class="flex-row gap-10 mt-10">
                        ${btns}
                    </div>
                </div>`;
            }).join('');
        },

        // Запуск стола (отправляем сигнал в базу)
        start: async (id) => {
            const { error } = await supabase
                .from('tables')
                .update({ 
                    status: 'В ИГРЕ', 
                    started_at: Date.now(), 
                    accumulated_cost: 0,
                    accumulated_time: 0,
                    paused: false 
                })
                .eq('id', id);
                
            if(error) alert("Ошибка запуска: " + error.message);
        },

        // Остановка стола (пока простая, позже прикрутим создание чека)
        stop: async (id) => {
            const { error } = await supabase
                .from('tables')
                .update({ 
                    status: 'СВОБОДЕН', 
                    started_at: null,
                    accumulated_cost: 0,
                    accumulated_time: 0,
                    paused: false 
                })
                .eq('id', id);
                
            if(error) alert("Ошибка остановки: " + error.message);
        }
    };
}
