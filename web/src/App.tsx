import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type Item, type Risk, type StatusInfo } from './api';

const RISK_LABEL: Record<Risk, string> = { low: 'Baixo', medium: 'Médio', high: 'Alto' };
const STATUS_LABEL: Record<string, string> = { pending: 'Aguardando', sent: 'Enviado', discarded: 'Descartado', error: 'Erro', ignored: 'Ignorado' };

function ago(iso: string | null): string {
  if (!iso) return 'nunca';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'agora há pouco';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  return new Date(iso).toLocaleDateString('pt-BR');
}

export function App() {
  const [status, setStatus] = useState<StatusInfo | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>('Notification' in window ? Notification.permission : 'unsupported');

  const refresh = useCallback(async () => {
    try {
      const [s, list] = await Promise.all([api.status(), api.items(filter)]);
      setStatus(s);
      setItems(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [filter]);

  useEffect(() => { void refresh(); }, [refresh]);

  // atualizações em tempo real + notificação de novos itens
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
        <h1>Assistente de e-mail</h1>
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
      </header>

      {error && <div className="banner error">{error}</div>}
      {status?.lastError && <div className="banner error">Problema na última verificação: {status.lastError}</div>}
      {status && status.problems.length > 0 && (
        <div className="banner warn">Falta configurar no arquivo .env: <ul>{status.problems.map((p) => <li key={p}>{p}</li>)}</ul></div>
      )}
      {status && status.policies.files.length === 0 && <div className="banner warn">Nenhuma política carregada: coloque arquivos .md na pasta de políticas.</div>}
      {status?.policies.truncated && <div className="banner warn">As políticas passaram do limite e foram cortadas. Reduza ou resuma os documentos.</div>}

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
