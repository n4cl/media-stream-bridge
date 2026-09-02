# Media Stream Bridge

## 機能

- 閲覧中のタブで検出した HLS ストリーム候補を表示する
- 候補が一つなら自動選択し、複数なら保存する候補を選べる
- 既定の保存先へすぐに保存できる
- ファイル名と保存先を指定して保存できる
- 保存中、完了、失敗、キャンセルの状態を確認できる
- 保存中の処理をキャンセルできる
- 同名ファイルを上書きせず、失敗・キャンセル時の途中ファイルを削除する

## 対応環境

- macOS
- Node.js 20 以上
- ffmpeg
- Firefox Developer Edition

## セットアップ

依存関係をインストールしてビルドする。

```sh
npm install
npm run build
```

Native Host を登録する。`ffmpeg` は `PATH`、`/opt/homebrew/bin/ffmpeg`、`/usr/local/bin/ffmpeg`、`/usr/bin/ffmpeg` の順に探索される。

```sh
node scripts/install-native-host.mjs
```

この操作により、Native Host の manifest とランチャーが次の場所に作成される。

- `~/Library/Application Support/Mozilla/NativeMessagingHosts/`
- `~/Library/Application Support/Media Stream Bridge/`

## 起動と使い方

次のコマンドで Firefox Developer Edition を起動する。拡張機能は一時プロファイルへ読み込まれる。

```sh
npm run start:firefox
```

1. 対象の動画ページを開く。
2. ツールバーの Media Stream Bridge を開く。
3. 保存するストリームを確認または選択する。
4. `保存`、または `設定して保存` を選ぶ。
5. Popup で保存結果を確認する。

`保存` は `~/Downloads/Media Stream Bridge/` にランダムID付きの `.mp4` を作成する。`設定して保存` では、今回に限りファイル名と `Downloads` または `Movies` を選べる。拡張子を省略した名前には `.mp4` を付与する。

## 制約

- DRM で保護されていない HLS VOD（`.m3u8`）だけを対象とする
- URL 単体を ffmpeg へ渡して取得できるストリームだけを対象とする
- Cookie、`Authorization`、`Referer` などの認証状態や追加 HTTP ヘッダーは引き継がない
- DRM の解除、認証やアクセス制御の回避は行わない
- MPEG-DASH、ライブストリーム、直接配信の MP4／WebM は対象外
- Firefox 以外のブラウザと、サイト固有の検出・選択処理は対象外

## 開発

```sh
npm run check
```

`check` はフォーマット検査、lint、ビルド、拡張 manifest の検査、テストを実行する。

## ドキュメント

- [初期版ロードマップ](docs/roadmap.md)
- [基本設計](docs/design/architecture.md)
- [開発方針](docs/development.md)
