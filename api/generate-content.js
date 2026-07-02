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

  // 口コミ返信：投稿日からの経過日数と、選んだトーンで文面を最適化する
  const reviewDate = req.body.reviewDate || req.body.createTime || '';
  let reviewAgeDays = null;
  if (reviewDate) {
    const t = Date.parse(reviewDate);
    if (!isNaN(t)) reviewAgeDays = Math.floor((Date.now() - t) / 86400000);
  }
  // このお店が過去にした返信（文体・句読点・語感を合わせる最優先の見本）
  const pastReplies = (Array.isArray(req.body.pastReplies) ? req.body.pastReplies : [])
    .map(s => String(s || '').trim()).filter(Boolean).slice(0, 8);
  const styleBlock = pastReplies.length
    ? `\n【このお店が過去にした実際の返信（最優先の文体見本）】\n${pastReplies.map((p, i) => `例${i + 1}：${p}`).join('\n')}\n→ これはこの店の"本物の返信"です。次を必ず真似てください：①読点「、」句点「。」の打ち方と頻度 ②一文の長さとリズム ③語尾のバリエーション（です／ます／ました／ますね 等の混ぜ方）④お礼・お詫び・締めの言い回し ⑤改行や呼びかけの有無。内容は今回の口コミに合わせて変えるが、"句読点と語感"はこの例に必ず寄せる。例より硬い定型（「この度は」「誠に」「〜させていただきます」の乱用）を足さない。`
    : '';
  // AIっぽさ（機械的な句読点・定型の連なり）を消すための共通ガイド
  const humanTone = pastReplies.length
    ? '過去の返信例の句読点・一文の長さ・語尾を最優先で真似る。読点「、」を1文に詰め込みすぎない。全部の文を同じ長さ・同じ形にしない。実際のスタッフが手で打ったような、少しだけ崩れた自然さにする。'
    : '読点「、」を機械的に多用しない（1文に詰め込まない）。一文は短めに区切り、文の長さと語尾（です／ます／ました 等）に変化をつける。「この度は」「誠に」「〜させていただきます」などのテンプレ表現を並べない。教科書的な整いすぎた文でなく、実際のスタッフが手で打ったような自然な口調にする。';
  const replyTone = req.body.tone || 'polite';
  const toneGuide = ({
    polite: '丁寧でプロフェッショナルな接客トーン。落ち着いた敬語。',
    warm: '温かく親しみやすいトーン。少しやわらかい言い回しで距離感を縮める。',
    formal: 'フォーマルで格式のあるトーン。きちんとした敬語で礼節を重んじる。',
  })[replyTone] || '丁寧でプロフェッショナルな接客トーン。';
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
    prompt = `あなたは${storeName}で実際に接客している店舗スタッフです。お客様が書いてくれた口コミに、心のこもった返信を書いてください。テンプレ的でない、その口コミ専用の返信にしてください。

【口コミ者名】${reviewerName || 'お客様'}
【評価】★${rating}/5
【口コミ本文】${reviewText}

【店舗の強み・特徴】${strengths}
【提供サービス・商品】${services}
【キーワード】${keywords.join('、')}

【トーン】${toneGuide}
【来店時期の扱い】${timeGuide}${styleBlock}

【良い返信の条件】
1. 冒頭で、口コミ本文に実際に書かれた「具体的な良かった点」を1つ拾い、その言葉に触れて感謝する（料理名・接客・雰囲気・スタッフの対応など、本文の語をそのまま活かす）。一般論の「ご来店ありがとうございます」だけで終わらせない。
2. その点について、店舗側の想い・こだわり・取り組みを一言添えて、人間味を出す（本文に書かれていない事実は創作しない）。
3. 関連する自社サービス・商品があれば、宣伝くさくならない範囲で自然に1つだけ触れる（無理なら触れない）。
4. MEO：地域名か上記キーワードを1つだけ、文意を壊さない範囲で自然に織り込む（不自然なら入れない）。
5. お客様の名前（${reviewerName || 'お客様'}）を1回、自然に呼びかける。
6. 文末はまた来てほしい気持ちを、紋切り型でなく自然に伝えて締める。
7. ${timeGuide.includes('以前') || timeGuide.includes('ヶ月') ? '時間が経っている口コミなので「先日」など直近を示す語は使わない。' : ''}

【厳守】
- 120〜190文字程度。です・ます調。
- ${humanTone}
- 口コミ本文に無い事実（来店回数・注文内容など）を勝手に作らない。
- 「この度はご来店いただき誠にありがとうございます。」のような、どの店でも使える定型の出だしを避け、その口コミならではの一文から始める。
- 絵文字・顔文字・記号（！含む）は使わない。
- 返信文のみを出力（説明や見出しは書かない）。`;
  }

  // ★1〜3：謝罪・改善の返信
  if (type === 'reply_negative') {
    prompt = `あなたは${storeName}で実際に接客している店舗スタッフです。低評価の口コミに、誠実で人間味のある返信を書いてください。

【口コミ者名】${reviewerName || 'お客様'}
【評価】★${rating}/5
【口コミ本文】${reviewText}

【店舗の強み・特徴】${strengths}
【提供サービス・商品】${services}
【キーワード】${keywords.join('、')}

【トーン】${toneGuide}
【来店時期の扱い】${timeGuide}${styleBlock}

【良い返信の条件】
1. お客様が「具体的に何に不満を感じたか」を本文から正確に特定し、その点に正面から触れる（はぐらかさない）。
2. まず誠実に謝罪する。ただし「大変申し訳ございませんでした」だけの定型で終わらせず、何に対してのお詫びかを明記する。
3. 指摘点に対し、店舗としてどう受け止め・どう改善するかを、可能な範囲で具体的に伝える（実在の取り組み・サービス内容の範囲で。できない約束や言い訳はしない）。
4. もう一度試してほしい気持ちを、押し付けでなく丁寧に伝える。
5. MEO：謝罪の文意を損なわない範囲で、地域名かサービス名を不自然でなければ1つだけ自然に含める（謝罪が主目的。無理なら入れない）。

【厳守】
- 150〜210文字程度。です・ます調。誠実で温かみのある文体。
- ${humanTone}
- 口コミ本文に無い事実や言い訳を作らない。責任転嫁しない。
- ${timeGuide.includes('以前') || timeGuide.includes('ヶ月') ? '時間が経っている口コミなので「先日」など直近を示す語は使わない。返信が遅くなったことへのお詫びを冒頭に自然に添えてよい。' : ''}
- 絵文字・顔文字・記号（！含む）は使わない。
- 返信文のみを出力。`;
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
お客様が選んだ「良かった点」をもとに、そのお客様自身が書いたような、自然で等身大の口コミ下書きを作ってください。

【参考：お店】${storeName}
【お客様が選んだ良かった点】${userWords.join('、') || '特になし'}

【文体ルール（人間が書いたように・最重要）】
- 店名を書き出しに使わない。「${storeName}では、」のような始め方は禁止。お客様目線の感想からそのまま始める。
- 読点（、）を極力使わない。1文に読点は多くても1つまで。基本は読点なしで自然につなげる。
- 一文は短めにして複数の文に分ける。各文は必ず「。」で終える。
- いかにもAIが書いた説明口調・整いすぎた言い回しを避ける。実際のお客様が書いた素直な感想にする。
- 80〜150文字程度。です・ます調（体言止めが少し混ざるのはOK）。
- 選ばれた良かった点を自然に反映する。星評価や「★5」等は書かない。宣伝文句・キャッチコピーは入れない。絵文字は0〜1個。
- これは下書き（たたき台）。本人が直す前提で、自然な日本語にする。

【出力の形】
- 口コミ本文のみ。1文ごとに改行する（「。」の後で改行する）。前置き・説明・見出しは書かない。

【お手本（この文体・改行・読点の少なさに寄せる）】
ヒアリングが丁寧でサイト制作の際に何から何まで考えてくれて安心しました。
サイトのクオリティも高く理想通りのものができて嬉しかったです。
コミュニケーションもスムーズでこちらの要望をよく聞いてくれたと思います。`;
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

  // 競合分析の勝ち筋助言
  if (type === 'competitor_advice') {
    const c = req.body.competitor || {};
    const topText = (c.top || []).map((t, i) => `${i + 1}位 ${t.title}（★${t.rating || '—'}・口コミ${t.reviews || '—'}件）`).join('\n');
    prompt = `あなたはMEO（Googleマップ集客）の専門家です。
以下は「${c.keyword}」での上位競合と自店の状況です。自店がこの競合を抜いて上位表示されるための具体策を助言してください。

【自店】${storeName}（現在 ${c.myRank ? c.myRank + '位' : '圏外'}）
強み: ${strengths || '未設定'}
【上位競合】
${topText || 'データなし'}

【出力ルール】
- 「■競合との差（何が足りないか）」「■今すぐやるべき具体策」の2見出しで、各2〜4個の箇条書き（・始まり）
- 口コミ数・評価の差、GBP充実度、投稿頻度など、上位との具体的な差に触れる
- 効果や順位を断定・捏造しない（「〜が期待できます」程度）
- 前置き不要。2見出しの箇条書きのみ`;
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
    let content = data.choices?.[0]?.message?.content?.trim();
    if (!content) return res.status(500).json({ error: 'AI生成失敗' });
    // 口コミ下書きは「。」ごとに改行し、店名の書き出しを念のため除去（モデルが入れた場合の保険）
    if (type === 'review_draft') {
      content = content
        .replace(new RegExp('^\\s*' + String(storeName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*(では|は|さんは|様は)?[、,：:]?\\s*', ''), '')
        .replace(/。\s*/g, '。\n')   // 「。」の後で改行
        .replace(/\n{2,}/g, '\n')     // 余分な空行をまとめる
        .trim();
    }
    res.json({ content });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
