// api/generate-content.js — キーワード＋ナレッジから自然な文章を生成
import { kvGet } from './_kv.js';

// 生成モデル（高性能なllama-3.3-70b。Groqで無料・日本語の質が高い）
const GROQ_MODEL = 'llama-3.3-70b-versatile';

// 業種に合わせた「ご来店/ご依頼/ご購入…」の言い回しと締めの決まり文句を返す
function bizPhrasing(category, storeName) {
  const c = String(category || '');
  const m = (re, verb, close) => re.test(c) ? { verb, close } : null;
  const hit =
    m(/飲食|レストラン|カフェ|居酒屋|料理|食堂|ラーメン|焼|寿司|そば|うどん|バー|ダイニング|ビストロ|パン|スイーツ/, 'ご来店', 'またのご来店を心よりお待ちしております。') ||
    m(/美容|サロン|ネイル|エステ|理容|美容室|ヘア|まつげ|アイラッシュ|脱毛/, 'ご来店', 'またのご来店を心よりお待ちしております。') ||
    m(/整体|整骨|接骨|マッサージ|治療院|鍼|灸|カイロ|リラク/, 'ご来院', 'またのご来院を心よりお待ちしております。') ||
    m(/歯科|クリニック|病院|医院|皮膚科|内科|眼科|整形|治療/, 'ご来院', 'またのご来院を心よりお待ちしております。') ||
    m(/宿泊|ホテル|旅館|民泊|ゲストハウス/, 'ご宿泊', 'またのお越しを心よりお待ちしております。') ||
    m(/EC|通販|ショップ|販売|物販|ストア|オンライン/, 'ご購入', 'またのご利用を心よりお待ちしております。') ||
    m(/制作|Web|ウェブ|ホームページ|ＨＰ|デザイン|システム|開発|アプリ|コンサル|士業|税理|行政書|不動産|広告|マーケ|印刷|撮影/, 'ご依頼', '引き続きよろしくお願いいたします。') ||
    { verb: 'ご利用', close: '引き続きよろしくお願いいたします。' };
  return hit;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { locationId, type, reviewText, rating, reviewerName } = req.body;
  if (!locationId || !type) return res.status(400).json({ error: 'locationId・type必須' });

  // 口コミ返信：投稿日からの経過日数と、選んだトーンで文面を最適化する
  const reviewDate = req.body.reviewDate || req.body.createTime || '';
  let reviewAgeDays = null;
  if (reviewDate) {
    const t = Date.parse(reviewDate);
    if (!isNaN(t)) reviewAgeDays = Math.floor((Date.now() - t) / 86400000);
  }
  // このお店が過去にした返信（文体・句読点・語感を合わせる最優先の見本）。多く読み込むほど文体が安定する。
  const pastReplies = (Array.isArray(req.body.pastReplies) ? req.body.pastReplies : [])
    .map(s => String(s || '').trim()).filter(Boolean).slice(0, 20);
  // 過去返信の平均文字数（返信の長さもこの店に寄せる）
  const avgLen = pastReplies.length ? Math.round(pastReplies.reduce((s, p) => s + p.length, 0) / pastReplies.length) : 0;
  const styleBlock = pastReplies.length
    ? `\n【このお店が過去にした実際の返信 ${pastReplies.length}件（最優先の文体見本）】\n${pastReplies.map((p, i) => `例${i + 1}：${p}`).join('\n')}\n→ これはこの店の"本物の返信"です。上の${pastReplies.length}件をよく読み、この店の"クセ"を体得してください。必ず真似ること：①読点「、」句点「。」の打ち方と頻度 ②一文の長さとリズム（平均で約${avgLen}文字前後） ③語尾のバリエーション（です／ます／ました／ますね／です！ 等の混ぜ方や、この店が使いがちな語尾） ④お礼・お詫び・締めの決まり文句 ⑤呼びかけ方・改行の有無・絵文字や記号を使うかどうか（過去例に無ければ使わない）。内容は今回の口コミに合わせて変えるが、"言い回しの手触り"はこの例に必ず寄せる。過去例に無い硬い定型（「この度は」「誠に」「〜させていただきます」等）を勝手に足さない。`
    : '';
  // AIっぽさ（機械的な句読点・定型の連なり）を消すための共通ガイド
  const humanTone = pastReplies.length
    ? `過去の返信例${pastReplies.length}件の句読点・一文の長さ・語尾・言い回しのクセを最優先で真似る。読点「、」を1文に詰め込みすぎない。全部の文を同じ長さ・同じ形にしない。いかにもAIが書いた"整いすぎた模範解答"にせず、その店のスタッフが実際に手で打ったような、少し崩れた自然さ・体温のある文にする。`
    : '読点「、」を機械的に多用しない（1文に詰め込まない）。一文は短めに区切り、文の長さと語尾（です／ます／ました 等）に変化をつける。「この度は」「誠に」「〜させていただきます」などのテンプレ表現を並べない。教科書的な整いすぎた文でなく、実際のスタッフが手で打ったような自然な口調にする。';
  // 絵文字・！などの記号は「その店の過去返信に合わせる」のが最も人間らしい（一律禁止だと逆に硬くAIっぽい）
  const symbolRule = pastReplies.length
    ? '絵文字や「！」などの記号は、過去の返信例で使われていれば同じくらいの頻度で使い、使われていなければ使わない。過去例に合わせる。'
    : '絵文字・顔文字は使わない。「！」は多くても1つまで（多用しない）。';
  const replyTone = req.body.tone || 'polite';
  const toneGuide = ({
    polite: '丁寧でプロフェッショナルなトーン。落ち着いた敬語で、きちんとしつつ読みやすく。',
    warm: '温かく親しみやすいトーン。「〜嬉しかったです」「ぜひまた」など少しやわらかい言い回しで距離感を縮める。堅すぎる漢語（誠に/賜り 等）は控えめに。',
    formal: 'フォーマルで格式のあるトーン。「誠に」「心より」「賜り」等のかしこまった敬語で礼節を重んじる。',
  })[replyTone] || '丁寧でプロフェッショナルなトーン。';
  // 経過期間に応じた時制ガイド（古い口コミに「先日」等の直近表現を使わせない）
  let timeGuide;
  if (reviewAgeDays == null) {
    timeGuide = '来店時期は不明。時期を断定する表現（「先日」「本日」など）は避け、「このたびは」等の時期を限定しない言い回しにする。';
  } else if (reviewAgeDays <= 14) {
    timeGuide = `口コミは約${reviewAgeDays}日前と新しい。「先日はご来店いただき」など最近来店した前提の自然な表現でよい。`;
  } else if (reviewAgeDays <= 45) {
    timeGuide = `口コミから約${reviewAgeDays}日経過。「先日」は使わず「このたびは」「ご来店いただき」など時期を限定しない表現にする。`;
  } else {
    const months = Math.round(reviewAgeDays / 30);
    timeGuide = `口コミから約${months}ヶ月経過（${reviewAgeDays}日前）と時間が経っている。「先日」「本日」は使わない。「以前はご来店いただき」「その節はご利用いただき」のように、少し前の来店であることを踏まえた自然な表現にする。返信が遅くなったことへの軽い一言（例「ご返信が遅くなり申し訳ありません」）を冒頭に自然に添えてもよい（必須ではない）。`;
  }

  // お客さん向け口コミ下書き / Instagram整形 で使う追加パラメータ
  const userWords = Array.isArray(req.body.words) ? req.body.words.filter(Boolean) : [];
  const sourceText = req.body.sourceText || '';

  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_API_KEY) return res.status(500).json({ error: 'GROQ_API_KEY未設定' });

  // ── 対策キーワード（rankings_ の meta）を各生成に自然に織り込むための共通ブロック ──
  // MEOはGBPに「キーワード欄」が無いため、選んだ語を説明文/サービス/投稿/Q&A/HP等へ自然に盛り込む。
  const _rankData = await kvGet(`rankings_${locationId}`) || {};
  const _rankMeta = _rankData.meta || {};
  const _prOrder = { A: 0, B: 1, C: 2 };
  const seoKws = (_rankData.keywords || [])
    .filter(k => k && (_rankMeta[k]?.enabled !== false))
    .sort((a, b) => (_prOrder[_rankMeta[a]?.priority] ?? 3) - (_prOrder[_rankMeta[b]?.priority] ?? 3));
  const seoWeave = seoKws.length
    ? `\n\n【MEO対策キーワード（Googleに専門性を伝えるため文章に自然に織り込む語・優先度順）】\n${seoKws.slice(0, 12).map(k => `・${k}${_rankMeta[k]?.category ? `（${_rankMeta[k].category}）` : ''}`).join('\n')}\n→ 上位の2〜4語を、意味が通る範囲で自然に本文へ織り込む。羅列・詰め込み・不自然な繰り返しは禁止。日本語の読みやすさを最優先し、対策語が"結果的に含まれている"状態を目指す。地域名は文脈に合う形で1回程度添える。実在しないサービスや誇大表現は作らない。`
    : '';

  // ── URLから店舗情報を自動抽出（HP/ぐるなび等のWebページ） ──
  if (type === 'autofill') {
    const url = req.body.url;
    // sourceText 指定時はURL取得をスキップ（Instagram連携アカウントのプロフィール＋投稿文などを直接渡す用途）
    const provided = String(req.body.sourceText || '').trim();
    let pageText = '';
    if (provided) {
      pageText = provided.replace(/\s+/g, ' ').trim().slice(0, 7000);
    } else {
      if (!url || !/^https?:\/\//.test(url)) return res.status(400).json({ error: '有効なURLを入力してください' });
      try {
        const pr = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; cantik-meo-bot/1.0)' } });
        let html = await pr.text();
        html = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
        pageText = html.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 7000);
      } catch (e) {
        return res.status(400).json({ error: 'URLの取得に失敗しました: ' + e.message });
      }
    }
    if (pageText.length < 50) return res.status(400).json({ error: provided ? 'Instagramから十分な情報を取得できませんでした（プロフィール文・投稿キャプションが少ない可能性）' : 'ページから十分な情報を取得できませんでした（JS主体のページの可能性）' });

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
- keywords: 「地域名×業種」「地域名×業種×ニーズ/メニュー」の検索されやすい語を読点区切りで。MEOの基本は主力5〜7個に絞ることなので、王道の主力語を5〜7個を中心にし、必要に応じてロングテールを数個添える（詰め込みすぎない）。実際に検索されそうな組み合わせにする（例「相模原 焼き鳥」「相模原 居酒屋 個室」）
- strengths: ページから読み取れる強み・特徴を、MEO・ローカルSEOで効くよう"厚く"書く（4〜6文）。地域名・サービス名・専門性・こだわり・利用シーンを自然に含め、"なぜこの店なのか"が伝わる密度に。抽象語だけで終わらせず根拠まで。ページに無い実績・数値は創作しない
- expertise: 差別化ポイント・専門性・実績（E-E-A-T：経験/専門性/権威性/信頼性）。資格・特化分野・経歴・第三者評価・実績年数などページから読み取れる事実を具体化し、AI検索に引用されやすい書き方に。無理な創作はしない（無ければ空）
- services: 主要なサービス・メニューを（あれば価格も）具体的に列挙。各項目に特徴・おすすめ理由を一言添えて情報量を増やし、検索される語を含める
- serviceArea: 対応エリア・周辺地域。店舗所在地から来店が見込める近隣の市区町村・駅・地域名を複数挙げてMEOの守備範囲を広げる（地理的に妥当な範囲で。ページに地域情報があれば優先）
- targetCustomer: ページから推測できる主な客層（年代・性別・利用シーン・悩み）
- description: 来店を促す自然な紹介文（180〜280字・地域名と業種を自然に含む・誇大表現や効果の断定はしない）

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
          max_tokens: 1500, temperature: 0.3,
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

  // ── URLのページをAIが読み、AIO/LLMO/GEO観点で"質"を判定（スコア＋観点別＋改善提案） ──
  if (type === 'aio_analyze') {
    const url = req.body.url;
    if (!url || !/^https?:\/\//.test(url)) return res.status(400).json({ error: '有効なURLを入力してください' });
    let html = '';
    try {
      const pr = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; cantik-meo-bot/1.0)' } });
      html = await pr.text();
    } catch (e) { return res.status(400).json({ error: 'URLの取得に失敗しました: ' + e.message }); }
    // 構造化データを機械判定して事実としてAIに渡す（AIに推測させない）
    const schema = [];
    if (/"@type"\s*:\s*"(LocalBusiness|Dentist|MedicalClinic|Restaurant|HealthAndBeautyBusiness|Store|ProfessionalService|Organization)"/i.test(html)) schema.push('LocalBusiness/Organization');
    if (/"@type"\s*:\s*"(FAQPage|Question)"/i.test(html)) schema.push('FAQPage');
    if (/"@type"\s*:\s*"AggregateRating"|"aggregateRating"\s*:/i.test(html)) schema.push('AggregateRating');
    if (/"@type"\s*:\s*"(Article|BlogPosting|NewsArticle)"/i.test(html)) schema.push('Article');
    if (/"@type"\s*:\s*"BreadcrumbList"/i.test(html)) schema.push('BreadcrumbList');
    if (/"@type"\s*:\s*"Product"/i.test(html)) schema.push('Product');
    const titleM = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const metaDesc = (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i) || [])[1] || '';
    const h1s = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/gi) || []).map(s => s.replace(/<[^>]+>/g, '').trim()).slice(0, 5);
    const pageText = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 7000);
    // このブロックは早期returnするため、下部の共通ナレッジ取得より前に自前で取得する
    const knowledge = await kvGet(`knowledge_${locationId}`) || {};
    const store = knowledge.storeName || '';
    const aPrompt = `あなたはAIO/LLMO/GEO（ChatGPT・Gemini・Perplexity・GoogleのAI検索/AI概要などの生成エンジンに、店舗・企業が"引用・推奨"されるための最適化）の専門家です。
以下の実在ページを読み、この店舗/企業ページが「AIに引用・推奨されやすいか」を厳しく評価してください。甘く採点しない。

【店舗/企業】${store || '（不明）'}（業種：${knowledge.category || '不明'}）
【ページタイトル】${titleM ? titleM[1].replace(/<[^>]+>/g, '').trim().slice(0, 120) : '（なし）'}
【meta description】${metaDesc.slice(0, 200) || '（なし）'}
【H1見出し】${h1s.join(' / ') || '（なし）'}
【機械判定された構造化データ(JSON-LD)】${schema.length ? schema.join('、') : '検出なし'}
【ページ本文（抜粋）】
${pageText || '（本文が取得できませんでした。JS主体のページの可能性）'}

【評価の観点（各0〜100・statusはgood/weak/missing）】
1. 構造化データ(Schema/JSON-LD): 上の機械判定を根拠にする（LocalBusiness/FAQPage/AggregateRating/Article等があるか、業種に適切か）
2. E-E-A-T(経験・専門性・権威性・信頼性): 著者/運営者情報・資格・実績・一次情報・更新性
3. FAQ・質問応答性: よくある質問、質問形の見出し＋明確な回答、AIがそのまま引用できるQ&A
4. エンティティの明確さ: 「誰が/何を/どこで/誰に」が曖昧さなく書かれ、店名・地域・サービスが実体として明確か
5. 事実の密度・引用されやすさ: 具体的な数値・固有名詞・定義・箇条書きなど、AIが抜き出して引用しやすい書き方か
6. NAP・一次情報: 店名・住所・電話・営業時間など一次情報がページに明記されているか

【出力（JSONのみ・説明や前置き・コードフェンスなし）】
{"score":0〜100の総合点(整数),"summary":"総評を2〜3文。AI検索に引用されやすいか、最大の弱点は何か","dimensions":[{"name":"構造化データ","score":0,"status":"missing","comment":"具体的に。何があり何が足りないか"},{"name":"E-E-A-T","score":0,"status":"weak","comment":"..."},{"name":"FAQ・質問応答性","score":0,"status":"missing","comment":"..."},{"name":"エンティティの明確さ","score":0,"status":"good","comment":"..."},{"name":"事実の密度・引用性","score":0,"status":"weak","comment":"..."},{"name":"NAP・一次情報","score":0,"status":"good","comment":"..."}],"improvements":[{"priority":"高","action":"具体的な改善アクション","reason":"なぜAIO/LLMO/GEOに効くか"}]}
improvementsは優先度高→低で3〜6件。コメント・アクションは具体的に（"充実させる"だけでなく何をどうするか）。捏造や効果の断定はしない。`;
    try {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST', headers: { Authorization: `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: GROQ_MODEL, messages: [{ role: 'user', content: aPrompt }], max_tokens: 1800, temperature: 0.35 }),
      });
      const data = await r.json();
      const content = data.choices?.[0]?.message?.content || '';
      const s = content.indexOf('{'), e = content.lastIndexOf('}');
      if (s === -1 || e === -1) return res.status(500).json({ error: 'AI診断に失敗しました（JSON取得不可）' });
      let result;
      try { result = JSON.parse(content.slice(s, e + 1)); }
      catch (er) { return res.status(500).json({ error: 'AI診断結果の解析に失敗しました' }); }
      return res.json({ result, schema, meta: { title: titleM ? titleM[1].replace(/<[^>]+>/g, '').trim() : '', h1: h1s } });
    } catch (e) { return res.status(500).json({ error: e.message }); }
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
${req.body.gbpContext ? `\n【Googleの情報（GBPカテゴリ・平均評価・実際の口コミ抜粋）】\n${req.body.gbpContext}\n→ 上記のGoogle口コミで実際に褒められている点・利用シーンを、strengths/services に事実の範囲で反映する（口コミの表現をヒントに具体化）。ただし口コミ本文の丸写しや、書かれていない実績の捏造はしない。\n` : ''}
【強化ルール】MEO・ローカルSEOで実際に効くよう、情報量を厚く・具体的に。ただし架空の数値/実績/受賞は作らない（与えられた情報と一般的事実の範囲で具体化する）。
- keywords: 「地域名×業種」「地域名×業種×ニーズ/メニュー」「地域名×悩み」「隣接エリア×業種」など実際に検索される語。MEOは専門性（Topical Relevance）重視のため、王道の主力語5〜7個を軸にし、必要に応じてロングテールを数個添える（多すぎるとテーマが散らばるので詰め込まない）。読点区切り
- strengths: 検索意図と差別化を意識し、具体的な特徴を4〜6文でしっかり書く。地域名・サービス名・専門性・こだわり・利用シーンを自然に含め、"なぜこの店なのか"が伝わる密度にする。抽象語（安心・丁寧 だけ）で終わらせず、その根拠まで書く
- expertise: 差別化ポイント・専門性・実績（E-E-A-T：経験/専門性/権威性/信頼性）。資格・経歴・特化分野・第三者評価・実績年数などを、与えられた情報から具体化。AIや検索に"引用されやすい"事実ベースの記述にする（無ければ、その業種で信頼につながる観点を一般論として2〜3点提示）
- services: 主要メニュー/サービスを検索される語を含めて具体的に列挙（価格があれば残す。各サービスの特徴・こだわり・おすすめ理由を一言添えて情報量を増やす）
- serviceArea: 対応エリア・周辺地域。店舗の所在地から来店が見込める近隣の市区町村・駅・地域名を複数挙げてMEOの守備範囲を広げる（例「相模原市全域・座間市・大和市・町田エリアからも来店」）。地理的に妥当な範囲にする
- description: 来店を促す自然な紹介文（180〜280字・地域名と業種を自然に含む）
- targetCustomer: 主な客層を具体的に（年代・性別・利用シーン・悩み）
- nearbyLandmarks: 分かれば最寄り駅・目印・徒歩分（無ければ現状維持/空）
- tips: さらにMEO順位・評価を上げる具体アクションを5個（GBP属性設定・写真追加・口コミ依頼・投稿テーマ・FAQ登録など）。各行「・」始まり。効果断定や捏造はしない

【出力JSON】（tipsは改行区切りの文字列、他は文字列）
{"keywords":"","strengths":"","expertise":"","services":"","serviceArea":"","description":"","targetCustomer":"","nearbyLandmarks":"","tips":""}
JSON以外は一切出力しない。${seoWeave ? seoWeave + '\n※上記の対策キーワードは特に strengths / services / serviceArea / description に自然に反映する。' : ''}`;
    try {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: GROQ_MODEL, messages: [{ role: 'user', content: enPrompt }], max_tokens: 1500, temperature: 0.5 }),
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

  // ★4〜5：感謝の返信（お世話になっております〜の3ブロック定型・業種別・トーン別）
  if (type === 'reply_positive') {
    const { verb, close } = bizPhrasing(knowledge.category, storeName);
    prompt = `あなたは${storeName}のオーナー/スタッフです。お客様がくれた高評価の口コミに、下記の"型"に沿って丁寧な返信を書いてください。

【お店】${storeName}${knowledge.category ? '（' + knowledge.category + '）' : ''}
【口コミ本文】${reviewText}
【店舗の強み・特徴】${strengths}
【提供サービス・商品】${services}

【トーン】${toneGuide}
【来店時期の扱い】${timeGuide}

【返信の構成（この3ブロックを必ず守る・ブロック間は空行で区切る）】
1行目（1ブロック目）：「お世話になっております。」だけ。
2ブロック目：この度は${verb}いただき、誠にありがとうございました。＋口コミを投稿してくれたことへのお礼（例：また、嬉しいお言葉／温かい口コミをご投稿いただきありがとうございます）。
3ブロック目：口コミ本文で実際に褒められた具体的な点を1つ拾ってそれに触れ「〜についてお褒めいただき（／ご満足いただけたとのことで）、大変嬉しく思います」と受ける → 今後の姿勢を一言（例：今後も〜できるよう努めてまいります）→ 締めの一文「${close}」。

【厳守】
- 上記の「お世話になっております。」で必ず始め、3ブロックを空行で区切る。全体で150〜240文字程度。です・ます調。
- 業種に合った言い回しにする：この店は${verb}が自然（${knowledge.category || '該当業種'}）。飲食/美容/整体などは来院・来店系、制作/士業/EC等は依頼・購入系。不自然な語は使わない。
- 口コミ本文に実際に書かれた点だけを拾う。本文に無い事実（来店回数・注文内容など）は作らない。
- ${humanTone}
- ${symbolRule}
- 返信文のみを出力（説明・見出し・番号・「1ブロック目」等のラベルは書かない）。${styleBlock ? '\n- 過去返信の語彙や温度感は参考にしてよいが、上記の構成と挨拶は必ず守る。' + styleBlock : ''}`;
  }

  // ★1〜3：謝罪・改善の返信（お世話になっております〜の3ブロック定型・業種別・トーン別）
  if (type === 'reply_negative') {
    const { verb } = bizPhrasing(knowledge.category, storeName);
    prompt = `あなたは${storeName}のオーナー/スタッフです。低評価の口コミに、下記の"型"に沿って誠実な返信を書いてください。

【お店】${storeName}${knowledge.category ? '（' + knowledge.category + '）' : ''}
【口コミ本文】${reviewText}
【店舗の強み・特徴】${strengths}
【提供サービス・商品】${services}

【トーン】${toneGuide}
【来店時期の扱い】${timeGuide}

【返信の構成（この3ブロックを必ず守る・ブロック間は空行で区切る）】
1行目（1ブロック目）：「お世話になっております。」だけ。
2ブロック目：この度は${verb}いただき、誠にありがとうございました。＋貴重なご意見をいただいたことへのお礼。続けて、お客様が不満に感じた点を本文から特定し、それに対して何に対するお詫びかを明記して誠実に謝罪する。
3ブロック目：指摘点をどう受け止め・どう改善するかを可能な範囲で具体的に伝える（実在の範囲で。言い訳・責任転嫁はしない）→ もう一度機会をいただきたい気持ちを丁寧に添えて締める。

【厳守】
- 「お世話になっております。」で必ず始め、3ブロックを空行で区切る。全体で170〜260文字程度。です・ます調。誠実で温かみのある文体。
- 業種に合った言い回し（この店は${verb}が自然・${knowledge.category || '該当業種'}）。
- ${humanTone}
- 口コミ本文に無い事実や言い訳を作らない。責任転嫁しない。
- ${timeGuide.includes('以前') || timeGuide.includes('ヶ月') ? '時間が経っている口コミなので「先日」など直近を示す語は使わない。返信が遅くなったことへのお詫びを添えてよい。' : ''}
- ${symbolRule}
- 返信文のみを出力（説明・見出し・ラベルは書かない）。${styleBlock ? '\n- 過去返信の温度感は参考にしてよいが、上記の構成と挨拶は守る。' : ''}`;
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
    const cat = knowledge.category || '';
    const ctx = [strengths, services].filter(Boolean).join(' / ');
    prompt = `あなたは、お店やサービスを利用したお客様が口コミを書くのを手伝うアシスタントです。
お客様が選んだ「良かった点」をヒントに、そのお客様が"自分の実体験"を語るような、自然で具体的な口コミ下書きを1つ作ってください。

【利用したお店・サービス】${storeName}${cat ? '（' + cat + '）' : ''}
【お店の特徴・提供内容】${ctx || '（詳細情報なし。業種から自然に推測してよい）'}
【お客様が選んだ良かった点】${userWords.join('、') || '特になし'}

【最重要：単語の羅列にしない】
- 選ばれた点は全部使わない。2〜3個だけ選び、残りは捨てる。全部入れようとすると必ず箇条書きになる。
- 禁止パターン①：「◯◯が良かったです。△△も丁寧でした。□□も満足です。」と1文ずつ並べる。
- 禁止パターン②：「説明も分かりやすく、価格も合理的で、対応も丁寧で…」と"も"で点を次々つなげて並べる。これも実質箇条書き。
- 代わりに、実際に利用した時の"具体的な場面・状況"を主役にして、その体験を語る中に良かった点を2〜3個だけ自然に溶け込ませる。
- 小さなストーリーにする。例：①利用前の不安や状況 → ②どう対応してくれたか（具体的な一場面）→ ③結果どう感じたか。または、依頼した経緯 → 進み方 → 満足した点。
- 「何を・どんな状況で利用し・どうだったか」が伝わる、その人だけの体験談にする。

【文体】
- 店名を書き出しに使わない。お客様目線の体験からそのまま始める。
- この店の業種（${cat || '当該業種'}）に合った、実際にありそうな具体的な場面・言葉で書く。※ホームページ制作・Web・サイトの話は、この店が制作会社/Web系でない限り絶対に書かない。飲食なら料理や接客、整体なら施術や体の変化、美容なら仕上がりやカウンセリング等、業種に合わせる。
- 90〜150文字程度。です・ます調。実際のお客様が書いた自然な文にする。いかにもAIが書いた説明口調・整いすぎた文は避ける。
- 星評価や「★5」等は書かない。宣伝文句・キャッチコピーは入れない。絵文字は0〜1個。読点（、）は自然な範囲で使ってよい（単語の機械的な羅列にだけしない）。
- 【厳守】英語・ローマ字・記号は一切使わない。「-san」「-sama」「staff」等のローマ字混じりは絶対に書かない。人を指すときは「担当の方」「スタッフの方」「店員さん」など自然な日本語にする（「担当者-san」のような表記は禁止）。すべて自然な日本語のみで書く。
- これは下書き（たたき台）。本人が直す前提で、自然な日本語にする。

【出力の形】
- 口コミ本文のみ。前置き・説明・見出しは書かない。

【厚み・具体性の"お手本"（※これは制作会社の口コミ例。この"体験を語る具体性・自然な流れ"だけを真似て、内容は必ずこのお店の業種に置き換える）】
・漠然としたイメージしかなかったのですが、こちらの想いを丁寧にヒアリングしていただき、何パターンもご提案いただけました。おかげで納得のいくものが完成しました。
・最初は何を準備すればいいのか分からず不安でしたが、一つひとつ分かりやすく説明していただき、スムーズに進めることができました。レスポンスも早く安心感がありました。
・細かい要望にも快く対応していただき、こちらの希望をしっかり反映してくださいました。最後まで丁寧な対応で安心してお任せできました。`;
  }

  // アンケートの「良かった点」選択肢を業種に合わせてAI生成
  if (type === 'survey_points') {
    prompt = `あなたはMEO・口コミ施策の専門家です。下記のお店のアンケートで、来店客が「良かった点」として選ぶ選択肢を作ってください。

【店舗名】${knowledge.storeName || storeName}
【業種】${knowledge.category || ''}
【強み・特徴】${strengths}
【提供サービス・メニュー】${services}

【ルール】
- このお店・この業種の客が実際に「良かった」と感じる具体的な点を10個。
- 1個あたり4〜12文字の短い体言止め（例「スタッフが丁寧」「料理が美味しい」「予約が取りやすい」）。
- 業種に即した具体性を入れる（飲食なら料理/接客、整体なら施術/説明、美容なら仕上がり/カウンセリング等）。
- 抽象的すぎる語（「最高」だけ等）は避け、口コミの素材になる具体語にする。
- JSON配列のみ出力。説明・前置き・コードフェンスは書かない。例：["スタッフが丁寧","料理が美味しい",...]`;
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

  // 画像に載せるおしゃれな英字タイトル（マガジン/ブランドロゴ風）
  if (type === 'en_headline') {
    prompt = `あなたは${knowledge.storeName || storeName}のクリエイティブディレクターです。Instagram/Googleポストの画像に重ねる、雑誌の表紙やブランドロゴのような短い英字タイトルを1つだけ作ってください。

【店舗情報】
- 店名: ${knowledge.storeName || storeName}
- 業種: ${knowledge.category || '不明'}
- 強み: ${strengths || '不明'}
- 地域: ${knowledge.address || ''}

【ルール】
- 英単語1〜3語・合計20文字以内（例のスタイル: CORNER / SHIBUYA NIGHT / SanMichele / CRAFT & SMOKE）
- 店の雰囲気・地名・業種を感じさせるものにする。日本語は使わない
- 実在しない受賞歴・No.1表現は使わない
- 引用符や記号で囲わない（&は可）。英字タイトルの言葉だけを出力`;
  }

  // 画像下部に添える短いサブテキスト
  if (type === 'subtext') {
    prompt = `あなたは${storeName}の広告担当です。Instagram/Googleポストの画像の下部に添える短いサブテキストを1つだけ作ってください。

【店舗情報】
- 店名: ${knowledge.storeName || storeName}
- 業種: ${knowledge.category || '不明'}
- 営業時間: ${knowledge.businessHours || '不明'}
- 定休日: ${knowledge.closedDays || '不明'}
- 強み: ${strengths || '不明'}

【ルール】
- 22文字以内。営業案内・予約案内・お店の魅力の一言など、画像の添え文として自然なもの
- 店の実情報に基づく。営業時間が不明なら時間は書かない。架空の事実や誇大表現・効果断定はしない
- 鉤括弧や記号で囲わない。サブテキストの言葉だけを出力`;
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
- 各地域に対し「地域名 業種」「地域名 業種 ニーズ/メニュー」の組み合わせを作る
- 出力は実際に検索される自然な語にする。例「座間市 美容室」「大和駅 縮毛矯正」のように地域名と語を半角スペースで繋ぐ。「×」「✕」などの記号は絶対に使わない
- 業種が「不明」の場合は、業種を表す語を入れず「地域名」だけにはせず、文脈から最も適切な業種カテゴリを推測して使う
- 必ず実在する地域名・駅名のみ使う（架空の地名を作らない）
- 15〜20個を読点（、）区切りで出力。キーワードのみ（番号・理由・前置き不要）`;
  }

  // AI相談アシスタント（店舗データを踏まえて質問に答える）
  if (type === 'assistant') {
    const q = req.body.question || '';
    const ctx = req.body.context || {};
    prompt = `あなたは${storeName}専属のMEO（Googleマップ集客）コンサルタントです。以下の店舗情報を踏まえ、質問に具体的に答えてください。

【店舗情報】
- 業種: ${knowledge.category || '不明'}
- 地域: ${knowledge.address || ''} ${knowledge.nearbyLandmarks || ''}
- 強み: ${strengths || '未設定'}
- サービス: ${services || '未設定'}
- キーワード: ${keywords.join('、') || '未設定'}
- 口コミ: ${ctx.reviews || '不明'}
- 現在の順位状況: ${ctx.rankings || '不明'}

【質問】${q}

【ルール】
- 上記の実情報に基づいて答える。分からないことは「未計測/未設定」と正直に言う（捏造しない）
- 「次に何をすべきか」を具体的なアクションで示す。優先順位をつける
- 効果や順位は断定せず「〜が期待できます」程度
- 簡潔に（箇条書き中心、長くなりすぎない）`;
  }

  // 口コミ分析（傾向・改善点・活かし方）
  if (type === 'review_analysis') {
    const revs = (req.body.reviews || []).slice(0, 40);
    const revText = revs.map(r => `★${r.star}：${r.comment}`).join('\n');
    prompt = `あなたはMEO・店舗運営の専門家です。以下は${storeName}の口コミ一覧です。全体を分析してください。

【口コミ】
${revText}

【出力ルール】次の4見出しで、各2〜4個の箇条書き（・始まり）。口コミに実際に書かれた内容だけに基づく（捏造しない）。
■よく褒められている点
■不満・改善が必要な点
■全体の傾向（客層・来店動機など読み取れること）
■サービス改善・投稿への活かし方（具体的に）
前置き不要、4見出しの箇条書きのみ出力。`;
  }

  // AI口コミリスク診断（β）— Googleポリシー違反の"可能性"を判定。JSON返却。
  // ※「削除できる」とは言わない。あくまで可能性の分析。
  if (type === 'review_risk') {
    const rt = req.body.reviewText || '';
    const rating = req.body.rating || '';
    prompt = `あなたはGoogleビジネスプロフィール（Googleマップ）の口コミポリシーに精通した専門家です。次の口コミが、Googleの投稿ポリシーに違反している「可能性」を分析してください。あくまで可能性の評価であり、削除できると断定してはいけません。

【口コミ】★${rating}／5
${rt}

【Googleの主な禁止事項（判定観点）】
スパム / 嫌がらせ・ハラスメント / 個人攻撃・人格否定 / 差別表現 / 個人情報 / 性的表現 / 脅迫 / 競合による不正口コミの疑い / 来店事実が確認できない / 広告・宣伝 / なりすまし / オフライン（店と無関係）/ 虚偽の可能性

【判定基準】
- 実体験に基づく正当な不満（味・接客・待ち時間など具体的な体験）は、たとえ低評価でも削除対象になりにくい → risk低。
- 人格攻撃・誹謗中傷・来店事実不明・スパム・なりすまし等は削除対象になり得る → risk高。

【出力】次のJSONのみを出力（前置き・コードフェンス・説明なし。厳密なJSON）：
{"risk":"high|medium|low","score":0-100,"recommend":"report|reply|watch","reasons":["該当したポリシー観点を日本語で最大4個"],"comment":"店舗オーナー向けの一言（30字以内・可能性の表現にとどめる）"}
scoreは「Googleポリシー違反の可能性の高さ」を0〜100で。recommendは report(報告推奨)/reply(返信推奨)/watch(様子見)。`;
  }

  // Google削除報告文の生成
  if (type === 'review_report') {
    const rt = req.body.reviewText || '';
    const reasons = Array.isArray(req.body.reasons) ? req.body.reasons.join('、') : '';
    prompt = `あなたはGoogleビジネスプロフィールの口コミ報告に詳しい専門家です。以下の口コミをGoogleに報告するための、丁寧で事実ベースの報告文を作成してください。

【対象の口コミ】
${rt}
【該当が疑われるポリシー観点】${reasons || '（AI判定に基づく）'}

【ルール】
- 200〜300字程度。感情的にならず、事実と該当ポリシーを冷静に述べる。
- 「Googleマップの投稿ポリシー『◯◯』に該当する可能性があります。ご確認をお願いいたします。」の形で締める。
- 断定（「削除してください」）ではなく「該当する可能性」「ご確認をお願いします」の表現にとどめる。
- 報告文の本文のみ出力（前置き不要）。`;
  }

  // AIインサイト異常検知・傾向分析
  if (type === 'insight_anomaly') {
    const m = req.body.metrics || {};
    const ctx = req.body.context || {};
    const lines = [];
    if (m.impressions != null) lines.push(`表示回数（合計）: ${m.impressions}`);
    if (m.mapsImpressions != null) lines.push(`マップ表示: ${m.mapsImpressions}`);
    if (m.searchImpressions != null) lines.push(`検索表示: ${m.searchImpressions}`);
    if (m.calls != null) lines.push(`電話タップ: ${m.calls}`);
    if (m.directionRequests != null) lines.push(`ルート検索: ${m.directionRequests}`);
    if (m.websiteClicks != null) lines.push(`サイト訪問: ${m.websiteClicks}`);
    prompt = `あなたはMEO（Googleマップ集客）のデータアナリストです。${storeName}のGoogleビジネスプロフィールのインサイト指標を分析し、異常や気になる傾向を検知して、改善提案をしてください。

【インサイト指標（直近）】
${lines.join('\n') || '（データ不足）'}
${ctx.rankings ? `【順位状況】${ctx.rankings}` : ''}
${ctx.reviews ? `【口コミ】${ctx.reviews}` : ''}

【分析観点】
- 表示回数が多いのに電話・ルート検索・サイト訪問（アクション）が極端に少ない＝「見られているが行動につながっていない」異常。
- 検索表示に対しマップ表示が極端に低い/高いなどの偏り。
- アクション率（電話＋ルート＋サイト÷表示回数）が低い場合の改善余地。
- 数字が全て0や欠損なら「データ蓄積待ち」と正直に述べる。

【出力】次の3見出しで、各1〜3個の箇条書き（・始まり）。データに基づき、数字を交えて具体的に。憶測で数字を作らない。
■気づき・異常（データから読み取れること）
■考えられる原因
■改善アクション（今月やること・具体的に）
前置き不要、3見出しの箇条書きのみ。`;
  }

  // 競合分析の勝ち筋助言（自店vs競合を客観比較し、既に勝っている項目は課題にしない）
  if (type === 'competitor_advice') {
    const c = req.body.competitor || {};
    const self = c.self || {};
    const topText = (c.top || []).map((t, i) => `${i + 1}位 ${t.title}（★${t.rating || '—'}・口コミ${t.reviews || '—'}件）`).join('\n');
    const compRevs = (c.top || []).map(t => Number(t.reviews)).filter(n => Number.isFinite(n));
    const compRates = (c.top || []).map(t => Number(t.rating)).filter(n => Number.isFinite(n));
    const maxCompRev = compRevs.length ? Math.max(...compRevs) : 0;
    const maxCompRate = compRates.length ? Math.max(...compRates) : 0;
    const myRev = Number(self.reviews) || 0, myRate = Number(self.rating) || 0;
    const leadRev = myRev >= maxCompRev && myRev > 0;
    const leadRate = myRate >= maxCompRate && myRate > 0;
    prompt = `あなたはMEO（Googleマップ集客）の専門家です。
「${c.keyword}」での検索結果について、自店と上位競合を客観的に比較し、自店が上位表示されるための"本当に効く"具体策を助言してください。

【自店】${storeName}
- 現在の順位: ${c.myRank ? c.myRank + '位' : '圏外'}
- 評価: ★${myRate || '—'} ／ 口コミ ${myRev || '—'}件
- 強み: ${strengths || '未設定'}
【上位競合（このキーワードで上位に出ている店）】
${topText || 'データなし'}
【検索地点】${c.location || 'エリア中心'}

【必ず踏まえる事実（ここを外すと的外れになる）】
- 口コミ数: 自店 ${myRev}件 ／ 競合の最多 ${maxCompRev}件 → 自店は競合より口コミが${leadRev ? '多い（＝口コミ数は既に強み。絶対に「口コミを増やせ」を主対策にしない）' : '少ない'}。
- 評価: 自店 ★${myRate || '—'} ／ 競合の最高 ★${maxCompRate || '—'} → 自店の評価は競合と${leadRate ? '同等以上（＝評価は強み。「評価を上げろ」を主対策にしない）' : '差がある'}。
- 【最重要ロジック】自店が口コミ数・評価で競合に勝っている/同等なのに順位が下なら、原因は口コミ・評価ではなく「Googleがこのキーワードで自店を関連性が高いと判断していない」こと。その場合は次を優先して助言する:
  ・GBPのメインカテゴリ/サブカテゴリがこのキーワードに合っているか（例「ホームページ制作」ならカテゴリを的確に）
  ・店舗説明文・サービス/商品名・投稿・Q&Aにこのキーワードと関連語を自然に入れる（対策キーワードの反映）
  ・検索地点からの近接性は操作しづらいが、サービス提供地域・説明で地域網羅性を高める
  ・投稿頻度・商品/サービス登録・写真など、GBPの"活性度"シグナルを上げる
  ・NAP（名称・住所・電話）の表記統一とサイテーション

【出力ルール】
- 「■競合との差（事実に基づく）」「■今すぐやるべき具体策（優先順）」の2見出し、各3〜4個の箇条書き（・始まり）。
- 自店が既に勝っている項目は「強み」として明記し、そこを課題にしない。実際の順位差の要因（関連性・近接性・活性度）に踏み込む。
- 効果や順位を断定・捏造しない。数字は上に与えられた事実だけを使う。前置き不要、2見出しの箇条書きのみ。`;
  }

  // 場所・業種・サービスから、根拠のある対策キーワード候補をAI生成（分類＋優先度つき・JSON配列）
  // ※ 知識タブの旧 keyword_suggest（パイプ形式）とは別物なので type を分ける
  if (type === 'keyword_ideas') {
    const area = req.body.area || knowledge.address || knowledge.region || '';
    const genre = req.body.genre || knowledge.category || '';
    const svc = req.body.services || services || '';
    const existing = Array.isArray(req.body.existing) ? req.body.existing.filter(Boolean) : keywords;
    prompt = `あなたはMEO（Googleマップ集客）の専門家です。次のお店の「対策キーワード（Googleマップ・ローカル検索で上位を狙う語）」の候補を作ってください。

【店舗名】${storeName || ''}
【エリア（市区町村・地域）】${area || '（不明）'}
【業種・ジャンル】${genre || '（不明）'}
【提供サービス・メニュー・強み】${svc || '（不明）'}
【すでに登録済み（重複させない）】${existing.length ? existing.join('、') : 'なし'}

【キーワードの考え方】
- 実際に見込み客がGoogleマップ／検索で打ち込む語。基本は「地域名＋業種・サービス」の組み合わせ。
- 3つの検索意図で分類する:
  - 今すぐ客(今すぐ来店・利用したい層。地域×業種の王道語): 優先度A
  - 悩み・目的(症状・目的・シーンで探す層): 優先度B
  - 差別化(店名・独自メニュー・特徴で指名/認知を狙う語): 優先度C
- エリアは市区・駅・地域名などバリエーションを持たせる。
- 誇大・不自然な語や、実在しないサービスは作らない。

【出力】JSON配列のみ。各要素は {"keyword","area","category","priority","reason"} の5キー。
- keyword: 実際の検索語（例「新宿 ネパール料理」）
- area: 計測地域（例「新宿区」。KWに地域が含まれていてもここは市区名等）
- category: "今すぐ客" | "悩み・目的" | "差別化" のいずれか
- priority: "A" | "B" | "C"（今すぐ客=A / 悩み・目的=B / 差別化=C を基本に）
- reason: なぜ有効か（20〜40文字・断定しすぎない）
候補は8〜12件出すが、まず「今すぐ客(A)」の王道主力を5〜7件そろえ、残りを悩み・目的/差別化のロングテールにする（登録は主力5〜7個が最適という前提。詰め込みは禁止）。説明文・前置き・コードフェンスは書かず、JSON配列だけを出力。`;
  }

  // GBP 商品・サービス登録用の説明文（対策キーワードを自然に含める）
  if (type === 'product_desc') {
    const name = req.body.productName || req.body.itemName || '';
    prompt = `あなたはMEO（Googleマップ集客）の専門家です。Googleビジネスプロフィールの「商品・サービス」登録に載せる紹介文を書いてください。

【店舗名】${storeName}
【業種】${knowledge.category || ''}
【商品・サービス名】${name || '（店の主要な商品・サービスから代表的なものを選ぶ）'}
【店の強み】${strengths}
【提供サービス・メニュー】${services}

【ルール】
- 1つの商品・サービスにつき、名称＋60〜120字の説明文。魅力と特徴が具体的に伝わるように。
- 検索されやすい語（地域名・業種・用途）を自然に含める。誇大表現・効果断定・架空実績はしない。
- ${name ? 'この商品・サービス1件について書く。' : '代表的な商品・サービスを3件、それぞれ「■名称」の見出しで書く。'}
- 前置き・説明・コードフェンスは書かず、本文のみ。`;
  }

  // GBP よくある質問（Q&A）を業種に合わせて自動生成
  if (type === 'qa_generate') {
    const n = Math.min(Math.max(parseInt(req.body.count) || 5, 1), 8);
    prompt = `あなたはMEO（Googleマップ集客）の専門家です。Googleビジネスプロフィールの「よくある質問（Q&A）」を、この店に来店・利用を検討する人が実際に知りたい内容で作ってください。

【店舗名】${storeName}
【業種】${knowledge.category || ''}
【営業時間】${knowledge.businessHours || ''}
【定休日】${knowledge.closedDays || ''}
【駐車場】${knowledge.parking || ''}
【アクセス】${knowledge.nearbyLandmarks || ''}
【強み】${strengths}
【サービス】${services}

【ルール】
- 質問と回答のペアを${n}個。回答は事実ベース（不明な項目は一般的で無難な範囲にとどめ、架空の断定はしない）。
- 予約・支払い・アクセス・所要時間・初めての利用・こだわり など、来店前の不安を解消する実用的な内容。
- 検索されやすい語（地域名・業種・サービス名）を質問文に自然に含める。
- 出力形式は各ペアを「Q. 〜」「A. 〜」の2行、ペア間は1行空ける。前置き不要。`;
  }

  // ホームページ用のコンテンツ（見出し＋本文）を生成
  if (type === 'hp_content') {
    const section = req.body.section || 'トップの紹介文';
    prompt = `あなたは集客に強いWebライターです。${storeName}のホームページに載せる「${section}」の文章を書いてください。

【店舗名】${storeName}
【業種】${knowledge.category || ''}
【地域/住所】${knowledge.address || ''}
【強み】${strengths}
【サービス】${services}
【ターゲット】${knowledge.targetCustomer || ''}

【ルール】
- 見出し（20字前後）＋本文（250〜400字）。読み手の来店・問い合わせにつながる自然な紹介。
- 地域名・業種・サービス名を検索を意識して自然に含める（SEO/MEOに効くが、詰め込みは禁止）。
- 誇大表現・効果断定・架空実績は書かない。実際のスタッフが書いたような等身大の文章。
- 前置き・説明は書かず、見出しと本文のみ。`;
  }

  // 写真の説明文（GBP写真・SNS用の短いキャプション）
  if (type === 'photo_caption') {
    const note = req.body.photoNote || sourceText || '';
    prompt = `あなたは${storeName}のSNS・GBP運用担当です。掲載する写真に添える短い説明文（キャプション）を書いてください。

【店舗名】${storeName}
【業種】${knowledge.category || ''}
【写真の内容・伝えたいこと】${note || '（店の魅力が伝わる写真）'}
【強み】${strengths}

【ルール】
- 40〜80字の自然な説明文。写真の内容に触れ、地域名・業種・サービス名のいずれかを自然に含める。
- 誇大表現・効果断定はしない。絵文字は使っても1個まで。
- 前置き不要、説明文のみ。`;
  }

  // 店舗向けコンテンツ生成では対策キーワードを自然に織り込む（投稿/SNS/キャッチ/HP・商品・Q&A等）
  const _seoTypes = ['post', 'post_themes', 'instagram', 'instagram_post', 'catchcopy', 'hp_content', 'product_desc', 'qa_generate', 'photo_caption'];
  if (seoWeave && _seoTypes.includes(type)) prompt += seoWeave;

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
        max_tokens: type === 'keyword_ideas' ? 1800 : 500,
        temperature: type === 'keyword_ideas' ? 0.55 : 0.85,
        top_p: 0.9,
      }),
    });
    const data = await r.json();
    let content = data.choices?.[0]?.message?.content?.trim();
    if (!content) return res.status(500).json({ error: 'AI生成失敗' });
    // 口コミ下書きは「。」ごとに改行し、店名の書き出しを念のため除去（モデルが入れた場合の保険）
    if (type === 'review_draft') {
      content = content
        .replace(new RegExp('^\\s*' + String(storeName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*(では|は|さんは|様は)?[、,：:]?\\s*', ''), '')
        // ローマ字混じりの敬称アーティファクトを日本語に是正（例「担当者-san」→「担当者さん」）
        .replace(/[\s]*[-‑–—][\s]*(san|さん)\b/gi, 'さん')
        .replace(/[\s]*[-‑–—][\s]*(sama|san?ma)\b/gi, 'さま')
        .replace(/[\s]*[-‑–—][\s]*(chan)\b/gi, 'ちゃん')
        .replace(/[\s]*[-‑–—][\s]*(kun)\b/gi, 'くん')
        .replace(/担当者さん/g, '担当の方')      // 「担当者さん」は不自然なので自然な言い方に
        .replace(/staff/gi, 'スタッフ')
        .replace(/。\s*/g, '。\n')   // 「。」の後で改行
        .replace(/\n{2,}/g, '\n')     // 余分な空行をまとめる
        .trim();
    }
    res.json({ content });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
