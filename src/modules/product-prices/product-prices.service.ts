import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { fetchWithTlsFallback } from '../../common/http/outbound-fetch';
import { SearchProductPricesDto } from './dto/search-product-prices.dto';

export type ProductPriceConverted = {
  uzs: number;
  usd: number;
  rub: number;
};

export type ProductPriceOffer = {
  storeName: string;
  storeDomain: string | null;
  logoUrl: string | null;
  title: string;
  priceLabel: string;
  priceValue: number | null;
  currency: string | null;
  convertedPrices: ProductPriceConverted | null;
  productUrl: string;
  rating: number | null;
  reviewsCount: number | null;
  deliveryNote: string | null;
};

type ExchangeRates = {
  uzsPerUsd: number;
  rubPerUsd: number;
};

type ShoppingRegion = {
  id: string;
  /** Google Shopping `gl` — faqat serpapi.com/google-shopping-countries ro‘yxatidagi kodlar */
  shoppingGl?: string;
  /** Oddiy Google (`tbm=shop`) uchun `gl` — umumiy Google mamlakatlari kengroq */
  googleGl?: string;
  hl: string;
  location: string;
  defaultCurrency: string;
};

export type ProductPriceSearchResult = {
  query: string;
  offers: ProductPriceOffer[];
  searchedAt: string;
};

type SerpShoppingResult = {
  title?: string;
  source?: string;
  price?: string;
  extracted_price?: number;
  link?: string;
  product_link?: string;
  tracking_link?: string;
  thumbnail?: string;
  rating?: number;
  reviews?: number;
  delivery?: string;
};

type SerpCategorizedShoppingBlock = {
  shopping_results?: SerpShoppingResult[];
};

type SerpShoppingResponse = {
  shopping_results?: SerpShoppingResult[];
  inline_shopping_results?: SerpShoppingResult[];
  categorized_shopping_results?: SerpCategorizedShoppingBlock[];
  error?: string;
};

const MIN_OFFERS_BEFORE_STOP = 8;
const MAX_SEARCH_QUERIES = 4;
const CATEGORY_PREFIX =
  /^(planshet|smartfon|noutbuk|kompyuter|monitor|televizor|naushnik|klaviatura|sichqoncha|printer|skaner|kamera|mikrofon|kolonka|router|modem)\s+/i;

const KNOWN_STORE_DOMAINS: Record<string, string> = {
  'uzum.uz': 'Uzum Market',
  'market.yandex.uz': 'Yandex Market',
  'olx.uz': 'OLX',
  'mediapark.uz': 'Mediapark',
  'idea.uz': 'IDEA',
  'texnomart.uz': 'Texnomart',
  'olcha.uz': 'Olcha',
  'asaxiy.uz': 'Asaxiy',
  'zoodmall.com': 'ZoodMall',
  'wildberries.uz': 'Wildberries',
  'amazon.com': 'Amazon',
  'aliexpress.com': 'AliExpress',
  'aliexpress.ru': 'AliExpress',
};

const SHOPPING_REGIONS: ShoppingRegion[] = [
  {
    id: 'ru',
    shoppingGl: 'ru',
    googleGl: 'ru',
    hl: 'ru',
    location: 'Russia',
    defaultCurrency: 'RUB',
  },
  {
    id: 'us',
    shoppingGl: 'us',
    googleGl: 'us',
    hl: 'en',
    location: 'United States',
    defaultCurrency: 'USD',
  },
  {
    id: 'uz',
    // Google Shopping gl=uz qo‘llab-quvvatlanmaydi; RU + location + "Uzbekistan" so‘rovi
    shoppingGl: 'ru',
    googleGl: 'uz',
    hl: 'ru',
    location: 'Tashkent, Uzbekistan',
    defaultCurrency: 'UZS',
  },
];

@Injectable()
export class ProductPricesService {
  private readonly logger = new Logger(ProductPricesService.name);
  private exchangeRatesCache: {
    rates: ExchangeRates;
    expiresAt: number;
  } | null = null;

  constructor(private readonly configService: ConfigService) {}

  private resolveSerpApiKey(): string {
    return (
      this.configService.get<string>('serpApi.apiKey')?.trim() ||
      process.env.SERPAPI_API_KEY?.trim() ||
      ''
    );
  }

  async search(dto: SearchProductPricesDto): Promise<ProductPriceSearchResult> {
    const apiKey = this.resolveSerpApiKey();

    if (!apiKey) {
      throw new ServiceUnavailableException(
        'Internetdan narx qidirish hozircha yoqilmagan (SERPAPI_API_KEY kerak)',
      );
    }

    const searchQueries = this.buildSearchQueries(dto);
    const primaryQuery = searchQueries[0] ?? dto.name.trim();
    const exchangeRates = await this.getExchangeRates();

    const merged: ProductPriceOffer[] = [];

    for (const baseQuery of searchQueries) {
      if (merged.length >= MIN_OFFERS_BEFORE_STOP) break;

      const regionResults = await Promise.all(
        SHOPPING_REGIONS.map((region) =>
          this.fetchShoppingResults(
            apiKey,
            this.queryForRegion(baseQuery, region),
            region,
          ),
        ),
      );

      for (let i = 0; i < SHOPPING_REGIONS.length; i++) {
        const region = SHOPPING_REGIONS[i];
        const rows = regionResults[i] ?? [];
        merged.push(
          ...this.mapShoppingResults(
            rows,
            region.defaultCurrency,
            exchangeRates,
          ),
        );
      }
    }

    if (merged.length === 0) {
      for (const baseQuery of searchQueries.slice(0, 2)) {
        const regionResults = await Promise.all(
          SHOPPING_REGIONS.map((region) =>
            this.fetchGoogleShopTabResults(
              apiKey,
              this.queryForRegion(baseQuery, region),
              region,
            ),
          ),
        );

        for (let i = 0; i < SHOPPING_REGIONS.length; i++) {
          const region = SHOPPING_REGIONS[i];
          const rows = regionResults[i] ?? [];
          merged.push(
            ...this.mapShoppingResults(
              rows,
              region.defaultCurrency,
              exchangeRates,
            ),
          );
        }

        if (merged.length > 0) break;
      }
    }

    const offers = this.sortAndLimitOffers(merged, 24);

    return {
      query: primaryQuery,
      offers,
      searchedAt: new Date().toISOString(),
    };
  }

  private serpApiGl(
    region: ShoppingRegion,
    engine: 'google_shopping' | 'google',
  ): string | undefined {
    return engine === 'google_shopping'
      ? region.shoppingGl
      : (region.googleGl ?? region.shoppingGl);
  }

  private logSerpApiIssue(
    regionId: string,
    status: number,
    message: string,
    prefix = 'SerpAPI',
  ): void {
    const isEmptyResult =
      status === 200 &&
      /hasn't returned any results|has not returned any results/i.test(message);

    if (isEmptyResult) {
      this.logger.debug(`${prefix} [${regionId}]: ${message}`);
      return;
    }

    this.logger.warn(`${prefix} [${regionId}] ${status}: ${message}`);
  }

  private async fetchShoppingResults(
    apiKey: string,
    query: string,
    region: ShoppingRegion,
  ): Promise<SerpShoppingResult[]> {
    const params = new URLSearchParams({
      engine: 'google_shopping',
      q: query,
      api_key: apiKey,
      hl: region.hl,
      google_domain: 'google.com',
      location: region.location,
      num: '20',
    });

    const gl = this.serpApiGl(region, 'google_shopping');
    if (gl) {
      params.set('gl', gl);
    }

    const url = `https://serpapi.com/search.json?${params.toString()}`;

    try {
      const response = await fetchWithTlsFallback(url, {
        headers: { Accept: 'application/json' },
        timeoutMs: 25_000,
      });

      const rawBody = await response.text().catch(() => '');
      let data: SerpShoppingResponse = {};

      try {
        data = rawBody ? (JSON.parse(rawBody) as SerpShoppingResponse) : {};
      } catch {
        this.logger.warn(
          `SerpAPI [${region.id}] JSON xatosi: ${rawBody.slice(0, 120)}`,
        );
        return [];
      }

      if (!response.ok || data.error) {
        this.logSerpApiIssue(
          region.id,
          response.status,
          data.error ?? rawBody.slice(0, 120),
        );
        return [];
      }

      return this.extractShoppingRows(data);
    } catch (error) {
      this.logger.warn(`SerpAPI [${region.id}] ulanish: ${String(error)}`);
      return [];
    }
  }

  /** Google qidiruv — Shopping tab (google_shopping bo‘sh qolsa) */
  private async fetchGoogleShopTabResults(
    apiKey: string,
    query: string,
    region: ShoppingRegion,
  ): Promise<SerpShoppingResult[]> {
    const params = new URLSearchParams({
      engine: 'google',
      q: query,
      tbm: 'shop',
      api_key: apiKey,
      hl: region.hl,
      google_domain: 'google.com',
      location: region.location,
      num: '15',
    });

    const gl = this.serpApiGl(region, 'google');
    if (gl) {
      params.set('gl', gl);
    }

    const url = `https://serpapi.com/search.json?${params.toString()}`;

    try {
      const response = await fetchWithTlsFallback(url, {
        headers: { Accept: 'application/json' },
        timeoutMs: 25_000,
      });

      const rawBody = await response.text().catch(() => '');
      let data: SerpShoppingResponse = {};

      try {
        data = rawBody ? (JSON.parse(rawBody) as SerpShoppingResponse) : {};
      } catch {
        return [];
      }

      if (!response.ok || data.error) {
        this.logSerpApiIssue(
          region.id,
          response.status,
          data.error ?? rawBody.slice(0, 120),
          'SerpAPI google/shop',
        );
        return [];
      }

      return this.extractShoppingRows(data);
    } catch (error) {
      this.logger.warn(`SerpAPI google/shop [${region.id}]: ${String(error)}`);
      return [];
    }
  }

  private extractShoppingRows(
    data: SerpShoppingResponse,
  ): SerpShoppingResult[] {
    const rows: SerpShoppingResult[] = [];

    if (data.shopping_results?.length) {
      rows.push(...data.shopping_results);
    }

    if (data.inline_shopping_results?.length) {
      rows.push(...data.inline_shopping_results);
    }

    for (const block of data.categorized_shopping_results ?? []) {
      if (block.shopping_results?.length) {
        rows.push(...block.shopping_results);
      }
    }

    return rows;
  }

  private queryForRegion(baseQuery: string, region: ShoppingRegion): string {
    if (region.id === 'uz') {
      return `${baseQuery} Uzbekistan`;
    }

    return baseQuery;
  }

  private async getExchangeRates(): Promise<ExchangeRates> {
    const now = Date.now();
    if (this.exchangeRatesCache && this.exchangeRatesCache.expiresAt > now) {
      return this.exchangeRatesCache.rates;
    }

    const fallback: ExchangeRates = { uzsPerUsd: 12_600, rubPerUsd: 90 };

    try {
      const response = await fetchWithTlsFallback(
        'https://open.er-api.com/v6/latest/USD',
        { timeoutMs: 8_000 },
      );

      if (!response.ok) {
        return fallback;
      }

      const json = (await response.json()) as {
        rates?: { UZS?: number; RUB?: number };
      };

      const uzsPerUsd = json.rates?.UZS;
      const rubPerUsd = json.rates?.RUB;

      if (
        typeof uzsPerUsd === 'number' &&
        uzsPerUsd > 0 &&
        typeof rubPerUsd === 'number' &&
        rubPerUsd > 0
      ) {
        const rates = { uzsPerUsd, rubPerUsd };
        this.exchangeRatesCache = {
          rates,
          expiresAt: now + 60 * 60 * 1000,
        };
        return rates;
      }
    } catch (error) {
      this.logger.warn(`Valyuta kursi yuklanmadi: ${String(error)}`);
    }

    return fallback;
  }

  private convertToAllCurrencies(
    amount: number,
    currency: string,
    rates: ExchangeRates,
  ): ProductPriceConverted {
    const code = currency.toUpperCase();
    let usd = amount;

    if (code === 'RUB') {
      usd = amount / rates.rubPerUsd;
    } else if (code === 'UZS') {
      usd = amount / rates.uzsPerUsd;
    } else if (code === 'EUR') {
      usd = amount / 0.92;
    }

    return {
      usd: Math.round(usd * 100) / 100,
      uzs: Math.round(usd * rates.uzsPerUsd),
      rub: Math.round(usd * rates.rubPerUsd),
    };
  }

  private sortAndLimitOffers(
    offers: ProductPriceOffer[],
    limit: number,
  ): ProductPriceOffer[] {
    const seen = new Set<string>();
    const unique: ProductPriceOffer[] = [];

    for (const offer of offers) {
      const key = `${offer.storeDomain ?? offer.storeName}|${offer.priceLabel}|${offer.productUrl}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(offer);
    }

    unique.sort((a, b) => {
      const av = a.convertedPrices?.uzs ?? Number.POSITIVE_INFINITY;
      const bv = b.convertedPrices?.uzs ?? Number.POSITIVE_INFINITY;
      return av - bv;
    });

    return unique.slice(0, limit);
  }

  /** Qidiruv variantlari: avval qisqa model nomi, keyin to‘liq nom */
  private buildSearchQueries(dto: SearchProductPricesDto): string[] {
    const name = dto.name.trim();
    const queries: string[] = [];

    const beforeComma = name.split(',')[0]?.trim() ?? '';
    const shortName = beforeComma.replace(CATEGORY_PREFIX, '').trim();

    if (shortName.length >= 8) {
      queries.push(shortName);
    }

    const keywords = this.extractProductKeywords(name);
    if (keywords && keywords.length >= 8 && !queries.includes(keywords)) {
      queries.push(keywords);
    }

    if (name.length >= 4 && !queries.includes(name)) {
      queries.push(name);
    }

    const summary = this.summarizeForSearch(dto.characteristics, 100);
    if (summary) {
      const withSpecs = `${shortName || name} ${summary}`.trim();
      if (withSpecs.length >= 10 && !queries.includes(withSpecs)) {
        queries.push(withSpecs);
      }
    }

    return [...new Set(queries)].slice(0, MAX_SEARCH_QUERIES);
  }

  /** Brend + model (masalan Samsung Galaxy Tab S11 Ultra) */
  private extractProductKeywords(name: string): string | null {
    const cleaned = name.replace(CATEGORY_PREFIX, '').trim();
    const segment = (cleaned.split(',')[0] ?? cleaned).trim();

    const brandMatch = segment.match(
      /\b(samsung|apple|xiaomi|huawei|honor|oppo|vivo|realme|oneplus|google|microsoft|sony|lg|lenovo|asus|acer|hp|dell|msi|canon|nikon|jbl|bose|philips|dyson|garmin|amazon)\b[\w\s.-]*/i,
    );

    if (brandMatch) {
      return brandMatch[0].replace(/\s+/g, ' ').trim();
    }

    return segment.length >= 8 ? segment : null;
  }

  /** Google Shopping qidiruvi uchun qisqa xulosa (to‘liq texnik matn kerak emas) */
  private summarizeForSearch(text?: string, maxLen = 220): string {
    if (!text?.trim()) return '';

    const oneLine = text.replace(/\s+/g, ' ').trim();
    if (oneLine.length <= maxLen) return oneLine;

    const firstSentence = oneLine.split(/[.!?\n]/)[0]?.trim() ?? '';
    if (firstSentence.length >= 24 && firstSentence.length <= maxLen) {
      return firstSentence;
    }

    return `${oneLine.slice(0, maxLen).trimEnd()}…`;
  }

  private mapShoppingResults(
    results: SerpShoppingResult[],
    defaultCurrency: string,
    exchangeRates: ExchangeRates,
  ): ProductPriceOffer[] {
    const offers: ProductPriceOffer[] = [];

    for (const row of results) {
      const productUrl = (
        row.product_link ||
        row.link ||
        row.tracking_link ||
        ''
      ).trim();
      if (!productUrl) continue;

      const storeDomain = this.resolveStoreDomain(productUrl, row.source);
      const storeName = this.resolveStoreName(row.source, storeDomain);
      const priceLabel = (row.price || '').trim() || 'Narx ko‘rsatilmagan';
      const priceValue =
        typeof row.extracted_price === 'number' &&
        Number.isFinite(row.extracted_price)
          ? row.extracted_price
          : this.parsePriceFromLabel(priceLabel);
      const currency = this.detectCurrency(priceLabel) ?? defaultCurrency;

      const convertedPrices =
        priceValue != null && priceValue > 0
          ? this.convertToAllCurrencies(priceValue, currency, exchangeRates)
          : null;

      offers.push({
        storeName,
        storeDomain,
        logoUrl: storeDomain
          ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(storeDomain)}&sz=128`
          : null,
        title: (row.title || dtoFallbackTitle(row)).trim(),
        priceLabel,
        priceValue,
        currency,
        convertedPrices,
        productUrl,
        rating: typeof row.rating === 'number' ? row.rating : null,
        reviewsCount: typeof row.reviews === 'number' ? row.reviews : null,
        deliveryNote: row.delivery?.trim() || null,
      });
    }

    return offers;
  }

  private resolveStoreDomain(
    productUrl: string,
    source?: string,
  ): string | null {
    try {
      const hostname = new URL(productUrl).hostname
        .replace(/^www\./i, '')
        .toLowerCase();

      for (const domain of Object.keys(KNOWN_STORE_DOMAINS)) {
        if (hostname === domain || hostname.endsWith(`.${domain}`)) {
          return domain;
        }
      }

      return hostname || null;
    } catch {
      if (source) {
        const normalized = source.trim().toLowerCase();
        const match = Object.entries(KNOWN_STORE_DOMAINS).find(
          ([, label]) => label.toLowerCase() === normalized,
        );
        return match?.[0] ?? null;
      }

      return null;
    }
  }

  private resolveStoreName(
    source: string | undefined,
    domain: string | null,
  ): string {
    if (domain && KNOWN_STORE_DOMAINS[domain]) {
      return KNOWN_STORE_DOMAINS[domain];
    }

    if (source?.trim()) {
      return source.trim();
    }

    if (domain) {
      const label = domain.split('.')[0];
      return label.charAt(0).toUpperCase() + label.slice(1);
    }

    return 'Do‘kon';
  }

  private parsePriceFromLabel(label: string): number | null {
    const digits = label.replace(/[^\d.,]/g, '').replace(/\s/g, '');
    if (!digits) return null;

    const normalized =
      digits.includes(',') && digits.includes('.')
        ? digits.replace(/,/g, '')
        : digits.replace(/,/g, '.');

    const value = Number.parseFloat(normalized);
    return Number.isFinite(value) ? value : null;
  }

  private detectCurrency(label: string): string | null {
    if (/so[''`ʻ]m|сум|uzs|сўм/i.test(label)) return 'UZS';
    if (/\$|usd|us\$/i.test(label)) return 'USD';
    if (/€|eur/i.test(label)) return 'EUR';
    if (/₽|rub|руб/i.test(label)) return 'RUB';
    return null;
  }
}

function dtoFallbackTitle(row: SerpShoppingResult): string {
  return row.source?.trim() || 'Mahsulot';
}
