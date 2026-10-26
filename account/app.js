const $=s=>document.querySelector(s);
const db=window.supabase.createClient('https://jpcdbtaztovxmqruvktv.supabase.co','sb_publishable_y7nZtPY1snx7_GSAExxhLw_j9xaOoxy');
const signingIn=new URLSearchParams(location.search).get('mode')==='signin';
let busy=false,currentUser=null;
if(signingIn){
 document.title='Sign in · Game Club';
 $('#authTitle').textContent='Sign in';
 $('#submitAccount').textContent='Sign in';
 $('#accountPassword').autocomplete='current-password';
 $('#switchMode').href='./';
 $('#switchMode').textContent='New here? Create an account';
}
function renderSession(user){
 currentUser=user;
 $('#sessionCard').hidden=!user;
 $('#currentAccount').textContent=user?'You are signed in as '+user.email+'.':'';
 $('#accountForm').hidden=!!user;
}
async function loadSession(){
 try{const {data,error}=await db.auth.getSession();if(error)throw error;renderSession(data.session?.user || null);}
 catch{$('#status').textContent='Could not check your sign-in status. Please reload.';}
}
$('#signOutAccount').onclick=async()=>{
 const {error}=await db.auth.signOut();
 if(error){$('#status').textContent=error.message;return;}
 renderSession(null);$('#status').textContent='';$('#accountEmail').focus();
};
$('#accountForm').onsubmit=async event=>{
 event.preventDefault();
 if(busy || currentUser || !$('#accountForm').reportValidity())return;
 busy=true;$('#submitAccount').disabled=true;$('#status').textContent='';
 const email=$('#accountEmail').value.trim(),password=$('#accountPassword').value;
 try{
  const result=signingIn?await db.auth.signInWithPassword({email,password}):await db.auth.signUp({email,password,options:{emailRedirectTo:new URL('./',location.href).href}});
  if(result.error)throw result.error;
  $('#accountPassword').value='';
  $('#status').textContent=signingIn?'Signed in. Choose Cabo, Poker or Game Club below.':result.data?.session?'Account created. Choose a game below.':'Check your email to confirm your account, then return here to sign in.';
  if(result.data?.session)renderSession(result.data.session.user);
 }catch(error){$('#status').textContent=error.message || 'Could not connect. Please try again.';}
 finally{busy=false;$('#submitAccount').disabled=false;}
};
db.auth.onAuthStateChange((_event,session)=>renderSession(session?.user || null));
loadSession();
