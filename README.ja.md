# Agent-fast

[![CI](https://github.com/aakashkavuru101/agent-fast/actions/workflows/ci.yml/badge.svg)](https://github.com/aakashkavuru101/agent-fast/actions/workflows/ci.yml)
[![ライセンス: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node.js >=24](https://img.shields.io/badge/node-%3E%3D24-339933?logo=node.js&logoColor=white)](package.json)
[![Ollama ローカルファースト](https://img.shields.io/badge/Ollama-local--first-7c3aed)](https://ollama.com/)

[English](README.md)

Agent-fast は、AI エージェントと自動テスト向けの Apache-2.0 ライセンス、ローカルファーストなブラウザランタイムです。常駐型のネイティブ Chrome デーモン、アクセシビリティ参照、イベント駆動の MCP サーバー、決定的なリプレイ、Ollama の無料ローカルモデルで動作する制限付き自律ループを組み合わせています。

アカウント、ホステッドブラウザ、モデルサブスクリプション、テレメトリー、アクション単位の料金は不要です。必要なものは、実行マシン、Chrome、互換性のあるローカルモデルだけです。Agent-fast は Apache ライセンスの [`agent-browser`](https://github.com/vercel-labs/agent-browser) エンジンを基盤としています。この選択の調査結果は [docs/research.md](docs/research.md) に記載しています。

## セキュリティ契約

- 自律実行の `run` はデフォルトで読み取り専用です。モデルによるクリックと入力には `--act` が必要です。
- CLI、MCP、自律ツール、リプレイでは、完全一致のホストを明示的に許可しない限り、プライベート/ループバック URL を拒否します。これはホスト名の検査であり、DNS、リダイレクト、ページ内リクエスト、履歴、認証ボールト経由の遷移には適用されません。
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

信頼できるローカル開発サーバーには、`--allowed-domains 127.0.0.1` または完全一致のホスト名で明示的に許可してください。ワイルドカードではプライベートホストを許可できません。

## AI エージェントの機能

バージョン 0.2.0 はネイティブエンジンを直接実行し、互換性のある操作をバッチ処理します。自律ループはモデル反復ごとに最大 3 つの順序付きツール呼び出しを受け入れ、次の機能をサポートします。

- コンパクトなスナップショット、可読ページ抽出、バッチ処理による URL/タイトル状態取得
- 履歴と `tab_list` から取得する `t1` のようなタブ参照
- 数値要素参照が古くなった場合のセマンティックテキスト/ラベル操作
- `--act` モードでの認証ボールトプロファイル
- JSON Schema 検証済みの構造化出力
- モデル呼び出しなしの決定的なワークフローリプレイ

### 構造化出力

ローカル JSON Schema を指定すると、機械可読な `result` を必須にできます。

```json
{
  "type": "object",
  "properties": {
    "title": { "type": "string" },
    "url": { "type": "string", "format": "uri" }
  },
  "required": ["title", "url"],
  "additionalProperties": false
}
```

```bash
agent-fast --schema ./schema.json run \
  "Open https://example.com and return the actual title and URL in result"
```

無効な結果は修正のためにモデルへ返されます。最終回答には、独立して観測した URL とドキュメントタイトルの証拠も含まれます。

### モデル不要のワークフローリプレイ

成功した実行を保存し、追加のモデル呼び出しなしでリプレイできます。

```bash
agent-fast --act --save-flow ./flow.json run \
  "Open https://example.com and inspect the page"
agent-fast flow ./flow.json
```

入力した値はワークフローファイルに保存されません。`{{value1}}` のようなプレースホルダーになり、リプレイ時に指定します。

```bash
agent-fast --act flow ./login-flow.json --param-env value1
```

実行前に、シークレット管理ツールまたは非表示の端末入力で環境変数 `value1` を設定します。各パラメータに `--param-env NAME` を繰り返します。未設定、重複、未使用のパラメータは拒否します。機密でない値には `--param value1=replacement` も使えますが、シェル履歴やプロセス一覧に表示されます。入力値は標準入力でエンジンに渡します。ただし、リプレイトレースやページ出力に値が含まれる可能性は残ります。

ワークフローファイルは所有者専用権限でアトミックに書き込まれます。リプレイにも、同じアクション、ドメイン、出力、タイムアウト、読み取り/操作ポリシーが適用されます。

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

反復操作では MCP で一度接続してください。Node とブラウザが常駐し、各操作で Node を起動し直す必要がありません。Claude Code などの MCP クライアントが推論を担当するため、追加のモデルループや Ollama は不要です。

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

操作を許可する場合のみ `agent-fast --act mcp` を使用してください。Agent-fast 自身の MCP サーバーが、CLI と同じ引数検証、プライベートホスト検査、期限付きコマンド実行、設定済みセッションを使用します。ツール引数でセッション、許可ドメイン、ポリシーを変更できません。操作は順序通りに実行し、失敗は明示的なツールエラーとして返し、切断時にブラウザを閉じます。基盤エンジンの全ツールは公開しません。対応ツールは `tools/list` で確認してください。

`agent_fast_batch` は最大 50 件の操作を 1 リクエストで実行します。すべての操作を事前検証し、互換性のある操作をネイティブバッチにまとめ、最初の実行失敗で停止します。実行済みの操作はロールバックしません。

```json
{
  "steps": [
    { "action": "fill_label", "args": { "label": "Search", "text": "example" } },
    { "action": "click_text", "args": { "text": "Go" } },
    { "action": "assert_text", "args": { "selector": "#output", "text": "Clicked: example" } }
  ]
}
```

## 自動テスト

CLI、MCP、自律実行、保存済みワークフローで、状態待機と明示的なアサーションを使用できます。

```bash
agent-fast wait-for '#ready'
agent-fast frame '#app-frame'
agent-fast snapshot
agent-fast fill @e2 'test input'
agent-fast select '#country' 'JP'
agent-fast press Enter
agent-fast assert-text '#status' 'Saved'
agent-fast frame main
```

`wait_for` は MCP/ワークフローで visible、hidden、attached、detached を指定できます。`assert_text` はテキストが完全一致するまで読み取りを繰り返し、期限切れを失敗として返します。いずれも最大 30 秒とコマンド期限の範囲内でタイムアウトを指定できます。キーボードとドロップダウン操作には、自律実行/MCP/リプレイで `--act` が必要です。

入れ子のフレームでは、選択中のフレームのスナップショットから新しい iframe 参照を取得して切り替えます。現行エンジンでは、CSS によるフレーム指定とセマンティックなテキスト/ラベル検索はメインドキュメントを基準に解決します。フレーム内のクリック/入力には新しい要素参照を使用してください。ローカルの動的ページで検証済みですが、認証済み Microsoft アプリでは未検証です。ファイルのアップロード/ダウンロードや任意の JavaScript 実行は引き続きポリシー対象外です。

`agent-browser` 0.41.2 とドメイン制限を使う検証では、サイト分離されたクロスオリジン iframe の読み込みが停止しました。再現コードは明示的なスキップ理由付きテストとして残しています。クロスオリジン iframe の互換性は未確認です。通過した入れ子フレーム試験は同一オリジンです。この基盤エンジンの制限は、埋め込み型の企業アプリに関係する未解決事項です。

エンジンやブラウザの変更後に、既知の失敗を再現するコマンドです。

```bash
AGENT_FAST_TEST_CROSS_ORIGIN=1 node --test --test-name-pattern=site-isolated test/browser.test.mjs
```

別の Chromium を使う場合は `CHROME_PATH` を設定してください。通常のテストではこの再現試験をスキップします。

## 認証

基盤エンジンは、暗号化されたローカル認証ボールトに認証情報を保存できます。公式のボールト設定手順に従った後、プロファイル名だけを参照します。

```bash
agent-fast auth login my-profile
```

パスワードをタスク、コマンドライン、モデルコンテキストに含めないでください。認証が必要な作業では、専用ブラウザプロファイルとドメイン許可リストを推奨します。Agent-fast 自体は認証情報ストアを実装していません。

## パフォーマンス設計

Agent-fast は第 2 の Node.js ラッパーを起動せず、ネイティブエンジンバイナリを直接実行します。互換性のある操作は JSON バッチを共有し、起動時の open+snapshot と URL+title の状態読み取りをバッチ化し、モデル反復ごとに最大 3 つの順序付きアクションを受け入れます。デーモンはコマンド間で常駐します。

固定ループバックページで独立ベンチマークを実行できます。

```bash
CHROME_PATH=/absolute/path/to/chrome npm run benchmark
```

以下の中央値は、2026-11-09 に Node.js 26.12.1、`agent-browser` 0.41.2、Chrome 158.0.8127.18 を使用した macOS arm64 ホスト上の 50 回の測定結果です。CLI の各測定では `dist/cli.js` を新しい Node プロセスで起動し、常駐デーモンから読み取ります。インプロセスの行には Node 起動時間を含みません。これはローカル測定であり、普遍的なランキングではありません。

| 操作 | 中央値 |
| --- | ---: |
| Agent-fast CLI `get title`（Node 起動を含む） | 63.01 ms |
| Agent-fast 常駐 MCP `get title` | 4.93 ms |
| Agent-fast MCP バッチ URL+title | 5.48 ms |
| Agent-fast インプロセスのネイティブ `get title` | 4.77 ms |
| 直接ネイティブ `agent-browser` `get title` | 3.72 ms |
| 直接 `agent-browser` Node ラッパー `get title` | 57.81 ms |
| 常駐インプロセス Playwright `page.title()` | 0.17 ms |
| Agent-fast インプロセスのバッチ URL+title | 5.22 ms |
| Agent-fast インプロセスの個別 URL+title 呼び出し | 9.24 ms |

今回の MCP 初期化は一度だけ 97.92 ms でした。MCP の行には常駐 Agent-fast との JSON-RPC 往復を含みますが、モデル推論、ブラウザ起動、遷移、サインインは含みません。単発 CLI は引き続き Node 起動コストを負担します。この表は利用方式の比較です。p95 と環境情報を含む測定結果は [benchmarks/latest.json](benchmarks/latest.json) に保存しています。

以前の 94.4% 高速化という主張は、CLI 全体とインプロセス呼び出しを比較していたため撤回します。今回のベンチマークは旧 Agent-fast CLI を再測定していないため、新旧 CLI の高速化率は主張しません。ラッパーの行は直接実行した `agent-browser` であり、旧 Agent-fast CLI ではありません。この比較では、常駐 Playwright と直接ネイティブ `agent-browser` の方が高速です。

## 検証結果

今回の macOS 検証では、TypeScript のビルド/型チェックと自動テストが通過しました。実 Chromium のワークフロー 8 件と、コマンド実行部の障害注入 6 件を含みます。入れ子フレーム参照、ドロップダウン、キー入力、遅延表示、アサーション、MCP エラー回復、デーモン終了後の明示的な再接続、不正/過大なメッセージ、ポリシー境界、複数バッチのリプレイを検証しました。CI は Linux/macOS/Windows に対応する設定に更新しましたが、新しいマトリクスの実行結果は未確認です。デーモンのシグナル試験は Windows ではスキップします。ライブ Microsoft アプリ、Ollama、公開サイト、認証ボールトは今回未検証です。

最終回答には、独立して観測した URL とドキュメントタイトルの証拠が含まれます。ベンチマークコードと反復可能なテストはリポジトリに含まれています。

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
