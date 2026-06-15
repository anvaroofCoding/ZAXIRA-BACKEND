import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type PolishResult = {
  name: string;
  characteristics: string;
};

@Injectable()
export class PurchaseRequestAiService {
  constructor(private readonly configService: ConfigService) {}

  private compact(value: string, maxLength: number) {
    return value
      .replace(/\s+/g, ' ')
      .replace(/\s*[,;|]\s*/g, ', ')
      .trim()
      .slice(0, maxLength);
  }

  private toTitleCase(value: string) {
    return value
      .split(' ')
      .map((word) => {
        if (!word) return word;
        if (/^[a-z]*\d+[a-z\d]*$/i.test(word)) return word.toUpperCase();
        if (word.length <= 2) return word.toUpperCase();
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      })
      .join(' ');
  }

  private normalizeName(value: string) {
    const cleaned = this.compact(value, 120)
      .replace(/\biphon(e)?\b/gi, 'iPhone')
      .replace(/\bmaxx\b/gi, 'Max')
      .replace(/\bproo?\b/gi, 'Pro')
      .replace(/\bwhites?\b/gi, 'White')
      .replace(/\bblacks?\b/gi, 'Black');

    return this.toTitleCase(cleaned)
      .replace(/\bIphone\b/g, 'iPhone')
      .replace(/\bGb\b/g, 'GB')
      .replace(/\bTb\b/g, 'TB')
      .slice(0, 120);
  }

  private normalizeCharacteristics(value: string) {
    const cleaned = this.compact(value, 700)
      .replace(/\bhotira(si)?\b/gi, 'xotira')
      .replace(/\bram(i)?\b/gi, 'RAM')
      .replace(/\bprosessor\b/gi, 'protsessor')
      .replace(/\bkamerasi?\b/gi, 'kamera')
      .replace(/\bdsiplay|displayy|ekran\s*display\b/gi, 'ekran')
      .replace(/\b(\d+)\s*gb\b/gi, '$1 GB')
      .replace(/\b(\d+)\s*tb\b/gi, '$1 TB')
      .replace(/\b(\d+)\s*px\b/gi, '$1 MP')
      .replace(/\s*-\s*/g, ': ')
      .replace(/\s*:\s*/g, ': ')
      .replace(/\s*,\s*/g, ', ');

    return cleaned
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(', ')
      .slice(0, 700);
  }

  private normalizeResult(name: string, characteristics: string): PolishResult {
    const normalizedName = this.normalizeName(name);
    const normalizedCharacteristics = this.normalizeCharacteristics(characteristics);

    return {
      name: normalizedName,
      characteristics: normalizedCharacteristics,
    };
  }

  async polishItemText(
    name: string,
    characteristics: string,
  ): Promise<PolishResult> {
    const apiKey = this.configService
      .get<string>('ai.openRouterApiKey')
      ?.trim();
    const model =
      this.configService.get<string>('ai.openRouterModel')?.trim() ||
      'deepseek/deepseek-chat-v3-0324:free';

    const fallback = this.normalizeResult(name, characteristics);

    if (!apiKey) {
      return fallback;
    }

    const prompt = [
      'Kiritilgan tovar matnini professional ko‘rinishda qayta yozing.',
      'Talablar:',
      '- Nomi: to‘g‘ri yozuv, brend/model aniq, 2-120 belgi.',
      '- Xususiyat: faqat kerakli texnik ma’lumotlar, qisqa va o‘qilishi oson, 8-700 belgi.',
      '- Bir xil format: "Kalit: qiymat, Kalit: qiymat".',
      '- Imlo xatolarini tuzat.',
      '- Noma’lum ma’lumot qo‘shmang.',
      '- Javob faqat JSON bo‘lsin: {"name":"...","characteristics":"..."}',
      '',
      `name: ${name}`,
      `characteristics: ${characteristics}`,
    ].join('\n');

    try {
      const response = await fetch(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages: [
              {
                role: 'system',
                content:
                  'Siz procurement data editor siz. Har doim aniq, imloviy to‘g‘ri, qidiruvga mos matn qaytaring.',
              },
              { role: 'user', content: prompt },
            ],
            temperature: 0.2,
            response_format: { type: 'json_object' },
          }),
        },
      );

      if (!response.ok) {
        return fallback;
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = data.choices?.[0]?.message?.content?.trim();

      if (!content) {
        return fallback;
      }

      const parsed = JSON.parse(content) as Partial<PolishResult>;
      const polished = this.normalizeResult(
        String(parsed.name ?? ''),
        String(parsed.characteristics ?? ''),
      );

      return {
        name: polished.name || fallback.name,
        characteristics: polished.characteristics || fallback.characteristics,
      };
    } catch {
      return fallback;
    }
  }
}
