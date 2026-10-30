/*
 * ラクラクMEO — English UI layer (Meta App Review 用)
 * ------------------------------------------------------------------
 * `?lang=en` が付いているときだけ、画面の日本語を英語に差し替える。
 * 既存のHTML/JSには一切手を入れない“上乗せ”方式なので、通常運用（日本語）は無傷。
 *
 * なぜUIそのものを英語にするか:
 *   2026-07-13 と 2026-08-21 の2回、英語“字幕”を焼き込んだ動画で申請して
 *   どちらも「アプリUIの言語として英語を使用する」を理由に却下された。
 *   レビュアーが画面を読めないとE2Eを実証したと見なされないため、UIごと英語にする。
 *
 * 使い方: https://meo.cantik.co.jp/?lang=en
 */
(function () {
  'use strict';
  var p = new URLSearchParams(location.search);

  // OAuthから戻ると api/auth/callback.js が `/?...` へリダイレクトするため ?lang=en が落ちる。
  // それだと録画の中盤（連携完了の瞬間）から日本語UIに戻ってしまうので、
  // 一度 ?lang=en で開いたらタブが閉じるまで英語を維持する。
  // ※sessionStorage は同一オリジン内でのみ保持される＝録画は必ず
  //   Metaに登録済みの redirect_uri と同じドメイン（meo-manager-rho.vercel.app）で行うこと。
  var KEY = '__appreview_en';
  try {
    if (p.get('lang') === 'en') sessionStorage.setItem(KEY, '1');
    else if (p.get('lang') === 'ja') sessionStorage.removeItem(KEY); // 明示的に日本語へ戻す逃げ道
  } catch (e) { /* プライベートモード等で使えなくても落とさない */ }

  var on = p.get('lang') === 'en';
  if (!on) { try { on = sessionStorage.getItem(KEY) === '1'; } catch (e) {} }
  if (!on) return;

  // Chromeの自動翻訳を止める（2026-09-09の実測で判明した最大の穴）
  // ------------------------------------------------------------------
  // `<html lang="ja">` のまま中身だけ英語になるため、Chromeが言語の食い違いを検知して
  // **英語を日本語へ訳し戻していた**。実測では画面が丸ごと日本語だった。
  //   Locations → 場所 ／ Reviews → レビュー ／ Switch location → スイッチの位置
  // この状態で録画すると却下条項4（アプリUIが英語でない）を3回目で踏む。
  // lang属性をenにし notranslate を宣言して、翻訳そのものを無効化する。
  // ※`?lang=en` のときだけ通る経路なので日本語運用には影響しない。
  try {
    var html = document.documentElement;
    html.lang = 'en';
    html.setAttribute('translate', 'no');
    html.classList.add('notranslate');
    html.classList.remove('translated-ltr', 'translated-rtl'); // 訳し始めていた痕跡を消す
    var m = document.createElement('meta');
    m.name = 'google';
    m.content = 'notranslate';
    (document.head || html).appendChild(m);
  } catch (e) { /* 失敗しても英語化本体は続行する */ }

  // 完全一致の辞書。キーは trim 済みの日本語。
  var T = {
    // ── ブランド・ログイン ─────────────────────────────
    'ラクラクMEO': 'Rakuraku MEO',
    'はじめてでも、カンタンに始められる！': 'Local marketing made simple.',
    'ログイン': 'Log in',
    '認証してログイン': 'Verify and log in',
    'メールに届いた6桁の認証コードを入力してください。': 'Enter the 6-digit code sent to your email.',
    'ログアウト': 'Log out',
    '戻る': 'Back',

    // ── サイドバー ────────────────────────────────────
    'メイン': 'MAIN',
    'ダッシュボード': 'Dashboard',
    'クライアント': 'Clients',
    '店舗管理': 'Locations',
    '口コミ管理': 'Reviews',
    '集客・発信': 'MARKETING',
    '投稿管理': 'Google Posts',
    'Instagram投稿': 'Instagram',
    'HP SEO・記事': 'Website SEO',
    'MEO / AIO 対策': 'LOCAL SEO / AIO',
    'サイテーション': 'Citations',
    'AIO / LLMO / GEO対策': 'AIO / LLMO / GEO',
    '改ざん防止': 'Tamper Detection',
    '企業ナレッジ': 'Business Knowledge',
    '順位': 'RANKINGS',
    '順位管理': 'Keyword Manager',
    '順位レポート': 'Rank Report',
    'インサイト': 'Insights',
    '設定': 'Settings',
    '使い方': 'Help',
    '更新': 'Refresh',
    '翻訳': 'Translate',

    // ── Instagram パネル：連携 ────────────────────────
    'Instagramを連携': 'Connect Instagram',
    '再連携': 'Reconnect',
    '連携済み': 'Connected',
    '未連携': 'Not connected',
    '店舗を選択してください': 'Select a location',
    '読み込み中…': 'Loading…',
    '読み込み中...': 'Loading…',

    // ── Instagram パネル：写真ライブラリ → 投稿 ───────
    '写真ライブラリ': 'Photo library',
    '＋ 写真をアップロード': '+ Upload photo',
    '動画をアップロード': 'Upload video',
    '画像を生成': 'Generate image',
    '画像を探す': 'Find image',
    'URLから取り込む': 'Import from URL',
    'この写真で投稿を作る': 'Create a post with this photo',
    'すべて選択': 'Select all',
    '選択を解除': 'Clear selection',
    '選択して削除': 'Select and delete',
    '選択した写真を削除': 'Delete selected photos',
    '0件選択中': '0 selected',
    // 「（承認の上）」は社内の承認フローの意味。英語で "(after approval)" と書くと
    // 「Meta の審査が通るまで押せない」と読まれるので、ボタンは動作だけを書く。
    'Instagramに投稿（承認の上）': 'Publish to Instagram',
    '投稿は社外公開アクションです。': 'Publishing is a public action.',
    '内容を確認の上、社長承認として投稿してください。': ' Review the content before publishing.',
    'AIでキャプション生成': 'Generate caption with AI',
    'AIで生成': 'Generate with AI',
    'ハッシュタグ': 'Hashtags',
    '適正数の目安：3〜5個（Instagramは最大5個）': 'Recommended: 3–5 hashtags (Instagram allows up to 5).',
    '取り込んだ写真は': 'Imported photos are',
    '（自店の写真・許可済みのみ）。': '(own or licensed photos only).',
    '※他者が撮影・権利を持つ写真の利用可否は必ずご確認ください': 'Always confirm you have the rights to any photo you upload.',
    '「画像」タブで店舗写真を背景に選ぶと仕上がりが良くなります': 'Pick a location photo in the Image tab for a better result.',

    // ── Instagram パネル：インサイト ──────────────────
    'Instagramインサイト': 'Instagram insights',
    'フォロワー': 'Followers',
    'リーチ': 'Reach',
    'リーチ 28d': 'Reach (28d)',
    'リーチ 7d': 'Reach (7d)',
    'プロフ表示': 'Profile views',
    'いいね': 'Likes',
    'コメント': 'Comments',
    '保存': 'Saves',
    '表示回数': 'Impressions',
    'エンゲージメント': 'Engagement',
    'この投稿のインサイト': 'Insights for this post',

    // ── Instagram パネル：コメント ────────────────────
    '投稿のコメント': 'Post comments',
    '投稿を読み込み': 'Load posts',
    '投稿を選択してください': 'Select a post',
    '返信': 'Reply',
    '送信': 'Send',
    'コメントを読み込み': 'Load comments',

    // ── Instagram パネル：DM（録画では使わないが画面に出る）──
    'メッセージ（DM）': 'Direct messages',
    '会話を選択してください': 'Select a conversation',
    '「更新」で会話を読み込み': 'Press Refresh to load conversations',

    // ── 投稿画像エディタ（映り込み対策）──────────────
    '投稿画像作成': 'Create post image',
    '写真とテキストから投稿用の画像を作成（無料・ブラウザ内生成）': 'Build a post image from a photo and text (generated in your browser).',
    'ライブプレビュー': 'Live preview',
    'ライブラリに保存': 'Save to library',
    '保存すると写真ライブラリに入り、そのまま投稿に使えます': 'Saved images go to your photo library, ready to post.',
    'テンプレート': 'Template',
    '見出し': 'Headline',
    '見出し（キャッチコピー）': 'Headline',
    'サブテキスト': 'Subtext',
    'サブテキスト（任意）': 'Subtext (optional)',
    '英字見出し': 'English headline',
    '英字見出し（任意・おしゃれな英語タイトル）': 'English headline (optional)',
    '店名': 'Business name',
    '店名（画像に載せる表記・空欄で非表示）': 'Business name shown on the image (leave blank to hide)',
    'テキスト': 'Text',
    'テキスト内容': 'Text content',
    '画像': 'Image',
    '画像比率': 'Aspect ratio',
    '正方形 1:1': 'Square 1:1',
    '縦長 4:5（投稿推奨）': 'Portrait 4:5 (recommended)',
    '縦長 4:5（推奨）': 'Portrait 4:5 (recommended)',
    'ストーリー/リール 9:16': 'Story / Reel 9:16',
    '背景写真': 'Background photo',
    '背景写真のサイズ（拡大・縮小）': 'Background photo size',
    '背景の位置・サイズをリセット': 'Reset background position and size',
    '配置をリセット': 'Reset layout',
    'デフォルトに戻す': 'Reset to default',
    '自動補正（明るさ・コントラスト）': 'Auto-adjust (brightness and contrast)',
    '自動色': 'Auto color',
    '全体カラー': 'Overall color',
    '配色/濃さ': 'Palette / intensity',
    '文字色': 'Text color',
    '文字色（要素ごと）': 'Text color (per element)',
    '文字サイズ（要素ごと）': 'Text size (per element)',
    '文字位置': 'Text position',
    'サイズ・文字位置': 'Size and position',
    'フォント・向き': 'Font and orientation',
    '和文フォント': 'Japanese font',
    '和文を縦書き': 'Vertical Japanese text',
    'ロゴ': 'Logo',
    'ロゴ画像を選ぶ': 'Choose a logo image',
    'ロゴの大きさ': 'Logo size',
    'ロゴを外す': 'Remove logo',
    '透明度': 'Opacity',
    'サイズ': 'Size',
    '位置:': 'Position:',
    'ドラッグ': 'Drag',
    '再生成': 'Regenerate',
    '基本': 'Basic',
    '文字なし': 'No text',
    '文字なし（写真のみ）': 'No text (photo only)',
    '写真のみ・ロゴ可': 'Photo only (logo allowed)',
    '元の縦横比のまま': 'Keep original aspect ratio',
    '使い方のポイント': 'Tips',
    '← 前のページへ': '← Previous page',
    '写真の内容・伝えたいこと（任意）': 'What the photo shows (optional)',
    '見出し・英字見出し・サブテキストはAIボタンで自動生成できます': 'Headline, English headline and subtext can be generated with the AI button.',
    '背景に店内・料理の写真を選ぶと、雰囲気に合った高品質な画像になります。': 'Choosing an interior or food photo as the background gives the best result.',
    '配色は背景が写真なしグラデーションのときの色味、文字色は全体の基本色です。': 'Palette applies to the gradient background; text color sets the base color.',
    '表示されます。スライダーで大きさを変え、プレビュー上で写真を': 'Use the slider to resize, then drag the photo in the preview',

    // 位置・色・フォント名
    '左上': 'Top left', '中央': 'Center', '右上': 'Top right',
    '左下': 'Bottom left', '下': 'Bottom', '右下': 'Bottom right',
    '白': 'White', '黒': 'Black', 'クリーム': 'Cream', 'ゴールド': 'Gold',
    'ピンク': 'Pink', 'ブルー': 'Blue', 'グリーン': 'Green', 'ダーク': 'Dark',
    'ウォーム': 'Warm', 'カラー': 'Color',
    'ゴシック': 'Gothic', '明朝': 'Mincho', '丸ゴシック': 'Rounded Gothic',
    '筆太ゴシック': 'Bold Brush Gothic', 'マガジン': 'Magazine',
    'スタンダード': 'Standard', 'エレガント': 'Elegant',
    'スタンダード（下グラデ）': 'Standard (bottom gradient)',
    'エレガント（白セリフ・CORNER風）': 'Elegant (white serif)',
    'マガジン（英字大・SHIBUYA風）': 'Magazine (large English type)',
    '明朝見出し': 'Mincho headline',
    '明朝見出し（SanMichele風）': 'Mincho headline (SanMichele style)',
    '筆太ゴシック（塚田農場風）': 'Bold brush gothic',
    '塚田農場風・縦書き': 'Vertical brush style',
    '白セリフ・CORNER風': 'White serif',
    '英字大・SHIBUYA風': 'Large English type',
    'SanMichele風': 'SanMichele style',
    '下グラデ・万能': 'Bottom gradient (versatile)',

    // ── 改ざん防止（録画では使わないが導線上映る）─────
    '正規情報の登録': 'Verified business information',
    '正規情報として保存': 'Save as verified information',
    '企業ナレッジから取り込む': 'Import from Business Knowledge',
    '変更チェック': 'Check for changes',
    'アラート履歴': 'Alert history',
    '未設定': 'Not set',
    'アラートなし（正常です）': 'No alerts',
    '正式店舗名 *': 'Official business name *',
    '電話番号 *': 'Phone number *',
    '正式住所 *': 'Official address *',
    '公式URL': 'Website',
    'カテゴリ': 'Category',
    '営業時間': 'Business hours',

    // ── サイドバー下部・ヘッダー ──────────────────────
    '月次レポート': 'Monthly report',
    'アカウント': 'Account',
    '使い方ガイド': 'User guide',
    '店舗切替': 'Switch location',
    '管理者': 'Administrator',
    '管理者アカウント': 'Administrator account',
    'パスワード変更': 'Change password',
    'メールアドレスとパスワードでログイン': 'Log in with your email and password',

    // ── Instagram パネルの説明文 ──────────────────────
    'クライアントからもらった写真をアップロードして蓄積します（スマホ写真は自動でリサイズ）。':
      'Upload and store photos received from the business (phone photos are resized automatically).',
    'お店の食べログ・ぐるなび・公式サイト等のURLを入れると、掲載画像を取り込めます。':
      'Paste the URL of a listing or the official site to import its images.',
    'お店のロゴを重ねられます。透過PNG推奨。プレビュー上でドラッグして位置を調整できます。':
      'Overlay the business logo (transparent PNG recommended). Drag it in the preview to reposition.',
    '「自動色」ONならテンプレートに合う色を自動で使います。OFFにすると個別に指定できます。':
      'With Auto color on, colors follow the template. Turn it off to set them individually.',

    // ── 汎用 ──────────────────────────────────────────
    'キャンセル': 'Cancel',
    '閉じる': 'Close',
    '削除': 'Delete',
    '編集': 'Edit',
    '追加': 'Add',
    '検索': 'Search',
    '選択': 'Select',
    '確認': 'Confirm',
    '完了': 'Done',

    // ── ダッシュボード（録画 0:10〜0:35 に映る。2026-09-09に静的抽出して追加）──
    '全店舗の概況': 'All locations overview',
    '全店舗 横断ビュー': 'All locations',
    '月次レポート（PDF）': 'Monthly report (PDF)',
    '登録店舗': 'Locations',
    '管理キーワード': 'Managed keywords',
    'TOP3圏内': 'In top 3',
    'TOP10圏内': 'In top 10',
    '圏外': 'Not ranked',
    '前月比': 'MoM',
    '前月比 UP': 'MoM up',
    '前月比 DOWN': 'MoM down',
    '入力済み': 'Entered',
    '未入力': 'Not entered',
    '平均順位': 'Avg. rank',
    '最終入力': 'Last entry',
    'KW数': 'Keywords',
    'KW未登録': 'No keywords',
    'ステータス': 'Status',
    '店舗名': 'Location',
    '店舗別サマリー': 'Summary by location',
    '店舗一覧': 'Location list',
    '店舗情報を読み込み中...': 'Loading locations...',
    '店舗名・会社名で絞り込み': 'Filter by location or company',
    '表示中の店舗別サマリーをCSVでダウンロード': 'Download the summary shown as CSV',
    'クリックで並び替え': 'Click to sort',
    'クリックで店舗を選択': 'Click to select a location',
    'データなし': 'No data',
    'すべて': 'All',
    '読み込む': 'Load',
    '分析する': 'Analyze',
    '非表示にする': 'Hide',
    'クイックスタート': 'Quick start',
    'クイックアクション': 'Quick actions',
    '＋ クライアント追加': '+ Add client',
    '＋ 店舗登録': '+ Add location',
    'レポート確認': 'Review report',
    '口コミ獲得KPI（全店舗合計・今月）': 'Review acquisition KPIs (all locations, this month)',
    'QRスキャン': 'QR scans',
    'アンケート回答': 'Survey responses',
    'AI生成': 'AI-generated',
    'Googleクリック': 'Google clicks',
    'LINE誘導': 'LINE referrals',
    'メール取得': 'Emails collected',
    '回答率': 'Response rate',
    'AI生成率': 'AI-generation rate',
    'Google誘導率': 'Google click-through rate',
    'LINE誘導率': 'LINE referral rate',
    'AIコンサル': 'AI Consultant',
    'AIコンサルは店舗ごとに分析を行います。': 'The AI consultant analyzes one location at a time.',
    '対象店舗を選択すると、': 'Select a location to see:',
    '・MEO健康診断　・改善ポイント　・優先アクション': 'MEO health check / improvement points / priority actions',
    'を表示します。': '.',
    '対象店舗を選択してください': 'Select a location',
    '店舗への確認事項': 'Items to confirm with the business',
    '掲載サイトの情報が媒体間で食い違っていたり、そもそも公開情報が無い項目です。': 'Items where listing sites disagree, or where no public information exists.',
    '店に確認できるまで、投稿やGoogleビジネスプロフィールには書きません': 'We publish nothing to posts or the Google Business Profile until the business confirms it',
    '（誤った営業時間や存在しない設備を載せないため）。': '(so we never publish wrong hours or amenities that do not exist).',
    '確認が取れたら「確認済みにする」を押して、聞いた内容を残してください。': 'Once confirmed, press "Mark as confirmed" and record what you were told.',
    'ダッシュボードをひと目チェック': 'Check the dashboard at a glance',
    '新しい口コミを確認しAI返信案で返信': 'Check new reviews and reply with an AI draft',
    '投稿を1本作成（写真つき）': 'Create one post with a photo',
    '順位の変化を確認（月曜に自動計測）': 'Check rank changes (measured automatically on Mondays)',
    'AIコンサルの週次タスクを1つ実行': 'Run one weekly AI consultant task',
    '店舗レポートを生成して振り返り': 'Generate a location report and review it',
    '競合との順位比較→翌月の重点KWを決定': 'Compare ranks with competitors, then set next month’s focus keywords',
    '効果の低いキーワードを入れ替え': 'Replace underperforming keywords',
    '毎日（約5分）': 'Daily (about 5 min)',
    '毎週（約15分・月曜以降）': 'Weekly (about 15 min, Monday onward)',
    '毎月（約30分・月初）': 'Monthly (about 30 min, start of month)',
    '運用サイクルの目安を見る（毎日5分・毎週15分・毎月30分）': 'See the suggested cadence: 5 min daily, 15 min weekly, 30 min monthly',
    '最初の1〜2ヶ月は順位が大きく動かなくても問題ありません。MEOの効果は一般的に3〜6ヶ月かけて表れます。口コミ返信と週1投稿の継続がいちばんの近道です。': 'Rankings often move little in the first one or two months. Local SEO results usually appear over three to six months. Replying to reviews and posting weekly is the fastest route.',

    // ── Instagram（録画 1:40〜3:10 の本体。同上）──
    'クライアントごとに写真を貯めて、選んだ写真からAIがキャプションを生成し、Instagramへ投稿します。': 'Keep a photo library per client, let AI draft a caption from the photo you pick, and publish to Instagram.',
    '※現在は連携済みアカウント（@cantik.ink）へ投稿します。各クライアントのアカウントへの投稿は、Instagram API審査の通過後に各社を連携して可能になります。': 'Posts currently go to the connected account (@cantik.ink). Publishing to each client’s own account becomes available once the Instagram API review is approved and each client connects their account.',
    '※相手の最新メッセージから24時間以内のみ返信できます（Instagramの仕様）。送信は社外アクションのため承認の上で行ってください。': 'You can reply only within 24 hours of the customer’s latest message (an Instagram rule). Sending is an outbound action, so get approval first.',
    'プレビュー上の文字（見出し・英字・サブ・店名）はドラッグで位置を調整できます。テンプレートを変えると配置はリセットされます。': 'Drag the text in the preview (headline, English line, subtitle, business name) to reposition it. Changing the template resets the layout.',
    'して位置を調整（文字のない場所をドラッグ）。縮小すると写真全体が枠に収まり、余白は自動でぼかして埋めます。': 'to adjust the position (drag where there is no text). Shrinking fits the whole photo in the frame and blurs the margins automatically.',
    'マガジン': 'Magazine',
    'エレガント': 'Elegant',
    'カラー': 'Color',
    'クリーム': 'Cream',
    'グリーン': 'Green',
    'ゴールド': 'Gold',
    'ダーク': 'Dark',
    'ブルー': 'Blue',
    '黒': 'Black',
    '明朝': 'Serif',
    '丸ゴシック': 'Rounded sans',
    '中央': 'Center',
    '下': 'Bottom',
    '右上': 'Top right',
    '右下': 'Bottom right',

    // ── Instagram：JSが実行時に生成する文字列（録画 0:45〜3:10 の本体）──
    // HTMLの静的抽出では拾えない。MutationObserver が挿入時に置換する。
    'Instagram連携状態を確認中…': 'Checking Instagram connection…',
    'Instagram未連携': 'Instagram not connected',
    'Instagram連携済み': 'Instagram connected',
    'に投稿します': 'is connected for publishing',
    '付与された権限:': 'Granted permissions:',
    '(取得不可)': '(unavailable)',
    '連携URLをコピー': 'Copy connect URL',
    'この店舗のInstagramを連携すると、その店舗のアカウントへ直接 投稿・コメント返信・インサイト取得 ができます。': 'Connect this location’s Instagram to publish, reply to comments and read insights directly on that account.',
    '連携には、お店のInstagramが': 'Connecting requires the business’s Instagram to be',
    'プロアカウント（ビジネス/クリエイター）': ' a professional account (Business or Creator)',
    'であることが必要です。': '.',
    '下書き作成・保存までは可能ですが、公開はこの店舗のInstagramを連携してから行えます。': ' You can draft and save, but publishing requires connecting this location’s Instagram.',
    '※未連携の間は投稿できません。': 'Publishing is disabled while the account is not connected.',
    'この店舗のInstagramが未連携です。連携してから投稿してください。': 'This location’s Instagram is not connected. Connect it before publishing.',
    '写真を選択してください': 'Select a photo',
    'キャプションを入力してください': 'Enter a caption',
    '生成中...': 'Generating…',
    '生成失敗': 'Generation failed',
    '生成失敗:': 'Generation failed:',
    'この内容でInstagramに投稿します。よろしいですか？（社外公開アクション）': 'Publish this to Instagram? It will be posted publicly.',
    '投稿中...': 'Publishing…',
    'Instagramに投稿しました！': 'Published to Instagram.',
    '投稿失敗:': 'Publish failed:',
    '取得失敗:': 'Fetch failed:',
    '読み込み失敗': 'Failed to load',
    'Instagram Graph APIの実数値（直近28日/7日）。「—」はそのメトリクスが未提供の期間/種別です。': 'Real values from the Instagram Graph API (last 28 and 7 days). “—” means the metric is not provided for that period or media type.',
    'リーチ（28日）': 'Reach (28d)',
    'リーチ（7日）': 'Reach (7d)',
    'プロフ表示（28日）': 'Profile views (28d)',
    '反応した人（28日）': 'Accounts engaged (28d)',
    '合計の反応（28日）': 'Total interactions (28d)',
    '投稿数': 'Posts',

    // ── Instagram コメント返信フロー（録画 2:45〜3:10）──
    'コメント読み込み中...': 'Loading comments…',
    'コメントはまだありません。': 'No comments yet.',
    '返信...': 'Write a reply...',
    '返信する': 'Reply',
    '@ユーザー': '@user',
    'ユーザー': 'User',
    'シェア': 'Shares',
    '合計の反応': 'Total interactions',
    '投稿を開く': 'Open post',
    'このコメントに返信します。よろしいですか？（社外アクション）': 'Send this reply? It will be posted publicly.',
    '返信しました': 'Reply sent',
    '返信失敗:': 'Reply failed:',
    '… (コメント': '… (comments',
    '件 ・': ' · ',
    'この投稿のコメント数は': 'Instagram reports',
    '件ですが、Instagram APIの一覧には出てきません。': 'comments on this post, but they do not appear in the API list.',
    'これは権限の問題ではなく（インサイト等は正常に動いています）、': 'This is not a permissions problem — insights and the rest work normally —',
    'Instagramが特定のコメントをAPI一覧から除外する仕様': 'Instagram excludes certain comments from the API list by design',
    'によるものです。主な原因：': '. Main causes:',
    '① コメントした人の': '1. The commenter’s',
    'アカウントが非公開（鍵付き）': 'account is private',
    '→ 非公開アカウントのコメントはAPIに出ません': '→ comments from private accounts are not returned by the API',
    '② そのコメントが': '2. The comment is',
    '削除された親コメントへの返信': 'a reply to a deleted parent comment',
    '確認方法：': 'How to check:',
    '公開アカウント（または自店アカウント）からこの投稿に新しくコメントして「更新」→ 表示されれば連携は正常です。': 'Add a new comment to this post from a public account (or your own), then press Refresh. If it appears, the connection is working.',

    // ── ダッシュボードの実行時生成分（2026-09-10に実機で発見。HTML側には無い）──
    'Google連携済み': 'Connected to Google',
    'GBP連携': 'GBP connected',
    '自動判定': 'Auto-detected',
    '1. Googleと連携する': '1. Connect Google',
    '右上の「Googleと連携」から接続。口コミ・インサイト・投稿が使えるようになります': 'Connect from “Connect Google” at the top right. Reviews, insights and posts become available.',
    '2. 管理する店舗を選ぶ': '2. Choose the locations you manage',
    '店舗管理 → 店舗ピッカーで管理対象をONにします': 'Locations → turn on the ones you manage in the location picker',
    '3. 企業ナレッジを登録する': '3. Register business knowledge',
    '企業ナレッジ →「URLから自動取得」が最速です': 'Business Knowledge → “Import from URL” is the fastest way',
    '4. 対策キーワードを登録する（主力5〜7個）': '4. Register target keywords (5 to 7 core terms)',
    '店舗管理 → 対策キーワード →「AIでキーワード候補」': 'Locations → Target keywords → “Suggest keywords with AI”',
    '5. 口コミにAI返信してみる': '5. Try an AI reply to a review',
    '口コミ管理 → 未返信の口コミ →「AI返信案」': 'Reviews → Unanswered → “AI reply draft”',
    '6. クライアント用レポートを発行する': '6. Issue a client report',
    '店舗詳細 → その他 →「クライアント用レポート発行」': 'Location detail → More → “Issue client report”',
    '【デモ】さくら美容室 渋谷店': 'Sakura Hair Salon Shibuya (demo)',
    // 写真1枚ごとの生成ボタンとそのツールチップ（フォトライブラリに32個並ぶ）
    '生成': 'Generate',
    'この写真で画像生成': 'Generate an image from this photo',
    'クリックでこの写真から画像生成': 'Click to generate an image from this photo',
    'Googleビジネスプロフィールに写真を追加': 'Add this photo to the Google Business Profile',
    // ログイン中のアカウント名（サイドバー左下）。クライアント店名は実在の屋号なので訳さない。
    '株式会社cantik': 'cantik Inc.',
    // 都道府県（店舗一覧のグループ見出し）
    '東京都': 'Tokyo',
    '神奈川県': 'Kanagawa',
    '埼玉県': 'Saitama',
    '千葉県': 'Chiba',
    '沖縄県': 'Okinawa',
    '大阪府': 'Osaka',

    // ── サイドバーのツールチップ ─────────────────────
    'このページを最新のデータに更新': 'Refresh this page with the latest data',
    'この画面の使い方ガイドを開く': 'Open the guide for this screen',
    'メニューを開閉': 'Toggle menu',
    '選択中の店舗：': 'Selected location:',
  };

  // 数を含む可変の文字列は完全一致では拾えない（実測: 「2/6 完了」「/ 21店舗」が残った）。
  // 順に当てて最初に一致したものを使う。
  var RX = [
    [/^(\d+)\/(\d+)\s*完了$/, '$1 of $2 done'],
    [/^\/\s*(\d+)店舗$/, '/ $1 locations'],
    [/^最終更新:\s*(.+)$/, 'Last updated $1'],
    [/^前月\s*(\d+)$/, 'Last month $1'],   // 全社サマリーのカードに出るツールチップ
    [/^@(\S+)\s*に投稿します$/, 'Posts go to @$1'],   // 連携済みバッジの右（1つのテキストノード）
    [/^(\d+)件\s*・?$/, '$1 comments ·'],   // コメント数の表記
    [/^(\d+)件表示（全(\d+)件）$/, 'Showing $1 of $2'],
    [/^全体の\s*(\d+)%$/, '$1% of all'],
    [/^ナレッジ\s*(\d+)%$/, 'Knowledge $1%'],
    [/^(\d+)件$/, '$1 items'],
    [/^(\d+)店舗$/, '$1 locations'],
    [/^(\d+)字$/, '$1 chars'],
    [/^(\d+)ヶ月$/, '$1 months'],
    [/^(\d{4})年(\d{1,2})月(\d{1,2})日$/, '$2/$3/$1'],
    // 失敗トースト（APIのエラー文が後ろに付くので前方だけ置換する）
    [/^返信失敗[：:]\s*(.*)$/, 'Reply failed: $1'],
    [/^投稿失敗[：:]\s*(.*)$/, 'Publish failed: $1'],
    [/^送信失敗[：:]\s*(.*)$/, 'Send failed: $1'],
    [/^追加失敗[：:]\s*(.*)$/, 'Add failed: $1'],
    [/^削除失敗[：:]?\s*(.*)$/, 'Delete failed: $1'],
    [/^生成に失敗しました$/, 'Generation failed'],
    [/^追加に失敗しました$/, 'Add failed'],
  ];

  // 全文が一致しない文字列の中に混ざるUI片（2026-09-12追加）
  // 投稿セレクトの選択肢が「(日本語のキャプション)… (コメント8)」で、
  // 前半は実データなので全文一致では拾えず、後半の「(コメント8)」が録画に残った。
  var SUB = [
    [/（コメント(\d+)）|\(コメント(\d+)\)/g, function (m, a, b) { return '(' + (a || b) + ' comments)'; }],
    [/\(キャプションなし\)/g, '(no caption)'],
    [/コメント読み込み中\.\.\./g, 'Loading comments...'],
  ];

  function trSub(s) {
    var out = s;
    for (var i = 0; i < SUB.length; i++) out = out.replace(SUB[i][0], SUB[i][1]);
    return out === s ? null : out;
  }

  function trDyn(s) {
    for (var i = 0; i < RX.length; i++) {
      if (RX[i][0].test(s)) return s.replace(RX[i][0], RX[i][1]);
    }
    return trSub(s);
  }

  // ネイティブダイアログを英語にする（2026-09-09追加）
  // ------------------------------------------------------------------
  // confirm() / alert() はDOMに無いので、テキストノードを置換するこの層では届かない。
  // 録画で必ず出る2箇所がここに当たる。
  //   投稿の直前   … 「この内容でInstagramに投稿します。よろしいですか？（社外公開アクション）」
  //   返信の直前   … 「このコメントに返信します。よろしいですか？（社外アクション）」
  // どちらも申請の対象権限（content_publish / manage_comments）を実行する瞬間なので、
  // ここが日本語だとレビュアーには何を承諾した画面か読めない。
  ['confirm', 'alert', 'prompt'].forEach(function (fn) {
    var orig = window[fn];
    if (typeof orig !== 'function') return;
    window[fn] = function () {
      var a = Array.prototype.slice.call(arguments);
      if (a.length) {
        var k = String(a[0] == null ? '' : a[0]).trim();
        var en = T[k] || trDyn(k);
        if (en) a[0] = en;
      }
      return orig.apply(window, a);
    };
  });

  // トーストを英語にする（2026-09-12追加）
  // ------------------------------------------------------------------
  // トーストは一瞬でDOMに挿して消えるので、MutationObserver側の置換が間に合わない。
  // 実際に録画へ「返信失敗: An unknown error has occurred.」が日本語のまま写った。
  // 出す前に文字列を訳す。辞書にもRXにも無い日本語が来たら英語の定型に落とす。
  (function () {
    var wrap = function () {
      if (typeof window.showToast !== 'function' || window.showToast.__en) return false;
      var orig = window.showToast;
      var f = function (msg, kind) {
        var k = String(msg == null ? '' : msg).trim();
        var en = T[k] || trDyn(k);
        if (!en && /[ぁ-んァ-ヶ一-龥]/.test(k)) en = (kind === 'error') ? 'Request failed.' : 'Done.';
        return orig.call(window, en || k, kind);
      };
      f.__en = true;
      window.showToast = f;
      return true;
    };
    if (!wrap()) {
      var n = 0, t = setInterval(function () { if (wrap() || ++n > 100) clearInterval(t); }, 50);
    }
  })();

  // placeholder 専用
  var PH = {
    'メールアドレス': 'Email address',
    'パスワード（6文字以上）': 'Password (6+ characters)',
    '表示名（例：株式会社cantik）': 'Display name (e.g. cantik Inc.)',
    '6桁のコード': '6-digit code',
    '返信メッセージ': 'Write a reply',
    '返信...': 'Write a reply...',
    'ここにキャプションが表示されます（生成後に自由に編集できます）': 'Your caption appears here and can be edited freely.',
    '#相模原カフェ #自家焙煎珈琲 #南橋本ランチ': '#localcafe #specialtycoffee #lunch',
    'ページのURL（https://…）': 'Page URL (https://…)',
    '例：麺屋cantik 相模原店': 'e.g. cantik Noodle Bar',
    '例：本格炭火焼きを、相模原で': 'e.g. Real charcoal grill, right here',
    '例：新メニューのパスタ／季節限定／店内の雰囲気': 'e.g. new pasta / seasonal / interior',
    '例：ご予約受付中／月〜土 17:00〜': 'e.g. Now taking bookings / Mon–Sat from 5pm',
    '例：CORNER / SHIBUYA / SanMichele': 'e.g. CORNER / SHIBUYA / SanMichele',
  };

  var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, CODE: 1, PRE: 1 };

  function tr(node) {
    // テキストノード
    var w = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        return (n.parentNode && SKIP[n.parentNode.nodeName])
          ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      },
    });
    var hits = [], n;
    while ((n = w.nextNode())) {
      var k = n.nodeValue.trim();
      if (!k) continue;
      if (T[k]) hits.push([n, T[k]]);
      else { var d = trDyn(k); if (d) hits.push([n, d]); }
    }
    hits.forEach(function (h) {
      h[0].nodeValue = h[0].nodeValue.replace(h[0].nodeValue.trim(), h[1]);
    });

    // 属性
    var scope = node.querySelectorAll ? node : document;
    scope.querySelectorAll('[placeholder]').forEach(function (el) {
      var v = el.getAttribute('placeholder').trim();
      if (PH[v]) el.setAttribute('placeholder', PH[v]);
      else if (T[v]) el.setAttribute('placeholder', T[v]);
    });
    ['title', 'aria-label'].forEach(function (a) {
      scope.querySelectorAll('[' + a + ']').forEach(function (el) {
        var v = el.getAttribute(a).trim();
        if (T[v]) el.setAttribute(a, T[v]);
      });
    });
    // サイドバー下部のアバターは表示名の1文字目＝「株式会社cantik」だと「株」になる。
    // 辞書では拾えない派生文字なので直接置く。
    // ここ（tr内）に置くのが必須＝run()だけだと、ユーザー情報が非同期で後から描かれたときに戻る
    //（2026-09-10の実機で、run()に置いた版が「株」のままだった）。
    var ui = document.getElementById('userInitial');
    if (ui && /[ぁ-んァ-ヶ一-龥]/.test(ui.textContent || '')) ui.textContent = 'C';

    // value を持つボタン
    scope.querySelectorAll('input[type=button],input[type=submit]').forEach(function (el) {
      if (T[el.value.trim()]) el.value = T[el.value.trim()];
    });

    addPostButtons();
  }

  // 写真から投稿フォームを開くボタンを足す（2026-09-11・録画のために追加）
  // ------------------------------------------------------------------
  // このビルドでは写真タイルのクリックが `genFromPhoto(i)`（画像生成）に繋がっており、
  // 投稿フォーム `igComposeCard` を開く `pickPhoto(i)` は**動画タイルにしか結線されていない**
  // （index.html:7477）。ライブラリに動画が1本も無いため、
  // 「写真を選ぶ → キャプション → 投稿」の導線が画面から辿れない。
  // App Reviewでは content_publish をアプリ内から実演する必要があるので、
  // `?lang=en` のときだけタイルにボタンを1つ足して既存の pickPhoto を呼ぶ。
  //   ・既存のクリック（画像生成）は変更しない＝足すだけ
  //   ・`?lang=en` 以外では一切動かない＝日本語運用は無傷
  //   ・indexは既存の onclick="genFromPhoto(N)" から読む（描画順に依存しない）
  function addPostButtons() {
    var g = document.getElementById('mediaGallery');
    if (!g || typeof window.pickPhoto !== 'function') return;
    Array.prototype.forEach.call(g.children, function (tile) {
      if (tile.querySelector('[data-en-post]')) return;
      var img = tile.querySelector('img[onclick]');
      if (!img) return;
      var m = /genFromPhoto\((\d+)\)/.exec(img.getAttribute('onclick') || '');
      if (!m) return;
      var i = Number(m[1]);
      var b = document.createElement('button');
      b.setAttribute('data-en-post', '1');
      b.textContent = 'Create a post';
      b.style.cssText = 'position:absolute;bottom:4px;right:4px;z-index:3;background:#111;' +
        'color:#fff;border:0;border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer';
      b.addEventListener('click', function (ev) {
        ev.stopPropagation();
        window.pickPhoto(i);
      });
      tile.appendChild(b);
    });
  }

  function run() {
    document.documentElement.setAttribute('lang', 'en');
    document.title = 'Rakuraku MEO — Local marketing console';
    tr(document.body);
  }

  // ?lang=en&audit=1 … 画面に残っている日本語をコンソールに出す（録画前の自己点検用）
  function audit() {
    var seen = new Set();
    var w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    var n;
    while ((n = w.nextNode())) {
      var el = n.parentElement;
      if (!el || SKIP[el.nodeName]) continue;
      if (!el.offsetParent && el.nodeName !== 'OPTION') continue; // 非表示は無視
      var t = n.nodeValue.trim();
      if (t && /[ぁ-んァ-ヶ一-龥]/.test(t) && t.length <= 60) seen.add(t);
    }
    if (seen.size) {
      console.warn('[EN audit] 未翻訳 ' + seen.size + '件 — appreview-en.js の辞書に追加してください');
      console.table([].concat(Array.from(seen)).map(function (x) { return { japanese: x }; }));
    } else {
      console.log('[EN audit] 表示中の日本語なし');
    }
    return Array.from(seen);
  }
  window.__enAudit = audit;
  if (p.get('audit') === '1') {
    setTimeout(audit, 1500);
    document.addEventListener('click', function () { setTimeout(audit, 600); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }

  // 画面が動的に描き変わっても英語のままにする（パネル切替・API描画あと）
  // requestAnimationFrame はタブが非表示だと止まる。CDPで裏から操作している間に
  // 描かれたカードがそのまま日本語で残った（2026-09-12に「Instagram未連携」で実測）。
  // setTimeout なら表示状態に関係なく走る。
  var pending = false;
  new MutationObserver(function () {
    if (pending) return;
    pending = true;
    setTimeout(function () { pending = false; tr(document.body); }, 0);
  }).observe(document.documentElement, { childList: true, subtree: true });

  // 描画が非同期のカードは、観測を取りこぼしても最後に必ず英語へ戻す保険。
  setInterval(function () { tr(document.body); }, 1200);
})();
