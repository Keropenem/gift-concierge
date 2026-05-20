// LLM出力に含まれる商品URLを検証する後処理。
// (1) HEADリクエストで到達可能性チェック（#2/#7 URL捏造・誤りの検出）
// (2) ドメインがECサイトとして購入動線がありそうか判定（#8 閲覧専用URL排除）
// 提案の即時破棄まではせず、警告マーカーを応答末尾に追加する。
// LLM がそもそも怪しい URL を出さないようにする一次対策は SYSTEM_PROMPT_HIDDEN 側。
// ここは「漏れた怪しいURL」を網にかける二次対策。

const FETCH_TIMEOUT_MS = 4000;
const MAX_URLS_TO_CHECK = 10;

// 購入動線が確実にあるECドメイン（substring 一致）
const EC_DOMAINS = [
  // モール系
  "rakuten.co.jp",
  "amazon.co.jp",
  "amazon.com",
  "shopping.yahoo.co.jp",
  "store.shopping.yahoo.co.jp",
  "paypaymall.yahoo.co.jp",
  // ECプラットフォーム
  ".shopify.com",
  ".myshopify.com",
  "thebase.in",
  ".thebase.in",
  ".base.shop",
  ".stores.jp",
  ".booth.pm",
  ".creema.jp",
  ".minne.com",
  ".iichi.com",
  // よくある独自ECドメインパターン
  "/shop/",
  "/store/",
  "/products/",
  "/item/",
  "/cart/",
];

// 明らかに「閲覧専用」で購入できないドメイン・パターン
const NON_EC_PATTERNS = [
  ".museum",
  ".or.jp/news/",
  ".co.jp/news/",
  ".com/news/",
  "/news/",
  "/article/",
  "/press/",
  "/blog/",
  "wikipedia.org",
  "ja.wikipedia.org",
  "en.wikipedia.org",
  "note.com",
  "ameblo.jp",
  "hatenablog.com",
  ".gallery/",
  "/gallery/",
];

export type UrlCheckResult = {
  url: string;
  reachable: boolean;
  status?: number;
  isEcLikely: boolean;
  error?: string;
};

export function extractUrls(text: string): string[] {
  // Markdown リンク `[label](url)` と素のURLの両方を拾う
  const urls = new Set<string>();
  const mdLinkRe = /\[[^\]]*\]\((https?:\/\/[^\s\)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = mdLinkRe.exec(text)) !== null) {
    urls.add(m[1]);
  }
  const bareRe = /(?<![\(\[])(https?:\/\/[^\s\)\]\、。」)]+)/g;
  while ((m = bareRe.exec(text)) !== null) {
    urls.add(m[1]);
  }
  return Array.from(urls);
}

export function classifyEc(url: string): boolean {
  const lower = url.toLowerCase();
  // 非ECパターンに該当したら即false
  for (const p of NON_EC_PATTERNS) {
    if (lower.includes(p)) return false;
  }
  // ECパターンのいずれかに該当したらtrue
  for (const p of EC_DOMAINS) {
    if (lower.includes(p)) return true;
  }
  // どちらにも該当しない場合は「不明」だが、保守的にtrueにせず判定保留→true扱い（false positive を避ける）
  return true;
}

async function headCheck(url: string): Promise<{ reachable: boolean; status?: number; error?: string }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      // HEAD で試し、405/501等で拒否されたらGET（rangeで1バイトだけ）にフォールバック
      let res = await fetch(url, {
        method: "HEAD",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; ENN-LinkChecker/1.0)",
        },
      });
      if (res.status === 405 || res.status === 501) {
        res = await fetch(url, {
          method: "GET",
          redirect: "follow",
          signal: controller.signal,
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; ENN-LinkChecker/1.0)",
            Range: "bytes=0-0",
          },
        });
      }
      const reachable = res.status < 400;
      return { reachable, status: res.status };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { reachable: false, error: msg };
  }
}

export async function validateUrls(text: string): Promise<UrlCheckResult[]> {
  const urls = extractUrls(text).slice(0, MAX_URLS_TO_CHECK);
  if (urls.length === 0) return [];

  const results = await Promise.all(
    urls.map(async (url): Promise<UrlCheckResult> => {
      const isEcLikely = classifyEc(url);
      const { reachable, status, error } = await headCheck(url);
      return { url, reachable, status, isEcLikely, error };
    })
  );
  return results;
}

// 検証結果から問題URLを抽出し、応答末尾に追記する注意書きを生成
export function buildUrlWarningSuffix(results: UrlCheckResult[]): string {
  const unreachable = results.filter((r) => !r.reachable);
  const nonEc = results.filter((r) => r.reachable && !r.isEcLikely);

  if (unreachable.length === 0 && nonEc.length === 0) return "";

  const lines: string[] = ["\n\n---", "> **ご案内**"];

  if (unreachable.length > 0) {
    lines.push("> 一部の商品URLが現在アクセスできない可能性があります。商品名でECサイト（楽天 / Amazon 等）を直接検索することをお勧めします:");
    for (const r of unreachable) {
      lines.push(`> - ${r.url} ${r.status ? `(HTTP ${r.status})` : "(到達不可)"}`);
    }
  }

  if (nonEc.length > 0) {
    lines.push("> 一部のURLはニュース記事・ギャラリー紹介ページ等の「閲覧専用」の可能性があります。購入可能なECサイトでの再検索をお勧めします:");
    for (const r of nonEc) {
      lines.push(`> - ${r.url}`);
    }
  }

  return lines.join("\n");
}
