import { config } from './config';
import { Store } from './db';
import { GmailClient } from './gmail';
import { startPoller } from './poller';
import { buildServer } from './server';
import { bindSettings, configProblems } from './settings';

const store = new Store();
bindSettings(store);
const gmail = new GmailClient(store);
const poller = startPoller({ store, gmail });
const app = buildServer({ store, gmail, poller });

// Somente 127.0.0.1: nada de expor este app na rede.
await app.listen({ host: '127.0.0.1', port: config.port });
console.log(`\nAssistente de e-mail rodando em http://127.0.0.1:${config.port}`);
for (const p of configProblems(store)) console.log(`  ! falta configurar: ${p}`);
if (!gmail.isConnected()) console.log('  ! Gmail não conectado: abra o endereço acima e clique em "Conectar Gmail".');

const shutdown = () => { poller.stop(); void app.close().then(() => process.exit(0)); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
