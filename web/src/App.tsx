import { marked } from 'marked';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, type Item, type PublicSettings, type Risk, type SettingsPatch, type StatusInfo } from './api';

const RISK_LABEL: Record<Risk, string> = { low: 'Baixo', medium: 'Médio', high: 'Alto' };
const STATUS_LABEL: Record<string, string> = { pending: 'Aguardando', sent: 'Enviado', discarded: 'Descartado', error: 'Erro', ignored: 'Ignorado' };

type Page = 'fila' | 'config' | 'docs';

function ago(iso: string | null): string {
  if (!iso) return 'nunca';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'agora há pouco';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  return new Date(iso).toLocaleDateString('pt-BR');
}

export function App() {
  const [page, setPage] = useState<Page>('fila');
  const [status, setStatus] = useState<StatusInfo | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>('Notification' in window ? Notification.permission : 'unsupported');
  const [welcomed, setWelcomed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [s, list] = await Promise.all([api.status(), api.items(filter)]);
      setStatus(s);
      setItems(list);
      setError(null);
      if (!welcomed && s.setup && !s.setup.ready) {
        setPage('config');
        setWelcomed(true);
      } else if (!welcomed) {
        setWelcomed(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [filter, welcomed]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const es = new EventSource('/api/events');
    es.onmessage = (m) => {
      const e = JSON.parse(m.data) as { type: string; status?: string };
      if (e.type === 'item' && e.status === 'pending' && 'Notification' in window && Notification.permission === 'granted') {
        new Notification('Novo e-mail aguardando aprovação', { body: 'Há um rascunho de resposta pronto para revisar.' });
      }
      void refresh();
    };
    return () => es.close();
  }, [refresh]);

  const pendingCount = status?.counts.pending ?? 0;
  useEffect(() => { document.title = pendingCount ? `(${pendingCount}) Assistente de e-mail` : 'Assistente de e-mail'; }, [pendingCount]);

  const selected = useMemo(() => items.find((i) => i.id === selectedId) ?? null, [items, selectedId]);
  useEffect(() => { if (selectedId === null && items.length) setSelectedId(items[0].id); }, [items, selectedId]);

  return (
    <div className="app">
      <header className="top">
        <div className="brand-nav">
          <h1>Assistente de e-mail</h1>
          <nav className="nav">
            <button className={page === 'fila' ? 'nav-btn on' : 'nav-btn'} onClick={() => setPage('fila')}>Fila</button>
            <button className={page === 'config' ? 'nav-btn on' : 'nav-btn'} onClick={() => setPage('config')}>Configuração</button>
            <button className={page === 'docs' ? 'nav-btn on' : 'nav-btn'} onClick={() => setPage('docs')}>Documentos</button>
          </nav>
        </div>
        {page === 'fila' && (
          <div className="chips">
            {status?.gmail.connected ? (
              <span className="chip ok" title="Caixa conectada">● {status.gmail.email ?? 'Gmail conectado'}</span>
            ) : (
              <a className="btn primary" href="/auth/google">{status?.gmail.needsReauth ? 'Reconectar Gmail' : 'Conectar Gmail'}</a>
            )}
            <span className="chip">Última verificação: {ago(status?.lastPollAt ?? null)}</span>
            <button className="btn" onClick={() => void api.poll().then(refresh)} disabled={!status?.gmail.connected}>Verificar agora</button>
            {perm === 'default' && <button className="btn" onClick={() => void Notification.requestPermission().then(setPerm)}>Ativar avisos</button>}
            {status?.gmail.connected && <button className="btn link" onClick={() => void api.disconnect().then(refresh)}>Desconectar</button>}
          </div>
        )}
      </header>

      {error && <div className="banner error">{error}</div>}
      {status?.lastError && page === 'fila' && <div className="banner error">Problema na última verificação: {status.lastError}</div>}
      {status && status.problems.length > 0 && page !== 'config' && (
        <div className="banner warn">
          Falta configurar: <ul>{status.problems.map((p) => <li key={p}>{p}</li>)}</ul>
          <button className="btn link" onClick={() => setPage('config')}>Abrir Configuração</button>
        </div>
      )}
      {status && status.policies.files.length === 0 && page === 'fila' && (
        <div className="banner warn">Nenhuma política carregada. <button className="btn link" onClick={() => setPage('docs')}>Abrir Documentos</button></div>
      )}
      {status?.policies.truncated && page === 'fila' && <div className="banner warn">As políticas passaram do limite e foram cortadas. Reduza ou resuma os documentos.</div>}

      {page === 'fila' && (
        <main className="cols">
          <aside className="list">
            <div className="tabs">
              <button className={filter === 'pending' ? 'tab on' : 'tab'} onClick={() => { setFilter('pending'); setSelectedId(null); }}>Aguardando ({pendingCount})</button>
              <button className={filter === 'all' ? 'tab on' : 'tab'} onClick={() => { setFilter('all'); setSelectedId(null); }}>Histórico</button>
            </div>
            {items.length === 0 && <p className="empty">{filter === 'pending' ? 'Nenhum e-mail aguardando. 🎉' : 'Nada por aqui ainda.'}</p>}
            {items.map((i) => (
              <button key={i.id} className={`row ${i.id === selected?.id ? 'sel' : ''}`} onClick={() => setSelectedId(i.id)}>
                <span className={`dot ${i.status === 'error' ? 'err' : i.risk ?? ''}`} />
                <span className="who">{i.from_name || i.from_email}</span>
                <span className="subj">{i.subject}</span>
                <span className="meta">{STATUS_LABEL[i.status]} · {ago(i.received_at)}</span>
              </button>
            ))}
          </aside>
          <section className="detail">
            {selected ? <Detail key={selected.id} item={selected} onChange={refresh} /> : <p className="empty">Selecione um e-mail.</p>}
          </section>
        </main>
      )}

      {page === 'config' && (
        <SettingsPage
          setup={status?.setup ?? null}
          onSaved={() => void refresh()}
          gmailConnected={!!status?.gmail.connected}
          needsReauth={!!status?.gmail.needsReauth}
          onOpenDocs={() => setPage('docs')}
        />
      )}
      {page === 'docs' && <DocsPage onChanged={() => void refresh()} />}
    </div>
  );
}

function SetupChecklist({ setup, onOpenDocs }: { setup: StatusInfo['setup']; onOpenDocs: () => void }) {
  const Step = ({ ok, children }: { ok: boolean; children: ReactNode }) => (
    <li className={ok ? 'step ok' : 'step'}>{ok ? '✓' : '○'} {children}</li>
  );
  return (
    <div className="setup-box">
      <h3>Primeiros passos</h3>
      <ol className="setup-list">
        <Step ok={setup.company}>Empresa e assinatura</Step>
        <Step ok={setup.llm}>Chave do modelo (Vercel AI Gateway ou OpenAI)</Step>
        <Step ok={setup.google}>Google Client ID e Secret</Step>
        <Step ok={setup.gmail}>Conectar Gmail</Step>
        <Step ok={setup.policies}>Políticas da empresa <button type="button" className="btn link" onClick={onOpenDocs}>abrir Documentos</button></Step>
        <Step ok={setup.pipedrive}>Pipedrive <span className="optional">(opcional)</span></Step>
      </ol>
      <p className="hint">Guia em Documentos → <code>COMEÇAR.md</code>. No Mac: <code>Abrir Assistente.command</code> sobe em segundo plano (sem Terminal à vista); <code>Encerrar Assistente.command</code> para parar.</p>
    </div>
  );
}

function Detail({ item, onChange }: { item: Item; onChange: () => Promise<void> }) {
  const [text, setText] = useState(item.reply_body ?? '');
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showCrm, setShowCrm] = useState(false);
  const editable = item.status === 'pending';
  const dirty = text !== (item.reply_body ?? '');

  async function run(label: string, fn: () => Promise<unknown>, confirmMsg?: string) {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusy(label); setErr(null);
    try { await fn(); await onChange(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  }

  return (
    <div className="detail-in">
      <div className="head">
        <div>
          <h2>{item.subject}</h2>
          <div className="from">De: {item.from_name ? `${item.from_name} ` : ''}&lt;{item.from_email}&gt;{item.customer?.known && <span className="tag">cliente{item.customer.org ? ` · ${item.customer.org}` : ''}</span>}{item.customer && !item.customer.known && <span className="tag new">contato novo</span>}</div>
        </div>
        {item.risk && <span className={`badge ${item.risk}`}>Risco {RISK_LABEL[item.risk]}</span>}
      </div>

      {item.status === 'error' && <div className="banner error">Não foi possível gerar a resposta: {item.error}</div>}
      {item.risk_reasons && <p className="reasons"><b>Por que este risco:</b> {item.risk_reasons.replaceAll('[guardrail] ', '· regra automática: ')}</p>}
      {item.internal_notes && <p className="notes"><b>Confira antes de enviar:</b> {item.internal_notes}</p>}

      <h3>E-mail recebido</h3>
      <pre className="orig">{item.body}</pre>

      {item.customer && (
        <>
          <button className="btn link" onClick={() => setShowCrm(!showCrm)}>{showCrm ? 'Ocultar' : 'Ver'} histórico do cliente (Pipedrive)</button>
          {showCrm && <pre className="orig crm">{item.customer.text}</pre>}
        </>
      )}

      {item.status !== 'error' && (
        <>
          <h3>Rascunho de resposta {editable ? '(editável)' : ''}</h3>
          <textarea value={text} onChange={(e) => setText(e.target.value)} readOnly={!editable} rows={12} />
        </>
      )}

      {err && <div className="banner error">{err}</div>}

      {editable && (
        <div className="actions">
          <button className="btn primary" disabled={!!busy || !text.trim()} onClick={() => void run('send', () => api.send(item.id, text), 'Enviar esta resposta agora para ' + item.from_email + '?')}>{busy === 'send' ? 'Enviando…' : 'Enviar'}</button>
          <button className="btn" disabled={!!busy || !dirty} onClick={() => void run('save', () => api.save(item.id, text))}>{busy === 'save' ? 'Salvando…' : 'Salvar rascunho'}</button>
          <button className="btn danger" disabled={!!busy} onClick={() => void run('discard', () => api.discard(item.id), 'Descartar este rascunho? O e-mail original continua na sua caixa.')}>Descartar</button>
        </div>
      )}
      {(editable || item.status === 'error') && (
        <div className="regen">
          <input value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="Refazer com uma instrução (ex.: mais curto, ofereça uma ligação)…" />
          <button className="btn" disabled={!!busy} onClick={() => void run('regen', () => api.regenerate(item.id, instruction).then(() => setInstruction('')))}>{busy === 'regen' ? 'Gerando…' : 'Refazer'}</button>
        </div>
      )}
    </div>
  );
}

const VERCEL_GATEWAY = 'https://ai-gateway.vercel.sh/v1';
const OPENAI_URL = 'https://api.openai.com/v1';

function SettingsPage({
  setup, onSaved, gmailConnected, needsReauth, onOpenDocs,
}: {
  setup: StatusInfo['setup'] | null;
  onSaved: () => void;
  gmailConnected: boolean;
  needsReauth: boolean;
  onOpenDocs: () => void;
}) {
  const [s, setS] = useState<PublicSettings | null>(null);
  const [companyName, setCompanyName] = useState('');
  const [signature, setSignature] = useState('');
  const [signatureEn, setSignatureEn] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [secretTouched, setSecretTouched] = useState(false);
  const [baseUrl, setBaseUrl] = useState(VERCEL_GATEWAY);
  const [apiKey, setApiKey] = useState('');
  const [keyTouched, setKeyTouched] = useState(false);
  const [model, setModel] = useState('openai/gpt-4.1');
  const [domain, setDomain] = useState('');
  const [token, setToken] = useState('');
  const [tokenTouched, setTokenTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void api.settings().then((cur) => {
      setS(cur);
      setCompanyName(cur.company.name);
      setSignature(cur.company.signature);
      setSignatureEn(cur.company.signatureEn);
      setClientId(cur.google.clientId);
      setBaseUrl(cur.llm.baseUrl || VERCEL_GATEWAY);
      setModel(cur.llm.model || 'openai/gpt-4.1');
      setDomain(cur.pipedrive.domain);
    }).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  async function save() {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const patch: SettingsPatch = {
        company: { name: companyName, signature, signatureEn },
        google: { clientId },
        llm: { baseUrl, model },
        pipedrive: { domain },
      };
      if (secretTouched) patch.google!.clientSecret = clientSecret;
      if (keyTouched) patch.llm!.apiKey = apiKey;
      if (tokenTouched) patch.pipedrive!.token = token;
      const out = await api.saveSettings(patch);
      setS(out);
      setSecretTouched(false); setKeyTouched(false); setTokenTouched(false);
      setClientSecret(''); setApiKey(''); setToken('');
      setMsg('Configuração salva neste computador.');
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!s && !err) return <p className="empty">Carregando configuração…</p>;

  return (
    <main className="panel">
      <h2>Configuração</h2>
      <p className="lead">Tudo fica só neste Mac. Não precisa editar arquivo <code>.env</code>.</p>
      {setup && !setup.ready && <SetupChecklist setup={setup} onOpenDocs={onOpenDocs} />}

      <section className="form-block">
        <h3>1. Empresa</h3>
        <label>Nome da empresa<input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Minha Empresa" /></label>
        <label>Assinatura (português)<input value={signature} onChange={(e) => setSignature(e.target.value)} placeholder="Equipe Minha Empresa" /></label>
        <label>Assinatura (inglês)<input value={signatureEn} onChange={(e) => setSignatureEn(e.target.value)} placeholder="Minha Empresa Team" /></label>
      </section>

      <section className="form-block">
        <h3>2. Modelo (LLM)</h3>
        <p className="hint">Use o botão Vercel AI Gateway e cole a chave que você recebeu.</p>
        <div className="presets">
          <button type="button" className="btn" onClick={() => { setBaseUrl(VERCEL_GATEWAY); if (!model.includes('/')) setModel('openai/gpt-4.1'); }}>Vercel AI Gateway</button>
          <button type="button" className="btn" onClick={() => { setBaseUrl(OPENAI_URL); setModel('gpt-4.1'); }}>OpenAI</button>
        </div>
        <label>URL base<input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={VERCEL_GATEWAY} /></label>
        <label>Chave da API
          <input
            type="password"
            value={apiKey}
            onChange={(e) => { setApiKey(e.target.value); setKeyTouched(true); }}
            placeholder={s?.llm.apiKeyConfigured ? '•••••••• (deixe em branco para manter)' : 'cole a chave aqui'}
            autoComplete="off"
          />
        </label>
        <label>Modelo<input value={model} onChange={(e) => setModel(e.target.value)} placeholder="openai/gpt-4.1" /></label>
        <p className="hint">{s?.llm.apiKeyConfigured ? 'Chave já configurada.' : 'Chave ainda não configurada.'}</p>
      </section>

      <section className="form-block">
        <h3>3. Google (Gmail)</h3>
        <p className="hint">Passo a passo em Documentos → <code>CONFIGURAR-GOOGLE.md</code>. Depois cole aqui e salve.</p>
        <label>Client ID<input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="xxxxx.apps.googleusercontent.com" autoComplete="off" /></label>
        <label>Client Secret
          <input
            type="password"
            value={clientSecret}
            onChange={(e) => { setClientSecret(e.target.value); setSecretTouched(true); }}
            placeholder={s?.google.clientSecretConfigured ? '•••••••• (deixe em branco para manter)' : 'chave secreta do cliente'}
            autoComplete="off"
          />
        </label>
        <p className="hint">{s?.google.clientSecretConfigured ? 'Secret já configurado.' : 'Secret ainda não configurado.'}</p>
        {!gmailConnected || needsReauth ? (
          <a className="btn primary" href="/auth/google">{needsReauth ? 'Reconectar Gmail' : 'Conectar Gmail'}</a>
        ) : (
          <span className="chip ok">● Gmail conectado</span>
        )}
      </section>

      <section className="form-block">
        <h3>4. Pipedrive <span className="optional">(opcional)</span></h3>
        <p className="hint">Domínio = a parte antes de .pipedrive.com. Token com permissão de leitura.</p>
        <label>Domínio<input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="minhaempresa" /></label>
        <label>Token da API
          <input
            type="password"
            value={token}
            onChange={(e) => { setToken(e.target.value); setTokenTouched(true); }}
            placeholder={s?.pipedrive.tokenConfigured ? '•••••••• (deixe em branco para manter)' : 'token'}
            autoComplete="off"
          />
        </label>
        <p className="hint">{s?.pipedrive.tokenConfigured ? 'Token já configurado.' : 'Sem Pipedrive o histórico do cliente não entra no rascunho.'}</p>
      </section>

      {err && <div className="banner error">{err}</div>}
      {msg && <div className="banner ok">{msg}</div>}
      <div className="actions">
        <button className="btn primary" disabled={busy} onClick={() => void save()}>{busy ? 'Salvando…' : 'Salvar configuração'}</button>
      </div>
    </main>
  );
}

function DocsPage({ onChanged }: { onChanged: () => void }) {
  const [tab, setTab] = useState<'guias' | 'politicas'>('guias');
  const [guides, setGuides] = useState<string[]>([]);
  const [policies, setPolicies] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [html, setHtml] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const loadLists = useCallback(async () => {
    const [d, p] = await Promise.all([api.docs(), api.policies()]);
    setGuides(d.files);
    setPolicies(p.files);
  }, []);

  useEffect(() => { void loadLists().catch((e) => setErr(e instanceof Error ? e.message : String(e))); }, [loadLists]);

  function switchTab(next: 'guias' | 'politicas') {
    setTab(next);
    setSelected(null);
    setContent('');
    setHtml('');
    setDirty(false);
    setMsg(null);
    setErr(null);
  }

  async function openFile(name: string, which: 'guias' | 'politicas' = tab) {
    setErr(null); setMsg(null); setBusy(true);
    try {
      const file = which === 'guias' ? await api.doc(name) : await api.policy(name);
      setSelected(name);
      setContent(file.content);
      setDirty(false);
      if (which === 'guias') setHtml(await marked.parse(file.content));
      else setHtml('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function savePolicy() {
    if (!selected) return;
    setBusy(true); setErr(null);
    try {
      await api.savePolicy(selected, content);
      setDirty(false);
      setMsg('Política salva.');
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function createNew() {
    const name = window.prompt('Nome do arquivo (ex.: 08-frete.md):');
    if (!name) return;
    const finalName = name.toLowerCase().endsWith('.md') ? name : `${name}.md`;
    setBusy(true); setErr(null);
    try {
      await api.createPolicy(finalName, `# ${finalName.replace(/\.md$/i, '')}\n\n`);
      setTab('politicas');
      await loadLists();
      await openFile(finalName, 'politicas');
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function removePolicy() {
    if (!selected || !window.confirm(`Excluir ${selected}?`)) return;
    setBusy(true); setErr(null);
    try {
      await api.deletePolicy(selected);
      setSelected(null); setContent(''); setDirty(false);
      await loadLists();
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const files = tab === 'guias' ? guides : policies;

  return (
    <main className="docs-layout">
      <aside className="docs-side">
        <div className="tabs">
          <button className={tab === 'guias' ? 'tab on' : 'tab'} onClick={() => switchTab('guias')}>Guias</button>
          <button className={tab === 'politicas' ? 'tab on' : 'tab'} onClick={() => switchTab('politicas')}>Políticas</button>
        </div>
        {tab === 'politicas' && (
          <div className="docs-actions">
            <button className="btn" disabled={busy} onClick={() => void createNew()}>Nova política</button>
            <button
              className="btn"
              disabled={busy}
              onClick={() => void (async () => {
                setBusy(true); setErr(null);
                try {
                  const r = await api.seedPolicies();
                  await loadLists();
                  setMsg(r.copied.length
                    ? `Copiados: ${r.copied.join(', ')}. Edite com as regras reais.`
                    : 'Nada novo: os exemplos já estavam na pasta (ou a pasta de exemplos está vazia).');
                  onChanged();
                } catch (e) {
                  setErr(e instanceof Error ? e.message : String(e));
                } finally {
                  setBusy(false);
                }
              })()}
            >Copiar exemplos</button>
          </div>
        )}
        {files.length === 0 && <p className="empty">{tab === 'guias' ? 'Nenhum guia em docs/.' : 'Nenhuma política ainda. Crie uma ou use “Copiar exemplos”.'}</p>}
        {files.map((f) => (
          <button key={f} className={`row ${selected === f ? 'sel' : ''}`} onClick={() => void openFile(f)}>
            <span className="subj">{f}</span>
          </button>
        ))}
      </aside>
      <section className="docs-main">
        {err && <div className="banner error">{err}</div>}
        {msg && <div className="banner ok">{msg}</div>}
        {!selected && <p className="empty">Selecione um arquivo.</p>}
        {selected && tab === 'guias' && (
          <article className="md-view">
            <h2>{selected}</h2>
            <div className="md-body" dangerouslySetInnerHTML={{ __html: html }} />
          </article>
        )}
        {selected && tab === 'politicas' && (
          <div className="policy-edit">
            <div className="head">
              <h2>{selected}</h2>
              <div className="actions">
                <button className="btn primary" disabled={busy || !dirty} onClick={() => void savePolicy()}>{busy ? 'Salvando…' : 'Salvar'}</button>
                <button className="btn danger" disabled={busy} onClick={() => void removePolicy()}>Excluir</button>
              </div>
            </div>
            <p className="hint">Linhas com <code>[INTERNO …]</code> não vão para o modelo. Tudo o resto entra no prompt a cada e-mail.</p>
            <textarea className="policy-ta" value={content} onChange={(e) => { setContent(e.target.value); setDirty(true); }} rows={24} />
          </div>
        )}
      </section>
    </main>
  );
}
