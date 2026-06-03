// api/generate-reply.js — AI返信文生成（Groq使用）
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { reviewText, rating, storeName, tone } = req.body;
  if (!reviewText) return res.status(400).json({ error: 'reviewText必須' });

  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_API_KEY) return res.status(500).json({ error: 'GROQ_API_KEY未設定' });

  const toneMap = {
    polite: '丁寧でプロフェッショナルな',
    warm: '温かみのある親しみやすい',
    formal: 'フォーマルで格式のある',
  };
  const toneStr = toneMap[tone] || '丁寧でプロフェッショナルな';

  const prompt = `あなたは${storeName || '店舗'}のオーナーです。
以下のGoogleマップの口コミに対して、${toneStr}返信文を日本語で作成してください。

評価：★${rating}/5
口コミ内容：${reviewText}

要件：
- 150〜200文字程度
- ネガティブな口コミには誠実に謝罪し改善を伝える
- ポジティブな口コミには感謝を伝える
- 店舗名や具体的な対応を含める
- 返信文のみ出力（前置き・説明不要）`;

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
        max_tokens: 400,
        temperature: 0.7,
      }),
    });
    const data = await r.json();
    const reply = data.choices?.[0]?.message?.content?.trim();
    if (!reply) return res.status(500).json({ error: 'AI生成失敗' });
    res.json({ reply });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
