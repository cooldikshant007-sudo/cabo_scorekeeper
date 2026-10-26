import { createClient } from "npm:@supabase/supabase-js@2.102.0";

const cors = {
 "Access-Control-Allow-Origin": "https://cooldikshant007-sudo.github.io",
 "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
 "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const json = (body, status=200) => new Response(JSON.stringify(body), {status, headers:{...cors,"Content-Type":"application/json"}});
Deno.serve(async request => {
 if(request.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(request.method!=="POST")return json({error:"Method not allowed"},405);
 try{
  const url=Deno.env.get("SUPABASE_URL") || "";
  const client=createClient(url,Deno.env.get("SUPABASE_ANON_KEY") || "",{global:{headers:{Authorization:request.headers.get("Authorization") || ""}},auth:{persistSession:false}});
  const {data:authData,error:authError}=await client.auth.getUser();
  if(authError || !authData.user)return json({error:"Please sign in again."},401);
  const body=await request.json().catch(()=>null);
  const email=String(body?.email || "").trim().toLowerCase();
  const communityId=String(body?.communityId || "");
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length>254 || !/^[0-9a-f-]{36}$/i.test(communityId))return json({error:"Enter a valid email and choose a community."},400);
  const {data:community,error:communityError}=await client.from("communities").select("id,owner_user_id").eq("id",communityId).maybeSingle();
  if(communityError || !community || community.owner_user_id!==authData.user.id)return json({error:"Only the community owner can add members."},403);
  const admin=createClient(url,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",{auth:{persistSession:false}});
  let target=null;
  for(let page=1;page<=100;page++){
   const {data,error}=await admin.auth.admin.listUsers({page,perPage:100});
   if(error)return json({error:"Could not find the account. Please try again."},500);
   target=data.users.find(u=>u.email?.toLowerCase()===email);
   if(target || data.users.length<100)break;
  }
  if(!target || !target.email_confirmed_at)return json({error:"Ask them to create and verify a Cabo or Poker account with this email first, then add them again."},404);
  const displayName=(String(body?.displayName || "").trim() || email.split("@")[0]).slice(0,40);
  const {error}=await admin.from("community_members").upsert({community_id:communityId,user_id:target.id,display_name:displayName},{onConflict:"community_id,user_id",ignoreDuplicates:true});
  if(error)return json({error:"Could not add this member. Please try again."},500);
  return json({message:"Member added. The community will appear when they open Game Club."});
 }catch{return json({error:"Could not add this member. Please try again."},500);}
});
