import { createOpenAI } from '@ai-sdk/openai';
import { generateText, Output } from 'ai';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { config } from './config';
import { CATEGORIES, type ModelReply } from './types';

export const modelReplySchema = z.object({
  category: z.enum(CATEGORIES),
  risk: z.enum(['low', 'medium', 'high']),
  risk_reasons: z.string(),
  reply_subject: z.string(),
  reply_body: z.string(),
  internal_notes: z.string(),
});

export interface LlmResult {
  /** null quando o modelo não devolveu uma saída válida (os guardrails tratam como risco alto) */
  reply: ModelReply | null;
  tokensIn: number | null;
  tokensOut: number | null;
}

/** Lê prompts/system.md e troca os marcadores de empresa e assinatura. */
export function systemPrompt(): string {
  const raw = readFileSync(new URL('../prompts/system.md', import.meta.url), 'utf8');
  return raw
    .replaceAll('{{EMPRESA}}', config.company)
    .replaceAll('{{ASSINATURA_EN}}', config.signatureEn)
    .replaceAll('{{ASSINATURA}}', config.signature)
    .trim();
}

/** Chama o modelo (qualquer endpoint compatível com a API da OpenAI: OpenAI, Vercel AI Gateway, Ollama...). */
export async function callModel(system: string, user: string): Promise<LlmResult> {
  const provider = createOpenAI({ baseURL: config.llm.baseUrl, apiKey: config.llm.apiKey });
  try {
    const r = await generateText({
      model: provider.chat(config.llm.model),
      output: Output.object({ schema: modelReplySchema }),
      system,
      prompt: user,
      temperature: 0.2,
      maxOutputTokens: 1200,
    });
    return { reply: r.output, tokensIn: r.usage?.inputTokens ?? null, tokensOut: r.usage?.outputTokens ?? null };
  } catch (e) {
    // Saída fora do formato: segue com null (risco alto + texto padrão). Erros de rede/chave sobem para o chamador.
    if (e instanceof Error && /NoObjectGenerated|NoOutputGenerated|TypeValidation|JSONParse/i.test(e.name)) {
      return { reply: null, tokensIn: null, tokensOut: null };
    }
    throw e;
  }
}
