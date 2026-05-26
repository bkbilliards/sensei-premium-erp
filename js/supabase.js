const SUPABASE_URL = 'https://huryvmmweiyfgmumzxzh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1cnl2bW13ZWl5ZmdtdW16eHpoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4MDc3MzAsImV4cCI6MjA5NDM4MzczMH0._kHBRzXqiQ16Lo1vz8xUeZnJBIv1bTpG5iX-3FZKhAg';

export const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

export const session = { isAuth: false, user: null };

export const saveSession = () => localStorage.setItem('sensei_session', JSON.stringify(session));
export const loadSession = () => {
    const s = localStorage.getItem('sensei_session');
    if (s) Object.assign(session, JSON.parse(s));
};
