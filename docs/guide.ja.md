# Agent-fast ガイド

[README](../README.ja.md) の背後にある完全なリファレンスです。すべてのコマンド、ツールカタログ、要素の特定、構造化された結果、テスト、動画、フィンガープリント、性能設計、テストスイートの範囲を説明します。

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

## MCP のセッションとバッチ

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

