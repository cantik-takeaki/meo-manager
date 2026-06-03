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
以下の口コミにお礼の返信を書いてください。

【口コミ者名】${reviewerName || 'お客様'}
【評価】★${rating}/5
【口コミ】${reviewText}

【店舗の強み・特徴】${strengths}
【キーワード】${keywords.join('、')}

【返信のルール】
- 120〜180文字程度
- 「お越しいただきありがとうございます」を自然に含める
- お客様の名前（${reviewerName}様）を1回使う
- 具体的な店舗の特徴や次回来店への期待を入れる
- 文末は「またのご来店をお待ちしております」系で締める
- です・ます調、丁寧だが堅すぎない
- AIっぽいテンプレ感を出さない。人が書いたように自然に
- 絵文字・記号は使わない
- 返信文のみ出力`;
  }

  // ★1〜3：謝罪・改善の返信
  if (type === 'reply_negative') {
    prompt = `あなたは${storeName}の店舗スタッフです。
以下のネガティブな口コミに誠実に返信してください。

【口コミ者名】${reviewerName || 'お客様'}
【評価】★${rating}/5
【口コミ】${reviewText}

【返信のルール】
- 150〜200文字程度
- まず「申し訳ございませんでした」と誠実に謝罪
- 口コミの内容に具体的に言及する
- 改善への取り組みや今後の対応を伝える
- 再来店を丁寧にお願いする
- です・ます調、誠実で温かみのある文体
- AIっぽいテンプレ感を出さない。実際に現場で働く人が書いたように
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
