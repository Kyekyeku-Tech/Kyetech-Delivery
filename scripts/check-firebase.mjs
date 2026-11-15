import { loadEnv } from 'vite';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
const env=loadEnv('development',process.cwd(),'');
const fields={apiKey:'API_KEY',authDomain:'AUTH_DOMAIN',projectId:'PROJECT_ID',storageBucket:'STORAGE_BUCKET',messagingSenderId:'MESSAGING_SENDER_ID',appId:'APP_ID'};
const config=Object.fromEntries(Object.entries(fields).map(([name,suffix])=>[name,env['VITE_FIREBASE_'+suffix]||env['NEXT_PUBLIC_FIREBASE_'+suffix]||'']));
for(const [name,value] of Object.entries(config))console.log(name+': '+(value?'present ('+value.length+' characters)':'MISSING'));
console.log('API key shape: '+(/^AIza[A-Za-z0-9_-]{35}$/.test(config.apiKey)?'valid Firebase web key format':'does not match the usual Firebase web key format'));
let app;
try{
  app=initializeApp(config,'kyetech-config-check');getAuth(app);getFirestore(app);
  console.log('Firebase SDK startup: PASS (no account or database writes performed).');
  if(process.argv.includes('--live')) {
    const response=await fetch('https://identitytoolkit.googleapis.com/v1/projects?key='+encodeURIComponent(config.apiKey));
    const result=await response.json();
    console.log('Firebase API configuration check: HTTP '+response.status);
    if(response.ok) console.log('API key accepted. Localhost authorized: '+Boolean(result.authorizedDomains?.includes('localhost')));
    else {
      let message=String(result.error?.message||'API configuration request failed');
      for(const value of Object.values(config))if(value.length>7)message=message.replaceAll(value,'[redacted]');
      console.log('Firebase API reason: '+message);process.exitCode=1;
    }
  }
}
catch(error){console.log('Firebase SDK startup: FAIL ('+(error.code||'unknown-error')+').');process.exitCode=1;}
finally{if(app)await deleteApp(app);}
