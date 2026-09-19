# Jev Tetris Benchmark

TypeSafeのSystem Oneモデル **Jev** と、汎用言語モデル **Claude Haiku 4.5** に同じテトリス盤面・同じ合法手候補を渡し、配置判断を比較する再現可能なデモです。

ゲーム処理はコードが担当し、モデルが決めるのは「最大12個の合法手から、どの候補を選ぶか」だけです。穴を増やさないことを最優先し、次にライン消去、既存の穴、高さ、凹凸を評価します。

## このリポジトリで確認できること

- Jevの`Choice`質問を、状態を持つゲームの意思決定に利用する方法
- Vercel AI Gateway経由とTypeSafe API直接接続の両方
- 同一条件におけるJevとClaude Haiku 4.5の判断結果
- 20ライン到達、ゲームオーバー、判断時間、入力トークン、推定API費用
- Jevが返す候補別確率とconfidence

## 必要なもの

- Node.js 22以上
- Jev用に次のどちらか1つ
  - [Vercel AI Gateway](https://vercel.com/ai-gateway)のAPIキー
  - [TypeSafe AI](https://typesafe.ai/)のAPIキー
- 比較レースを行う場合はAnthropic APIキー

APIの利用料金は各サービスのアカウントに発生します。画面上の金額はコード内の単価を使った推定値なので、必ず各サービスの最新価格を確認してください。

## ローカルで実行

```bash
git clone https://github.com/planstack-ai/jev-tetris-benchmark.git
cd jev-tetris-benchmark
npm install
cp .env.example .env.local
```

`.env.local`へ自分のキーを設定します。

### Vercel AI Gateway経由でJevを使う

```dotenv
AI_GATEWAY_API_KEY=your_gateway_key
ANTHROPIC_API_KEY=your_anthropic_key
```

### TypeSafeへ直接接続する

```dotenv
TYPESAFE_API_KEY=your_typesafe_key
TETRIS_JEV_MODEL=jev-latest
ANTHROPIC_API_KEY=your_anthropic_key
```

起動します。

```bash
npm run dev
```

[http://localhost:3000](http://localhost:3000)を開き、「レースを開始」を押してください。APIキーはNext.jsのRoute Handler内だけで読み込まれ、ブラウザには送信されません。

Anthropicキーを設定しない場合はJev単独モード、Jev用キーを設定しない場合はHaiku単独モードとして動作します。

## 仕組み

```text
現在の盤面 + テトリミノ
          ↓
コードが回転・横位置ごとの合法手を列挙
          ↓
穴 / ライン消去 / 高さ / 凹凸を計算
          ↓
上位12候補を同じJSON形式でモデルへ送信
          ↓
Jev Choice または Haiku tool use が候補IDを返す
          ↓
コードが選択を検証して盤面へ反映
```

Jevへ渡す判断は1つの`Choice`です。候補生成、テトリスのルール、入力検証、盤面更新はすべて決定的なコード側に残しています。これは「既知の処理はコード、意味的な選択だけをモデル」というTypeSafeの構成例です。

## 主なファイル

- `app/engine.ts` — 盤面、回転、落下、ライン消去、候補生成
- `app/tetris-demo.tsx` — レース進行と可視化
- `lib/tetris-jev.mjs` — Jev Choice、入力・応答検証、Gateway/直接接続
- `lib/tetris-haiku.mjs` — Haiku tool useと入力・応答検証
- `app/api/` — APIキーをサーバー側に閉じ込めるRoute Handler
- `tests/` — API境界、候補外応答、レート制限などのテスト

## 検証

```bash
npm test
npm run lint
npm run build
```

テストでは外部APIをモックします。実料金を発生させずに入力検証と応答処理を確認できます。実モデルの再現実験はブラウザから行ってください。

## セキュリティ

- APIキーを`NEXT_PUBLIC_`変数へ入れないでください。
- `.env.local`はGit対象外です。
- APIは同一オリジンと専用ヘッダーを確認します。
- 候補数、盤面サイズ、値域、レスポンスの候補IDを検証します。
- Vercel AI Gateway経由ではZero Data Retentionをリクエスト単位で指定します。

## 注意

これはユースケース検証用のベンチマークであり、厳密なモデル性能評価ではありません。モデル更新、レート制限、通信状況、プロンプトや候補生成の変更によって結果は変化します。

## License

[MIT](./LICENSE)
