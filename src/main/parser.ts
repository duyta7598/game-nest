import { createHash } from 'node:crypto';
import { type CheerioAPI, load } from 'cheerio';
import type { CatalogPage, Game, GameDetail } from '../shared/types';

export const SOURCE = 'https://fitgirl-repacks.site';

export function sourceUrl(value: string): string {
  const url = new URL(value, SOURCE);
  if (url.origin !== SOURCE || url.username || url.password) {
    throw new Error('Đường dẫn không thuộc nguồn FitGirl đã cấu hình.');
  }
  url.hash = '';
  return url.href;
}

export function validMagnet(value: string): boolean {
  if (value.length > 32768) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'magnet:' &&
      url.searchParams
        .getAll('xt')
        .some(
          (xt) =>
            /^urn:btih:([a-f0-9]{40}|[a-z2-7]{32})$/i.test(xt) ||
            /^urn:btmh:1220[a-f0-9]{64}$/i.test(xt),
        )
    );
  } catch {
    return false;
  }
}

const clean = (text: string) => text.replace(/\s+/g, ' ').trim();

function gameFromArticle($: CheerioAPI, selector: Parameters<CheerioAPI>[0]): Game | null {
  const article = $(selector);
  const link = article.find('.entry-title a').first();
  const title = clean(link.text() || article.find('.entry-title').first().text());
  const content = article.find('.entry-content');
  if (
    !title ||
    (!article.hasClass('category-lossless-repack') && !content.find('a[href^="magnet:"]').length)
  )
    return null;
  let url: string;
  try {
    url = sourceUrl(link.attr('href') || $('link[rel="canonical"]').attr('href') || '');
  } catch {
    return null;
  }
  const clone = content.clone();
  clone.find('br').replaceWith('\n');
  clone.find('script, style').remove();
  clone.find('p, div, h1, h2, h3, h4, li').append('\n');
  const text = clone.text();
  const size = (label: string) =>
    clean(text.match(new RegExp(`${label}:\\s*([^\\n]+)`, 'i'))?.[1] || '').slice(0, 120);
  const imageNode = content.find('img.alignleft, img[width="150"], img').first();
  let image = imageNode.attr('data-src') || imageNode.attr('src') || '';
  try {
    const u = new URL(image, SOURCE);
    image = u.protocol === 'https:' ? u.href : '';
  } catch {
    image = '';
  }
  return {
    id: createHash('sha256').update(url).digest('hex').slice(0, 16),
    title,
    url,
    image,
    genres: [
      ...new Set(
        content
          .find('a[href*="/tag/"]')
          .map((_, a) => clean($(a).text()))
          .get(),
      ),
    ].slice(0, 8),
    repackSize: size('Repack Size'),
    originalSize: size('Original Size'),
    date: article.find('time').first().attr('datetime') || '',
  };
}

export function parseCatalog(html: string, page: number): CatalogPage {
  const $ = load(html);
  if (!$('.site-content, #content, article').length)
    throw new Error(
      'Nguồn trả về trang không đúng định dạng hoặc đang yêu cầu xác minh trong trình duyệt.',
    );
  const games = $('article')
    .map((_, a) => gameFromArticle($, a))
    .get()
    .filter(Boolean) as Game[];
  return {
    games: [...new Map(games.map((g) => [g.id, g])).values()],
    page,
    hasNext: $('.nav-previous a, a.next.page-numbers, a[rel="next"]').length > 0,
    cached: false,
    fetchedAt: new Date().toISOString(),
  };
}

export function parseDetail(html: string, url: string): GameDetail {
  const $ = load(html);
  const article = $('article').first();
  const game = gameFromArticle($, article);
  if (!game) throw new Error('Không tìm thấy thông tin game trên trang này.');
  const content = article.find('.entry-content');
  const magnets = new Map<string, { label: string; uri: string }>();
  content.find('a[href^="magnet:"]').each((_, a) => {
    const uri = $(a).attr('href') || '';
    if (!validMagnet(uri)) return;
    const label = clean($(a).closest('li').find('a').first().text()).slice(0, 80) || 'Torrent';
    magnets.set(uri, { label, uri });
  });
  const paragraphs: string[] = [];
  let collecting = false;
  const features: string[] = [];
  content.children().each((_, element) => {
    const el = $(element);
    const text = clean(el.text());
    if (/^h[1-6]$/.test(element.tagName)) {
      collecting = /game description|about (?:the|this) game/i.test(text);
      if (/repack features/i.test(text)) {
        el.nextUntil('h1,h2,h3,h4')
          .find('li')
          .each((_, li) => {
            features.push(clean($(li).text()).slice(0, 500));
          });
      }
    } else if (collecting && element.tagName === 'p' && text) paragraphs.push(text);
  });
  return {
    ...game,
    url: sourceUrl(url),
    description: paragraphs.join('\n\n').slice(0, 12000),
    features: features.slice(0, 18),
    magnets: [...magnets.values()],
  };
}
