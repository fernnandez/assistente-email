import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve, sep } from 'node:path';
import { config } from './config';

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

const SAFE_ASSET = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,80}\.(png|jpe?g|gif|webp)$/i;
const ALLOWED_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

export function signaturesDir(): string {
  const dir = join(config.dataDir, 'signatures');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function assetPath(name: string): string {
  const base = basename(name);
  if (!SAFE_ASSET.test(base)) throw Object.assign(new Error('Nome de imagem inválido.'), { statusCode: 400 });
  const root = resolve(signaturesDir());
  const full = resolve(root, base);
  if (!full.startsWith(root + sep) && full !== join(root, base)) {
    throw Object.assign(new Error('Caminho inválido.'), { statusCode: 400 });
  }
  return full;
}

export function readAsset(name: string): { buf: Buffer; contentType: string } {
  const full = assetPath(name);
  if (!existsSync(full)) throw Object.assign(new Error('Imagem não encontrada.'), { statusCode: 404 });
  const ext = extname(full).toLowerCase();
  return { buf: readFileSync(full), contentType: ALLOWED_MIME[ext] ?? 'application/octet-stream' };
}

/** Salva imagem (base64) e devolve o nome do arquivo para usar em /api/signature-assets/... */
export function saveAsset(args: { filename?: string; contentType?: string; dataBase64: string }): { name: string; url: string } {
  const raw = args.dataBase64.replace(/^data:[^;]+;base64,/, '');
  const buf = Buffer.from(raw, 'base64');
  if (!buf.length || buf.length > 1_500_000) {
    throw Object.assign(new Error('Imagem inválida ou maior que 1,5 MB.'), { statusCode: 400 });
  }
  let ext = extname(args.filename ?? '').toLowerCase();
  const mime = (args.contentType ?? '').toLowerCase();
  if (!ext) {
    if (mime.includes('png')) ext = '.png';
    else if (mime.includes('jpeg') || mime.includes('jpg')) ext = '.jpg';
    else if (mime.includes('gif')) ext = '.gif';
    else if (mime.includes('webp')) ext = '.webp';
    else ext = '.png';
  }
  if (!ALLOWED_MIME[ext]) throw Object.assign(new Error('Use PNG, JPEG, GIF ou WebP.'), { statusCode: 400 });
  const name = `${randomBytes(8).toString('hex')}${ext}`;
  writeFileSync(assetPath(name), buf);
  return { name, url: `/api/signature-assets/${name}` };
}

/** Extrai data-URLs do HTML, grava como assets e troca por /api/signature-assets/... */
export function materializeDataUrls(html: string): string {
  return html.replace(/src=(["'])data:(image\/(?:png|jpeg|jpg|gif|webp));base64,([A-Za-z0-9+/=\s]+)\1/gi, (_m, quote, mime, b64) => {
    const { url } = saveAsset({ contentType: mime, dataBase64: b64.replace(/\s+/g, '') });
    return `src=${quote}${url}${quote}`;
  });
}

export function isEnglishBody(text: string): boolean {
  return /\b(the|you|your|our|please|regards|hello|hi)\b/i.test(text) && !/\b(voc[eê]|nosso|nossa|obrigad|para)\b/i.test(text);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function plainToHtml(text: string): string {
  return escapeHtml(text).replace(/\r\n/g, '\n').replace(/\n/g, '<br>\n');
}

const ASSET_SRC = /(?:src|SRC)=["'](\/api\/signature-assets\/([a-zA-Z0-9._-]+))["']/g;

export interface InlineImage {
  cid: string;
  name: string;
  contentType: string;
  buf: Buffer;
}

/** Troca /api/signature-assets/X por cid:X e lista anexos inline. */
export function htmlWithCid(signatureHtml: string): { html: string; images: InlineImage[] } {
  const images: InlineImage[] = [];
  const seen = new Set<string>();
  const html = signatureHtml.replace(ASSET_SRC, (_m, _url, name: string) => {
    const base = basename(name);
    if (!SAFE_ASSET.test(base)) return _m;
    if (!seen.has(base)) {
      seen.add(base);
      try {
        const { buf, contentType } = readAsset(base);
        const cid = createHash('sha1').update(base).digest('hex').slice(0, 16);
        images.push({ cid, name: base, contentType, buf });
      } catch {
        return _m;
      }
    }
    const cid = createHash('sha1').update(base).digest('hex').slice(0, 16);
    return `src="cid:${cid}"`;
  });
  return { html, images };
}

export interface ComposedMail {
  text: string;
  html?: string;
  images: InlineImage[];
}

export interface SignatureCompany {
  signature: string;
  signatureEn: string;
  signatureHtml: string;
  signatureHtmlEn: string;
}

/**
 * Monta texto + HTML do e-mail. O corpo da resposta continua em texto;
 * se houver assinatura HTML, ela vai só na parte HTML (com imagens embutidas).
 */
export function composeMailBodies(plainReply: string, co: SignatureCompany): ComposedMail {
  const english = isEnglishBody(plainReply);
  const sigPlain = (english ? co.signatureEn : co.signature).trim() || co.signature;
  const sigHtmlRaw = (english ? co.signatureHtmlEn : co.signatureHtml).trim();

  let text = plainReply.trim();
  const tail = text.slice(-200).toLowerCase();
  if (sigPlain && !tail.includes(sigPlain.toLowerCase().slice(0, Math.min(24, sigPlain.length)))) {
    text = `${text}\n\n${sigPlain}`;
  }

  if (!sigHtmlRaw) return { text, images: [] };

  // Remove assinatura texto do fim para não duplicar na parte HTML
  let bodyOnly = plainReply.trim();
  if (sigPlain && bodyOnly.endsWith(sigPlain)) {
    bodyOnly = bodyOnly.slice(0, -sigPlain.length).trimEnd();
  }
  const prepared = materializeDataUrls(sigHtmlRaw);
  const { html: sigHtml, images } = htmlWithCid(prepared);
  const html = `${plainToHtml(bodyOnly)}<br><br>--<br>${sigHtml}`;
  return { text, html, images };
}

/** Texto curto da assinatura HTML (para o prompt do modelo). */
export function signaturePlainFromHtml(html: string, fallback: string): string {
  const t = stripTags(html);
  return t.slice(0, 200) || fallback;
}
