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
                
                // Роли
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
                
                if (data && data.length > 0) {
                    sel.innerHTML = data.map(u => `<option value="${u.id}">${u.name} (${u.role})</option>`).join('');
                } else {
                    sel.innerHTML = '<option value="">База пуста! Создайте пользователя в Supabase</option>';
                }
            } catch(e) {
                console.error("Auth Error:", e);
                sel.innerHTML = '<option value="">Ошибка подключения к БД</option>';
            }
        },
        login: async () => {
            const uid = $('staffSelect').value; const pin = $('pinInput').value;
            if(!uid) return app.ui.toast('Выберите сотрудника', 'danger');
            try {
                const { data: user, error } = await supabase.from('users').select('*').eq('id', uid).eq('pin', pin).single();
                if(error || !user) throw new Error('Неверный PIN');
                app.session.isAuth = true; app.session.user = user; app.saveSession();
                app.ui.toast('Авторизация успешна', 'success');
                app.auth.checkSession();
            } catch(e) { app.ui.toast(e.message, 'danger'); }
        }
    };
}
