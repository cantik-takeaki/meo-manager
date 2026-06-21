// api/generate-content.js — キーワード＋ナレッジから自然な文章を生成
import { kvGet } from './_kv.js';

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

【返信のルール】
- まず口コミ本文を読み、お客様が「何に不満を感じたのか」を具体的に特定し、その点に正面から触れる
- まず「申し訳ございませんでした」と誠実に謝罪
- 指摘された点について、可能なら自社の取り組みやサービス内容（上記）を踏まえた改善・対応を具体的に伝える
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
    const { postType, customInstruction } = req.body;
    prompt = `あなたは${storeName}のSNS担当スタッフです。
Googleビジネスプロフィールへの投稿文を作成してください。

【投稿タイプ】${postType || '一般'}
【キーワード】${keywords.join('、')}
【サービス内容】${services}
【特記事項】${customInstruction || 'なし'}

【ルール】
- 150〜250文字程度
- 自然な口語体、読みやすい改行を含める
- 地域名・サービス名・キーワードを自然に盛り込む
- 「ぜひお気軽にお越しください」などの来店促進を含める
- AIが書いたと感じさせない。実際のお店の人が書いたような温度感
- マーケティング用語や過度な宣伝文句を避ける
- 絵文字は1〜2個まで、使いすぎない
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

  if (!prompt) return res.status(400).json({ error: '不明なtype' });

  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
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
