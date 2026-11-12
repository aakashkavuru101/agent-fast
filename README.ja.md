# Agent-fast

[![CI](https://github.com/aakashkavuru101/agent-fast/actions/workflows/ci.yml/badge.svg)](https://github.com/aakashkavuru101/agent-fast/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@aakashkavuru101/agent-fast?logo=npm&logoColor=white)](https://www.npmjs.com/package/@aakashkavuru101/agent-fast)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node.js >=24](https://img.shields.io/badge/node-%3E%3D24-339933?logo=node.js&logoColor=white)](package.json)
[![Ollama local-first](https://img.shields.io/badge/Ollama-local--first-7c3aed)](https://ollama.com/)

[English](README.md)

Agent-fast は、AI エージェントのための無料・オープンソースのブラウザーです。一度インストールすれば、MCP、コマンドライン、または好きなモデルを使った自律ループから、閉じ込められたブラウザーを使えます。アカウント、ホスト型ブラウザー、テレメトリ、操作ごとの料金はいずれも不要です。

Apache ライセンスの [`agent-browser`](https://github.com/vercel-labs/agent-browser) エンジンの上に、エージェントに必要なものを足しています。

| 必要なもの | Agent-fast がすること |
| --- | --- |
| **トークン効率** | スナップショットはエンジンの refs マップを除いたプレーンテキストで届きます（公開サイト 7 件で 72% 削減）。ページ移動の結果には新しいページが含まれるため、モデルは尋ねずに操作できます。`snapshot` の `diff` は変更された行だけを返します。 |
| **ゼロセットアップ** | マシンにある Chrome、Brave、Edge、Chromium をそのまま使います。`npx @aakashkavuru101/agent-fast mcp` だけで MCP サーバーが動きます。`install` はブラウザーがない場合にだけダウンロードします。 |
| **画像へのフォールバック** | 要素の特定に失敗すると、MCP でも run ループでも、ページのスクリーンショットと座標でクリックするためのヒントを返します。画像を見られるモデルには画像が渡ります。 |
| **モデル連携** | `claude-*`、`gpt-*`、`o*`、`gemini-*` という名前はそれぞれのベンダーへ、そのベンダーのキーで振り分けられます。それ以外は Ollama または任意の OpenAI 互換 URL で動きます。Claude は公式 SDK を通り、ツール結果に画像を含めます。 |
| **ステルス** | 自動化フラグを付けないため `navigator.webdriver` は false です。インストール済みブラウザーのヘッドレスセッションは `HeadlessChrome` ではなく、そのブラウザー本来のユーザーエージェントを送ります。 |
| **人間による確認** | reCAPTCHA、hCaptcha、Turnstile、「あなたが人間であることを確認」のページを検出し、同じプロファイルの見えるウィンドウで人に渡します。自動では解きません。 |
| **閉じ込め** | すべての通信は、DNS 解決後にドメイン許可リストを強制するローカルの送信プロキシを通ります。ツールカタログは閉じています。eval、シェル、エンジンへの生のアクセスはありません。 |
| **速度** | 起動済みの操作は 1 ミリ秒を大きく下回ります。操作ごとに新しいプロセスを起動せず、エンジンのデーモンに 1 行送るだけだからです。 |

静的なページから、サインインしてクロスオリジンのフレームを埋め込むシングルページアプリケーションまで、同じツールがどのサイトでも動きます。

## 目次

- [クイックスタート](#クイックスタート)
- [ベンチマークと評価](#ベンチマークと評価)
- [セキュリティ契約](#セキュリティ契約)
- [要件とインストール](#要件とインストール)
- [直接操作](#直接操作)
- [機能](#機能)
- [コーディングエージェント向け MCP](#コーディングエージェント向け-mcp)
- [自律実行](#自律実行)
- [モデルを使わないワークフロー再生](#モデルを使わないワークフロー再生)
- [人間による確認](#人間による確認)
- [認証](#認証)
- [フィンガープリント](#フィンガープリント)
- [自動テスト](#自動テスト)
- [動画](#動画)
- [性能設計](#性能設計)
- [検証](#検証)
- [制限事項](#制限事項)

## クイックスタート

Chromium 系ブラウザーがインストールされていれば、MCP クライアントに必要なのは 1 項目だけです。

```json
{
  "mcpServers": {
    "agent-fast": {
      "command": "npx",
      "args": ["-y", "@aakashkavuru101/agent-fast", "--act", "mcp"]
    }
  }
}
```

読み取り専用のブラウザーにするには `--act` を外します。ターミナルからは次のとおりです。

```bash
npm install -g @aakashkavuru101/agent-fast
agent-fast doctor                       # 使うブラウザーを表示し、起動できるか確認
agent-fast open https://example.com
agent-fast snapshot                     # @e1 形式の参照付きツリーとしてページを表示
agent-fast --act click @e1
agent-fast close
```

ローカルモデルまたはホスト型モデルによる自律実行:

```bash
ollama pull qwen3:4b                    # 無料・ローカル
agent-fast run "Open https://example.com and report the main heading"

export ANTHROPIC_API_KEY=...            # または OPENAI_API_KEY、GEMINI_API_KEY
AGENT_FAST_MODEL=claude-opus-5-5 agent-fast --act run "Find the pricing page and list the plans"
```

## ベンチマークと評価

生データとスクリプトは [benchmarks/](benchmarks/) にあります。いずれも macOS arm64 のマシン 1 台でのローカルな測定であり、普遍的な順位付けではありません。

### 1. 起動済み操作の遅延

`npm run benchmark`（[benchmarks/warm.mjs](benchmarks/warm.mjs)）は、固定のループバックページに対して 1 操作を 50 回ずつ測り、Agent-fast をエンジン自身のクライアントや常駐 Playwright と比べます。2026-11-12 に、このリリース（0.4.0）を Node.js 26.12.1、`agent-browser` 0.41.2、Brave（Chromium 157）で測った中央値です。

| 経路 | 中央値 | p95 |
| --- | ---: | ---: |
| Agent-fast プロセス内 `get title` | 0.31 ms | 0.40 ms |
| Agent-fast MCP `get title`（JSON-RPC の往復全体） | 0.50 ms | 0.67 ms |
| Agent-fast MCP バッチ（URL とタイトル） | 1.35 ms | 1.57 ms |
| 常駐プロセス内 Playwright `page.title()` | 0.17 ms | 0.29 ms |
| ネイティブ `agent-browser` `get title`（操作ごとに 1 プロセス） | 3.72 ms | 4.31 ms |
| Agent-fast CLI `get title`（毎回新しい Node プロセス） | 58.09 ms | 61.00 ms |
| `agent-browser` の Node ラッパー `get title` | 57.39 ms | 58.96 ms |

起動済みの MCP 操作はバージョン 0.2.0（4.77 ms）のおよそ 10 倍速く、エンジン自身のネイティブクライアントよりも速くなっています。単発の CLI コマンドは Node の起動時間に縛られるため、遅延が重要な場合は MCP を使ってください。MCP の初期化には 1 回だけ 303 ms かかりました。生データ: [benchmarks/latest.json](benchmarks/latest.json)。

### 2. 市場のツールとの直接比較

[benchmarks/head-to-head/](benchmarks/head-to-head/) は、同じモデル（`claude-opus-5-5`、effort xhigh）、同じ Brave、タスクごとに 1 つの `claude -p` セッションで、10 のタスクを 5 つのブラウザーツールに実行させます。タイトル・価格・表の行の読み取り、リンクの移動、検索フォーム、iframe 内のフォーム、確認ダイアログの承認、指示を注入しようとするページの読み取り、MDN のページと GitHub リポジトリの読み取りです。2026-11-12 にこのリリースで 2 回測定しました。表は 2 回目で、1 回目も同じ順位で、どのツールも 4〜19 秒速いものでした。両方の実行の詳細は [results-2026-11-12.md](benchmarks/head-to-head/results-2026-11-12.md) にあります。

| ツール | 合格 | 経過時間 | ブラウザー呼び出し | エラー | モデルのターン | 入力トークン | API 換算コスト |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **Agent-fast 0.4.0** | 10 / 10 | **87 秒** | **22** | **0** | **31** | **280,964** | $0.34 |
| Playwright MCP 0.0.83 | 10 / 10 | 122 秒 | 31 | 0 | 40 | 425,863 | **$0.30** |
| Chrome DevTools MCP 1.12.0 | 10 / 10 | 120 秒 | 31 | 0 | 37 | 554,753 | $0.32 |
| agent-browser 0.41.2 | 10 / 10 | 192 秒 | 38 | 1 | 42 | 1,651,353 | $0.83 |
| Claude in Chrome | 10 / 10 | 164 秒 | 34 | 0 | 42 | 644,060 | $0.39 |

- すべてのツールがすべてのタスクに合格し、注入された指示に従ったツールはありませんでした。
- Agent-fast は 2 回とも 10 タスク中 9 つで最速で、ブラウザー呼び出し、モデルのターン、トークンが最も少なく、エラーはありませんでした。ページ移動の結果に新しいページが含まれるため、多くのタスクが 1〜2 回の呼び出しで終わり、3 つのタスクは `read` だけで答えが出ました。自身のエンジンを直接公開したもの（agent-browser の MCP サーバー）と比べて、入力トークンは 80% 以上少なくなりました。
- Playwright MCP と Chrome DevTools MCP は約 40% 多い呼び出しで約 40% 遅く、エラーはありませんでした。Playwright の実行はキャッシュ読み取りの割合が高いため、API 換算の金額では最も安くなりました。
- 3 つの変更の前、このビルドでの Agent-fast の最初の実行は 133 秒でした。ブラウザーの時間はその 7% で、残りはターンごとのモデルの時間でした。このリリースの 3 つの変更が差を埋めました。軽量な既定のツールカタログ（41 から 25 ツールへ。残りは `--tools full`）、読み取り失敗時にスクリーンショットを付けないこと、MCP の初期化時にブラウザーを起動すること。下記のダイアログの修正も同じ実行で見つかりました。

### 3. ローカルモデルによるエージェント評価

`npm run benchmark:agent`（[benchmarks/agent-eval.mjs](benchmarks/agent-eval.mjs)）は、実際のモデルを使ってローカルページ上の 8 つのタスクを実行し、結果を厳密に検査します。内容は、タイトルの読み取り、価格の抽出、表の値の検索、リンクの移動、検索フォーム、iframe 内のフォーム、確認ダイアログの承認、指示を注入しようとするページの読み取りです。このホストの Ollama で、各タスクを temperature 0 で 1 回ずつ実行しました。

| モデル | 合格 | 備考 |
| --- | ---: | --- |
| `qwen3.5:9b` | 8 件中 6 件 | 1 タスクあたりモデル呼び出し 1〜4 回、26〜51 秒。不合格の 1 件は別のページから正しい見出しを報告し、もう 1 件は状態の文言を言い換えました。注入された指示には従いませんでした。2026-11-10 に測定。生データは [benchmarks/agent-eval.json](benchmarks/agent-eval.json)。 |
| `qwen3:4b`（既定） | 8 件中 7 件 | 通常のタスクにはすべて正解しましたが、応答のたびに数分考えるため 1 タスクに 27〜460 秒かかりました。インジェクションのページではツール呼び出しをしなくなり、実行は失敗しました。既定の `--model-timeout`（5 分）が必要です。2026-11-11 に測定。 |
| `llama3.2:3b` | 8 件中 1 件 | ページは読めますが、スキーマに合う `done` 呼び出しを作れません。 |

実行ごとに結果は変動します。`AGENT_FAST_MODEL=<モデル> npm run benchmark:agent` で再実行できます。ホスト型モデルもキーを設定すれば同じように使えます。

## セキュリティ契約

- ループバック、リダイレクト、サブリソース、iframe、WebSocket を含むすべてのブラウザー通信は、セッションごとの送信プロキシを通ります。プロキシはホスト名を解決し、プライベート、ループバック、リンクローカル、NAT64、6to4 のアドレスを拒否したうえで、検査したそのアドレスに接続します。これにより DNS リバインディングや `127.0.0.1.nip.io` 形式の回避を防ぎます。
- `--allowed-domains` または `--allow-preset` を指定すると、プロキシは許可リスト外のホストもすべて拒否します。`127.0.0.1` のような完全一致の指定は、プライベートホストを明示的に許可するためのものです。ワイルドカードではプライベートホストは許可されません。
- 自律実行の `run` は既定で読み取り専用です。モデルによる操作には `--act` が必要です。許可リストがない場合、モデルはタスクに書かれたサイトにしか移動できません。そのため、ページがモデルを誘導してデータを別の場所へ運ばせることはできません。`--open-web` でこの制限を外せます。
- どちらのポリシーも、JavaScript eval、ネットワーク傍受、Cookie・ストレージ・保存状態へのアクセスを拒否します。アップロードとダウンロードは、ディレクトリを指定するまで無効で、指定後もそのディレクトリ内に限定されます。ページが開始したダウンロードは `~/.agent-fast/downloads` に保存され、利用者自身のダウンロードフォルダーには入りません。
- ページに入力する値は、コマンドライン引数ではなく JSON として渡します。そのため `--action-policy` や `-5` のような文字列もそのまま入力され、エンジンの設定を変えることはできません。
- エンジンはシェルを受け取らず、`AGENT_FAST_API_KEY`、ベンダーのキー、無関係な環境の認証情報を継承しません。ベンダーのキーはそのベンダー自身の API にだけ送られ、独自のモデル URL には `AGENT_FAST_API_KEY` だけが送られます。
- 既定のブラウザーは独立したセッションです。個人の Chrome プロファイルや任意の CDP エンドポイントには接続しません。`--profile` は専用のディレクトリを使います。
- ページの内容は信頼できないデータとしてモデルに渡します。プロンプトインジェクションのリスクは下がりますが、なくなるわけではありません。
- 制御用の API をネットワークに公開しません。MCP は stdio を使い、プロキシはループバックだけで待ち受けます。

これは設計によるセキュリティであり、完全な安全性の保証ではありません。認証情報を使う前、または影響の大きい Web サイトで操作する前に [SECURITY.md](SECURITY.md) をお読みください。

## 要件とインストール

- macOS、Linux、Windows 上の Node.js 24 以降
- Chromium 系ブラウザー。Agent-fast はインストール済みの Chrome、Brave、Edge、Chromium を見つけます。どれもない場合は `agent-fast install` が Chrome for Testing をダウンロードします。`--executable-path` または `CHROME_PATH` で明示的に指定できます
- [Ollama](https://ollama.com/) またはベンダーのキーは、自律実行の `run` にのみ必要です。CLI と MCP での直接操作にモデルは不要です
- `ffmpeg` は `--record` にのみ必要です

```bash
npm install -g @aakashkavuru101/agent-fast
agent-fast doctor       # 使うブラウザーを表示し、起動できるか確認
agent-fast install      # doctor がブラウザーを見つけられない場合のみ
```

クローンからは `npm install && npm run build` の後、`agent-fast` の代わりに `node dist/cli.js` を使うか、`npm link` で PATH に追加します。

## 直接操作

```bash
agent-fast open https://example.com
agent-fast snapshot
agent-fast get text body
agent-fast screenshot
agent-fast close
```

スナップショットは、iframe 内の要素を含む操作可能な要素に `@e1` のような参照を割り当てます。ページ移動や DOM の変化の後は、参照を使う前にスナップショットを取り直してください。長いツリーは `--max-output` で切り詰められます。`agent-fast snapshot main`（MCP では `selector`）で、1 つの領域を参照付きで読めます。

```bash
agent-fast click @e1
agent-fast fill @e2 "search text"
agent-fast fill @e2 -- -5          # ハイフンで始まる値の前には -- を置く
agent-fast hover @e3
agent-fast press Enter
agent-fast dialog accept
agent-fast tab-new https://example.org   # tab-list、tab-switch t1、tab-close t2 もあります
```

直接の操作コマンドは利用者自身の操作を表すため、操作用ポリシーを使います。自律的な操作には別途 `--act` の指定が必要です。

セッションを閉じ込めるには許可リストを指定します。`*.example.com` は `example.com` とそのサブドメインを含みます。ページが必要とする CDN のホストも含めてください。

```bash
agent-fast --allowed-domains "*.example.com,cdn.example.net" open https://example.com
agent-fast --allowed-domains "*.example.com,cdn.example.net" snapshot
agent-fast blocked     # プロキシが拒否したホスト。ページに必要なものを追加する
```

関連するコマンドには毎回同じセッションと許可リストを渡してください。実行中のセッションの許可リストは変更できません。先に `close` してください。信頼できるローカル開発サーバーには `--allowed-domains 127.0.0.1`（または正確なホスト名）で明示的に許可します。

## 機能

| 分野 | ツール（CLI、MCP、自律実行、ワークフロー共通） |
| --- | --- |
| 移動と読み取り | `open`、`read`、`snapshot`、`get_text`、`get_state`、`back`、`forward`、`reload`、`scroll`、タブ操作 |
| 待機と検証 | `wait`、`wait_for`（セレクターの状態、iframe とシャドウ DOM 内を含む表示テキスト、URL のグロブ、`networkidle` などの読み込み状態）、`assert_text` |
| 操作（`--act`） | `click`（シングル／ダブル）、`fill`、`type`（実際のキー入力）、`press`、`hover`、`check`、`select`、`drag`、`click_text`、`fill_label`、`click_at` と `drag_at`（ビューポート座標） |
| ダイアログ | `dialog` の状態確認、キャンセル、承認（承認には `--act` が必要）。alert は自動で承認されます |
| フレーム | `frame` でセレクターまたは参照によりスコープを設定。参照とロール／名前のロケーターは、切り替えなしで同一オリジン・クロスオリジンの iframe 内に届きます |
| ファイル（`--act`） | `--upload-dir` からの `upload`、`--download-dir` への `download` |
| 証跡 | `screenshot`、`console`（メッセージと未捕捉エラー）、`network`（リクエスト一覧）、失敗時のスクリーンショット、`--record` による動画 |
| サインイン | エンジンの暗号化された認証ボールトを使う `auth_login`、サインインを保持する `--profile` |
| フォールバック | 操作ツールが要素を特定できないと `click_at` と `drag_at` のためのスクリーンショットを返す。`handoff` は人間による確認を見えるウィンドウで人に解いてもらう |

### 要素の特定

操作ツールは、最新のスナップショットの参照、またはロールとアクセシブルネームのどちらかを受け取ります。

```json
{ "action": "click", "args": { "role": "button", "name": "Save" } }
{ "action": "fill", "args": { "role": "textbox", "name": "Flow name", "text": "Weekly report" } }
{ "action": "click", "args": { "role": "button", "name": "Delete", "nth": 1 } }
```

ロールと名前のロケーターは新しいスナップショットを取り、要素が描画されるまで最大 3 秒待ち、iframe 内でも動作します。複数の要素が一致する場合は、推測せずに失敗し、`nth` の指定を求めます。

## コーディングエージェント向け MCP

一度接続すれば、Node プロセスとブラウザーは起動したままになり、各操作はエンジンのデーモンへのメッセージ 1 つで済みます。推論は Claude Code などの MCP クライアントが担います。

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

クライアントに操作させる場合にのみ `agent-fast --act mcp` を使ってください。ツール名は `agent_fast_<操作>` です。クライアントは `tools/list` でツールを確認してください。ツールの引数でセッション、ドメイン許可リスト、ポリシー、カタログを変更することはできません。

結果は、モデルのターンとトークンを節約する形になっています。

- スナップショットは、エンジンの `refs` マップを除いたプレーンテキストで届きます。ツリー自体が各参照を示しています。
- `open`、`back`、`forward`、`reload`、タブの切り替え、URL が変わる操作の後は、結果に新しいページのツリーが含まれるため、モデルはスナップショットを求めずにそのまま操作できます。
- 同じページ内の操作では、`wait_for` と `snapshot` で終わる `batch` が 1 回の呼び出しで操作と確認を行います。
- 一度全体を読んだ後は、`snapshot` に `diff` を付けると、同じ範囲の前回のツリーから追加・削除された行だけを返します。
- 操作ツールが要素を特定できなかった結果（ref、ロールと名前、セレクターが見つからない）にはページのスクリーンショットが付くため、画像を見られるクライアントはそのピクセル座標で `click_at` と `drag_at` に切り替えられます。読み取りの失敗に画像は付きません。必要なのはより良いセレクターです。
- 既定のカタログは軽量です。タブ、フレーム、コンソール、ネットワーク、ドラッグ、ボールトでのログイン、ファイルのツールは `tools/list` に含まれません。どの項目もターンごとにモデルのトークンを消費するためです。`--tools full` ですべてを公開します。
- ブラウザーはクライアントの初期化時に、モデルが最初の呼び出しを考えている間に起動するため、最初の `open` は起動時間を払いません。
- ページに人間による確認が表示されると、結果がそれを伝え、`agent_fast_handoff` を示します。
- サーバーの `initialize` 応答には、これらのパターンがクライアント向けの指示として含まれます。

セッションとプロトコル:

- `--session` を指定しない限り、サーバーごとに独自のブラウザーセッションを使います。あるクライアントが切断しても、別のクライアントのブラウザーは閉じられません。`--keep-open` を指定しない限り、クライアントの切断時にブラウザーを閉じます。
- ブラウザー操作は順番に実行されます。`ping` などのプロトコル要求には、長い待機の途中でもすぐに応答します。
- `notifications/cancelled` は、待機中の要求を取り除くか、実行中の要求の待機を打ち切ります。キャンセルされた要求には応答しません。すでにブラウザーへ送られた操作は、完了することがあります。
- `agent_fast_screenshot` は、パスに加えて画像そのものを返します。

`agent_fast_batch` は、最大 50 個の操作を 1 回の要求で順番に実行します。すべての操作は実行前に検証され、最初の失敗でバッチが止まり、スクリーンショットが返されます。完了済みの操作は取り消されません。

```json
{
  "steps": [
    { "action": "fill", "args": { "role": "textbox", "name": "Search", "text": "example" } },
    { "action": "click", "args": { "role": "button", "name": "Go" } },
    { "action": "assert_text", "args": { "selector": "#output", "text": "Clicked: example" } }
  ]
}
```

## 自律実行

`run` は好きなモデルでブラウザーを操作します。既定は無料のローカルモデルです。

```bash
ollama pull qwen3:4b
ollama serve
agent-fast run "Open https://example.com and report the page title and main heading"
agent-fast --act run "Open https://example.com, use the Learn more link, and summarize the result"
```

既定値: モデルは `qwen3:4b`（`http://127.0.0.1:11434/v1/chat/completions`）、反復は 20 回、モデルの 1 回の応答は 5 分まで（`--model-timeout`。タイムアウトした応答は再試行しません）、移動先は `--allowed-domains` か `--open-web` がない限りタスクに書かれたサイトに限定、`--keep-open` がない限り終了後にブラウザーを閉じます。

このループは小さなモデルを前提に作られています。不正なツール引数、未知のツール、スキーマ違反は、実行を終了させずにモデルへ返します。JSON のテキストとして書かれたツール呼び出しも認識します。ツール呼び出しのない応答を、それだけで成功として扱うことはありません。空の応答は実行を失敗させます。文章による回答は、`done` ツールを求められた後にモデルが同じ回答を繰り返し、かつ結果スキーマが不要な場合にのみ受け入れます。拒否した応答はすべてトレースに残ります。

### ホスト型モデル

モデル名でベンダーが決まり、そのベンダーの通常のキーが読まれます。`claude-*` は Anthropic Messages API と `ANTHROPIC_API_KEY`、`gpt-*` と `o*` は OpenAI と `OPENAI_API_KEY`、`gemini-*` は Google の OpenAI 互換エンドポイントと `GEMINI_API_KEY` を使います。`AGENT_FAST_API_KEY` はどれよりも優先され、独自の `AGENT_FAST_MODEL_URL` には `AGENT_FAST_API_KEY` だけが送られ、いずれもブラウザーエンジンには渡されません。

```bash
AGENT_FAST_MODEL=claude-opus-5-5 agent-fast --act run "Find the pricing page and list the plans"
```

その他の OpenAI 互換エンドポイントは URL を明示すれば使えます。ゲートウェイの chat-completions URL に `claude-*` の名前を組み合わせることもできます。

```bash
export AGENT_FAST_MODEL="your-model"
export AGENT_FAST_MODEL_URL="https://provider.example/v1/chat/completions"
export AGENT_FAST_API_KEY="your-key"  # 任意。エンジンのプロセスには渡されません
agent-fast run "Summarize the current page"
```

画像を見られるモデルには画像が渡ります。`screenshot` の結果と、要素の特定に失敗したときのページがツール結果と一緒に届くため、モデルは見えているものに対して `click_at` へ切り替えられます。Claude の経路では履歴を編集しないため、思考が有効なまま残り、伸びていく前方部分はキャッシュされます。chat completions では最新の画像だけを残し、画像を拒否するテキストのみのモデルには画像なしで要求を送り直します。

リモート推論には費用がかかる場合があり、ページ内容がそのプロバイダーへ送信されます。ループバックの HTTP は利用できますが、ループバック以外のモデルエンドポイントには HTTPS が必要です。

### 構造化された結果

ローカルの JSON Schema を指定すると、`result` に機械可読な出力を必須にできます。

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

不正な結果は修正のためにモデルへ返されます。最終応答には、独立して観測した URL とタイトルの証跡も含まれます。

## モデルを使わないワークフロー再生

成功した実行を保存し、モデルを呼び出さずに再生します。

```bash
agent-fast --act --save-flow ./flow.json run \
  "Open https://example.com and inspect the page"
agent-fast flow ./flow.json
```

保存されたワークフローには成功したステップだけが残ります。操作した要素は参照ではなくロールと名前で記録されるため、ページが要素の番号を振り直しても再生時に見つけられます。ただし、再生がデザイン変更に耐えるわけではありません。ボタンの名前が変われば、スクリーンショット付きで明示的に失敗します。

入力した値はワークフローファイルに書き込まれません。`{{value1}}` のようなプレースホルダーになり、再生時に指定する必要があります。

```bash
agent-fast --act flow ./login-flow.json --param-env value1
```

このコマンドを実行する前に、シークレットマネージャーまたは非表示のターミナル入力で環境変数 `value1` を設定してください。パラメーターごとに `--param-env NAME` を繰り返します。不足、重複、未使用のパラメーターは失敗として扱います。`--param value1=replacement` は機密でない値に使えますが、シェルの履歴やプロセス一覧に表示されます。再生のトレースやページ出力に入力値が現れることもあります。

ワークフローファイルは所有者だけが読める権限でアトミックに書き込まれます。再生にも同じ操作、ドメイン、出力、タイムアウト、読み取り／操作ポリシーの検査が適用されます。

## 人間による確認

Agent-fast は CAPTCHA を解きません。ページに確認（reCAPTCHA、hCaptcha、Turnstile、「あなたが人間であることを確認」）が表示されると、MCP の結果がそれを伝え、`handoff` ツール（または `agent-fast handoff`）がページを人に渡します。`--headed` セッションでは確認が消えるまで待ちます。`--profile` 付きのヘッドレスセッションでは、そのプロファイルで見えるウィンドウを開き直して待ち、ヘッドレスへ戻ってから確認が消えていることを確かめます。戻ってきた場合は失敗として、`--headed` で実行するよう伝えます。プロファイルがない場合は、何を付けて起動すべきかを返します。多くの確認は Cookie をユーザーエージェントに結び付けるため、切り替え後も有効にしたい場合はインストール済みブラウザーを使ってください（[フィンガープリント](#フィンガープリント) を参照）。

## 認証

閉じ込めの強い順に 3 つの方法があります。

1. **認証ボールト。** エンジンは認証情報をローカルの暗号化されたボールトに保持します。エンジンの手順でプロファイルを設定し、名前だけを指定します: `agent-fast auth login my-profile`。パスワードはタスク、コマンドライン、モデルのコンテキストに一切入りません。
2. **専用プロファイル。** `--profile <ディレクトリ>` は、`--headed` のウィンドウで一度サインインした後の Cookie をセッション間で保持します。MFA を伴うサインインに使ってください。
3. **パラメーター。** `--param-env` で指定する再生用プレースホルダー。

認証情報は必ずドメイン許可リストと組み合わせてください。Agent-fast は独自の認証情報ストアを実装せず、個人の Chrome プロファイルに接続することもありません。

## フィンガープリント

ヘッドレスセッションは自動化を名乗りません。起動時に自動化フラグを無効にするため `navigator.webdriver` は false になり、インストール済みブラウザーを使うセッションは `HeadlessChrome` ではなくそのブラウザー本来の簡略化ユーザーエージェントを送ります。Chrome for Testing は起動前にバージョンが分からないため、ヘッドレスのユーザーエージェントのままです。この上書きにより `navigator.userAgentData.brands` は空になり、厳密な検査では気付かれる可能性があります。ネットワーク境界とツールカタログは変わりません。フィンガープリント偽装、プロキシのローテーション、CAPTCHA の自動解決はありません。

## 自動テスト

CLI、MCP、自律実行、保存したワークフローで、準備完了の条件と明示的なアサーションを使えます。

```bash
agent-fast wait-for '#ready'
agent-fast snapshot
agent-fast fill @e2 'test input'
agent-fast select '#country' 'JP'
agent-fast press Enter
agent-fast assert-text '#status' 'Saved'
agent-fast console
```

`assert_text` は、テキストが完全に一致するまで読み取りを繰り返し、タイムアウト時に失敗を報告します。アサーションの失敗、再生ステップの失敗、バッチの失敗、成功しなかった自律実行は、それぞれその時点のページのスクリーンショットを `--artifacts`（既定は `~/.agent-fast/artifacts`）に保存し、パスを返します。`console` と `network` は、ページが出力したログと送信した要求を示します。

## 動画

HTML5 動画を含むページは、WebM と H.264 の MP4 を含めて動作します。プレーヤーのコントロールはスナップショットに現れるため、ページの JavaScript を使わずに再生状況を確認できます。

```bash
agent-fast --act mcp   # 続けて: click {role: "button", name: "play"}、snapshot → slider "video time scrubber": 1.36
```

DRM で保護されたストリーム（Widevine）は Chrome for Testing では再生できません。自律実行または再生の動画を記録するには `--record` を付けます。ファイルは成果物ディレクトリに書き込まれ、そのパスが返されます。

## 性能設計

単発のエンジンクライアントは、操作のたびにプロセスを起動します。Agent-fast は、デーモンの起動と検証のためにセッションごとに一度だけエンジンのクライアントを起動し、その後の操作は JSON 1 行としてデーモンのローカルソケットへ送ります。デーモンは起動時の操作ポリシーを強制するため、この近道で省かれるのはプロセスであり、検査ではありません。Windows では、すべての操作にエンジンのクライアントを使います。

自律実行ではモデルの推論が時間の大半を占めます。上記の遅延の数値が最も効くのは、モデルを呼び出さずに数百の操作を実行する MCP クライアントと再生です。直接経路では、バッチは個別の呼び出しより速くはありません。バッチの価値は、要求が 1 回で済むことと、失敗時に止まることです。

## 検証

macOS では、TypeScript のビルドと 56 件の自動テストがすべて合格し、スキップはありません。そのうち 21 件は実際のブラウザーを操作します。対象は、ブラウザーの検出とヘッドレスのフィンガープリント、要素の特定に失敗したときの画像付き結果、見えるウィンドウへ渡して再起動後も保持される人間による確認、スナップショットの差分、クロスオリジンと入れ子のフレーム、業務アプリを模したページ（独自のコンボボックス、シャドウ DOM、リッチテキストエディター）、ダイアログ、ホバー、ドラッグ＆ドロップ、パス逸脱を試みるアップロード、ダウンロード、コンソールとネットワークの読み取り、スクリーンショット、動画再生、DNS 解決後のプロキシによる遮断、実行中のセッションでのポリシー切り替え、参照の番号が変わった後のワークフローの記録と再生、失敗時のスクリーンショット、台本どおりに応答するモデルを使ったエージェントループの失敗パターン、移動範囲の制限、MCP の ping・キャンセル・セッション分離です。

CI は Linux、macOS、Windows で、ランナー自身の Chrome を使ってテストを実行します。Windows では、デーモンのシグナルのテストとダウンロードの検証をスキップします。テストは Brave でも合格します（`CHROME_PATH` または `--executable-path` で指定）。このリリースで実行していないものは、認証ボールトでのログインです。

エンジンの制限が 1 つ残っています。クロスオリジンのフレームの中にさらにクロスオリジンのフレームがある場合、その内側はスナップショットにもロケーターにも現れません。`click_at` と `drag_at` はスクリーンショットから得たビューポート座標で内側に届き、文字入力はフォーカスのある要素に届きます。ただし、内側のテキストはスクリーンショット以外では読み取れません。

## 制限事項

- どのブラウザーエージェントも、完全な安全性やプロンプトインジェクションへの耐性を保証することはできません。
- 送信プロキシはブラウザー自身の通信に対する強い境界ですが、OS のファイアウォールではありません。ブラウザーの脆弱性を突かれると回避される可能性があります。敵対的なコンテンツには、送信規則を設定したコンテナーまたは VM を使ってください。
- CAPTCHA の自動解決、フィンガープリント偽装、住宅用プロキシサービス、ホスト型ブラウザー群はありません。ユーザーエージェントの上書きにより、クライアントヒントのブランドは空になります。
- Chrome for Testing の UI は英語です。言語ごとに表示名を保存するサイトでは、その言語のインストール済みブラウザーを使ってください。
- DRM 動画は Chrome for Testing では再生できません。
- Windows では、`download` ツールが CI で「Download was canceled」となって失敗し、未検証です。それ以外のテストは、Windows でもエンジンのクライアント経由ですべて合格します。
- ローカルモデルの品質には大きな差があります。上記の評価を参照してください。モデルがツールスキーマに従えない場合は、CLI と MCP の直接操作を利用できます。
- 読み取り専用モードではページの移動と読み取りはできますが、クリックやフォーム入力が必要なワークフローは完了できません。
- デーモンとの直接通信は、固定した `agent-browser` のバージョンに依存します。この依存関係を更新するときは再検証が必要です。
- ページ出力やモデルとの会話には機密データが含まれることがあります。セッションを閉じ、リスクを評価していない限り、規制対象データや個人データを扱わないでください。

## ライセンス

Apache-2.0。詳しくは [LICENSE](LICENSE) を参照してください。エンジン選定の調査は [docs/research.md](docs/research.md) にあります。
