export function initAuth(app, supabase) {
    const $ = i => document.getElementById(i);
    let staffList = [];

    return {
        checkSession: () => {
            app.loadSession();
            app.render();
        },

        renderStaff: async () => {
            // Резервный список (сработает, если база недоступна)
            let fallbackStaff = [
                { id: 1, name: "Хозяин", pin: "1201", role: "owner" },
                { id: 2, name: "Султан", pin: "1111", role: "admin" },
                { id: 3, name: "Дидар", pin: "2222", role: "admin" }
            ];

            try {
                // Пытаемся достать данные из SQL
                const { data, error } = await supabase.from('users').select('*').eq('active', true);
                if (data && data.length > 0) {
                    staffList = data;
                } else {
                    staffList = fallbackStaff;
                }
            } catch (e) {
                console.error("Ошибка БД, используем резерв:", e);
                staffList = fallbackStaff;
            }
            
            let selectEl = $('staffSelect');
            if (selectEl) {
                selectEl.innerHTML = '<option value="" disabled selected>-- Выберите сотрудника --</option>' + 
                    staffList.map(s => `<option value="${s.name}">${s.role === 'owner' ? '👑 ' : ''}${s.name}</option>`).join('');
            }
                
            let btnLogin = $('btn-login');
            if (btnLogin) {
                btnLogin.onclick = () => {
                    const selectedName = selectEl.value; // Берем имя из выпадающего списка
                    const enteredPin = $('pinInput').value.trim(); // Убираем случайные пробелы
                    
                    if (!selectedName) {
                        alert("❌ Выберите ваше имя из списка!");
                        return;
                    }

                    // Ищем пользователя по имени
                    const user = staffList.find(s => s.name === selectedName);
                    
                    // Жестко приводим оба ПИНа к тексту и сравниваем
                    if (user && String(user.pin).trim() === String(enteredPin)) {
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
