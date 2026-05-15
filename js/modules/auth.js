export function initAuth(app, supabase) {
    const $ = i => document.getElementById(i);
    let staffList = [];

    return {
        checkSession: () => {
            app.loadSession();
            app.render();
        },

        renderStaff: async () => {
            // Загружаем персонал из SQL таблицы users
            const { data, error } = await supabase.from('users').select('*').eq('active', true);
            
            let selectEl = $('staffSelect');
            if (data && data.length > 0) {
                staffList = data;
                if (selectEl) {
                    selectEl.innerHTML = '<option value="" disabled selected>-- Выберите сотрудника --</option>' + 
                        staffList.map(s => `<option value="${s.pin}">${s.role === 'owner' ? '👑 ' : ''}${s.name}</option>`).join('');
                }
            } else {
                if (selectEl) selectEl.innerHTML = '<option disabled>Ошибка базы данных</option>';
            }
                
            let btnLogin = $('btn-login');
            if (btnLogin) {
                btnLogin.onclick = () => {
                    const pin = $('pinInput').value;
                    const user = staffList.find(s => s.pin === pin);
                    
                    if (user) {
                        app.session.isAuth = true;
                        app.session.user = user;
                        app.session.activeAdminName = user.name;
                        app.saveSession();
                        $('pinInput').value = '';
                        app.render(); 
                    } else {
                        alert("❌ Неверный PIN-код!");
                    }
                };
            }
        },

        logout: () => {
            if (confirm("Закрыть смену и выйти?")) {
                app.session.isAuth = false;
                app.session.user = null;
                app.saveSession();
                app.render();
            }
        }
    };
}
