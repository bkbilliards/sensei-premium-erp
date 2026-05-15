export function initAuth(app, supabase) {
    const $ = i => document.getElementById(i);
    let staffList = [];

    return {
        checkSession: () => {
            app.loadSession();
            app.render();
        },

        renderStaff: async () => {
            let fallbackStaff = [
                { id: 1, name: "Хозяин", pin: "1201", role: "owner" },
                { id: 2, name: "Султан", pin: "1111", role: "admin" },
                { id: 3, name: "Дидар", pin: "2222", role: "admin" }
            ];

            try {
                const { data, error } = await supabase.from('users').select('*').eq('active', true);
                if (data && data.length > 0) staffList = data;
                else staffList = fallbackStaff;
            } catch (e) {
                staffList = fallbackStaff;
            }
            
            let selectEl = $('staffSelect');
            if (selectEl) {
                selectEl.innerHTML = '<option value="" disabled selected>-- Выберите себя --</option>' + 
                    staffList.map(s => `<option value="${s.name}">${s.role === 'owner' ? '👑 ' : ''}${s.name}</option>`).join('');
            }
                
            let btnLogin = $('btn-login');
            if (btnLogin) {
                btnLogin.onclick = () => {
                    const selectedName = selectEl.value;
                    const enteredPin = $('pinInput').value.trim();
                    
                    if (!selectedName) return alert("❌ Выберите ваше имя из списка!");

                    const user = staffList.find(s => s.name === selectedName);
                    
                    if (user && String(user.pin).trim() === String(enteredPin)) {
                        app.session.isAuth = true;
                        app.session.user = user;
                        app.session.activeAdminName = user.name;
                        app.saveSession();
                        $('pinInput').value = '';
                        app.ui.toast(`Добро пожаловать, ${user.name}!`, 'success');
                        app.render(); 
                    } else {
                        app.ui.toast("❌ Неверный PIN-код!", 'danger');
                    }
                };
            }
        },

        logout: () => {
            if (confirm("Выйти из системы?")) {
                app.session.isAuth = false;
                app.session.user = null;
                app.saveSession();
                app.render();
            }
        }
    };
}
