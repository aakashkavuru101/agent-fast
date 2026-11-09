# Agent-fast

[![CI](https://github.com/aakashkavuru101/agent-fast/actions/workflows/ci.yml/badge.svg)](https://github.com/aakashkavuru101/agent-fast/actions/workflows/ci.yml)
[![ライセンス: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node.js >=24](https://img.shields.io/badge/node-%3E%3D24-339933?logo=node.js&logoColor=white)](package.json)
[![Ollama ローカルファースト](https://img.shields.io/badge/Ollama-local--first-7c3aed)](https://ollama.com/)

[English](README.md)

Agent-fast は、AI エージェント向けの Apache-2.0 ライセンス、ローカルファーストなブラウザエージェントです。常駐型のネイティブ Chrome デーモン、コンパクトなアクセシビリティ参照、セキュアな MCP/CLI インターフェース、そして Ollama の無料ローカルモデルで動作する制限付き自律ループを組み合わせています。

アカウント、ホステッドブラウザ、モデルサブスクリプション、テレメトリー、アクション単位の料金は不要です。必要なものは、実行マシン、Chrome、互換性のあるローカルモデルだけです。Agent-fast は Apache ライセンスの [`agent-browser`](https://github.com/vercel-labs/agent-browser) エンジンを基盤としています。この選択の調査結果は [docs/research.md](docs/research.md) に記載しています。

## セキュリティ契約

- 自律実行の `run` はデフォルトで読み取り専用です。モデルによるクリックと入力には `--act` が必要です。
- 直接実行する `click`、`fill`、`auth login` は、ユーザーが明示的に要求するアクションです。
- 両方のポリシーで、JavaScript eval、ダウンロード、アップロード、ネットワーク変更、保存済み状態の変更を拒否します。
- すべてのエンジン呼び出しに、明示的なポリシー、コンテンツ境界、出力上限、タイムアウトを適用します。
- エンジンにはシェルを介さず引数を渡します。`AGENT_FAST_API_KEY` や無関係な環境認証情報を継承しません。
- デフォルトでは独立したローカルブラウザセッションを使用し、個人の Chrome プロファイルや任意の CDP エンドポイントは使用しません。
- ページコンテンツは信頼できないデータとしてマークし、プロンプトでも明示します。プロンプトインジェクションのリスクは低減しますが、完全には排除できません。
- 制御 API をネットワークに公開しません。MCP は stdio を使用します。

これはセキュリティバイデザインであり、完全なセキュリティの保証ではありません。認証情報を使用する場合や、重要な影響を及ぼすサイトで操作する場合は、事前に [SECURITY.md](SECURITY.md) を読んでください。

## 必要条件

- Node.js 24 以降
- `agent-browser` が対応する macOS、Linux、または Windows
- 以下の手順でインストールする Chrome for Testing
- 自律実行の `run` にのみ [Ollama](https://ollama.com/)。直接 CLI と MCP ブラウジングにはモデル不要

## インストール

```bash
npm install
npm run build
node dist/cli.js install
```

必要に応じて CLI を PATH に公開します。

```bash
npm link
agent-fast doctor
```

以下の例では `agent-fast` を使用します。リンクしていない場合は `node dist/cli.js` に置き換えてください。

## 直接ブラウジング

```bash
agent-fast open https://example.com
agent-fast snapshot
agent-fast get text body
agent-fast get url
agent-fast close
```

スナップショットは、操作可能な要素に `@e1` のような参照を割り当てます。ナビゲーションや DOM 変更後は、参照を再利用する前に新しいスナップショットを取得してください。

```bash
agent-fast click @e1
agent-fast fill @e2 "search text"
agent-fast scroll down 800
```

直接のクリックと入力はユーザー自身のアクションを表すため、操作ポリシーを使用します。自律アクションには別途 `--act` の明示的な指定が必要です。

ナビゲーションとサブリソースを制限するには、許可リストを指定します。必要な CDN オリジンも含めないと、ページが壊れる場合があります。

```bash
agent-fast --allowed-domains "example.com,*.example.com,cdn.example.net" open https://example.com
agent-fast --allowed-domains "example.com,*.example.com,cdn.example.net" snapshot
```

関連するすべてのコマンドで、同じセッションと許可リストを維持してください。セッションのセキュリティ設定はネイティブエンジンに保持されます。

## 無料の自律エージェント

Ollama を起動し、ツール呼び出し対応モデルを取得します。

```bash
ollama pull qwen3:4b
ollama serve
```

読み取り専用の調査タスクを実行します。

```bash
agent-fast run "Open https://example.com and report the page title and main heading"
```

通常の操作を明示的に許可する場合は、次のように実行します。

```bash
agent-fast --act --allowed-domains "example.com,*.example.com" run \
  "Open https://example.com, use the More information link, and summarize the result"
```

デフォルト設定:

- モデル: `qwen3:4b`
- エンドポイント: `http://127.0.0.1:11434/v1/chat/completions`
- 自律エージェントの最大反復回数: 20
- `--keep-open` を指定しない限り、`run` 後にブラウザを終了

別の OpenAI 互換エンドポイントも、エージェントを変更せずに選択できます。

```bash
export AGENT_FAST_MODEL="your-model"
export AGENT_FAST_MODEL_URL="https://provider.example/v1/chat/completions"
export AGENT_FAST_API_KEY="your-key"  # 任意。エンジンのプロセスには渡しません
agent-fast run "Summarize the current page"
```

リモート推論には料金が発生する場合があり、そのプロバイダーにページコンテンツが送信されます。HTTP が許可されるのはループバックのみで、ループバック以外のモデルエンドポイントには HTTPS が必要です。

## コーディングエージェント向け MCP

```bash
agent-fast mcp
```

または、ビルド済み CLI をクライアントに設定します。

```json
{
  "mcpServers": {
    "agent-fast": {
      "command": "node",
      "args": ["/absolute/path/to/agent-fast/dist/cli.js", "mcp"]
    }
  }
}
```

クライアントにクリックと入力を許可する場合のみ `agent-fast --act mcp` を使用してください。MCP サーバーには、CLI と同じドメイン、出力、環境、アクションポリシーの制限が維持されます。

## 認証

基盤エンジンは、暗号化されたローカル認証ボールトに認証情報を保存できます。公式のボールト設定手順に従った後、プロファイル名だけを参照します。

```bash
agent-fast auth login my-profile
```

パスワードをタスク、コマンドライン、モデルコンテキストに含めないでください。認証が必要な作業では、専用ブラウザプロファイルとドメイン許可リストを推奨します。Agent-fast 自体は認証情報ストアを実装していません。

## パフォーマンス設計

Agent-fast は、ブラウザの繰り返し起動、完全な DOM ダンプ、デフォルトのスクリーンショット、不要なモデルステップを回避します。タスク内の最初の URL を直接開き、コンパクトな操作要素スナップショットを使用し、ページ出力を制限し、古い観測結果を省略し、直接コマンド間ではネイティブデーモンを常駐させます。

ベンダー比較に依存せず、実際のワークロードでウォームレイテンシを測定してください。公平なベンチマークでは、ブラウザ、ページ、モデル、ネットワーク、スナップショット設定、ウォーム/コールド状態を固定し、中央値と p95 の時間を報告します。ここではベンダー間ベンチマークを主張しません。

## 検証結果

パッケージ済み CLI は、TypeScript のビルド/型チェック、依存関係監査、実 Chromium でのフォーム/ナビゲーション、MCP の初期化/ナビゲーション/読み取り/終了、および `qwen3.5:9b` を使ったローカル Ollama の読み取り専用タスクと操作タスクを通過しました。否定的な検査では、eval/download/upload/state の拒否、読み取り専用クリックの拒否、ドメインブロック、引数オーバーライドの拒否、環境 API キーの除去を確認しました。最終回答には、独立して観測した URL とドキュメントタイトルの証拠が含まれます。

Node.js 26.12.1、`agent-browser` 0.41.2、Chrome 158.0.8127.18 を使用した固定ループバックフィクスチャでは、20 回のウォーム `get title` 呼び出しで中央値 120.35 ms、平均 126.37 ms、p95 149.99 ms を測定しました。この時間には Agent-fast の Node.js ラッパー起動と、常駐ネイティブデーモンとの通信が含まれます。CDP 単独やベンダー間の測定ではありません。4 つの操作要素を持つスナップショットは 134 文字でした。

## 制限事項

- ブラウザエージェントは、完全なセキュリティやプロンプトインジェクションに対する完全な耐性を保証できません。
- ドメインフィルタリングは OS ファイアウォールではありません。強力な分離にはコンテナとネットワーク egress 制御を使用してください。
- CAPTCHA 回避、ステルスフィンガープリント、住宅プロキシサービス、ホステッドブラウザフリートは内蔵していません。
- ローカルモデルの品質とツール呼び出し対応はモデルによって異なります。モデルが厳密なツールスキーマに従えない場合は、直接 CLI/MCP モードを使用できます。
- 読み取り専用モードではナビゲーションとページ読み取りは可能ですが、クリックやフォーム入力が必要なワークフローは完了できません。
- 入力テキストとセレクター引数はハイフンで始められません。これは現行リリースでエンジンオプションの上書きを防ぐためです。
- ページ出力とモデル会話には機密データが含まれる場合があります。セッションを終了し、リスクを評価していない規制データや個人データは使用しないでください。

## ライセンス

Apache-2.0。詳細は [LICENSE](LICENSE) を参照してください。
