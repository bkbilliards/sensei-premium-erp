export const supabase = window.supabase.createClient(
    'https://huryvmmweiyfgmumzxzh.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1cnl2bW13ZWl5ZmdtdW16eHpoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4MDc3MzAsImV4cCI6MjA5NDM4MzczMH0._kHBRzXqiQ16Lo1vz8xUeZnJBIv1bTpG5iX-3FZKhAg'
);

export let session = {
    isAuth: false,
    user: null,
    activeAdminName: null
};

export function saveSession() {
    localStorage.setItem('sensei_session_x', JSON.stringify(session));
}

export function loadSession() {
    const s = localStorage.getItem('sensei_session_x');
    if (s) Object.assign(session, JSON.parse(s));
}
