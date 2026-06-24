// api/generate-content.js — キーワード＋ナレッジから自然な文章を生成
import { kvGet } from './_kv.js';

// 生成モデル（高性能なllama-3.3-70b。Groqで無料・日本語の質が高い）
const GROQ_MODEL = 'llama-3.3-70b-versatile';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { locationId, type, reviewText, rating, reviewerName } = req.body;
  if (!locationId || !type) return res.status(400).json({ error: 'locationId・type必須' });

  // お客さん向け口コミ下書き / Instagram整形 で使う追加パラメータ
  const userWords = Array.isArray(req.body.words) ? req.body.words.filter(Boolean) : [];
  const sourceText = req.body.sourceText || '';

  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_API_KEY) return res.status(500).json({ error: 'GROQ_API_KEY未設定' });

  // ── URLから店舗情報を自動抽出（HP/ぐるなび等のWebページ） ──
  if (type === 'autofill') {
    const url = req.body.url;
    if (!url || !/^https?:\/\//.test(url)) return res.status(400).json({ error: '有効なURLを入力してください' });
    let pageText = '';
    try {
      const pr = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; cantik-meo-bot/1.0)' } });
      let html = await pr.text();
      html = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
      pageText = html.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 7000);
    } catch (e) {
      return res.status(400).json({ error: 'URLの取得に失敗しました: ' + e.message });
    }
    if (pageText.length < 50) return res.status(400).json({ error: 'ページから十分な情報を取得できませんでした（JS主体のページの可能性）' });

    const exPrompt = `あなたはMEO（Googleマップ集客）の専門家です。
以下は店舗のWebページ（ホームページやグルメサイト等）から抽出したテキストです。
このページを読み、MEOで上位表示・評価向上につながる「企業ナレッジ」を作成し、指定のJSONのみを出力してください。

【ページ内容】
${pageText}

【ルール】
■事実情報（捏造厳禁・ページに無ければ空文字 ""）
- storeName / postalCode / phone / businessDays / businessHours / address / parking はページに書かれた事実のみ。推測しない。
- postalCode は郵便番号（例 252-0314）。address は郵便番号を除いた住所。
- businessDays は営業日（例「月〜土」）、closedDays は定休日（例「日曜・祝日」）、businessHours は時間帯（例「10:00〜20:00」）。

■MEO最適化して記載する項目（事実をもとに、検索で見つかりやすい書き方にする）
- category: 検索で使われる業種名（例「美容室」「整骨院」「焼き鳥居酒屋」）
- nearbyLandmarks: ページにある最寄り駅・目印・徒歩分などのアクセス情報（地域検索に効く。無ければ空）
- keywords: 「地域名×業種」「地域名×業種×ニーズ/メニュー」の検索されやすい語を読点区切りで8〜10個。実際に検索されそうな組み合わせにする（例「相模原 焼き鳥」「相模原 居酒屋 個室」）
- strengths: ページから読み取れる強み・特徴を、検索意図に合うキーワードを自然に含めて簡潔に
- services: 主要なサービス・メニューを（あれば価格も）具体的に。検索される語を含める
- targetCustomer: ページから推測できる主な客層
- description: 来店を促す自然な紹介文（誇大表現・効果の断定はしない）

■共通
- ページに無い事実・実績・数値を創作しない
- JSON以外（説明・前置き・コードブロック記号）は一切出力しない

【出力JSON】
{"storeName":"","category":"","postalCode":"","address":"","phone":"","businessDays":"","closedDays":"","businessHours":"","parking":"","nearbyLandmarks":"","description":"","strengths":"","expertise":"","services":"","serviceArea":"","targetCustomer":"","keywords":""}`;
    try {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: [{ role: 'user', content: exPrompt }],
          max_tokens: 700, temperature: 0.3,
        }),
      });
      const data = await r.json();
      let content = data.choices?.[0]?.message?.content?.trim() || '';
      // JSON部分を抽出
      const s = content.indexOf('{'), e = content.lastIndexOf('}');
      if (s === -1 || e === -1) return res.status(500).json({ error: 'AI抽出に失敗しました（JSON取得不可）' });
      let fields;
      try { fields = JSON.parse(content.slice(s, e + 1)); }
      catch (er) { return res.status(500).json({ error: 'AI抽出結果の解析に失敗しました' }); }
      return res.json({ fields });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── HPを読んでAIO/LLMO/GEOの対応済み項目を自動判定 ──
  if (type === 'aio_detect') {
    const url = req.body.url;
    if (!url || !/^https?:\/\//.test(url)) return res.status(400).json({ error: '有効なURLを入力してください' });
    let html = '';
    try {
      const pr = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; cantik-meo-bot/1.0)' } });
      html = await pr.text();
    } catch (e) { return res.status(400).json({ error: 'URLの取得に失敗しました: ' + e.message }); }

    const detected = [];
    // 構造化データ（JSON-LD）を正規表現で確実に判定
    if (/"@type"\s*:\s*"(LocalBusiness|Dentist|MedicalClinic|Restaurant|HealthAndBeautyBusiness|Store|ProfessionalService)"/i.test(html)) detected.push('structured_local');
    if (/"@type"\s*:\s*"FAQPage"/i.test(html) || /"@type"\s*:\s*"Question"/i.test(html)) detected.push('structured_faq');
    if (/"@type"\s*:\s*"AggregateRating"|"aggregateRating"\s*:/i.test(html)) detected.push('structured_review');

    // 本文テキスト化してAIで内容系の項目を判定
    let pageText = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 6000);
    const aiPrompt = `以下は店舗Webページのテキストです。各項目がページ上で「対応済み」と言えるか、true/falseのJSONのみで答えてください。推測で甘く判定せず、明確に該当する場合のみtrue。

【ページ内容】
${pageText}

【判定項目】
- faq_page: 「〇〇するなら？」等のQ&A・よくある質問コンテンツがある
- faq_natural: 見出しが質問形式で、その下に回答が書かれている
- eeat_author: 専門家・スタッフのプロフィールや実績の掲載がある
- eeat_stats: 実績数値（創業〇年・顧客満足度〇%・施術数など）の記載がある
- nap_unified: 店名・住所・電話番号がページに明記されている

【出力JSON】
{"faq_page":false,"faq_natural":false,"eeat_author":false,"eeat_stats":false,"nap_unified":false}
JSON以外は出力しない。`;
    try {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST', headers: { Authorization: `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: GROQ_MODEL, messages: [{ role: 'user', content: aiPrompt }], max_tokens: 200, temperature: 0.1 }),
      });
      const data = await r.json();
      const content = data.choices?.[0]?.message?.content || '';
      const s = content.indexOf('{'), e = content.lastIndexOf('}');
      if (s !== -1 && e !== -1) {
        try {
          const j = JSON.parse(content.slice(s, e + 1));
          ['faq_page', 'faq_natural', 'eeat_author', 'eeat_stats', 'nap_unified'].forEach(k => { if (j[k] === true) detected.push(k); });
        } catch (er) { /* AI判定失敗時は構造化データのみ返す */ }
      }
    } catch (e) { /* AI失敗時も構造化データの結果は返す */ }

    return res.json({ detected: [...new Set(detected)] });
  }

  // ── 既存ナレッジをMEO最適化して強化（より詳しく・検索されやすく） ──
  if (type === 'meo_enrich') {
    const cur = req.body.current || {};
    const curKw = Array.isArray(cur.keywords) ? cur.keywords.filter(Boolean) : [];
    const enPrompt = `あなたはMEO（Googleマップ集客）の専門家です。
以下の店舗情報を、Googleマップ・地域検索で上位表示と評価向上につながるよう、より具体的で検索されやすい内容に強化してください。
事実は変えず（捏造・誇大・効果断定なし）、表現と情報の粒度をMEO最適化します。

【店舗名】${cur.storeName || ''}
【業種】${cur.category || ''}
【地域/住所】${cur.address || ''}
【近隣ランドマーク】${cur.nearbyLandmarks || ''}
【現在の強み】${cur.strengths || ''}
【現在のサービス】${cur.services || ''}
【現在のターゲット】${cur.targetCustomer || ''}
【現在の説明】${cur.description || ''}
【現在のキーワード】${curKw.join('、') || 'なし'}

【強化ルール】
- keywords: 「地域名×業種」「地域名×業種×ニーズ/メニュー」「地域名×悩み」「隣接エリア×業種」など実際に検索される語を10〜15個。ビッグKWからロングテールまで幅広く、読点区切り
- strengths: 検索意図と差別化を意識し、具体的な特徴を3〜5文でしっかり書く（地域名・サービス名・専門性・実績・こだわりを自然に含む。MEOで効くよう情報量を厚めに。ただし架空の数値や実績は作らない）
- services: 主要メニュー/サービスを検索される語を含めて具体的に列挙（価格があれば残す。各サービスの特徴も一言添えて情報量を増やす）
- description: 来店を促す自然な紹介文（150〜250字・地域名と業種を自然に含む）
- targetCustomer: 主な客層を具体的に
- nearbyLandmarks: 分かれば最寄り駅・目印・徒歩分（無ければ現状維持/空）
- tips: さらにMEO順位・評価を上げる具体アクションを5個（GBP属性設定・写真追加・口コミ依頼・投稿テーマ・FAQ登録など）。各行「・」始まり。効果断定や捏造はしない

【出力JSON】（tipsは改行区切りの文字列、他は文字列）
{"keywords":"","strengths":"","services":"","description":"","targetCustomer":"","nearbyLandmarks":"","tips":""}
JSON以外は一切出力しない。`;
    try {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: GROQ_MODEL, messages: [{ role: 'user', content: enPrompt }], max_tokens: 900, temperature: 0.5 }),
      });
      const data = await r.json();
      const content = data.choices?.[0]?.message?.content?.trim() || '';
      const s = content.indexOf('{'), e = content.lastIndexOf('}');
      if (s === -1 || e === -1) return res.status(500).json({ error: 'MEO強化に失敗しました（JSON取得不可）' });
      let fields;
      try { fields = JSON.parse(content.slice(s, e + 1)); }
      catch (er) { return res.status(500).json({ error: 'MEO強化結果の解析に失敗しました' }); }
      return res.json({ fields });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ナレッジ取得
  const knowledge = await kvGet(`knowledge_${locationId}`) || {};
  const storeName = knowledge.storeName || '当店';
  const keywords = (knowledge.keywords || []).filter(Boolean);
  const strengths = knowledge.strengths || '';
  const services = knowledge.services || '';

  let prompt = '';

  // ★4〜5：感謝の返信
  if (type === 'reply_positive') {
    prompt = `あなたは${storeName}の店舗スタッフです。
以下の口コミに、内容をしっかり読み取った上でお礼の返信を書いてください。

【口コミ者名】${reviewerName || 'お客様'}
【評価】★${rating}/5
【口コミ本文】${reviewText}

【店舗の強み・特徴】${strengths}
【提供サービス・商品】${services}
【キーワード】${keywords.join('、')}

【返信のルール】
- まず口コミ本文を読み、お客様が「具体的に何を褒めてくれたか」を1点拾って、それに触れて感謝する（例：料理・接客・雰囲気・特定のメニュー名など、本文に出た言葉を使う）
- お客様が触れた点に関連する自社のサービス・商品（上記）を自然に絡める。ただし押し売りや宣伝くさくしない
- MEO対策：可能であれば「地域名」や上記キーワードの語を1つだけ、文意を壊さない範囲で自然に織り込む（例「〇〇（地域）で…」）。無理に詰め込まない・不自然なら入れない
- 120〜180文字程度
- 「お越しいただきありがとうございます」を自然に含める
- お客様の名前（${reviewerName}様）を1回使う
- 文末は「またのご来店をお待ちしております」系で締める
- です・ます調、丁寧だが堅すぎない
- AIっぽいテンプレ感を出さない。口コミ本文に書いていない事実を勝手に作らない
- 絵文字・記号は使わない
- 返信文のみ出力`;
  }

  // ★1〜3：謝罪・改善の返信
  if (type === 'reply_negative') {
    prompt = `あなたは${storeName}の店舗スタッフです。
以下のネガティブな口コミに、内容を正確に読み取った上で誠実に返信してください。

【口コミ者名】${reviewerName || 'お客様'}
【評価】★${rating}/5
【口コミ本文】${reviewText}

【店舗の強み・特徴】${strengths}
【提供サービス・商品】${services}
【キーワード】${keywords.join('、')}

【返信のルール】
- まず口コミ本文を読み、お客様が「何に不満を感じたのか」を具体的に特定し、その点に正面から触れる
- まず「申し訳ございませんでした」と誠実に謝罪
- 指摘された点について、可能なら自社の取り組みやサービス内容（上記）を踏まえた改善・対応を具体的に伝える
- MEO対策：謝罪の文意を損なわない範囲で、地域名やサービス名を不自然でなければ1つだけ自然に含める（謝罪が主目的。無理なら入れない）
- 150〜200文字程度
- 再来店を丁寧にお願いする
- です・ます調、誠実で温かみのある文体
- AIっぽいテンプレ感を出さない。口コミ本文に書いていない事実や言い訳を作らない
- 言い訳がましくならない
- 絵文字・記号は使わない
- 返信文のみ出力`;
  }

  // Googleポスト生成
  if (type === 'post') {
    const { customInstruction } = req.body;
    // 値のある項目だけを情報ブロックに含める（未設定の項目はそもそも見せない）
    const infoLines = [];
    if (knowledge.storeName) infoLines.push(`店名: ${knowledge.storeName}`);
    if (knowledge.category) infoLines.push(`業種: ${knowledge.category}`);
    const area = [knowledge.address, knowledge.nearbyLandmarks].filter(Boolean).join(' ');
    if (area) infoLines.push(`地域/アクセス: ${area}`);
    if (strengths) infoLines.push(`強み・特徴: ${strengths}`);
    if (knowledge.expertise) infoLines.push(`専門性・実績: ${knowledge.expertise}`);
    if (services) infoLines.push(`提供サービス・メニュー: ${services}`);
    if (knowledge.serviceArea) infoLines.push(`対応エリア: ${knowledge.serviceArea}`);
    if (knowledge.targetCustomer) infoLines.push(`客層: ${knowledge.targetCustomer}`);
    if (keywords.length) infoLines.push(`キーワード: ${keywords.join('、')}`);
    const infoBlock = infoLines.length ? infoLines.join('\n') : '（店舗情報が未登録）';

    prompt = `あなたは「${knowledge.storeName || storeName}」で実際に働くスタッフです。
この店のGoogleビジネスプロフィール投稿を、下記の「実際の店舗情報」だけに基づいて書いてください。

【実際の店舗情報】
${infoBlock}

【今回の投稿の切り口・指示】${customInstruction || '一般的なお店の紹介'}

【絶対に守るルール】
- 上記に書かれている情報だけを使う。書かれていない事実（架空の店名・地域・メニュー・価格・イベント・店のコンセプト）を創作しない
- 「店名:」「業種:」などの項目名やラベルは絶対に投稿文に書かない。情報を自然な文章に溶け込ませる
- 「切り口・指示」は投稿の方向性として使うだけ。指示やテーマの言葉を、店名やお店のコンセプトとして扱わない（例：テーマが「MEO」でも、MEOという店や概念の話は作らない。あくまでこの店の宣伝にする）
- 店舗情報が未登録/乏しい場合は、具体を創作せず「気軽に来店してほしい」程度の短く自然な案内文にする
- 実在するこの店の自然な宣伝文にする。地域名・サービス名を自然に含める
- 150〜250文字程度・読みやすい改行・絵文字1〜2個まで
- 「ぜひお気軽にお越しください」等の来店促進を1つ含める
- 効果・順位の断定や誇大表現はしない
- 投稿文のみ出力`;
  }

  // お客さん向け：単語から口コミの「下書き」を作る
  if (type === 'review_draft') {
    prompt = `あなたは、お店に来店したお客様が口コミを書くのを手伝うアシスタントです。
お客様が選んだ「良かった点」のキーワードをもとに、そのお客様が自分で書いたような自然な口コミの下書きを作成してください。

【店舗名】${storeName}
【お客様が選んだ良かった点】${userWords.join('、') || '特になし'}

【ルール】
- 80〜150文字程度
- お客様本人が書いたような、等身大で自然な一人称の文体（です・ます調 or 体言止め混在OK）
- 選ばれたキーワードを自然に反映する
- 過度に宣伝的・大げさにしない。正直な感想のトーン
- 星評価や「★5です」などの表現は入れない
- 絵文字は0〜1個まで
- お店側の宣伝文句や定型のキャッチコピーを入れない
- これはあくまで「下書き（たたき台）」。本人が自由に直す前提で、自然な日本語にする
- 口コミ本文のみ出力`;
  }

  // 写真＋クライアント情報から、Instagram投稿キャプションをゼロから生成
  if (type === 'instagram_post') {
    const photoNote = req.body.photoNote || sourceText || '';
    prompt = `あなたは${storeName}の中の人として、Instagramの投稿キャプションを書きます。
広告代理店が書いたような既製品の文章ではなく、お店のスタッフが実際に書いたような、体温のある文章にしてください。

【店舗名】${storeName}
【業種・カテゴリ】${knowledge.category || ''}
【強み・特徴】${strengths}
【提供サービス】${services}
【狙いたいお客様】${knowledge.targetCustomer || ''}
【キーワード】${keywords.join('、')}
【今回の写真の内容・伝えたいこと】${photoNote || '（指定なし。お店の魅力が伝わる内容で）'}

【ルール】
- 全体で200〜350文字程度＋ハッシュタグ
- 1行目で思わず読みたくなる自然なフックを作る（「〜しませんか？」の連発や、いかにも広告な煽りは避ける）
- 実際の人が話すような、等身大で具体的な言葉づかい。きれいごとや抽象的な美辞麗句を避ける
- 写真の内容に自然に触れる
- 押し売り感を出さず、最後にさりげない来店・問い合わせの一言を添える
- 絵文字は使っても1〜3個まで、多用しない
- 文末にハッシュタグを8〜12個改行して付ける（地域名・業種・サービス・関連語をバランスよく）
- 誇大表現・効果の断定・他店比較はしない
- キャプション本文＋ハッシュタグのみ出力（前置きや説明文は不要）`;
  }

  // MEO投稿をInstagramキャプション用に整形する
  if (type === 'instagram') {
    prompt = `あなたは${storeName}のSNS担当です。
以下のGoogleビジネスプロフィール投稿の文章を、Instagramのキャプション用に整形してください。

【元の投稿文】${sourceText}
【キーワード】${keywords.join('、')}

【ルール】
- 内容は元の投稿と同じ趣旨を保つ
- Instagram向けに、改行を使った読みやすいレイアウトにする
- 最後にハッシュタグを5〜8個（地域名・業種・サービス・関連語）改行して付ける
- 絵文字を適度に使い、親しみやすいトーンにする
- 過度な宣伝・誇大表現は避ける
- キャプション本文＋ハッシュタグのみ出力`;
  }

  // MEO診断の助言文（スコアはフロントで機械的に算出。AIは課題・施策の文章のみ）
  if (type === 'diagnosis') {
    const d = req.body.diagnosis || {};
    const filled = (d.filled || []).join('、') || 'なし';
    const missing = (d.missing || []).join('、') || 'なし';
    const rv = d.reviewStats || {};
    const reviewLine = rv.totalCount != null
      ? `平均★${rv.averageRating || 0} / ${rv.totalCount || 0}件 / 未返信${rv.unrepliedCount || 0}件`
      : '未連携（口コミ未取得）';
    const rankLine = (d.rankings && d.rankings.length)
      ? d.rankings.map(r => `「${r.keyword}」${r.rank ? r.rank + '位' : '圏外'}`).join('、')
      : '未計測';
    prompt = `あなたはMEO（Googleマップ集客）の専門コンサルタントです。
以下の店舗の現状を見て、改善アドバイスを簡潔に書いてください。

【店舗名】${storeName}
【業種】${knowledge.category || '不明'}
【MEOスコア】${d.score != null ? d.score : '?'}/100
【できている項目】${filled}
【未対応・弱い項目】${missing}
【口コミ】${reviewLine}
【キーワード順位】${rankLine}

【出力ルール】
- 次の3見出しで、各2〜4個の箇条書き（・で始める）。見出しはそのまま使う。
■優先課題
■やるべき施策
■上位表示のための行動
- 「未対応・弱い項目」を最優先で具体的に指摘する
- 効果・順位・集客数を断定や捏造しない（「〜が期待できます」程度に留める）
- 専門用語は噛み砕いて、現場で何をすればいいか分かるように
- 前置き・締めの挨拶は不要。3見出しの箇条書きのみ出力`;
  }

  // 媒体登録状況・AIO/LLMO/GEOの「やることリスト」助言（現状をふまえて次の一手を提示）
  if (type === 'advice') {
    const topic = req.body.topic;
    const context = req.body.context || '';
    if (topic === 'citation') {
      prompt = `あなたはローカルSEO・サイテーション（各種媒体への店舗掲載）の専門家です。
業種「${knowledge.category || '不明'}」の店舗「${storeName}」について、現在の媒体登録状況をふまえ、次に何を優先すべきか助言してください。

【現在の媒体登録状況】
${context}

【出力ルール】
- 「■優先して登録すべき媒体」「■やるべきこと」の2見出しで、各2〜4個の箇条書き（・始まり）
- この業種で集客に効く媒体を優先し、未登録の重要媒体を具体名で挙げる
- NAP（店名・住所・電話）の表記統一の重要性にも触れる
- 効果・順位・集客数を断定や捏造しない
- 前置き・締めは不要。2見出しの箇条書きのみ出力`;
    } else if (topic === 'aio') {
      prompt = `あなたはAIO/LLMO/GEO（ChatGPTやGoogleのAI検索などで店舗が引用・推奨されるための最適化）の専門家です。
店舗「${storeName}」（業種：${knowledge.category || '不明'}）の現在のAIO対策状況をふまえ、次に何をすべきか助言してください。

【現在のAIO対策状況】
${context}

【出力ルール】
- 「■未対応で優先すべき項目」「■具体的なアクション」の2見出しで、各2〜4個の箇条書き（・始まり）
- 構造化データ、FAQ、明確な事実・数値の記載、第三者からの言及など、AIに引用されやすくする具体策を、未対応項目を優先して挙げる
- 効果を断定や捏造しない
- 前置き・締めは不要。2見出しの箇条書きのみ出力`;
    } else {
      return res.status(400).json({ error: '不明なtopic' });
    }
  }

  // 画像に載せる短いキャッチコピー
  if (type === 'catchcopy') {
    prompt = `あなたは${storeName}の広告担当です。Instagram/Googleポストの画像に載せる短いキャッチコピーを1つだけ作ってください。

【店舗情報】
- 店名: ${knowledge.storeName || storeName}
- 業種: ${knowledge.category || ''}
- 強み: ${strengths}
- サービス: ${services}
- 切り口の指定: ${req.body.customInstruction || 'お店の魅力が伝わるもの'}

【ルール】
- 18文字以内。短く印象的に
- 店の実情報に基づく。架空の事実や誇大表現・効果断定はしない
- 鉤括弧や記号で囲わない。キャッチコピーの言葉だけを出力`;
  }

  // 業種に合わせた月間投稿テーマを複数生成（月間プランの土台）
  if (type === 'post_themes') {
    const count = Math.min(Math.max(parseInt(req.body.count) || 5, 1), 12);
    const monthTheme = req.body.theme || '';
    prompt = `あなたは${storeName}（業種：${knowledge.category || '不明'}）のローカル集客（MEO）専門家です。
この業種・この店舗に最適な、来店や問い合わせにつながるGoogleビジネスプロフィール投稿のテーマを${count}個提案してください。

【店舗情報】
- 業種: ${knowledge.category || '不明'}
- 強み: ${strengths || '未設定'}
- 提供サービス: ${services || '未設定'}
- ターゲット: ${knowledge.targetCustomer || '未設定'}
- 地域: ${knowledge.address || ''}
${monthTheme ? `- 今月の方針: ${monthTheme}` : ''}

【ルール】
- その業種ならではの、検索・来店・予約につながる具体的なテーマにする（一般論や架空のキャンペーンにしない）
  例）整骨院→「肩こりの原因と自宅でできる予防」「産後骨盤矯正のご案内」、美容室→「梅雨時のうねり対策」「白髪染めの色持ちのコツ」、飲食→「今月の旬の食材を使った一品」「ランチの人気メニュー」
- 各テーマは15〜35文字程度の短いフレーズ
- ${count}個を改行区切りで出力。番号・記号・前置きは付けない。テーマのみ`;
  }

  // 店舗情報から「狙い目MEOキーワード」をおすすめ順に10個提案
  if (type === 'keyword_suggest') {
    prompt = `あなたはMEO（Googleマップ集客）の専門家です。
以下の店舗が狙うべき・上位を取りやすい検索キーワードを、おすすめ順に10個提案してください。

【店舗情報】
- 業種: ${knowledge.category || '不明'}
- 地域/住所: ${knowledge.address || ''}
- 強み・特徴: ${strengths || '未設定'}
- 提供サービス: ${services || '未設定'}
- 既存キーワード: ${keywords.join('、') || 'なし'}

【ルール】
- お客様が実際に検索しそうな「地域名×業種」「地域名×ニーズ/メニュー/悩み」「最寄り駅×業種」などを中心に
- 来店・予約につながりやすく、かつ競合が少なめで上位を狙いやすいものを優先しておすすめ順に並べる
- 既存キーワードと重複しない、新しい狙い目を中心に
- 検索ボリュームの具体数値や順位は捏造しない

【出力形式】（この通りに出力。前置き不要）
1行目に「推奨個数：◯個（この業種で効果的に運用できる目安と理由を一言）」
2行目以降に、各行「キーワード ｜ 一言の理由（なぜ狙い目か）」の形式で、ちょうど10個（番号・記号なし）`;
  }

  // 周辺地域を面で押さえる「地域×業種」キーワードを生成（地域強化）
  if (type === 'area_keywords') {
    const extraAreas = req.body.areas || '';
    prompt = `あなたはMEO（ローカル集客）の専門家です。
以下の店舗について、所在地と周辺地域（隣接する市区町村、最寄り駅と同じ沿線の駅）を踏まえ、来店が見込める範囲を「面」で押さえる検索キーワードを作ってください。

【店舗情報】
- 業種: ${knowledge.category || '不明'}
- 所在地: ${knowledge.address || ''} ${knowledge.nearbyLandmarks || ''}
- 対応エリア: ${knowledge.serviceArea || ''}
- 追加で狙いたい地域: ${extraAreas || '（指定なし。所在地から判断）'}
- 強み: ${strengths || ''}

【ルール】
- 店舗のある市区町村だけでなく、来店が見込める「隣接の市区町村」「近隣の駅名」も含めて広げる
- 各地域に「地域名×業種」「地域名×業種×ニーズ/メニュー」を割り当てる
- 必ず実在する地域名・駅名のみ使う（架空の地名を作らない）
- 15〜20個を読点（、）区切りで出力。キーワードのみ（番号・理由・前置き不要）`;
  }

  if (!prompt) return res.status(400).json({ error: '不明なtype' });

  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 500,
        temperature: 0.85,
        top_p: 0.9,
      }),
    });
    const data = await r.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) return res.status(500).json({ error: 'AI生成失敗' });
    res.json({ content });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
