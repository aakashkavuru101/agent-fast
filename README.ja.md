# Agent-fast

[![CI](https://github.com/aakashkavuru101/agent-fast/actions/workflows/ci.yml/badge.svg)](https://github.com/aakashkavuru101/agent-fast/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node.js >=24](https://img.shields.io/badge/node-%3E%3D24-339933?logo=node.js&logoColor=white)](package.json)
[![Ollama local-first](https://img.shields.io/badge/Ollama-local--first-7c3aed)](https://ollama.com/)

[English](README.md)

Agent-fast は、AI エージェントと自動テストのための、Apache-2.0 ライセンスのローカルファーストなブラウザーランタイムです。Apache ライセンスの [`agent-browser`](https://github.com/vercel-labs/agent-browser) エンジンの上に、セキュリティと信頼性の層を重ねています。

- **URL チェックではなく、ネットワーク境界。** ブラウザーのすべての通信はローカルの送信プロキシを通ります。プロキシはドメイン許可リストを強制し、DNS 解決後のアドレスがプライベートであれば遮断します。
- **閉じたツールカタログ。** エージェントには、既定拒否のポリシーの下で型付きのブラウザー操作だけを渡します。JavaScript eval、シェル、エンジンへの生のコマンド経路、任意のファイルアクセスはありません。
- **1 ミリ秒未満の操作。** 起動済みのセッションは約 0.3 ms で応答します。操作ごとにプロセスを起動せず、エンジンのデーモンと直接通信するためです。
- **実際の Web アプリケーション。** クロスオリジン iframe、ダイアログ、ホバー、ドラッグ＆ドロップ、アップロード、ダウンロード、動画、そして Power Apps や Power Automate のようなシングルページアプリに対応します。
- **再生と証跡。** 保存したワークフローは要素をロールと名前で探します。失敗時にはスクリーンショットを残し、指定すれば動画も残します。

アカウント、ホスト型ブラウザー、モデルの契約、テレメトリ、操作ごとの料金はいずれも不要です。エンジン選定の調査は [docs/research.md](docs/research.md) にあります。

## セキュリティ契約

- ループバック、リダイレクト、サブリソース、iframe、WebSocket を含むすべてのブラウザー通信は、セッションごとの送信プロキシを通ります。プロキシはホスト名を解決し、プライベート、ループバック、リンクローカル、NAT64、6to4 のアドレスを拒否したうえで、検査したそのアドレスに接続します。これにより DNS リバインディングや `127.0.0.1.nip.io` 形式の回避を防ぎます。
- `--allowed-domains` または `--allow-preset` を指定すると、プロキシは許可リスト外のホストもすべて拒否します。`127.0.0.1` のような完全一致の指定は、プライベートホストを明示的に許可するためのものです。ワイルドカードではプライベートホストは許可されません。
- 自律実行の `run` は既定で読み取り専用です。モデルによる操作には `--act` が必要です。許可リストがない場合、モデルはタスクに書かれたサイトにしか移動できません。そのため、ページがモデルを誘導してデータを別の場所へ運ばせることはできません。`--open-web` でこの制限を外せます。
- どちらのポリシーも、JavaScript eval、ネットワーク傍受、Cookie・ストレージ・保存状態へのアクセスを拒否します。アップロードとダウンロードは、ディレクトリを指定するまで無効で、指定後もそのディレクトリ内に限定されます。リンクのクリックでページが開始したダウンロードは `~/.agent-fast/downloads` に保存され、利用者自身のダウンロードフォルダーには入りません。
- ページに入力する値は、コマンドライン引数ではなく JSON として渡します。そのため `--action-policy` や `-5` のような文字列もそのまま入力され、エンジンの設定を変えることはできません。
- エンジンはシェルを受け取らず、`AGENT_FAST_API_KEY` や無関係な環境の認証情報を継承しません。
- 既定のブラウザーは独立したセッションです。個人の Chrome プロファイルや任意の CDP エンドポイントには接続しません。`--profile` は専用のディレクトリを使います。
- ページの内容は信頼できないデータとしてモデルに渡します。プロンプトインジェクションのリスクは下がりますが、なくなるわけではありません。
- 制御用の API をネットワークに公開しません。MCP は stdio を使い、プロキシはループバックだけで待ち受けます。

これは設計によるセキュリティであり、完全な安全性の保証ではありません。認証情報を使う前、または影響の大きい Web サイトで操作する前に [SECURITY.md](SECURITY.md) をお読みください。

## 要件

- Node.js 24 以降
- `agent-browser` が対応する macOS、Linux、Windows
- Chrome for Testing（下記の手順でインストール）
- [Ollama](https://ollama.com/)（自律実行の `run` にのみ必要。CLI と MCP での直接操作にモデルは不要）
- `ffmpeg`（`--record` にのみ必要）

## インストール

```bash
npm install
npm run build
node dist/cli.js install
```

必要に応じて CLI を PATH に追加します。

```bash
npm link
agent-fast doctor
```

以下の例では `agent-fast` を使います。リンクしていない場合は `node dist/cli.js` に置き換えてください。

## 直接操作

```bash
agent-fast open https://example.com
agent-fast snapshot
agent-fast get text body
agent-fast screenshot
agent-fast close
```

スナップショットは、iframe 内の要素を含む操作可能な要素に `@e1` のような参照を割り当てます。ページ移動や DOM の変化の後は、参照を使う前にスナップショットを取り直してください。

```bash
agent-fast click @e1
agent-fast fill @e2 "search text"
agent-fast fill @e2 -- -5          # ハイフンで始まる値の前には -- を置く
agent-fast hover @e3
agent-fast press Enter
agent-fast dialog accept
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
| 待機と検証 | `wait`、`wait_for`（セレクターの状態、表示テキスト、URL のグロブ、`networkidle` などの読み込み状態）、`assert_text` |
| 操作（`--act`） | `click`（シングル／ダブル）、`fill`、`type`（実際のキー入力）、`press`、`hover`、`check`、`select`、`drag`、`click_text`、`fill_label`、`click_at` と `drag_at`（ビューポート座標） |
| ダイアログ | `dialog` の状態確認、キャンセル、承認（承認には `--act` が必要）。alert は自動で承認されます |
| フレーム | `frame` でセレクターまたは参照によりスコープを設定。参照とロール／名前のロケーターは、切り替えなしで同一オリジン・クロスオリジンの iframe 内に届きます |
| ファイル（`--act`） | `--upload-dir` からの `upload`、`--download-dir` への `download` |
| 証跡 | `screenshot`、`console`（メッセージと未捕捉エラー）、`network`（リクエスト一覧）、失敗時のスクリーンショット、`--record` による動画 |
| サインイン | エンジンの暗号化された認証ボールトを使う `auth_login`、サインインを保持する `--profile` |

### 要素の特定

操作ツールは、最新のスナップショットの参照、またはロールとアクセシブルネームのどちらかを受け取ります。

```json
{ "action": "click", "args": { "role": "button", "name": "Save" } }
{ "action": "fill", "args": { "role": "textbox", "name": "Flow name", "text": "Weekly report" } }
{ "action": "click", "args": { "role": "button", "name": "Delete", "nth": 1 } }
```

ロールと名前のロケーターは新しいスナップショットを取り、要素が描画されるまで最大 3 秒待ち、iframe 内でも動作します。複数の要素が一致する場合は、推測せずに失敗し、`nth` の指定を求めます。

## Power Platform とその他の Microsoft アプリ

Power Apps、Power Automate、Dynamics 365、Microsoft 365 は、`login.microsoftonline.com` でサインインし、クロスオリジンのフレームを埋め込むシングルページアプリケーションです。Microsoft 用の許可リストのプリセットと専用プロファイルを使うと、サインインがセッションをまたいで保持されます。

```bash
# 最初に一度、表示されたウィンドウでサインインする（パスワード、MFA、同意は利用者自身が行う）
agent-fast --headed --profile ~/.agent-fast/profiles/work --allow-preset microsoft \
  open https://make.powerautomate.com

# 以降のセッションはプロファイルを再利用し、ヘッドレスで動く
agent-fast --profile ~/.agent-fast/profiles/work --allow-preset microsoft \
  open https://make.powerapps.com
agent-fast --profile ~/.agent-fast/profiles/work --allow-preset microsoft wait-for '[role=main]'
agent-fast --profile ~/.agent-fast/profiles/work --allow-preset microsoft snapshot
```

MCP クライアントでは、同じオプションでサーバーを起動します。

```json
{
  "mcpServers": {
    "agent-fast": {
      "command": "node",
      "args": ["/absolute/path/to/agent-fast/dist/cli.js", "--act", "--allow-preset", "microsoft",
               "--profile", "/absolute/path/to/profiles/work", "mcp"]
    }
  }
}
```

これらのアプリケーションでの実用上の注意点です。

- ロールと名前のロケーターを優先してください。作成者ポータルは頻繁に再描画され、参照はすぐ古くなります。
- ページ移動の後は `wait_for` に `text` または `load: "networkidle"` を指定してください。最初の描画の後も読み込みが続きます。
- Fluent のコンボボックスやコードエディターは `fill` を受け付けません。`click` の後に `type` と `press` を使ってください。
- Power Apps Studio のアプリプレビューは、クロスオリジンのフレームの中にあるクロスオリジンのフレームで、エンジンからは中が見えません。`screenshot` を取り、`click_at`、`drag_at`、`type` を使ってください。または、`network` で内側のフレームのアドレスを調べ、`tab_new` で別のタブに開けば、スナップショットとロケーターが通常どおり使えます。
- `agent-fast blocked` は許可リストが拒否したホストを一覧します。テナントが独自ドメインを使う場合は `--allowed-domains` で追加してください。
- プリセットは Microsoft が運用するドメインを広く信頼します。`*.sharepoint.com` のようにテナントのコンテンツを置くドメインも含みます。それが問題になる場合は、より狭い `--allowed-domains` を使ってください。

**確認済みの内容:** 両方の作成者ポータルがプリセット経由で読み込まれ、Microsoft のホストが 1 つも拒否されずに Microsoft のサインインページに到達します。また、構成要素（クロスオリジンのフレーム、ダイアログ、キーボード入力、ドラッグ＆ドロップ、アップロード）はローカルのフィクスチャで合格しています。**未確認の内容:** サインイン後のすべての動作。これには利用者のアカウントが必要で、条件付きアクセスなどのテナントポリシーが自動化されたブラウザーを拒否することもあります。

## 動画

HTML5 動画を含むページは、同梱の Chrome for Testing で動作します。WebM と H.264 の MP4 に対応します。プレーヤーのコントロールはスナップショットに現れるため、ページの JavaScript を使わずに再生状況を確認できます。

```bash
agent-fast --act mcp   # 続けて: click {role: "button", name: "play"}、snapshot → slider "video time scrubber": 1.36
```

DRM で保護されたストリーム（Widevine）は Chrome for Testing では再生できません。

自律実行または再生の動画を記録するには `--record` を付けます。ファイルは成果物ディレクトリに書き込まれ、そのパスが返されます。

```bash
agent-fast --record flow ./flow.json
```

## 構造化された結果

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

## 無料の自律エージェント

Ollama を起動し、ツール呼び出しに対応したモデルを取得します。

```bash
ollama pull qwen3:4b
ollama serve
```

読み取り専用の調査タスクを実行します。

```bash
agent-fast run "Open https://example.com and report the page title and main heading"
```

通常の操作を明示的に許可します。

```bash
agent-fast --act run \
  "Open https://example.com, use the Learn more link, and summarize the result"
```

既定値:

- モデル: `qwen3:4b`
- エンドポイント: `http://127.0.0.1:11434/v1/chat/completions`
- エージェントの最大反復回数: 20
- `--allowed-domains` または `--open-web` を指定しない限り、移動先はタスクに書かれたサイトに限定
- `--keep-open` を指定しない限り、`run` の後にブラウザーを閉じる

このループは小さなモデルを前提に作られています。不正なツール引数、未知のツール、スキーマ違反は、実行を終了させずにモデルへ返します。JSON のテキストとして書かれたツール呼び出しも認識します。ツール呼び出しのない応答を、それだけで成功として扱うことはありません。空の応答は実行を失敗させます。文章による回答は、`done` ツールを求められた後にモデルが同じ回答を繰り返し、かつ結果スキーマが不要な場合にのみ受け入れます。拒否した応答はすべてトレースに残ります。

### タスク成功率の実測

`benchmarks/agent-eval.mjs` は、実際のモデルを使ってローカルページ上の 8 つのタスクを実行し、結果を厳密に検査します。内容は、読み取り、抽出、表の検索、リンクの移動、検索フォーム、iframe 内のフォーム、確認ダイアログ、プロンプトインジェクションのページです。

2026-11-10 に、この macOS arm64 ホストの Ollama で測定した結果です。各タスクを temperature 0 で 1 回ずつ実行しました。測定は、このリリースの最後のレビュー修正の直前に行いました。その修正はループの方針を変えていません。

| モデル | 合格 | 備考 |
| --- | ---: | --- |
| `qwen3.5:9b` | 8 件中 7 件 | 1 タスクあたりモデル呼び出し 1〜4 回、13〜64 秒。不合格の 1 件は表の検索で、プラン名だけを求められたのに文章で答えました。注入された指示には従いませんでした。 |
| `llama3.2:3b` | 8 件中 1 件 | ページは正しく読み取りますが、スキーマに合う結果を付けた `done` 呼び出しを作れず、ステップ上限に達します。 |

3B のモデルは構造化タスクには小さすぎると考えてください。既定の `qwen3:4b` はこの環境に入っておらず、未測定です。合格したモデルの生データは [benchmarks/agent-eval.json](benchmarks/agent-eval.json) にあります。`AGENT_FAST_MODEL=<モデル> npm run benchmark:agent` で再実行できます。

エージェントを変更せずに、別の OpenAI 互換エンドポイントを選択できます。

```bash
export AGENT_FAST_MODEL="your-model"
export AGENT_FAST_MODEL_URL="https://provider.example/v1/chat/completions"
export AGENT_FAST_API_KEY="your-key"  # 任意。エンジンのプロセスには渡されません
agent-fast run "Summarize the current page"
```

リモート推論には費用がかかる場合があり、ページ内容がそのプロバイダーへ送信されます。ループバックの HTTP は利用できますが、ループバック以外のモデルエンドポイントには HTTPS が必要です。

## コーディングエージェント向け MCP

エージェントが繰り返し操作する場合は、MCP で一度だけ接続します。Node プロセスとブラウザーは起動したままになり、各操作はエンジンのデーモンへのメッセージ 1 つで済みます。推論は Claude Code などの MCP クライアントが担うため、2 つ目のモデルループや Ollama プロセスは不要です。

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

クライアントに操作させる場合にのみ `agent-fast --act mcp` を使ってください。ツール名は `agent_fast_<操作>` です。クライアントは `tools/list` でツールを確認してください。ツールの引数でセッション、ドメイン許可リスト、ポリシーを変更することはできません。

- `--session` を指定しない限り、サーバーごとに独自のブラウザーセッションを使います。あるクライアントが切断しても、別のクライアントのブラウザーは閉じられません。`--keep-open` を指定しない限り、クライアントの切断時にブラウザーを閉じます。
- ブラウザー操作は順番に実行されます。`ping` などのプロトコル要求には、長い待機の途中でもすぐに応答します。
- `notifications/cancelled` は、待機中の要求を取り除くか、実行中の要求の待機を打ち切ります。キャンセルされた要求には応答しません。すでにブラウザーへ送られた操作は、完了することがあります。
- `agent_fast_screenshot` は、パスに加えて画像そのものを返します。
- サーバーはパッケージのバージョンを報告し、プロトコルのバージョンをクライアントと取り決めます。

`agent_fast_batch` を使うと、最大 50 個の操作を 1 回の要求で順番に実行できます。すべての操作は実行前に検証され、最初の失敗でバッチが止まり、スクリーンショットが返されます。完了済みの操作は取り消されません。

```json
{
  "steps": [
    { "action": "fill", "args": { "role": "textbox", "name": "Search", "text": "example" } },
    { "action": "click", "args": { "role": "button", "name": "Go" } },
    { "action": "assert_text", "args": { "selector": "#output", "text": "Clicked: example" } }
  ]
}
```

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

## 認証

閉じ込めの強い順に 3 つの方法があります。

1. **認証ボールト。** エンジンは認証情報をローカルの暗号化されたボールトに保持します。エンジンの手順でプロファイルを設定し、名前だけを指定します: `agent-fast auth login my-profile`。パスワードはタスク、コマンドライン、モデルのコンテキストに一切入りません。
2. **専用プロファイル。** `--profile <ディレクトリ>` は、`--headed` のウィンドウで一度サインインした後の Cookie をセッション間で保持します。MFA を伴うサインインに使ってください。
3. **パラメーター。** `--param-env` で指定する再生用プレースホルダー。

認証情報は必ずドメイン許可リストと組み合わせてください。Agent-fast は独自の認証情報ストアを実装せず、個人の Chrome プロファイルに接続することもありません。

## 性能設計

単発のエンジンクライアントは、操作のたびにプロセスを起動します。Agent-fast は、デーモンの起動と検証のためにセッションごとに一度だけエンジンのクライアントを起動し、その後の操作は JSON 1 行としてデーモンのローカルソケットへ送ります。デーモンは起動時の操作ポリシーを強制するため、この近道で省かれるのはプロセスであり、検査ではありません。Windows では、すべての操作にエンジンのクライアントを使います。

固定のループバックページに対してベンチマークを実行します。

```bash
CHROME_PATH=/absolute/path/to/chrome npm run benchmark
```

2026-11-10 に、この macOS arm64 ホストで 50 回測定した中央値です。Node.js 26.12.1、`agent-browser` 0.41.2、Chrome for Testing 157.0.8103.38 を使用しました。これはローカルでの測定値であり、普遍的な順位付けではありません。

| 操作 | 中央値 | p95 |
| --- | ---: | ---: |
| Agent-fast プロセス内 `get title` | 0.29 ms | 0.36 ms |
| Agent-fast 常駐 MCP `get title`（JSON-RPC の往復全体） | 0.44 ms | 0.68 ms |
| Agent-fast MCP バッチ（URL とタイトル） | 0.72 ms | 0.85 ms |
| 常駐プロセス内 Playwright `page.title()` | 0.20 ms | 1.10 ms |
| ネイティブ `agent-browser` の直接実行 `get title`（操作ごとに 1 プロセス） | 3.51 ms | 4.13 ms |
| Agent-fast CLI `get title`（毎回新しい Node プロセス） | 54.47 ms | 61.71 ms |
| `agent-browser` の Node ラッパー直接実行 `get title` | 56.01 ms | 61.67 ms |

バージョン 0.2.0 では、同じホストで MCP が 4.77 ms、プロセス内が 4.52 ms でした。起動済みの操作はおよそ 10 倍速くなり、エンジン自身のネイティブクライアントより速くなっています。単発の CLI コマンドは今も Node の起動時間に縛られます。遅延が重要な場合は MCP を使ってください。呼び出し 1 回あたりでは、常駐の Playwright のほうがわずかに速いままです。直接経路では、バッチは個別の呼び出しより速くはありません。バッチの価値は、要求が 1 回で済むことと、失敗時に止まることです。MCP の初期化には 1 回だけ 242 ms かかりました。生データは [benchmarks/latest.json](benchmarks/latest.json) にあります。

自律実行ではモデルの推論が時間の大半を占めます。これらの数値が最も効くのは、モデルを呼び出さずに数百の操作を実行する MCP クライアントと再生です。

## 検証結果

macOS では、TypeScript のビルドと 41 件の自動テストがすべて合格し、スキップはありません。そのうち 18 件は実際の Chromium を操作します。対象は、クロスオリジンと入れ子のフレーム、作成者ポータルを模したページ（独自のコンボボックス、シャドウ DOM、リッチテキストエディター）、ダイアログ、ホバー、ドラッグ＆ドロップ、パス逸脱を試みるアップロード、ダウンロード、コンソールとネットワークの読み取り、スクリーンショット、動画再生、DNS 解決後のプロキシによる遮断、実行中のセッションでのポリシー切り替え、参照の番号が変わった後のワークフローの記録と再生、失敗時のスクリーンショット、台本どおりに応答するモデルを使ったエージェントループの失敗パターン、移動範囲の制限、MCP の ping・キャンセル・セッション分離です。

手作業でも次を確認しました。再生での `--record`、許可リストと併用した `--profile`、npm の tarball からのクリーンインストール、Power Platform の両方の作成者ポータルが Microsoft のサインインページに到達すること。

CI は Linux、macOS、Windows で合格しています。Windows では、デーモンのシグナルのテストとダウンロードの検証をスキップします。このリリースで実行していないものは次のとおりです。Microsoft のサインイン後の動作、認証ボールトでのログイン、既定の `qwen3:4b` モデル。

エンジンの制限が 1 つ残っています。Power Apps Studio のアプリプレビューのように、クロスオリジンのフレームの中にさらにクロスオリジンのフレームがある場合、その内側はスナップショットにもロケーターにも現れません。`click_at` と `drag_at` はスクリーンショットから得たビューポート座標で内側に届き、文字入力はフォーカスのある要素に届きます。ただし、内側のテキストはスクリーンショット以外では読み取れません。

## 制限事項

- どのブラウザーエージェントも、完全な安全性やプロンプトインジェクションへの耐性を保証することはできません。
- 送信プロキシはブラウザー自身の通信に対する強い境界ですが、OS のファイアウォールではありません。ブラウザーの脆弱性を突かれると回避される可能性があります。敵対的なコンテンツには、送信規則を設定したコンテナーまたは VM を使ってください。
- Microsoft のサインイン後の動作はここでは未確認です。テナントのポリシーが自動化されたブラウザーを遮断することもあります。
- CAPTCHA の回避、ステルス用フィンガープリント、住宅用プロキシサービス、ホスト型ブラウザー群は内蔵していません。
- DRM 動画は Chrome for Testing では再生できません。
- Windows では、`download` ツールが CI で「Download was canceled」となって失敗し、未検証です。それ以外のテストは、Windows でもエンジンのクライアント経由ですべて合格します。
- ローカルモデルの品質には大きな差があります。上記の実測結果を参照してください。モデルがツールスキーマに従えない場合は、CLI と MCP の直接操作を利用できます。
- 読み取り専用モードではページの移動と読み取りはできますが、クリックやフォーム入力が必要なワークフローは完了できません。
- デーモンとの直接通信は、固定した `agent-browser` のバージョンに依存します。この依存関係を更新するときは再検証が必要です。
- ページ出力やモデルとの会話には機密データが含まれることがあります。セッションを閉じ、リスクを評価していない限り、規制対象データや個人データを扱わないでください。

## ライセンス

Apache-2.0。詳しくは [LICENSE](LICENSE) を参照してください。
