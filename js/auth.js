/* =========================================================
   로그인 / 로그아웃
========================================================= */
let appStarted = false;
function showLoginError(msg){
  document.getElementById('loginErr').textContent = msg || '';
}
async function afterLogin(){
  let allowed = false;
  try { allowed = must(await sb.rpc('is_allowed_user')); } catch (e) { allowed = false; }
  if (!allowed){
    await sb.auth.signOut();
    document.getElementById('loginBack').classList.remove('hidden');
    showLoginError('이 계정은 접근 권한이 없습니다.');
    return;
  }
  document.getElementById('loginBack').classList.add('hidden');
  document.getElementById('logoutBtn').style.display = '';
  if (!appStarted){ appStarted = true; startApp(); }
}
async function doLogin(ev){
  ev.preventDefault();
  const btn = document.getElementById('loginBtn');
  btn.disabled = true; showLoginError('');
  const res = await sb.auth.signInWithPassword({
    email: document.getElementById('loginEmail').value.trim(),
    password: document.getElementById('loginPw').value
  });
  btn.disabled = false;
  if (res.error){ showLoginError('이메일 또는 비밀번호가 올바르지 않습니다.'); return; }
  afterLogin();
}
async function doLogout(){
  await sb.auth.signOut();
  location.reload();
}
document.addEventListener('DOMContentLoaded', async function(){
  const res = await sb.auth.getSession();
  if (res.data && res.data.session) afterLogin();
});

