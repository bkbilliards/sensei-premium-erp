export function initAuth(app, supabase) {
    const $ = id => document.getElementById(id);
    return {
        checkSession: () => {
            app.loadSession();
            if (!app.session.isAuth) {
                $('authScreen').classList.remove('hidden'); 
                $('appScreen').classList.add('hidden');
                app.auth.renderStaff();
            } else {
                $('authScreen').classList.add('hidden'); 
                $('appScreen').classList.remove('hidden');
                $('userName').innerText = app.session.user.name;
                
                document.querySelectorAll('.owner-only').forEach(el => {
                    el.style.display = app.session.user.role === 'owner' ? 'flex' : 'none';
                });
                
                app.tables.load(); 
                app.loadChecks();
            }
        },
        renderStaff: async () => {
            const sel = $('staffSelect'); if(!sel) return;
            try {
                const { data, error } = await supabase.from('users').select('*');
                if (error) throw error;
                
                // СМАРТ РЕКАВЕРИ: Если таблица users пустая - создаем резервные логины на лету!
                let usersList = data;
                if (!usersList || usersList.length === 0) {
                    usersList = [
                        { id: 998, name: "Хозяин (Резерв)", role: "owner", pin: "0000" },
                        { id: 999, name: "Админ (Резерв)", role: "admin", pin: "1111" }
                    ];
                    app.ui.toast("Внимание: БД персонала пуста. Включен резервный режим (0000 / 1111)", "warning");
                }
                
                sel.innerHTML = usersList.map(u => `<option value="${u.pin}" data-user='${JSON.stringify(u)}'>${u.name} (${u.role})</option>`).join('');
                
            } catch(e) {
                console.error("Auth Load Error:", e);
                sel.innerHTML = '<option value="0000" data-user=\'{"id":0,"name":"Local Admin","role":"owner","pin":"0000"}\'>Оффлайн режим (0000)</option>';
            }
        },
        login: async () => {
            const sel = $('staffSelect');
            const pinInput = $('pinInput').value;
            const selectedOpt = sel.options[sel.selectedIndex];
            
            if(!selectedOpt) return;
            const correctPin = selectedOpt.value;
            const userObj = JSON.parse(selectedOpt.dataset.user);
            
            if (pinInput === correctPin) {
                app.session.isAuth = true; 
                app.session.user = userObj; 
                app.saveSession();
                app.ui.toast('Авторизация успешна', 'success');
                app.auth.checkSession();
            } else {
                app.ui.toast('Неверный PIN', 'danger');
            }
        }
    };
}
