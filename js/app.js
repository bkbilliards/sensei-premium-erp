// ... (Остальной код app.js остается прежним, обнови только блок setupHotkeys и ui.playSound)

    setupHotkeys: () => {
        document.addEventListener('keydown', (e) => {
            // Мгновенное закрытие модалок на ESC
            if (e.key === 'Escape') {
                app.closeModals();
            }
            // Подтверждение оплаты в модалке по ENTER
            if (e.key === 'Enter') {
                const payModal = $('modal-pay');
                if (payModal && !payModal.classList.contains('hidden')) {
                    // По умолчанию пробиваем НАЛ при Enter
                    app.confirmPay('НАЛ');
                }
            }
        });
    },

    ui: {
        toast: (msg, type='success') => {
            const c = $('toast-container'); if(!c) return;
            const t = document.createElement('div');
            t.className = `toast toast-${type}`;
            t.innerText = msg;
            c.appendChild(t);
            setTimeout(() => t.remove(), 2500);
        },
        openSidePanel: (id) => { $(id).classList.add('active'); },
        closeSidePanel: (id) => { $(id).classList.remove('active'); },
        openModal: (id) => { $(id).classList.remove('hidden'); },
        
        // Мягкий, дорогой звук (без резкого писка)
        playSound: (type) => {
            try {
                const ctx = new (window.AudioContext || window.webkitAudioContext)();
                const osc = ctx.createOscillator(); 
                const gain = ctx.createGain();
                osc.connect(gain); 
                gain.connect(ctx.destination);
                
                if(type === 'start') { 
                    osc.frequency.setValueAtTime(400, ctx.currentTime); 
                    osc.type = 'sine'; 
                    gain.gain.setValueAtTime(0.01, ctx.currentTime); 
                    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3); 
                    osc.start(); osc.stop(ctx.currentTime + 0.3); 
                }
                if(type === 'pay') { 
                    osc.frequency.setValueAtTime(600, ctx.currentTime); 
                    osc.frequency.setValueAtTime(900, ctx.currentTime + 0.1); 
                    osc.type = 'triangle'; 
                    gain.gain.setValueAtTime(0.01, ctx.currentTime); 
                    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.2); 
                    osc.start(); osc.stop(ctx.currentTime + 0.2); 
                }
            } catch(e){}
        }
    },
// ...
