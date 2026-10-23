import {createRoot} from 'react-dom/client';
import App from '/src/App.tsx';
import {setAnalyticsEnabled,setEmailGateDone} from '/src/lib/analytics';
import {applySkin} from '/src/lib/skins';
import '/src/styles.css';

const info=await fetch('/__fixture/info').then(response=>response.json());
setAnalyticsEnabled(false);
setEmailGateDone('skipped');
localStorage.setItem('openmausbot.lastConversation.v1',info.botId);
applySkin(new URLSearchParams(location.search).get('theme')==='light'?'light':'dark');
createRoot(document.getElementById('root')!).render(<App/>);
